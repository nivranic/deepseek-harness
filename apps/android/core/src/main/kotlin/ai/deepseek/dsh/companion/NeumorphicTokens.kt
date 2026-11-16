package ai.deepseek.dsh.companion

/**
 * The Minimal Neumorphic baseline (nativization plan chapter 60): Android
 * ships exactly one visual style — soft raised surfaces from a dual-tone
 * shadow pair on an even, light surface. No glass, no translucency; the
 * Apple surface's second style is deliberately not mirrored here.
 *
 * Tokens are plain ARGB longs so the pure-JVM domain module stays
 * UI-framework-free; the Compose module reads them when it lands.
 */
object NeumorphicTokens {
    /** The even light ground every raised surface sits on. */
    const val surface = 0xFFE8EAF0UL

    /** Highlight tone of the raised pair; the side ambient light strikes. */
    const val shadowLight = 0xFFFFFFFFUL

    /** Shade tone of the raised pair; the side away from the light. */
    const val shadowDark = 0xFFB8BDD0UL

    /** Primary text on the surface. */
    const val textPrimary = 0xFF1C1F2AUL

    /** Secondary text on the surface. */
    const val textSecondary = 0xFF5A6072UL

    /** Corner radius of raised cards and controls, in dp. */
    const val cornerRadius = 16.0

    /** Uniform inset the dual shadows sit at, in dp. */
    const val shadowInset = 6.0

    /** Soothing blur radius of each shadow tone, in dp. */
    const val shadowBlur = 12.0

    /** Base spacing step of the eight-point grid, in dp. */
    const val spacing = 8.0
}
