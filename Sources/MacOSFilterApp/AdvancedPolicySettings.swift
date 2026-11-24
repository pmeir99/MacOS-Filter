import SwiftUI
import FilterCore

struct AdvancedPolicySettings: View {
    @Binding var settings: FilterSettings
    let levels = ["Explicit activity", "Explicit nudity", "Swimwear or lingerie", "Substantial exposure", "Some skin visible", "Everyday covered clothing", "Long loose coverage"]
    func binding<T>(_ path: WritableKeyPath<FilterSettings,T?>, _ fallback: T) -> Binding<T> {
        Binding(get: { settings[keyPath:path] ?? fallback }, set: { settings[keyPath:path] = $0 })
    }
    func product(_ key: String) -> Binding<Bool> {
        Binding(get: { (settings.products ?? []).contains(key) }, set: { enabled in
            var products = (settings.products ?? []).filter { $0 != key }
            if enabled { products.append(key) }
            settings.products = products
        })
    }
    var body: some View {
        Group {
            if settings.mode == .policy {
                Picker("Block whole image through", selection:binding(\.fullLevel,2)) {
                    ForEach(1...7,id:\.self) { n in Text("\(n). " + levels[n-1]).tag(n) }
                }
                Picker("Mask matching people through", selection:binding(\.maskLevel,5)) {
                    ForEach(1...7,id:\.self) { n in Text("\(n). " + levels[n-1]).tag(n) }
                }
                Toggle("Limit person masks to skin",isOn:binding(\.paintSkin,false))
            }
            Picker("Mask visual presentation",selection:binding(\.appearance,"all")) {
                Text("Everyone").tag("all")
                Text("Masculine appearance").tag("masculine")
                Text("Feminine appearance").tag("feminine")
            }
            if settings.mode == .skin || settings.paintSkin == true {
                Toggle("Include facial skin",isOn:binding(\.includeFace,true))
            }
            Toggle("Block underwear and lingerie products",isOn:product("underwear"))
            Toggle("Block adult products and accessories",isOn:product("adult"))
            Toggle("Block menstrual products",isOn:product("menstrual"))
            Text("Visual estimates can miss people and products. Full-image rules take priority. Uncertain presentation matches either selection.").font(.caption)
        }
    }
}
