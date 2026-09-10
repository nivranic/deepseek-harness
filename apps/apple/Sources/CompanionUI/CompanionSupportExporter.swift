import Foundation
import SharedAppleRemoteCore
import SupportExportCore

/// Prepares local application and Link observations without loading credentials or opening a connection.
public struct CompanionSupportExporter: Sendable {
    private let product: SupportProductIdentity
    private let identity: SupportLibraryIdentity
    private let exporter: SupportDocumentExporter

    public init(product: SupportProductIdentity, identity: SupportLibraryIdentity,
                scanner: any DocumentScanner, policy: DocumentScanPolicy) {
        self.product = product
        self.identity = identity
        exporter = SupportDocumentExporter(scanner: scanner, policy: policy)
    }

    /// The caller supplies an owner snapshot; only the complete serialized document can be admitted.
    public func prepare(link: LinkDiagnosticSnapshot?, connections: CompanionConnectionSnapshots) async throws -> ApprovedSupportDocument {
        try Task.checkCancellation()
        let document = CompanionSupportSnapshot(application: product, scanner: identity, link: .init(snapshot: link),
                                                connections: connections)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(document)
        data.append(10)
        return try await exporter.prepare(data)
    }
}

/// Missing producers and last-known observations cannot establish current Host health or authorization.
private struct CompanionSupportSnapshot: Encodable {
    let schemaVersion = 1
    let kind = "companion-support"
    let complete = false
    let application: SupportProductIdentity
    let scanner: SupportLibraryIdentity
    let link: LinkSection
    let connections: CompanionConnectionSnapshots
    let uncollected = ["application-source", "runtime-health", "effective-role",
                       "updates", "native-crashes", "session-diagnostics"]

    struct LinkSection: Encodable {
        let producer = "LinkClient"
        let activityScope = "client-lifetime"
        let roleFreshness = "last-known"
        let descriptionFreshness = "last-known"
        let snapshot: LinkDiagnosticSnapshot?
        let state: String

        init(snapshot: LinkDiagnosticSnapshot?) {
            self.snapshot = snapshot
            state = snapshot == nil ? "unavailable" : "observed"
        }
    }
}
