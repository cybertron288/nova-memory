/// Nova's design system, ported from the Claude Design project
/// `nova-design-system-d4e9eba3` (tokens/*.css and components/marks/Aperture.jsx).
///
/// The rule that governs this file: **every colour derives from one hue.**
/// `Nova.hue` is the single variable — change it and the whole app re-themes
/// coherently, because lightness and chroma are fixed per token and only hue
/// varies. That only works in a perceptually uniform space, which is why
/// `Color(oklch:)` exists here rather than using SwiftUI's HSB initialiser.
///
/// Values are transcribed from the CSS token files, not re-derived. If a token
/// changes there, change it here; do not "improve" a number locally.
import SwiftUI

enum Nova {

    // MARK: - The hue

    /// `--nova-hue: 296`. Violet.
    static let hue: Double = 296
    /// `--nova-grad-from-hue` / `--nova-grad-to-hue`: ±26° and no wider. That
    /// constraint is what keeps the gradient from reading as a generic mesh.
    static let gradFromHue = hue - 26
    static let gradToHue = hue + 26

    // MARK: - Surfaces (dark — the panel is dark in both appearances)

    static let surfaceRaised = Color(oklch: 0.238, 0.007, hue)
    /// The Your Space sidebar, one step below the raised content.
    static let surfacePage = Color(oklch: 0.192, 0.006, hue)
    /// Hover bands and inset strips.
    static let surfaceSunken = Color(oklch: 0.162, 0.006, hue)

    // MARK: - Ink

    static let inkPrimary = Color(oklch: 0.962, 0.003, hue)
    static let inkSecondary = Color(oklch: 0.728, 0.008, hue)
    // Tertiary and quaternary sit above the CSS values (0.578, 0.432). The
    // panel is glass, and over a white page its ground only darkens to about
    // L 0.40 — the CSS greys were drawn for a solid 0.238 ground and vanished
    // into it. These keep the four steps in order and stay legible there.
    static let inkTertiary = Color(oklch: 0.680, 0.008, hue)
    static let inkQuaternary = Color(oklch: 0.580, 0.007, hue)

    // MARK: - Accent

    static let accent = Color(oklch: 0.706, 0.176, hue)
    static let accentHover = Color(oklch: 0.764, 0.166, hue)
    static let accentWash = Color(oklch: 0.288, 0.072, hue)
    /// A row linked to the selected one: the wash, held back so the selection
    /// still reads as the one that was clicked.
    static let accentWashSoft = Color(oklch: 0.288, 0.072, hue, alpha: 0.55)
    static let onAccent = Color.white
    /// The flare colour on resolve — brighter than the wash, held for 120ms.
    static let accentMuted = Color(oklch: 0.588, 0.116, hue)

    // MARK: - Gradient ground

    static let gradFrom = Color(oklch: 0.468, 0.162, gradFromHue)
    static let gradTo = Color(oklch: 0.388, 0.166, gradToHue)

    // MARK: - Rules

    /// Translucent light ink rather than the CSS's solid L 0.318. The panel is
    /// glass, so its ground runs from about L 0.2 over a dark desktop to 0.40
    /// over a white page; a solid 0.318 was a light edge on the first and a
    /// black outline on the second. A light line at low alpha is always a
    /// little lighter than whatever is under it — how Apple's dark HUDs edge.
    static let rule = Color(oklch: 0.962, 0.003, hue, alpha: 0.12)
    static let ruleStrong = Color(oklch: 0.432, 0.007, hue)

    // MARK: - Status (fixed hues — never derived, because a green that turned
    // violet with the theme would stop meaning "healthy")

    static let statusLive = Color(oklch: 0.642, 0.112, 158)
    static let statusPaused = Color(oklch: 0.646, 0.008, 250)
    static let statusAttention = Color(oklch: 0.682, 0.132, 62)
    static let statusError = Color(oklch: 0.588, 0.148, 27)
    /// The Delete buttons in Your data's confirms, and nothing else. Darker
    /// than statusError so a white label clears 5:1 (5.00 rest, 5.93 hover);
    /// the error red itself gives 4.45.
    static let danger = Color(oklch: 0.560, 0.148, 27)
    static let dangerHover = Color(oklch: 0.520, 0.148, 27)

    // MARK: - Metrics (tokens/spacing.css)

    static let panelWidth: CGFloat = 440
    static let panelMaxHeight: CGFloat = 420
    /// Transparent margin around the panel inside its window, so the shadow —
    /// drawn by SwiftUI, not the window server — has room to fall off.
    static let panelMargin: CGFloat = 56
    static let headerHeight: CGFloat = 52
    static let rowHeight: CGFloat = 56
    static let footerHeight: CGFloat = 34
    static let radiusXS: CGFloat = 3
    static let radiusSM: CGFloat = 5
    static let radiusMD: CGFloat = 8
    static let buttonHeight: CGFloat = 32
    static let radiusXL: CGFloat = 14
    /// `--space-5` / `--space-6`, the only two the panel uses.
    static let space1: CGFloat = 2
    static let space2: CGFloat = 4
    static let space3: CGFloat = 6
    static let space4: CGFloat = 8
    static let space5: CGFloat = 12
    static let space6: CGFloat = 16
    static let space8: CGFloat = 24
    static let space9: CGFloat = 32
    /// Rows scroll past this; the design masks the edges at 24px.
    static let listMaxHeight: CGFloat = 334

    // MARK: - Motion (tokens/motion.css)

    /// One curve for the whole product: fast out, long settle, no overshoot.
    static func ease(_ duration: Double) -> Animation {
        .timingCurve(0.32, 0.72, 0.28, 1.00, duration: duration)
    }
    static let quick = 0.140
    static let base = 0.240
    static let considered = 0.420

    static var motionQuick: Animation { ease(quick) }
    static var motionBase: Animation { ease(base) }
    static var motionConsidered: Animation { ease(considered) }

    // Offsets and holds (docs/design/motion-spec.md §1). None of these is a
    // duration: a hold is a wait and an offset is a distance, so neither adds
    // a second feel to the product the way a fourth duration would.

    /// 6 rows x 24ms = a 120ms spread, which reads as one arrival rather than
    /// a queue.
    static let staggerStep = 0.024
    /// Rows past the 6th share its start, so a 200-row list costs the same
    /// as 6 and the longest possible entry stays 360ms.
    static let staggerCap = 6
    /// How long something new or changed keeps accent before settling. Long
    /// enough to find with the eye.
    static let ackHold = 1.2
    /// A rule that arrived from elsewhere gets a shorter hold: the user did
    /// not cause it, so it announces itself less.
    static let ackHoldExternal = 0.6
    /// The incoming pane waits for the outgoing one to be mostly gone, which
    /// is what keeps the two from reading as a double image.
    static let paneLead = 0.06
    /// At most one colour hold per row per this window. During a meeting the
    /// screen-sharing count climbs every few seconds, and an accent hold on
    /// each is a flicker.
    static let ackRateLimit = 10.0

    static let offsetPane: CGFloat = 8
    static let offsetRow: CGFloat = 4
    static let offsetCount: CGFloat = 6
    static let offsetDissolve: CGFloat = 2

    // MARK: - Type (tokens/typography.css)
    //
    // System faces only. On macOS, SF is what the OS is set in, and matching
    // it is what makes a menu-bar app feel like part of the machine.

    static let display = Font.system(size: 34, weight: .semibold)
    static let title = Font.system(size: 22, weight: .semibold)
    static let heading = Font.system(size: 15, weight: .semibold)
    static let body = Font.system(size: 13, weight: .regular)
    static let bodyEmphasis = Font.system(size: 13, weight: .semibold)
    static let caption = Font.system(size: 11, weight: .regular)
    static let label = Font.system(size: 10, weight: .semibold)
    static let capture = Font.system(size: 11, weight: .regular, design: .monospaced)

    static let labelTracking: CGFloat = 0.64      // 0.064em at 10px
    static let captionTracking: CGFloat = 0.044   // 0.004em at 11px
    /// SF Mono 11, for counts and sizes that line up down a column.
    static let figure = Font.system(size: 11, weight: .regular, design: .monospaced)
}

// MARK: - Status dot (components/marks/StatusDot)

enum NovaStatus {
    case live, paused, attention, error

    var color: Color {
        switch self {
        case .live: return Nova.statusLive
        case .paused: return Nova.statusPaused
        case .attention: return Nova.statusAttention
        case .error: return Nova.statusError
        }
    }
}

/// A 7px dot and its label, always together: a colour alone would need a
/// legend, and the label is what a screen reader gets.
struct StatusDot: View {
    let status: NovaStatus
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(status.color).frame(width: 7, height: 7)
            Text(label)
                .font(Nova.caption)
                .tracking(Nova.captionTracking)
                .foregroundStyle(Nova.inkSecondary)
                .lineLimit(1)
        }
    }
}

// MARK: - Buttons (components/buttons/Button)

/// Primary fills with the accent; secondary is a hairline outline that takes
/// the sunken band on hover. The primary's 0.98 press is the only
/// scale-on-press in the product.
struct NovaButtonStyle: ButtonStyle {
    enum Variant { case primary, secondary, danger }
    var variant: Variant = .secondary

    func makeBody(configuration: Configuration) -> some View {
        Label(configuration: configuration, variant: variant)
    }

    private struct Label: View {
        let configuration: ButtonStyleConfiguration
        let variant: Variant
        @State private var hover = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(Nova.bodyEmphasis)
                .foregroundStyle(variant == .secondary ? Nova.inkPrimary : Nova.onAccent)
                .padding(.horizontal, 14)
                .frame(height: Nova.buttonHeight)
                .background(
                    RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                        .fill(fill),
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                        .strokeBorder(variant == .secondary ? Nova.ruleStrong : .clear, lineWidth: 1),
                )
                .scaleEffect(variant != .secondary && configuration.isPressed ? 0.98 : 1)
                // The design system's disabled state: the same button at 0.4,
                // so it reads as present but not now.
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(Rectangle())
                .onHover { hover = $0 }
                .animation(Nova.motionQuick, value: hover)
        }

        private var fill: Color {
            switch variant {
            case .primary: return hover && isEnabled ? Nova.accentHover : Nova.accent
            case .secondary: return hover && isEnabled ? Nova.surfaceSunken : .clear
            case .danger: return hover && isEnabled ? Nova.dangerHover : Nova.danger
            }
        }
    }
}

// MARK: - Animation

extension Animation {
    /// The product's only curve (docs/design/motion-spec.md §1). `d` is one of
    /// `Nova.quick`, `Nova.base`, `Nova.considered` — never a new number.
    static func nova(_ d: Double) -> Animation { Nova.ease(d) }
}

// MARK: - oklch

extension Color {
    /// oklch → sRGB. SwiftUI has no oklch initialiser, and the token system is
    /// defined in it for a reason: at fixed L and C, every hue is equally
    /// present, so one variable can re-theme the app without any value
    /// becoming muddy or shouting. HSL cannot do that.
    init(oklch l: Double, _ c: Double, _ h: Double, alpha: Double = 1) {
        let hr = h * .pi / 180
        let (a, b) = (c * cos(hr), c * sin(hr))

        // OKLab → LMS (cube of the nonlinear response)
        let l_ = l + 0.3963377774 * a + 0.2158037573 * b
        let m_ = l - 0.1055613458 * a - 0.0638541728 * b
        let s_ = l - 0.0894841775 * a - 1.2914855480 * b
        let (L, M, S) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_)

        // LMS → linear sRGB
        let r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S
        let g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S
        let bb = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S

        func encode(_ x: Double) -> Double {
            let v = x <= 0.0031308 ? 12.92 * x : 1.055 * pow(max(x, 0), 1 / 2.4) - 0.055
            return min(max(v, 0), 1)
        }
        self.init(.sRGB, red: encode(r), green: encode(g), blue: encode(bb), opacity: alpha)
    }
}

// MARK: - The aperture mark
//
// Nova's only custom-drawn vector, ported from Aperture.jsx. Six blades,
// 60°-symmetric, rotating 30° between open and closed — that rotation is what
// makes it read as a mechanical iris rather than a scaling circle.

enum ApertureState {
    case capturing, paused, attention

    /// Opening as a fraction of the outer radius, from Aperture.jsx.
    var openness: Double {
        switch self {
        case .capturing: return 0.62
        case .paused: return 0
        case .attention: return 0.30
        }
    }
}

struct Aperture: Shape {
    var openness: Double

    /// Lets the open→closed transition animate as one continuous motion, which
    /// is the shutter the mark exists for.
    var animatableData: Double {
        get { openness }
        set { openness = newValue }
    }

    func path(in rect: CGRect) -> Path {
        // Aperture.jsx works in a 112-unit viewBox with R = 50 and a stroke of
        // 1.5/16 * 100. Keep the same proportions, scaled to the frame.
        let scale = min(rect.width, rect.height) / 112
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let R = 50 * scale
        let stroke = (1.5 / 16 * 100) * scale

        // A floor on the opening. At a literal 0 every blade starts at the
        // centre, so six tangent lines become six spokes through it — a wagon
        // wheel, not a closed shutter. Keeping a small radius lets the blades
        // sweep *past* the centre and overlap, which is what a real iris does
        // when it seals. `Aperture.jsx` has the same behaviour at open = 0.
        let open = max(openness, 0.16)
        let r = open * R
        let rot = (1 - open / 0.62) * 30 * .pi / 180

        var path = Path()
        path.addEllipse(in: CGRect(x: center.x - R, y: center.y - R, width: R * 2, height: R * 2))

        // Each blade is a tangent line leaving the opening circle and running
        // to the rim — not a chord across the opening. That is what gives the
        // iris its swept, bladed look instead of a hexagon.
        let reach = (R * R - r * r).squareRoot() - stroke / 2
        guard reach > 0 else { return path }

        for i in 0..<6 {
            let th = Double(i) * .pi / 3 + rot
            let p = CGPoint(x: center.x + r * cos(th), y: center.y + r * sin(th))
            // Perpendicular to the radius: the tangent direction.
            let d = CGPoint(x: -sin(th), y: cos(th))
            path.move(to: p)
            path.addLine(to: CGPoint(x: p.x + d.x * reach, y: p.y + d.y * reach))
        }
        return path
    }
}

/// The mark as used: stroked, optionally breathing, with the attention dot.
struct ApertureMark: View {
    var state: ApertureState
    var size: CGFloat
    var color: Color = Nova.inkPrimary
    /// The 4.2s breathing loop. Only ever true for `.capturing`, and suppressed
    /// under reduced motion — a user who asked for less movement is precisely
    /// the user an animated menu-bar icon bothers most.
    var breathe: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var strokeWidth: CGFloat { (1.5 / 16 * 100) * (size / 112) }

    var body: some View {
        mark
            .modifier(Breathing(active: breathe && state == .capturing && !reduceMotion))
            .animation(Nova.motionConsidered, value: state.openness)
            .accessibilityLabel("Nova \(state)")
    }

    private var mark: some View {
        ZStack {
            Aperture(openness: state.openness)
                .stroke(color, style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round))

            if state == .attention {
                Circle()
                    .fill(color)
                    .frame(width: size * (3.0 / 16) * (50.0 / 56), height: size * (3.0 / 16) * (50.0 / 56))
            }
        }
        .frame(width: size, height: size)
    }
}

/// The breathing, scoped to the scale and nothing else.
///
/// It used to be a `repeatForever` animation started in `onAppear`. A repeating
/// animation of that kind can absorb any other geometry change that lands in
/// the view while it runs, so when the header moved during a tab switch the
/// mark drifted with the breath's slow cycle and stayed out of place for
/// seconds. `phaseAnimator` animates only what its closure applies — the scale
/// — so the mark's position is left to layout.
private struct Breathing: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.phaseAnimator([1.0, 0.985]) { view, scale in
                view.scaleEffect(scale)
            } animation: { _ in
                .easeInOut(duration: 2.1)
            }
        } else {
            content
        }
    }
}

// MARK: - Toast (components/feedback/Toast)

/// A brief confirmation of something that already happened. It develops, holds
/// for four seconds, and dissolves — and it never carries an action, because a
/// message that disappears cannot be the only way to undo something.
struct ToastView: View {
    let message: String
    var duration: TimeInterval = 4
    let onDone: () -> Void

    @State private var shown = false

    var body: some View {
        Text(message)
            .font(Nova.body)
            .foregroundStyle(Nova.inkPrimary)
            .padding(.horizontal, Nova.space6)
            .frame(height: 32)
            .background(
                RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                    .fill(Nova.surfacePage),
            )
            .overlay(
                RoundedRectangle(cornerRadius: Nova.radiusSM, style: .continuous)
                    .strokeBorder(Nova.ruleStrong, lineWidth: 1),
            )
            .shadow(color: .black.opacity(0.28), radius: 12, y: 4)
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : Nova.offsetRow)
            .onAppear {
                withAnimation(.nova(Nova.base)) { shown = true }
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(duration))
                    withAnimation(.nova(Nova.base)) { shown = false }
                    try? await Task.sleep(for: .seconds(Nova.base))
                    onDone()
                }
            }
    }
}
