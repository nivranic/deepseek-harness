import Foundation
import Observation
import SharedAppleRemoteCore

/// One direct child of the open session, decoded from the generated
/// `LinkSubagentEntry` model (the flat projection of the host's child and
/// diagnostic rows).
public struct SubagentRow: Identifiable, Equatable {
    public let id: String
    /// Wire mode: `one-shot` or `continuable`.
    public let mode: LinkSubagentMode
    /// Durable creation label, when the descriptor carried one.
    public let label: String?
    /// `running` or `inactive` at the listing's sample.
    public let activity: LinkSubagentActivity?
    /// Why a diagnostic row has no child entry, when it does not.
    public let reason: LinkSubagentDiagnosticReason?

    public init(
        id: String, mode: LinkSubagentMode, label: String?,
        activity: LinkSubagentActivity?, reason: LinkSubagentDiagnosticReason?
    ) {
        self.id = id
        self.mode = mode
        self.label = label
        self.activity = activity
        self.reason = reason
    }
}

/// The Subagent surface's state: the open session's direct children from
/// `subagents/list`, reloaded when the open session changes or on demand.
/// A child's timeline opens read-only on the session follow stream through
/// the durable parent/child address.
@MainActor
@Observable
public final class SubagentsViewModel {
    public enum ListState: Equatable {
        case idle
        case loading
        case ready
        case failed(String)
    }

    public private(set) var rows: [SubagentRow] = []
    public private(set) var listState: ListState = .idle
    /** The parent the current rows describe; nil before one session opens. */
    public private(set) var parentSessionId: String?
    public private(set) var childTimeline: RemoteSessionViewModel?

    private let wire: any CompanionWireDriving

    /// - Parameter wire: the wire driver; tests pass a fake.
    public init(wire: any CompanionWireDriving) {
        self.wire = wire
    }

    /// Load one parent's children.
    /// @param parentSessionId - the open session whose children are listed.
    public func load(parentSessionId: String) async {
        self.parentSessionId = parentSessionId
        closeChild()
        listState = .loading
        do {
            let value = try await wire.call("subagents/list", args: [
                "parentSessionId": .string(parentSessionId),
            ])
            guard let catalog = ContractCodec.decode(LinkSubagentCatalog.self, from: value) else {
                throw LinkClientError.badWire("subagents/list value did not decode")
            }
            rows = catalog.entries.map(Self.row(of:))
            listState = .ready
        } catch {
            rows = []
            listState = .failed(RemoteSessionViewModel.message(of: error))
        }
    }

    /// Open one child's read-only timeline on the follow stream.
    public func openChild(_ row: SubagentRow) async {
        guard let parentSessionId else { return }
        let child = RemoteSessionViewModel(wire: wire)
        childTimeline = child
        await child.openSubagent(
            parentSessionId: parentSessionId,
            childSessionId: row.id,
            mode: row.mode.rawValue
        )
    }

    /// Close the open child timeline, when one is.
    public func closeChild() {
        childTimeline?.close()
        childTimeline = nil
    }

    private static func row(of entry: LinkSubagentEntry) -> SubagentRow {
        SubagentRow(
            id: entry.id,
            mode: entry.mode ?? .oneShot,
            label: entry.label,
            activity: entry.activity,
            reason: entry.reason
        )
    }
}
