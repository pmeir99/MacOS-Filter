import Foundation
import FilterCore
import CoreML
import Vision
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

@main
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

    static func main() {
        guard let caller = CommandLine.arguments.dropFirst().first,
              caller.hasPrefix("chrome-extension://") else {
            FileHandle.standardError.write(Data("Expected a Chrome extension origin.\n".utf8))
            return
        }

        do {
            while let payload = try readNextPayload() {
                let request = try JSONDecoder().decode(NativeRequest.self, from: payload)
                try request.validate()
                let response = handle(request)
                let responseData = try JSONEncoder().encode(response)
                FileHandle.standardOutput.write(try NativeMessageCodec.frame(responseData))
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
        var settings = SettingsStore.load()
        if let mode = request.modeOverride { settings.mode = mode }
        if let cutoff = request.cutoffOverride { settings.blockThreshold = min(0.95, max(0.1, cutoff)) }
        switch request.action {
        case .getSettings:
            return NativeResponse(requestID: request.requestID, ok: true, settings: settings)
        case .segment:
            guard settings.enabled else {
                return NativeResponse(requestID: request.requestID, ok: false, error: "Filtering is disabled in the Mac app.")
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
                _ = try ImageInputValidator.validate(imageData)
                guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
                      CGImageSourceGetCount(source) == 1 else {
                    return NativeResponse(requestID: request.requestID, ok: true, coverWholeImage: true)
                }
                if settings.mode == .adaptive {
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
                return NativeResponse(requestID: request.requestID, ok: true, maskData: maskBase64)
            } catch {
                return NativeResponse(requestID: request.requestID, ok: false, coverWholeImage: true, error: "Local image analysis failed.")
            }
        }
    }
}
