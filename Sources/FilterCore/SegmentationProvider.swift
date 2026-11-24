import Foundation
import CoreGraphics
import CoreVideo
import ImageIO
import UniformTypeIdentifiers
import Vision

public enum ProviderCapability: String, Codable, CaseIterable {
    case personMask
}

public protocol SegmentationProvider {
    var identifier: String { get }
    var capabilities: Set<ProviderCapability> { get }
    func personMaskPNG(for imageData: Data) throws -> Data?
}

public enum SegmentationError: Error {
    case noUsableMask
    case maskEncodingFailed
}

/// Vision schedules inference on available Apple hardware unless CPU-only mode is requested.
public final class VisionPersonSegmentationProvider: SegmentationProvider {
    public let identifier = "apple-vision-person"
    public let capabilities: Set<ProviderCapability> = [.personMask]

    public init() {}

    public func personMaskPNG(for imageData: Data) throws -> Data? {
        _ = try ImageInputValidator.validate(imageData)
        return try mask(imageData, silhouetteOnly: false)
    }

    /// A completed segmentation with no confident foreground is a successful negative.
    public func silhouettePNG(for imageData: Data) throws -> Data? {
        _ = try ImageInputValidator.validate(imageData)
        return try mask(imageData, silhouetteOnly: true)
    }

    private func mask(_ data: Data, silhouetteOnly: Bool) throws -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1536
              ] as CFDictionary) else { throw SegmentationError.noUsableMask }
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        request.usesCPUOnly = false
        let handler = VNImageRequestHandler(cgImage: upright, options: [:])
        try handler.perform([request])
        guard let pixelBuffer = request.results?.first?.pixelBuffer else { throw SegmentationError.noUsableMask }
        return try Self.pngFromAlphaMask(pixelBuffer, silhouetteOnly: silhouetteOnly)
    }

    private static func pngFromAlphaMask(_ pixelBuffer: CVPixelBuffer, silhouetteOnly: Bool) throws -> Data? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard let source = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            throw SegmentationError.noUsableMask
        }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let sourceStride = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard width > 0, height > 0, width <= 2048, height <= 2048 else {
            throw SegmentationError.noUsableMask
        }

        var rgba = Data(repeating: 0, count: width * height * 4)
        var hasForeground = false
        rgba.withUnsafeMutableBytes { destination in
            guard let output = destination.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            let input = source.assumingMemoryBound(to: UInt8.self)
            for y in 0..<height {
                for x in 0..<width {
                    let confidence = input[y * sourceStride + x]
                    if confidence >= 128 { hasForeground = true }
                    let alpha = silhouetteOnly ? UInt8(clamping: (Int(confidence) - 80) * 3) : confidence
                    let offset = (y * width + x) * 4
                    output[offset] = 255
                    output[offset + 1] = 255
                    output[offset + 2] = 255
                    output[offset + 3] = alpha
                }
            }
        }

        if silhouetteOnly && !hasForeground { return nil }
        guard let provider = CGDataProvider(data: rgba as CFData),
              let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue).union(.byteOrder32Big),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else {
            throw SegmentationError.maskEncodingFailed
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else {
            throw SegmentationError.maskEncodingFailed
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw SegmentationError.maskEncodingFailed }
        return output as Data
    }
}
