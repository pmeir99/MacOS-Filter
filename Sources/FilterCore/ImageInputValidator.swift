import Foundation
import ImageIO

public struct ImageDimensions: Equatable {
    public let width: Int
    public let height: Int
}

public enum ImageInputError: Error, Equatable {
    case encodedImageTooLarge
    case unsupportedOrCorruptImage
    case dimensionsUnavailable
    case pixelLimitExceeded
}

public enum ImageInputValidator {
    public static let maximumEncodedBytes = 8 * 1024 * 1024
    public static let maximumPixelCount = 24_000_000

    public static func validate(_ data: Data) throws -> ImageDimensions {
        guard !data.isEmpty, data.count <= maximumEncodedBytes else {
            throw ImageInputError.encodedImageTooLarge
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) else {
            throw ImageInputError.unsupportedOrCorruptImage
        }
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { throw ImageInputError.dimensionsUnavailable }
        guard width <= maximumPixelCount / height else { throw ImageInputError.pixelLimitExceeded }
        return ImageDimensions(width: width, height: height)
    }
}
