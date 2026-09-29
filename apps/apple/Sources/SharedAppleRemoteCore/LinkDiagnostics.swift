import Foundation

/// Fixed categories discard network addresses, credential fields and exception messages.
public enum LinkDiagnosticFailure: String, Error, Encodable, CaseIterable, Sendable {
    case unpaired, refused, transport, invalidResponse = "invalid-response", cancelled

    /// Project a carrier or owner failure without retaining its message, code or URL.
    public init(_ error: Error) {
        if error is CancellationError || (error as? URLError)?.code == .cancelled {
            self = .cancelled
        } else if let error = error as? LinkClientError {
            switch error {
            case .unpaired: self = .unpaired
            case .refused: self = .refused
            case .carrier: self = .transport
            case .badWire: self = .invalidResponse
            }
        } else {
            self = .transport
        }
    }
}

public enum LinkDescriptionObservation: String, Encodable, Sendable {
    case unavailable, querying, observed, failed
}

/// Only bounded protocol versions and fixed capability booleans leave an authenticated description.
public struct LinkSupportDescription: Encodable, Sendable {
    public let linkProtocolVersion: Int
    public let contractVersion: Int
    public let sessionFormatVersion: Int
    public let runtimeClass: String
    public let allowRemoteApproval: Bool
    public let sessionList: Bool
    public let sessionHistory: Bool
    public let sessionFollow: Bool
    public let sessionPrompt: Bool
    public let sessionCancel: Bool
    public let workspaceFollow: Bool
    public let approval: Bool
    public let question: Bool

    init(_ value: LinkHostDescription) throws {
        let versions = [value.linkProtocolVersion, value.contractVersion, value.sessionFormatVersion]
        guard versions.allSatisfy({ $0.isFinite && $0.rounded() == $0 && (0...Double(Int32.max)).contains($0) }),
              ["full", "lite"].contains(value.runtimeClass) else {
            throw LinkClientError.badWire("unsupported diagnostic protocol fields")
        }
        linkProtocolVersion = Int(value.linkProtocolVersion)
        contractVersion = Int(value.contractVersion)
        sessionFormatVersion = Int(value.sessionFormatVersion)
        runtimeClass = value.runtimeClass
        allowRemoteApproval = value.allowRemoteApproval
        sessionList = value.capabilities.session.list
        sessionHistory = value.capabilities.session.history
        sessionFollow = value.capabilities.session.follow
        sessionPrompt = value.capabilities.session.prompt
        sessionCancel = value.capabilities.session.cancel
        workspaceFollow = value.capabilities.workspace.follow
        approval = value.capabilities.interaction.approval
        question = value.capabilities.interaction.question
    }
}

/// Lifetime counters describe HTTP exchanges and stream readers, not current Host authorization or health.
public struct LinkDiagnosticSnapshot: Encodable, Sendable {
    public let startedRequests: UInt64
    public let finishedRequests: UInt64
    public let activeRequests: UInt64
    public let startedStreams: UInt64
    public let finishedStreams: UInt64
    public let activeStreams: UInt64
    public let countsSaturated: Bool
    public let failures: [LinkDiagnosticCount]
    public let lastKnownRole: String?
    public let descriptionState: LinkDescriptionObservation
    public let descriptionFailure: LinkDiagnosticFailure?
    public let description: LinkSupportDescription?
}

public struct LinkDiagnosticCount: Encodable, Sendable {
    public let category: LinkDiagnosticFailure
    public let count: UInt64
}

/// The lock serializes observation updates across URLSession callbacks and the UI's read-only projection.
final class LinkDiagnostics: @unchecked Sendable {
    struct DescriptionAttempt: Sendable {
        fileprivate let generation: UUID
        fileprivate let request: UUID
    }
    private let lock = NSLock()
    private var generation = UUID()
    private var descriptionRequest: UUID?
    private var startedRequests: UInt64 = 0
    private var finishedRequests: UInt64 = 0
    private var activeRequests: UInt64 = 0
    private var startedStreams: UInt64 = 0
    private var finishedStreams: UInt64 = 0
    private var activeStreams: UInt64 = 0
    private var saturated = false
    private var failures: [LinkDiagnosticFailure: UInt64] = [:]
    private var role: String?
    private var descriptionState = LinkDescriptionObservation.unavailable
    private var descriptionFailure: LinkDiagnosticFailure?
    private var description: LinkSupportDescription?

    func pairedRole(_ raw: String?) {
        lock.withLock {
            generation = UUID()
            descriptionRequest = nil
            role = raw.flatMap { LinkDeviceRole(rawValue: $0)?.rawValue }
            description = nil
            descriptionState = .unavailable
            descriptionFailure = nil
        }
    }

    func requestStarted() {
        lock.withLock { startedRequests = increment(startedRequests); activeRequests = increment(activeRequests) }
    }

    func requestFinished(_ failure: LinkDiagnosticFailure?) {
        lock.withLock {
            finishedRequests = increment(finishedRequests)
            activeRequests -= 1
            record(failure)
        }
    }

    func streamStarted() {
        lock.withLock { startedStreams = increment(startedStreams); activeStreams = increment(activeStreams) }
    }

    func streamFinished(_ failure: LinkDiagnosticFailure?) {
        lock.withLock {
            finishedStreams = increment(finishedStreams)
            activeStreams -= 1
            record(failure)
        }
    }

    func describing() -> DescriptionAttempt {
        lock.withLock {
            let request = UUID()
            descriptionRequest = request
            description = nil
            descriptionState = .querying
            descriptionFailure = nil
            return DescriptionAttempt(generation: generation, request: request)
        }
    }

    func described(_ attempt: DescriptionAttempt, result: Result<LinkSupportDescription, LinkDiagnosticFailure>) {
        lock.withLock {
            guard attempt.generation == generation, attempt.request == descriptionRequest else { return }
            descriptionRequest = nil
            switch result {
            case .success(let value):
                description = value
                descriptionState = .observed
                descriptionFailure = nil
            case .failure(let failure):
                description = nil
                descriptionState = .failed
                descriptionFailure = failure
            }
        }
    }

    func snapshot() -> LinkDiagnosticSnapshot {
        lock.withLock {
            LinkDiagnosticSnapshot(startedRequests: startedRequests, finishedRequests: finishedRequests, activeRequests: activeRequests,
                startedStreams: startedStreams, finishedStreams: finishedStreams, activeStreams: activeStreams, countsSaturated: saturated,
                failures: LinkDiagnosticFailure.allCases.compactMap { key in
                    failures[key].map { LinkDiagnosticCount(category: key, count: $0) }
                }, lastKnownRole: role, descriptionState: descriptionState, descriptionFailure: descriptionFailure, description: description)
        }
    }

    /// Counter saturation is sticky; no caller interprets a saturated active count as exact.
    private func increment(_ value: UInt64) -> UInt64 {
        let result = value.addingReportingOverflow(1)
        if result.overflow { saturated = true; return UInt64.max }
        return result.partialValue
    }

    private func record(_ failure: LinkDiagnosticFailure?) {
        if let failure { failures[failure] = increment(failures[failure, default: 0]) }
    }
}
