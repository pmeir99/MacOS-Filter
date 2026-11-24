import SwiftUI

@main
struct MacOSFilterApp: App {
    var body: some Scene {
        WindowGroup {
            SettingsView()
                .frame(minWidth: 440, minHeight: 420)
        }
        .windowResizability(.contentSize)
    }
}
