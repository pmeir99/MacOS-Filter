import XCTest
@testable import FilterCore

final class ProtocolTests: XCTestCase {
    func testFrameUsesLittleEndianLengthAndRoundTrips() throws {
        let payload = Data(#"{"protocolVersion":1}"#.utf8)
        let frame = try NativeMessageCodec.frame(payload)
        XCTAssertEqual(Array(frame.prefix(4)), [21, 0, 0, 0])
        XCTAssertEqual(try NativeMessageCodec.decodeFrame(frame), payload)
    }

    func testRejectsShortAndMismatchedFrames() throws {
        XCTAssertThrowsError(try NativeMessageCodec.decodeFrame(Data([1, 2, 3])))
        XCTAssertThrowsError(try NativeMessageCodec.decodeFrame(Data([4, 0, 0, 0, 1, 2])))
    }

    func testRequestRequiresImageForSegmentation() {
        let request = NativeRequest(requestID: "test-1", action: .segment)
        XCTAssertThrowsError(try request.validate())
    }

    func testRejectsUnsupportedProtocolAndEmptyRequestID() {
        XCTAssertThrowsError(try NativeRequest(protocolVersion: 2, requestID: "id", action: .getSettings).validate())
        XCTAssertThrowsError(try NativeRequest(requestID: "", action: .getSettings).validate())
    }

    func testSettingsClampOpacityAndValidateColor() {
        let settings = FilterSettings(overlayColor: "not-a-color", opacity: 3)
        XCTAssertEqual(settings.overlayColor, "#000000")
        XCTAssertEqual(settings.opacity, 1)
        XCTAssertEqual(FilterSettings(opacity: -2).opacity, 0.25)
    }
}
