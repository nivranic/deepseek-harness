import Foundation

/// Immutable application build metadata; scanner provenance cannot supply a missing application source.
public struct SupportApplicationSource: Encodable, Sendable {
    public let producer = "application-build"
    public let observation = "current"
    public let sourceSha: String
    public let treeSha: String

    /// Unstamped local builds return nil; partial, unresolved or malformed metadata refuses export.
    public init?(info: [String: Any]) throws {
        let source = info["DSHApplicationSourceSHA"]
        let tree = info["DSHApplicationSourceTree"]
        if source == nil && tree == nil { return nil }
        guard let sourceSha = source as? String, let treeSha = tree as? String else {
            throw SupportExportError.invalidIdentity
        }
        if sourceSha.isEmpty && treeSha.isEmpty { return nil }
        for value in [sourceSha, treeSha] {
            guard value.utf8.count == 40, value.utf8.allSatisfy({
                (48...57).contains($0) || (97...102).contains($0)
            }) else { throw SupportExportError.invalidIdentity }
        }
        self.sourceSha = sourceSha
        self.treeSha = treeSha
    }
}
