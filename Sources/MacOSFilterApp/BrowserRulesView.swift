import SwiftUI
import FilterCore

struct BrowserRulesView: View {
    @Binding var rules: BrowserRules
    var body: some View {
        GroupBox("Websites and text") {
            VStack(alignment: .leading, spacing: 10) {
                Picker("While scanning", selection: $rules.presentation) {
                    Text("Show placeholders").tag("placeholders")
                    Text("Show loading screen").tag("loading")
                }
                field("Blocked domains", $rules.blocked)
                field("Excluded domains", $rules.excluded)
                field("Blocked phrases", $rules.phrases)
                field("Website phrases (domain | phrase)", $rules.sitePhrases)
                field("Blocked image descriptions", $rules.products)
                Text("One entry per line. Exclusions apply to subdomains too.").font(.caption)
                ForEach($rules.profiles) { $profile in
                    HStack {
                        TextField("Domain", text: $profile.site)
                        Picker("Mode", selection: $profile.mode) {
                            ForEach(FilterMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        if profile.mode == .adaptive || profile.mode == .policy {
                            Stepper(String(format: "%.2f", profile.cutoff), value: $profile.cutoff, in: 0.1...0.95, step: 0.05)
                        }
                        Button("Remove") { rules.profiles.removeAll { $0.id == profile.id } }
                    }
                }
                Button("Add Website Profile") { rules.profiles.append(SiteProfile()) }
            }.padding(6)
        }
    }
    private func field(_ label: String, _ value: Binding<String>) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.callout)
            TextEditor(text: value).font(.body).frame(minHeight: 45)
                .border(Color.secondary.opacity(0.25)).accessibilityLabel(label)
        }
    }
}
