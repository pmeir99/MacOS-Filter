import SwiftUI
import FilterCore

struct SettingsView: View {
    @State private var settings = SettingsStore.load()
    @State private var extensionID = ""
    @State private var status = "Set up the Chrome extension to connect this Mac."
    @State private var statusIsError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
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
                    Text("Entire image").tag(FilterMode.entireImage)
                    Text("All detected people").tag(FilterMode.allPeople)
                }
                if settings.mode == .adaptive {
                    Slider("Whole-image cutoff", value: Binding(get: { settings.blockThreshold ?? 0.7 },
                        set: { settings.blockThreshold = $0 }), in: 0.1...0.95, step: 0.05)
                    Text("Block at score " + String(format: "%.2f", settings.blockThreshold ?? 0.7))
                }
                Picker("Overlay", selection: $settings.overlayStyle) {
                    Text("Solid color").tag(OverlayStyle.solid)
                    Text("Blur").tag(OverlayStyle.blur)
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
                Button("Save filtering settings") {
                    saveSettings()
                }
            }
            .formStyle(.grouped)

            GroupBox("Connect Chrome") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Load the extension folder in chrome://extensions with Developer mode on, then copy its ID here.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    TextField("32-character extension ID", text: $extensionID)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                    Button("Save Settings and Connect") {
                        connect()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.vertical, 4)
            }

            Text(status)
                .font(.callout)
                .foregroundStyle(statusIsError ? Color.red : Color.secondary)
                .textSelection(.enabled)
        }
        .padding(24)
    }

    private func saveSettings() {
        do {
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
            try SettingsStore.save(settings)
            let url = try NativeHostInstaller.install(extensionID: extensionID.trimmingCharacters(in: .whitespacesAndNewlines))
            status = "Chrome host installed at \(url.path). Reload the extension in Chrome."
            statusIsError = false
        } catch {
            status = error.localizedDescription
            statusIsError = true
        }
    }
}
