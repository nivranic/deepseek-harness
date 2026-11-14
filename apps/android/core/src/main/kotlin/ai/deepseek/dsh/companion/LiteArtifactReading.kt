package ai.deepseek.dsh.companion

/**
 * The chapter-56 kinds whose content is textual and renders directly;
 * every other kind renders its type and size only.
 */
val LiteArtifactTextKinds: Set<String> = setOf("markdown", "text", "report", "patch")

/**
 * One artifact's read content with its presentation decision — the
 * consumption face of the resource channel.
 */
data class LiteArtifactContent(
    val id: String,
    val kind: String,
    val title: String,
    val presentation: Presentation,
) {
    /** How the surface renders the bytes. */
    sealed interface Presentation {
        /** A textual kind renders its content directly. */
        data class Text(val text: String) : Presentation

        /** Any other kind renders its type and size only. */
        data class Binary(val kind: String, val sizeBytes: Int) : Presentation
    }
}

/**
 * Read one artifact's bytes from the resource channel and decide its
 * presentation: textual kinds decode and render directly, every other kind
 * shows its type and size, and a missing id reads as absent — the pane's
 * honest empty state.
 * @param store the artifact resource channel.
 * @param artifact the reference whose content is read.
 * @return the content, or null when no bytes live under the id.
 */
fun readLiteArtifact(store: LiteArtifactStoring, artifact: LiteArtifact): LiteArtifactContent? {
    val bytes = store.get(artifact.id) ?: return null
    val presentation = if (artifact.kind in LiteArtifactTextKinds) {
        LiteArtifactContent.Presentation.Text(bytes.decodeToString())
    } else {
        LiteArtifactContent.Presentation.Binary(kind = artifact.kind, sizeBytes = bytes.size)
    }
    return LiteArtifactContent(id = artifact.id, kind = artifact.kind, title = artifact.title, presentation = presentation)
}
