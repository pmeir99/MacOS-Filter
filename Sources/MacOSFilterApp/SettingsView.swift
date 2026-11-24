import SwiftUI
import FilterCore

struct SettingsView: View {
    @State private var settings = SettingsStore.load()
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

            Form {
                Toggle("Filtering enabled", isOn: $settings.enabled)
                Picker("What to cover", selection: $settings.mode) {
                    Text("Block high NSFW scores, otherwise cover people").tag(FilterMode.adaptive)
                    Text("Detected faces only").tag(FilterMode.faces)
                    Text("Entire image").tag(FilterMode.entireImage)
                    Text("Skin mask (experimental)").tag(FilterMode.skin)
                    Text("Seven-level policy (experimental)").tag(FilterMode.policy)
                    Text("All detected people").tag(FilterMode.allPeople)
                }
                if settings.mode == .skin || settings.mode == .policy {
                    AdvancedPolicySettings(settings: $settings)
                }
                if settings.mode == .adaptive || settings.mode == .policy {
                    Slider(value: Binding(get: { settings.blockThreshold ?? 0.7 },
                        set: { settings.blockThreshold = $0 }), in: 0.1...0.95, step: 0.05)
                        .accessibilityLabel("Whole-image cutoff")
                    Text("Block at score " + String(format: "%.2f", settings.blockThreshold ?? 0.7))
                }
                Picker("Overlay", selection: $settings.overlayStyle) {
                    Text("Solid color").tag(OverlayStyle.solid)
                    Text("Blur").tag(OverlayStyle.blur)
                }
                if settings.overlayStyle == .blur {
                    Slider(value: Binding(get: { settings.blurRadius ?? 16 }, set: { settings.blurRadius = $0 }), in: 4...40)
                        .accessibilityLabel("Blur radius")
                    Text("Blur radius: " + String(Int(settings.blurRadius ?? 16)) + " px")
                }
                Picker("Color", selection: $settings.overlayColor) {
                    Text("Black").tag("#000000")
                    Text("White").tag("#FFFFFF")
                    Text("Dark blue").tag("#172033")
                }
                HStack {
                    Text("Opacity")
                    Slider(value: $settings.opacity, in: 0.25...1)
                    Text("\(Int(settings.opacity * 100))%")
                        .monospacedDigit()
                        .frame(width: 48, alignment: .trailing)
                }

            }
            .formStyle(.grouped)

            BrowserRulesView(rules: Binding(get: { settings.siteRules ?? BrowserRules() },
                                            set: { settings.siteRules = $0 }))
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
        .frame(minWidth: 480, minHeight: 490)

        .onChange(of: settings) { _ in saveSettings() }
        .onAppear { connect(); updater.launched() }
        .sheet(isPresented: $updater.showWindow) { SoftwareUpdateView(updater: updater) }
    }

    private func saveSettings() {
        do {
            try settings.siteRules?.validate()
            try SettingsStore.save(settings)
            status = "Filtering settings saved."
            statusIsError = false
        } catch {
            status = "Could not save settings: \(error.localizedDescription)"
            statusIsError = true
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
