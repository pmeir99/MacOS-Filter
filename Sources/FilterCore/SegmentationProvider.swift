import Foundation
import CoreGraphics
import CoreImage
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

/// Fast, local baseline. Vision supplies the model and can schedule work on
/// Apple's available accelerators without shipping third-party weights.
public final class VisionPersonSegmentationProvider: SegmentationProvider {
    public let identifier = "apple-vision-person"
    public let capabilities: Set<ProviderCapability> = [.personMask]

    public init() {}

    public func personMaskPNG(for imageData: Data) throws -> Data? {
        _ = try ImageInputValidator.validate(imageData)
        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = .accurate
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(data: imageData, options: [:])
        try handler.perform([request])
        guard let pixelBuffer = request.results?.first?.pixelBuffer else { return nil }
        return try Self.pngFromAlphaMask(pixelBuffer)
    }

    private static func pngFromAlphaMask(_ pixelBuffer: CVPixelBuffer) throws -> Data {
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
        rgba.withUnsafeMutableBytes { destination in
            guard let output = destination.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            let input = source.assumingMemoryBound(to: UInt8.self)
            for y in 0..<height {
                for x in 0..<width {
                    let alpha = input[y * sourceStride + x]
                    let offset = (y * width + x) * 4
                    output[offset] = 255
                    output[offset + 1] = 255
                    output[offset + 2] = 255
                    output[offset + 3] = alpha
                }
            }
        }

        let provider = CGDataProvider(data: rgba as CFData)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmap = CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue).union(.byteOrder32Big)
        guard let provider,
              let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: bitmap,
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
