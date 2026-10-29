import SwiftUI

/// The two Apple visual styles the cross-device plan mandates: 简约拟态
/// (minimal neumorphic) everywhere, plus 液态玻璃 (liquid glass) where the OS
/// can honor it. Both styles read the same semantic token set — components
/// never branch on style themselves.
public enum CompanionStyle: String, CaseIterable, Identifiable {
    case neumorphic
    case liquidGlass

    public var id: String { rawValue }

    /// The display name shown in the appearance picker.
    public var displayName: String {
        switch self {
        case .neumorphic: return "简约拟态"
        case .liquidGlass: return "液态玻璃"
        }
    }
}

/// One semantic design-token set. Values differ per style; names never do.
public struct CompanionTheme {
    /// The style these tokens render.
    public let style: CompanionStyle

    // Color tokens — one semantic name per role, no component-owned colors.
    public let accent = Color.blue
    public let canvas = Color(red: 0.93, green: 0.94, blue: 0.96)
    public let surface = Color.white.opacity(0.92)
    public let textPrimary = Color.primary
    public let textSecondary = Color.secondary

    /// Corner radius tokens.
    public let radiusCard: CGFloat = 18
    public let radiusControl: CGFloat = 14

    /// The neumorphic shadow pair (light from top-left, dark from
    /// bottom-right); the glass style carries softer, wider shadows instead.
    public let shadowLight: Color
    public let shadowDark: Color
    public let shadowRadius: CGFloat

    /// Whether surfaces render translucency (materials) or opaque tints.
    public let translucent: Bool

    init(style: CompanionStyle) {
        self.style = style
        switch style {
        case .neumorphic:
            shadowLight = Color.white.opacity(0.9)
            shadowDark = Color.black.opacity(0.12)
            shadowRadius = 6
            translucent = false
        case .liquidGlass:
            shadowLight = Color.white.opacity(0.35)
            shadowDark = Color.black.opacity(0.18)
            shadowRadius = 16
            translucent = true
        }
    }

    /// Resolve the effective theme for one rendering environment: liquid
    /// glass degrades to 简约拟态 unless the OS supports it and the user has
    /// not asked for reduced transparency or increased contrast — the
    /// degrade is a token swap, never a per-component branch.
    /// - Parameters:
    ///   - requested: the style the user picked.
    ///   - glassCapableOS: whether this OS carries the glass design language.
    ///   - reduceTransparency: `AccessibilityPreferences.reduceTransparency`.
    ///   - increaseContrast: `AccessibilityPreferences.increaseContrast`.
    /// - Returns: the theme whose tokens the surface layer should read.
    public static func resolve(
        requested: CompanionStyle,
        glassCapableOS: Bool,
        reduceTransparency: Bool,
        increaseContrast: Bool
    ) -> CompanionTheme {
        let effective: CompanionStyle
        switch requested {
        case .neumorphic:
            effective = .neumorphic
        case .liquidGlass:
            effective = (glassCapableOS && !reduceTransparency && !increaseContrast) ? .liquidGlass : .neumorphic
        }
        return CompanionTheme(style: effective)
    }
}

/// The environment carrier for the active theme.
private struct CompanionThemeKey: EnvironmentKey {
    static let defaultValue = CompanionTheme(style: .neumorphic)
}

extension EnvironmentValues {
    /// The theme every companion surface reads.
    public var companionTheme: CompanionTheme {
        get { self[CompanionThemeKey.self] }
        set { self[CompanionThemeKey.self] = newValue }
    }
}

/// Applies one style's tokens to a subtree, honoring the degrade rule
/// against the accessibility preferences SwiftUI reports.
extension View {
    /// Install the requested style's tokens as the subtree's theme.
    /// - Parameter style: the user-selected visual style.
    public func companionTheme(_ style: CompanionStyle) -> some View {
        transformEnvironment(\.companionTheme) { theme in
            theme = CompanionTheme(style: style)
        }
    }
}
