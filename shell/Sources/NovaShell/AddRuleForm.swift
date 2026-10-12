// The add control for Your Space → Blocked apps.
//
// Two rules from the design govern it:
//
//  - The kind is never guessed. A bare word is usually an app and a dotted
//    string usually a domain, but guessing silently stores a rule that never
//    matches what the user meant. Neither kind is preselected and Block stays
//    disabled until one is picked.
//  - What the user typed and what Nova stores are both shown. A pasted link
//    becomes its host, and the scope is stated with a real subdomain and a
//    real near-miss, so "therapy.example" does not have to be guessed at.
import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct AddRuleForm: View {
    @ObservedObject var model: InspectorModel

    @State private var kind: Kind?
    @State private var text = ""
    /// Set by the app picker: the value is then a bundle id and this is the
    /// name to show beside it.
    @State private var pickedLabel: String?
    @FocusState private var focused: Bool

    enum Kind: String, CaseIterable {
        case app, domain
        var title: String { self == .app ? "App" : "Site" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Nova.space3) {
            HStack(spacing: Nova.space4) {
                kindPicker
                TextField(placeholder, text: $text)
                    .textFieldStyle(.plain)
                    .font(Nova.body)
                    .foregroundStyle(Nova.inkPrimary)
                    .focused($focused)
                    .padding(.horizontal, Nova.space4)
                    .frame(height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                            .fill(Nova.surfaceRaised),
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                            .strokeBorder(Nova.ruleStrong, lineWidth: 1),
                    )
                    .onSubmit(submit)
                    .onChange(of: text) { pickedLabel = nil }
                if kind == .app {
                    Button("Choose…") { choose() }
                        .buttonStyle(NovaButtonStyle(variant: .secondary))
                }
            }

            if !feedback.isEmpty {
                VStack(alignment: .leading, spacing: Nova.space2) {
                    ForEach(feedback, id: \.self) { line in
                        Text(line)
                            .font(Nova.caption)
                            .tracking(Nova.captionTracking)
                            .foregroundStyle(Nova.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            HStack(spacing: Nova.space4) {
                Spacer(minLength: 0)
                Button("Cancel") { model.closeAdd() }
                    .buttonStyle(NovaButtonStyle(variant: .secondary))
                Button(submitLabel, action: submit)
                    .buttonStyle(NovaButtonStyle(variant: .primary))
                    .disabled(!canSubmit || model.adding)
            }
        }
        .padding(Nova.space5)
        .background(
            RoundedRectangle(cornerRadius: Nova.radiusMD, style: .continuous)
                .fill(Nova.surfaceSunken),
        )
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space5)
        .padding(.bottom, Nova.space2)
        .onAppear { focused = true }
    }

    // MARK: Kind

    private var kindPicker: some View {
        HStack(spacing: 2) {
            ForEach(Kind.allCases, id: \.self) { k in
                let on = kind == k
                Text(k.title)
                    .font(Nova.body)
                    .foregroundStyle(on ? Nova.inkPrimary : Nova.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: Nova.radiusXS, style: .continuous)
                            .fill(on ? Nova.accentWash : .clear),
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(.nova(Nova.quick)) { kind = k } }
            }
        }
        .padding(2)
        .overlay(
            RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                .strokeBorder(Nova.ruleStrong, lineWidth: 1),
        )
    }

    private var placeholder: String {
        switch kind {
        case .app: return "An app's name, or choose one"
        case .domain: return "A site, like therapy.example"
        case nil: return "Pick App or Site first"
        }
    }

    // MARK: Feedback

    /// What the user typed, what Nova will store, and what that covers. The
    /// scope line names a real subdomain and a real near-miss rather than
    /// describing suffix matching in the abstract.
    private var feedback: [String] {
        let raw = text.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else {
            return kind == nil ? ["Pick App or Site — Nova never guesses which you meant"] : []
        }
        switch kind {
        case nil:
            return ["Pick App or Site — Nova never guesses which you meant"]
        case .app:
            if let label = pickedLabel {
                return ["Matches \(label) · \(raw)",
                        "Stored as the bundle id, so the rule holds if the app is renamed"]
            }
            return ["Matches any app called \(raw)",
                    "Use Choose… to store its bundle id instead, so the rule survives a rename"]
        case .domain:
            let host = Self.normalizeHost(raw)
            guard let host, Self.isValidHost(host) else {
                return ["That doesn't look like a site. A host like therapy.example"]
            }
            var lines: [String] = []
            if host != raw.lowercased() {
                lines.append("You entered \(raw) · Nova stores the host \(host)")
            }
            lines.append("Also covers its subdomains, like portal.\(host). Not not\(host)")
            return lines
        }
    }

    // MARK: Submit

    private var canSubmit: Bool {
        guard let kind else { return false }
        let raw = text.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return false }
        if kind == .domain {
            guard let h = Self.normalizeHost(raw), Self.isValidHost(h) else { return false }
        }
        return true
    }

    /// The button names the deletion, so the warning cannot be skipped by
    /// reflex — a plain "Block" would be clicked without reading the note.
    private var submitLabel: String {
        guard canSubmit else { return "Block" }
        return "Block and delete history"
    }

    private func submit() {
        guard let kind, canSubmit else { return }
        let raw = text.trimmingCharacters(in: .whitespaces)
        let value = kind == .domain ? (Self.normalizeHost(raw) ?? raw) : raw
        model.add(kind: kind.rawValue, value: value, label: pickedLabel)
    }

    /// The system app picker. The rule stores the bundle id read from the
    /// chosen app, so it matches even if the app is renamed.
    private func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.application]
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.prompt = "Choose"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let name = url.deletingPathExtension().lastPathComponent
        if let bundle = Bundle(url: url)?.bundleIdentifier {
            text = bundle
            pickedLabel = name
        } else {
            // No readable Info.plist: the name is all there is, and a rule by
            // name still works — it just will not survive a rename.
            text = name
            pickedLabel = nil
        }
    }

    // MARK: Host normalization
    //
    // Mirrors `normalizeExclusion` in the daemon. Duplicated on purpose: the
    // form has to show what will be stored before it is stored, and a round
    // trip per keystroke to find out is worse than two copies of six lines.
    // They must agree — if one changes, change both.

    static func normalizeHost(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("@") { s.removeFirst() }
        if let r = s.range(of: "://") { s = String(s[r.upperBound...]) }
        s = s.components(separatedBy: CharacterSet(charactersIn: "/?#")).first ?? s
        if let at = s.lastIndex(of: "@") { s = String(s[s.index(after: at)...]) }
        if let colon = s.lastIndex(of: ":"), s[s.index(after: colon)...].allSatisfy(\.isNumber) {
            s = String(s[..<colon])
        }
        s = s.lowercased()
        if s.hasPrefix("www.") { s.removeFirst(4) }
        while s.hasSuffix(".") { s.removeLast() }
        return s.isEmpty ? nil : s
    }

    static func isValidHost(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, let tld = labels.last, tld.count >= 2 else { return false }
        guard tld.allSatisfy({ $0.isLetter }) else { return false }
        return labels.allSatisfy { label in
            !label.isEmpty && label.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }
        }
    }
}
