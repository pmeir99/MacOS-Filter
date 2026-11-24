import Foundation
import FilterCore

@main
enum FilterHostMain {
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

    private static func handle(_ request: NativeRequest) -> NativeResponse {
        let settings = SettingsStore.load()
        guard settings.enabled else {
            return NativeResponse(requestID: request.requestID, ok: false, error: "Filtering is disabled in the Mac app.")
        }

        switch request.action {
        case .getSettings:
            return NativeResponse(requestID: request.requestID, ok: true, settings: settings)
        case .segment:
            guard settings.mode == .allPeople,
                  let encoded = request.imageData,
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
                guard let mask = try VisionPersonSegmentationProvider().personMaskPNG(for: imageData) else {
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
