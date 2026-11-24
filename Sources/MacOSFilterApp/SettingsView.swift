import SwiftUI
import FilterCore

struct SettingsView: View {
    @StateObject private var updater = AppUpdater()
    @State private var status = "Set up the Chrome extension to connect this Mac."
    @State private var statusIsError = false

    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "eye.slash")
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 3) {
                    Text("MacOS Filter").font(.title2.weight(.semibold))
                    Text("Images are analyzed on this Mac.").foregroundStyle(.secondary)
                }
            }

            Button("Open Chrome Settings") { openBrowserSettings() }
                .buttonStyle(.borderedProminent)
            GroupBox("Chrome") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("In chrome://extensions, enable Developer mode and choose Load unpacked. Select the folder shown below, then grant website access from the extension.")
                    Button("Show Extension Folder") {
                        NSWorkspace.shared.activateFileViewerSelecting([NativeHostInstaller.extensionFolder])
                    }
                }
            }
            Button("Software Update…") { updater.showWindow = true; Task { await updater.check() } }
            Text(status)
                .font(.callout)
                .foregroundStyle(statusIsError ? Color.red : Color.secondary)
                .textSelection(.enabled)
        }
        .padding(24) }
        .frame(minWidth: 480, minHeight: 320)

        .onAppear { connect(); updater.launched() }
        .sheet(isPresented: $updater.showWindow) { SoftwareUpdateView(updater: updater) }
    }

    private func openBrowserSettings() {
        guard let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome"),
              let settings = URL(string: "chrome-extension://\(NativeHostInstaller.extensionID)/options.html") else {
            status = "Install Google Chrome to open filter settings."
            statusIsError = true
            return
        }
        NSWorkspace.shared.open([settings], withApplicationAt: chrome, configuration: .init()) { _, error in
            if let error { DispatchQueue.main.async { status = error.localizedDescription; statusIsError = true } }
        }
    }

    private func connect() {
        do {
            try NativeHostInstaller.prepareExtension()
            _ = try NativeHostInstaller.install(extensionID: NativeHostInstaller.extensionID)
            status = "Chrome helper registered."
            statusIsError = false
        } catch {
            status = error.localizedDescription
            statusIsError = true
        }
    }
}
