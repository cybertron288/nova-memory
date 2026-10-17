// Your Space → Permissions.
//
// Each macOS grant Nova uses, read from this process rather than asked of
// Nova, so the pane is right even when the daemon is down. An off grant says
// what Nova loses without it and opens the System Settings list that fixes it.
import SwiftUI

struct PermissionsView: View {
    @ObservedObject var model: InspectorModel

    var body: some View {
        ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 0) {
                intro
                ForEach(NovaPermission.allCases, id: \.self) { permission in
                    PermissionRow(permission: permission, granted: model.grants[permission] ?? false)
                }
                footnote
            }
            .padding(.bottom, Nova.space8)
        }
        .scrollIndicators(.automatic)
    }

    private var intro: some View {
        Text("Nova needs Accessibility to read your screen. Screen Recording is optional")
            .font(Nova.body)
            .foregroundStyle(Nova.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 460, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Nova.space8)
            .padding(.top, Nova.space6)
            .padding(.bottom, Nova.space5)
            .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }

    private var footnote: some View {
        Text("After you change Screen Recording, macOS may need you to quit Nova and open it again")
            .font(Nova.caption)
            .tracking(Nova.captionTracking)
            .foregroundStyle(Nova.inkTertiary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 460, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Nova.space8)
            .padding(.top, Nova.space5)
    }
}

/// One grant. An off required grant reads as attention, an off optional one
/// as neutral: Nova without Screen Recording still works.
private struct PermissionRow: View {
    let permission: NovaPermission
    let granted: Bool

    private var status: (NovaStatus, String) {
        if granted { return (.live, "Granted") }
        return (permission.required ? .attention : .paused, "Not granted")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Nova.space3) {
            HStack(alignment: .firstTextBaseline, spacing: Nova.space5) {
                Text(permission.title)
                    .font(Nova.bodyEmphasis)
                    .foregroundStyle(Nova.inkPrimary)
                Spacer(minLength: 0)
                StatusDot(status: status.0, label: status.1)
                    .contentTransition(.opacity)
                    .animation(.nova(Nova.base), value: granted)
            }
            Text(permission.purpose)
                .font(Nova.body)
                .foregroundStyle(Nova.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 460, alignment: .leading)
            if !granted {
                Text(permission.withoutIt)
                    .font(Nova.caption)
                    .tracking(Nova.captionTracking)
                    .foregroundStyle(permission.required ? Nova.statusAttention : Nova.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 460, alignment: .leading)
                Button("Open System Settings") { permission.openSettings() }
                    .buttonStyle(NovaButtonStyle(variant: permission.required ? .primary : .secondary))
                    .padding(.top, Nova.space2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Nova.space8)
        .padding(.vertical, Nova.space5)
        .overlay(alignment: .bottom) { Rectangle().fill(Nova.rule).frame(height: 1) }
    }
}
