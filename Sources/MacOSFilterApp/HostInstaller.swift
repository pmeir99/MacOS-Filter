import Foundation
import UpdateSupport

enum NativeHostInstaller {
    static let extensionID = "jepaaemencfhlepcbinpekgnpfacdlpo"
    static let hostName = "com.pmeir99.macos_filter"

    static let extensionFolder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("MacOSFilter/ChromeExtension", isDirectory: true)

    static func prepareExtension() throws {
        let source = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/Extension")
        let manifest = "manifest.json"
        let fm = FileManager.default
        let incoming = try Data(contentsOf: source.appendingPathComponent(manifest))
        let parent = extensionFolder.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        if (try? Data(contentsOf: extensionFolder.appendingPathComponent(manifest))) == incoming { return }
        // Chrome may write metadata beside an unpacked manifest. Keep the signed bundle sealed.
        let stage = parent.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: stage) }
        try fm.copyItem(at: source, to: stage)
        if fm.fileExists(atPath: extensionFolder.path) {
            try UpdateTransaction.swap(extensionFolder, stage)
        } else {
            try fm.moveItem(at: stage, to: extensionFolder)
        }
    }

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
