import Foundation

public struct SiteProfile: Codable, Equatable, Identifiable {
    public var id = UUID()
    public var site = ""
    public var mode = FilterMode.adaptive
    public var cutoff = 0.7
    public init() {}
}

public struct BrowserRules: Codable, Equatable {
    public var presentation = "placeholders"
    public var blocked = ""
    public var excluded = ""
    public var phrases = ""
    public var sitePhrases = ""
    public var products = ""
    public var profiles: [SiteProfile] = []
    public init() {}

    public func validate() throws {
        func lines(_ value: String) -> [String] {
            value.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        func domain(_ value: String) -> Bool {
            let label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
            return value.lowercased().range(of: "^" + label + "(?:\\." + label + ")*$", options: .regularExpression) != nil
        }
        func error(_ message: String) -> NSError {
            NSError(domain: "BrowserRules", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
        guard (lines(blocked) + lines(excluded)).allSatisfy(domain) else { throw error("Enter one domain per line.") }
        for line in lines(sitePhrases) {
            let parts = line.components(separatedBy: "|")
            guard parts.count >= 2, domain(parts[0].trimmingCharacters(in: .whitespaces)),
                  !parts.dropFirst().joined(separator: "|").trimmingCharacters(in: .whitespaces).isEmpty
            else { throw error("Use domain | phrase for each website phrase.") }
        }
        let sites = profiles.map { $0.site.lowercased() }
        guard sites.allSatisfy(domain), Set(sites).count == sites.count else { throw error("Each profile needs a unique domain.") }
    }
}
