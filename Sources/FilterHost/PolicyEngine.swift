import Foundation
import Vision
import ImageIO
import FilterCore

enum PolicyFailure: Error { case unavailable, invalidResult }

final class PolicyEngine {
    static let shared = PolicyEngine()
    private var worker: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private struct Payload: Encodable {
        var imageData: String
        var boxes: [[Double]]
        var settings: FilterSettings
    }
    struct Decision: Decodable {
        let full: Bool?
        let mask: String?
    }
    private func connect() throws {
        if worker?.isRunning == true { return }
        let dir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        let process = Process(), send = Pipe(), receive = Pipe()
        process.executableURL = dir.appendingPathComponent("PolicyWorker")
        process.arguments = [dir.deletingLastPathComponent().appendingPathComponent("Resources/PolicyModels").path]
        process.standardInput = send
        process.standardOutput = receive
        try process.run()
        worker = process
        input = send.fileHandleForWriting
        output = receive.fileHandleForReading
    }
    func analyze(_ data: Data, settings: FilterSettings) throws -> Decision {
        guard let src = CGImageSourceCreateWithData(data as CFData,nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(src,0,[
                kCGImageSourceCreateThumbnailWithTransform:true,
                kCGImageSourceCreateThumbnailFromImageAlways:true,
                kCGImageSourceThumbnailMaxPixelSize:768
              ] as CFDictionary) else { throw PolicyFailure.invalidResult }
        let people = VNDetectHumanRectanglesRequest()
        people.upperBodyOnly = false
        try VNImageRequestHandler(cgImage:thumbnail,options:[:]).perform([people])
        let boxes = (people.results ?? []).map { person -> [Double] in
            let box = person.boundingBox.insetBy(dx:-0.015,dy:-0.015)
            return [Double(box.minX),Double(1-box.maxY),Double(box.width),Double(box.height)]
        }
        try connect()
        guard let input, let output else { throw PolicyFailure.unavailable }
        do {
            var payload = try JSONEncoder().encode(Payload(imageData:data.base64EncodedString(),boxes:boxes,settings:settings))
            payload.append(10)
            try input.write(contentsOf:payload)
            var result = Data()
            while result.last != 10 {
                let chunk = output.availableData
                guard !chunk.isEmpty, result.count + chunk.count < 720000 else { throw PolicyFailure.invalidResult }
                result.append(chunk)
            }
            let parsed = try JSONDecoder().decode(Decision.self,from:result)
            guard parsed.full == true || parsed.mask != nil else { throw PolicyFailure.invalidResult }
            return parsed
        } catch {
            if worker?.isRunning == true { worker?.terminate() }
            worker = nil
            throw error
        }
    }
}
