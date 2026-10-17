// Your Space → Profile (D24).
//
// The name and handles Nova matches against who wrote a line. Loop direction
// depends on them, and a wrong value inverts loops silently, so the pane says
// where the current values came from and shows what Nova stored after a save
// rather than what was typed.
import SwiftUI

struct ProfileView: View {
    @ObservedObject var model: InspectorModel

    @State private var newAlias = ""
    /// Set 300ms after loading starts; until then nothing says so.
    @State private var slowEnough = false

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.connection == .unreachable {
                        coldNotice
                    } else if let profile = model.profile {
                        intro(profile.source)
                        nameSection
                        handlesSection
                        saveRow
                    } else {
                        Text(slowEnough ? "Asking Nova" : " ")
                            .font(Nova.caption)
                            .tracking(Nova.captionTracking)
                            .foregroundStyle(Nova.inkTertiary)
                            .padding(.horizontal, Nova.space8)
                            .padding(.vertical, Nova.space5)
                            .animation(.nova(Nova.quick), value: slowEnough)
                    }
                }
                .padding(.bottom, Nova.space8)
            }
            .scrollIndicators(.automatic)

            if let toast = model.toast {
                ToastView(message: toast) { model.clearToast() }
                    .padding(.bottom, Nova.space6)
                    .allowsHitTesting(false)
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            slowEnough = true
        }
    }

    // MARK: Intro

    private func intro(_ source: Profile.Source) -> some View {
        VStack(alignment: .leading, spacing: Nova.space3) {
            Text("Nova uses your name and handles to tell what you owe from what others owe you. "
                + "A line counts as yours only when its author matches one of them")
                .font(Nova.body)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 460, alignment: .leading)
            if let note = sourceNote(source) {
                Text(note)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(source == .none ? Nova.statusAttention : Nova.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 460, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, Nova.space2)
    }

    private func sourceNote(_ source: Profile.Source) -> String? {
        switch source {
        case .app: return nil
        case .env: return "These come from NOVA_USER_NAME and NOVA_USER_ALIASES in .env. "
            + "Saving here overrides them"
        case .none: return "No name is set. Until one is, loops whose author Nova "
            + "can't recognise are dropped"
        }
    }

    // MARK: Name

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProfileSectionHeader(title: "NAME", note: "How you appear in chats and email")
            field("Your full name", text: $model.draftName, onSubmit: model.saveProfile)
                .padding(.horizontal, Nova.space8)
                .padding(.vertical, Nova.space5)
        }
    }

    // MARK: Handles

    private var handlesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProfileSectionHeader(
                title: "HANDLES",
                note: "Emails, usernames and short forms that also mean you",
                trailing: "\(model.draftAliases.count) handle\(model.draftAliases.count == 1 ? "" : "s")",
            )
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.draftAliases, id: \.self) { alias in
                    AliasRow(alias: alias) { model.removeAlias(alias) }
                }
            }
            .padding(.vertical, model.draftAliases.isEmpty ? 0 : 6)
            HStack(spacing: Nova.space4) {
                field("Add a handle, like sam@example.com", text: $newAlias, onSubmit: addAlias)
                Button("Add", action: addAlias)
                    .buttonStyle(NovaButtonStyle(variant: .secondary))
                    .disabled(newAlias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, Nova.space8)
            .padding(.vertical, Nova.space5)
        }
    }

    private func addAlias() {
        model.addAlias(newAlias)
        newAlias = ""
    }

    // MARK: Save

    private var saveRow: some View {
        VStack(alignment: .trailing, spacing: Nova.space3) {
            HStack(spacing: Nova.space4) {
                Spacer(minLength: 0)
                Button(model.savingProfile ? "Saving…" : "Save", action: model.saveProfile)
                    .buttonStyle(NovaButtonStyle(variant: .primary))
                    .disabled(!model.canSaveProfile)
            }
            if let error = model.profileError {
                Text("Nova didn't save that: \(error)")
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(Nova.statusError)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 460, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space4)
    }

    // MARK: Cold

    private var coldNotice: some View {
        VStack(alignment: .leading, spacing: Nova.space5) {
            ApertureMark(state: .paused, size: 28, color: Nova.inkTertiary)
            Text("Nova isn't answering")
                .font(Nova.heading)
                .foregroundStyle(Nova.inkPrimary)
            Text("This window gets your profile from Nova's background process, which "
                + "hasn't responded. Nothing can be shown or saved until it answers.")
                .font(Nova.body)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 460, alignment: .leading)
            HStack(spacing: Nova.space4) {
                Button("Try again") { model.refresh() }
                    .buttonStyle(NovaButtonStyle(variant: .primary))
                Button("Restart Nova") { model.restart() }
                    .buttonStyle(NovaButtonStyle(variant: .secondary))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, Nova.space5)
    }

    private func field(_ placeholder: String, text: Binding<String>, onSubmit: @escaping () -> Void) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(Nova.body)
            .foregroundStyle(Nova.inkPrimary)
            .padding(.horizontal, Nova.space4)
            .frame(height: 30)
            .frame(maxWidth: 460)
            .background(
                RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                    .fill(Nova.surfaceRaised),
            )
            .overlay(
                RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                    .strokeBorder(Nova.ruleStrong, lineWidth: 1),
            )
            .onSubmit(onSubmit)
    }
}

// MARK: - Rows

private struct ProfileSectionHeader: View {
    let title: String
    let note: String
    var trailing: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Nova.space1) {
            HStack(alignment: .firstTextBaseline, spacing: Nova.space5) {
                Text(title)
                    .font(Nova.label)
                    .tracking(Nova.labelTracking)
                    .foregroundStyle(Nova.inkSecondary)
                Spacer(minLength: 0)
                Text(trailing)
                    .font(Nova.capture)
                    .foregroundStyle(Nova.inkTertiary)
                    .monospacedDigit()
                    .contentTransition(.opacity)
                    .animation(.nova(Nova.base), value: trailing)
            }
            Text(note)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 460, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.top, Nova.space6)
        .padding(.bottom, Nova.space3)
        .background(Nova.surfaceRaised.opacity(0.97))
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }
}

/// One handle. Remove sits in a reserved column and shows on hover, as on
/// Blocked apps' rows, so it appearing shifts nothing.
private struct AliasRow: View {
    let alias: String
    let remove: () -> Void

    @State private var hover = false

    var body: some View {
        HStack(spacing: Nova.space5) {
            Text(alias)
                .font(Nova.body)
                .foregroundStyle(Nova.inkPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: Nova.space4)
            Button("Remove", action: remove)
                .buttonStyle(.plain)
                .font(Nova.caption)
                .foregroundStyle(hover ? Nova.inkPrimary : Nova.inkSecondary)
                .padding(.horizontal, Nova.space4)
                .frame(height: 22)
                .opacity(hover ? 1 : 0)
                .animation(.nova(Nova.quick), value: hover)
        }
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space4)
        .background(hover ? Nova.surfaceSunken : .clear)
        .onHover { h in withAnimation(.nova(Nova.quick)) { hover = h } }
    }
}
