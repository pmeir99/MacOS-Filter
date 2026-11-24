import Foundation

public enum FilterMode: String, Codable, CaseIterable {
    case entireImage
    case allPeople
}

public enum OverlayStyle: String, Codable, CaseIterable {
    case solid
    case blur
}

public struct FilterSettings: Codable, Equatable {
    public var enabled: Bool
    public var mode: FilterMode
    public var overlayStyle: OverlayStyle
    public var overlayColor: String
    public var opacity: Double

    public init(
        enabled: Bool = true,
        mode: FilterMode = .allPeople,
        overlayStyle: OverlayStyle = .solid,
        overlayColor: String = "#000000",
        opacity: Double = 1
    ) {
        self.enabled = enabled
        self.mode = mode
        self.overlayStyle = overlayStyle
        self.overlayColor = Self.validatedColor(overlayColor) ? overlayColor : "#000000"
        self.opacity = min(max(opacity, 0.25), 1)
    }

    private static func validatedColor(_ value: String) -> Bool {
        value.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil
    }
}

public enum SettingsStore {
    public static var fileURL: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return root.appendingPathComponent("MacOSFilter", isDirectory: true).appendingPathComponent("settings.json")
    }

    public static func load() -> FilterSettings {
        guard let data = try? Data(contentsOf: fileURL),
              let settings = try? JSONDecoder().decode(FilterSettings.self, from: data) else {
            return FilterSettings()
        }
        return settings
    }

    public static func save(_ settings: FilterSettings) throws {
        let url = fileURL
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(settings).write(to: url, options: .atomic)
    }
}
