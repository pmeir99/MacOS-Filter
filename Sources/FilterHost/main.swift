import Foundation
import AppKit
import CryptoKit
import FilterCore
import CoreML
import Vision
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

enum FilterHostMain {
    private static let provider = VisionPersonSegmentationProvider()

    private static let classifier: VNCoreMLModel? = {
        let binary = URL(fileURLWithPath: CommandLine.arguments[0])
        let url = binary.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Resources/Nudity.mlmodelc")
        let config = MLModelConfiguration()
        config.computeUnits = .all
        guard let model = try? MLModel(contentsOf: url, configuration: config) else { return nil }
        return try? VNCoreMLModel(for: model)
    }()

    private static let maskCache: NSCache<NSString, NSString> = {
        let cache = NSCache<NSString, NSString>()
        cache.countLimit = 128
        cache.totalCostLimit = 12 * 1024 * 1024
        return cache
    }()

    private static let personCache: NSCache<NSData, NSNumber> = {
        let cache = NSCache<NSData, NSNumber>()
        cache.countLimit = 512
        return cache
    }()

    private static func personPresent(in data: Data) throws -> Bool {
        let digest = Data(SHA256.hash(data: data)) as NSData
        if let cached = personCache.object(forKey: digest) { return cached.boolValue }
        _ = try ImageInputValidator.validate(data)
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1024
              ] as CFDictionary) else { throw NativeProtocolError.invalidFrame }
        let bodies = VNDetectHumanRectanglesRequest()
        bodies.upperBodyOnly = false
        let faces = VNDetectFaceRectanglesRequest()
        try VNImageRequestHandler(cgImage: upright).perform([bodies, faces])
        guard let people = bodies.results, let portraits = faces.results else { throw NativeProtocolError.invalidFrame }
        let found = !people.isEmpty || !portraits.isEmpty
        personCache.setObject(NSNumber(value: found), forKey: digest)
        return found
    }

    private static let outputLock = NSLock()
    private static var watcher: DispatchSourceFileSystemObject?

    private static func send(_ response: NativeResponse) throws {
        let frame = try NativeMessageCodec.frame(JSONEncoder().encode(response))
        outputLock.lock()
        defer { outputLock.unlock() }
        FileHandle.standardOutput.write(frame)
    }

    private static func subscribe(initial: FilterSettings) throws {
        guard watcher == nil else { return }
        let directory = SettingsStore.fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fd = open(directory.path, O_EVTONLY)
        guard fd >= 0 else { throw POSIXError(.EIO) }
        var previous = initial
        let version = installedVersion()
        let queue = DispatchQueue(label: "filter.preferences")
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename], queue: queue)
        let changed: () -> Void = {
            if installedVersion() != version {
                try? send(NativeResponse(requestID: "reloadExtension", ok: true))
                source.cancel()
                return
            }
            let current = SettingsStore.load()
            if previous != current {
                previous = current
                try? send(NativeResponse(requestID: "settingsChanged", ok: true, settings: current))
            }
        }
        source.setEventHandler(handler: changed)
        source.setCancelHandler { close(fd) }
        watcher = source
        source.resume()
        // Catch a save between the subscription snapshot and attaching the directory watch.
        queue.async(execute: DispatchWorkItem(block: changed))
    }

    private static func installedVersion() -> Data? {
        let url = SettingsStore.fileURL.deletingLastPathComponent().appendingPathComponent("ChromeExtension/manifest.json")
        return try? Data(contentsOf: url)
    }

    static func main() {
        guard let caller = CommandLine.arguments.dropFirst().first,
              caller.hasPrefix("chrome-extension://") else {
            FileHandle.standardError.write(Data("Expected a Chrome extension origin.\n".utf8))
            return
        }

        do {
            while let payload = try readNextPayload() {
                try autoreleasepool {
                let request = try JSONDecoder().decode(NativeRequest.self, from: payload)
                try request.validate()
                let response = handle(request)
                try send(response)
                if request.action == .subscribe, let settings = response.settings { try subscribe(initial: settings) }
                }
            }
        } catch {
            FileHandle.standardError.write(Data("Native host stopped: \(error)\n".utf8))
        }
    }

    private static func readExactly(_ count: Int) throws -> Data? {
        var result = Data()
        while result.count < count {
            let chunk = FileHandle.standardInput.readData(ofLength: count - result.count)
            if chunk.isEmpty {
                if result.isEmpty { return nil }
                throw NativeProtocolError.invalidFrame
            }
            result.append(chunk)
        }
        return result
    }

    private static func readNextPayload() throws -> Data? {
        guard let header = try readExactly(4) else { return nil }
        let length = try NativeMessageCodec.payloadLength(from: header)
        guard let payload = try readExactly(length), payload.count == length else {
            throw NativeProtocolError.frameLengthMismatch
        }
        return payload
    }

    // Normalize EXIF orientation before detection. Vision boxes and the mask
    // context both use bottom-left normalized coordinates.
    private static func faceMask(_ data: Data) throws -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 640
              ] as CFDictionary) else { return nil }
        let detection = VNDetectFaceRectanglesRequest()
        try VNImageRequestHandler(cgImage: thumbnail, options: [:]).perform([detection])
        guard let faces = detection.results, !faces.isEmpty else { return nil }
        let w = thumbnail.width, h = thumbnail.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.setFillColor(gray: 1, alpha: 1)
        for face in faces {
            let box = VNImageRectForNormalizedRect(face.boundingBox, w, h)
            ctx.fill(box.insetBy(dx: -box.width * 0.12, dy: -box.height * 0.15))
        }
        let output = NSMutableData()
        guard let mask = ctx.makeImage(), let destination = CGImageDestinationCreateWithData(
            output, UTType.png.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, mask, nil)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }

    private static func handle(_ request: NativeRequest) -> NativeResponse {
        var settings = request.settings ?? SettingsStore.load()
        if let mode = request.modeOverride { settings.mode = mode }
        if let cutoff = request.cutoffOverride { settings.blockThreshold = min(0.95, max(0.1, cutoff)) }
        switch request.action {
        case .updatePreference:
            let domain = "com.pmeir99.MacOS-Filter" as CFString
            let key = "checkForUpdatesAutomatically" as CFString
            if let enabled = request.automaticUpdates {
                CFPreferencesSetAppValue(key, enabled ? kCFBooleanTrue : kCFBooleanFalse, domain)
            }
            let saved = CFPreferencesAppSynchronize(domain)
            var response = NativeResponse(requestID: request.requestID, ok: saved)
            response.automaticUpdates = CFPreferencesGetAppBooleanValue(key, domain, nil)
            return response
        case .openSettings:
            let app = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent()
            let opened = NSWorkspace.shared.open(app)
            return NativeResponse(requestID: request.requestID, ok: opened)
        case .subscribe:
            return NativeResponse(requestID: request.requestID, ok: true, settings: settings)
        case .getSettings:
            return NativeResponse(requestID: request.requestID, ok: true, settings: settings)
        case .segment, .segmentWithPolicy:
            guard settings.enabled else {
                return NativeResponse(requestID: request.requestID, ok: false, error: "Filtering is paused.")
            }
            if settings.mode == .entireImage {
                return NativeResponse(requestID: request.requestID, ok: true, coverWholeImage: true)
            }
            guard let encoded = request.imageData,
                  let imageData = Data(base64Encoded: encoded) else {
                return NativeResponse(
                    requestID: request.requestID,
                    ok: false,
                    coverWholeImage: true,
                    error: "The image request could not be decoded."
                )
            }
            do {
                if settings.mode == .personBlur {
                    var response = NativeResponse(requestID: request.requestID, ok: true)
                    response.personDetected = try personPresent(in: imageData)
                    return response
                }
                let digest = Data(SHA256.hash(data: imageData)).base64EncodedString()
                if settings.mode == .peopleOnly {
                    let key = ("silhouette:" + digest) as NSString
                    let encoded: String
                    if let cached = maskCache.object(forKey: key) {
                        encoded = cached as String
                    } else {
                        encoded = try provider.silhouettePNG(for: imageData)?.base64EncodedString() ?? ""
                        guard encoded.utf8.count < 700_000 else { throw SegmentationError.maskEncodingFailed }
                        maskCache.setObject(encoded as NSString, forKey: key, cost: encoded.utf8.count)
                    }
                    var response = NativeResponse(requestID: request.requestID, ok: true,
                                                  maskData: encoded.isEmpty ? nil : encoded)
                    response.personDetected = !encoded.isEmpty
                    return response
                }
                let encoder = JSONEncoder()
                encoder.outputFormatting = .sortedKeys
                var maskSettings = settings
                maskSettings.siteRules = nil
                let policyKey = try encoder.encode(maskSettings).base64EncodedString()
                let key = "\(settings.mode.rawValue)|\(settings.blockThreshold ?? 0.7)|\(policyKey)|\(digest)" as NSString
                if let cached = maskCache.object(forKey: key) {
                    return NativeResponse(requestID: request.requestID, ok: true, maskData: cached as String)
                }
                _ = try ImageInputValidator.validate(imageData)
                guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
                      CGImageSourceGetCount(source) == 1 else {
                    return NativeResponse(requestID: request.requestID, ok: true, coverWholeImage: true)
                }
                if settings.mode == .adaptive || settings.mode == .policy {
                    guard let classifier else { throw NativeProtocolError.invalidFrame }
                    let analysis = VNCoreMLRequest(model: classifier)
                    analysis.imageCropAndScaleOption = .scaleFill
                    try VNImageRequestHandler(data: imageData).perform([analysis])
                    guard let scores = analysis.results as? [VNClassificationObservation],
                          let risk = scores.first(where: { $0.identifier.uppercased() == "NSFW" }) else {
                        throw NativeProtocolError.invalidFrame
                    }
                    if Double(risk.confidence) >= (settings.blockThreshold ?? 0.7) {
                        return NativeResponse(requestID: request.requestID, ok: true, coverWholeImage: true)
                    }
                }
                if settings.mode == .skin || settings.mode == .policy {
                    let decision = try PolicyEngine.shared.analyze(imageData, settings: settings)
                    if let mask = decision.mask {
                        maskCache.setObject(mask as NSString, forKey:key, cost:mask.utf8.count)
                        return NativeResponse(requestID:request.requestID,ok:true,maskData:mask)
                    }
                    return NativeResponse(requestID:request.requestID,ok:true,coverWholeImage:true)
                }
                let region: Data?
                if settings.mode == .faces {
                    region = try faceMask(imageData)
                } else {
                    region = try provider.personMaskPNG(for: imageData)
                }
                guard let mask = region else {
                    return NativeResponse(requestID: request.requestID, ok: true, coverWholeImage: true)
                }
                let maskBase64 = mask.base64EncodedString()
                guard maskBase64.utf8.count < 700_000 else {
                    return NativeResponse(requestID: request.requestID, ok: false, coverWholeImage: true, error: "Mask exceeded the safe response size.")
                }
                maskCache.setObject(maskBase64 as NSString, forKey: key, cost: maskBase64.utf8.count)
                return NativeResponse(requestID: request.requestID, ok: true, maskData: maskBase64)
            } catch {
                let reason: String
                if settings.mode == .peopleOnly {
                    if let segmentation = error as? SegmentationError {
                        reason = "Person segmentation: "+String(describing: segmentation)
                    } else {
                        let detail = error as NSError
                        reason = "Person segmentation: "+detail.domain+" ("+String(detail.code)+")"
                    }
                } else { reason = "Local image analysis failed." }
                return NativeResponse(requestID: request.requestID, ok: false, coverWholeImage: true, error: reason)
            }
        }
    }
}

FilterHostMain.main()
