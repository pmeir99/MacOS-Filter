import Foundation

enum NativeHostInstaller {
    static let hostName = "com.pmeir99.macos_filter"

    static func install(extensionID: String) throws -> URL {
        guard extensionID.range(of: "^[a-p]{32}$", options: .regularExpression) != nil else {
            throw InstallerError.invalidExtensionID
        }

        let executableFolder = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS", isDirectory: true)
        let hostExecutable = executableFolder.appendingPathComponent("FilterHost")
        guard FileManager.default.isExecutableFile(atPath: hostExecutable.path) else {
            throw InstallerError.hostExecutableMissing
        }

        let chromeDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts", isDirectory: true)
        try FileManager.default.createDirectory(at: chromeDirectory, withIntermediateDirectories: true)
        let manifestURL = chromeDirectory.appendingPathComponent(hostName + ".json")
        let manifest: [String: Any] = [
            "name": hostName,
            "description": "Local image filtering host for MacOS-Filter",
            "path": hostExecutable.path,
            "type": "stdio",
            "allowed_origins": ["chrome-extension://\(extensionID)/"]
        ]
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: manifestURL, options: .atomic)
        return manifestURL
    }
}

enum InstallerError: LocalizedError {
    case invalidExtensionID
    case hostExecutableMissing

    var errorDescription: String? {
        switch self {
        case .invalidExtensionID: return "Chrome extension ID must contain 32 letters from a through p."
        case .hostExecutableMissing: return "FilterHost was not found beside the Mac app. Reinstall the packaged app."
        }
    }
}
