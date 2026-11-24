import SwiftUI

@main
struct MacOSFilterApp: App {
    var body: some Scene {
        Window("MacOS Filter", id: "settings") {
            SettingsView()
                .frame(minWidth: 440, minHeight: 420)
        }
        .windowResizability(.contentSize)
    }
}
