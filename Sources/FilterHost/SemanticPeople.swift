import CoreML
import CoreVideo
import FilterCore
import Foundation
import ImageIO
import Vision

/// DeepLab's output is a PASCAL VOC class index at each input pixel.
enum SemanticPeople {
    private static let model: VNCoreMLModel? = {
        let resources = URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        guard let compiled = try? MLModel(contentsOf: resources.appendingPathComponent("DeepLabV3FP16.mlmodelc"),
                                          configuration: configuration) else { return nil }
        return try? VNCoreMLModel(for: compiled)
    }()

    static func mask(_ data: Data) throws -> Data? {
        _ = try ImageInputValidator.validate(data)
        guard let model, let source = CGImageSourceCreateWithData(data as CFData,nil),
              CGImageSourceGetCount(source) == 1,
              let image = CGImageSourceCreateThumbnailAtIndex(source,0,[
                kCGImageSourceCreateThumbnailFromImageAlways:true,
                kCGImageSourceCreateThumbnailWithTransform:true,
                kCGImageSourceThumbnailMaxPixelSize:1024
              ] as CFDictionary) else { throw SegmentationError.unsupportedImage }
        let request = VNCoreMLRequest(model: model)
        request.imageCropAndScaleOption = .scaleFill
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        guard let result = request.results?.first as? VNCoreMLFeatureValueObservation,
              let labels = result.featureValue.multiArrayValue,
              labels.shape.count >= 2, labels.shape.dropLast(2).allSatisfy({ $0.intValue == 1 }) else {
            throw SegmentationError.noUsableMask
        }
        let dims = labels.shape.suffix(2).map(\.intValue)
        let steps = labels.strides.suffix(2).map(\.intValue)
        let h = dims[0], w = dims[1]
        guard w>0, h>0, w<=1024, h<=1024 else { throw SegmentationError.noUsableMask }
        var buffer: CVPixelBuffer?
        guard CVPixelBufferCreate(nil,w,h,kCVPixelFormatType_OneComponent8,nil,&buffer)==kCVReturnSuccess,
              let buffer else { throw SegmentationError.noUsableMask }
        CVPixelBufferLockBaseAddress(buffer, [])
        guard let destination = CVPixelBufferGetBaseAddress(buffer) else {
            CVPixelBufferUnlockBaseAddress(buffer, [])
            throw SegmentationError.noUsableMask
        }
        let output = destination.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        var count = 0
        func copyLabels<T: BinaryInteger>(_ input: UnsafePointer<T>) {
            for y in 0..<h {
                for x in 0..<w {
                    let person = input[y*steps[0]+x*steps[1]] == 15
                    output[y*stride+x] = person ? 255 : 0
                    if person { count += 1 }
                }
            }
        }
        if labels.dataType == .int32 {
            copyLabels(UnsafePointer(labels.dataPointer.assumingMemoryBound(to: Int32.self)))
        } else {
            for y in 0..<h {
                for x in 0..<w {
                    let person = labels[y*steps[0]+x*steps[1]].intValue == 15
                    output[y*stride+x] = person ? 255 : 0
                    if person { count += 1 }
                }
            }
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        guard count >= 8 else { return nil }
        return try VisionPersonSegmentationProvider.encodeSilhouette(buffer)
    }
}
