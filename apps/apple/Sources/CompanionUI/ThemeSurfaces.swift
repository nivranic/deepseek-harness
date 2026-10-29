import SwiftUI

/// The one card surface every pane uses: same shape and layout both styles,
/// tokens-only differences — neumorphic gets the dual soft shadow, glass
/// gets translucency with a wider halo.
public struct CardSurface<Content: View>: View {
    @Environment(\.companionTheme) private var theme
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                    .fill(theme.translucent ? AnyShapeStyle(.ultraThinMaterial) : AnyShapeStyle(theme.surface))
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
                    .strokeBorder(theme.translucent ? theme.accent.opacity(0.12) : theme.shadowDark.opacity(0.25), lineWidth: 1)
            )
            .shadow(color: theme.shadowLight, radius: theme.shadowRadius, x: -theme.shadowRadius / 2, y: -theme.shadowRadius / 2)
            .shadow(color: theme.shadowDark, radius: theme.shadowRadius, x: theme.shadowRadius / 2, y: theme.shadowRadius / 2)
    }
}

/// The primary action control, token-driven like every other surface.
public struct CompanionButtonStyle: ButtonStyle {
    @Environment(\.companionTheme) private var theme

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundStyle(configuration.isPressed ? theme.textSecondary : theme.textPrimary)
            .background(
                RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                    .fill(theme.translucent ? AnyShapeStyle(.thinMaterial) : AnyShapeStyle(theme.canvas))
            )
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusControl, style: .continuous)
                    .strokeBorder(theme.shadowDark.opacity(0.25), lineWidth: 1)
            )
            .shadow(color: theme.shadowDark, radius: theme.shadowRadius / 2, x: 2, y: 2)
    }
}

extension ButtonStyle where Self == CompanionButtonStyle {
    /// The companion's standard button surface.
    public static var companion: CompanionButtonStyle { CompanionButtonStyle() }
}
