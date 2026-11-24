import Foundation

public enum NativeAction: String, Codable {
    case getSettings
    case subscribe
    case openSettings
    case segment
    case segmentWithPolicy
    case updatePreference
}

public struct NativeRequest: Codable {
    public let protocolVersion: Int
    public let requestID: String
    public let action: NativeAction
    public let modeOverride: FilterMode?
    public let cutoffOverride: Double?
    public let settings: FilterSettings?
    public let automaticUpdates: Bool?
    public let imageData: String?

    public init(protocolVersion: Int = 1, requestID: String, action: NativeAction, imageData: String? = nil) {
        self.protocolVersion = protocolVersion
        self.requestID = requestID
        self.action = action
        self.modeOverride = nil
        self.cutoffOverride = nil
        self.settings = nil
        self.automaticUpdates = nil
        self.imageData = imageData
    }

    public func validate() throws {
        guard protocolVersion == 1 else { throw NativeProtocolError.unsupportedVersion }
        guard !requestID.isEmpty, requestID.utf8.count <= 128 else { throw NativeProtocolError.invalidRequestID }
        if action == .segmentWithPolicy && settings == nil { throw NativeProtocolError.invalidFrame }
        if action == .segment || action == .segmentWithPolicy {
            guard let imageData, !imageData.isEmpty else { throw NativeProtocolError.missingImage }
            guard imageData.utf8.count <= 11_200_000 else { throw NativeProtocolError.messageTooLarge }
        }
    }
}

public struct NativeResponse: Codable {
    public let protocolVersion: Int
    public let requestID: String
    public let ok: Bool
    public var settings: FilterSettings?
    public var automaticUpdates: Bool?
    public var maskData: String?
    public var coverWholeImage: Bool?
    public var error: String?

    public init(
        requestID: String,
        ok: Bool,
        settings: FilterSettings? = nil,
        maskData: String? = nil,
        coverWholeImage: Bool? = nil,
        error: String? = nil
    ) {
        self.protocolVersion = 1
        self.requestID = requestID
        self.ok = ok
        self.settings = settings
        self.maskData = maskData
        self.coverWholeImage = coverWholeImage
        self.error = error
    }
}

public enum NativeProtocolError: Error, Equatable {
    case unsupportedVersion
    case invalidRequestID
    case missingImage
    case messageTooLarge
    case invalidFrame
    case frameLengthMismatch
}

public enum NativeMessageCodec {
    public static let maximumPayloadLength = 12 * 1024 * 1024

    public static func frame(_ payload: Data) throws -> Data {
        guard payload.count <= maximumPayloadLength, payload.count <= Int(UInt32.max) else {
            throw NativeProtocolError.messageTooLarge
        }
        let length = UInt32(payload.count)
        var framed = Data([
            UInt8(length & 0xff),
            UInt8((length >> 8) & 0xff),
            UInt8((length >> 16) & 0xff),
            UInt8((length >> 24) & 0xff)
        ])
        framed.append(payload)
        return framed
    }

    public static func payloadLength(from header: Data) throws -> Int {
        guard header.count == 4 else { throw NativeProtocolError.invalidFrame }
        let length = UInt32(header[0])
            | (UInt32(header[1]) << 8)
            | (UInt32(header[2]) << 16)
            | (UInt32(header[3]) << 24)
        guard length <= maximumPayloadLength else { throw NativeProtocolError.messageTooLarge }
        return Int(length)
    }

    public static func decodeFrame(_ frame: Data) throws -> Data {
        guard frame.count >= 4 else { throw NativeProtocolError.invalidFrame }
        let header = frame.prefix(4)
        let length = try payloadLength(from: Data(header))
        guard frame.count == length + 4 else { throw NativeProtocolError.frameLengthMismatch }
        return frame.subdata(in: 4..<frame.count)
    }
}
