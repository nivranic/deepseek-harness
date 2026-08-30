import Foundation

/// The chapter-56 kinds whose content is textual and renders directly;
/// every other kind renders its type and size only.
public let liteArtifactTextKinds: Set<String> = ["markdown", "text", "report", "patch"]

/// One artifact's read content with its presentation decision — the
/// consumption face of the resource channel.
public struct LiteArtifactContent: Equatable, Sendable {
    /// How the surface renders the bytes.
    public enum Presentation: Equatable, Sendable {
        /// A textual kind renders its content directly.
        case text(String)

        /// Any other kind renders its type and size only.
        case binary(kind: String, sizeBytes: Int)
    }

    public let id: String
    public let kind: String
    public let title: String
    public let presentation: Presentation

    public init(id: String, kind: String, title: String, presentation: Presentation) {
        self.id = id
        self.kind = kind
        self.title = title
        self.presentation = presentation
    }
}

/// Read one artifact's bytes from the resource channel and decide its
/// presentation: textual kinds decode and render directly, every other kind
/// shows its type and size, and a missing id reads as absent — the pane's
/// honest empty state.
/// - Parameters:
///   - store: the artifact resource channel.
///   - artifact: the reference whose content is read.
/// - Returns: the content, or nil when no bytes live under the id.
public func readLiteArtifact(_ store: any LiteArtifactStoring, _ artifact: LiteArtifactRecord) async -> LiteArtifactContent? {
    guard let data = await store.get(id: artifact.id) else { return nil }
    let presentation: LiteArtifactContent.Presentation = liteArtifactTextKinds.contains(artifact.kind)
        ? .text(String(decoding: data, as: UTF8.self))
        : .binary(kind: artifact.kind, sizeBytes: data.count)
    return LiteArtifactContent(id: artifact.id, kind: artifact.kind, title: artifact.title, presentation: presentation)
}
