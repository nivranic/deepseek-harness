import Foundation

/// Who and where a handoff came from (chapter 40's provenance record).
public struct HandoffProvenance: Equatable, Sendable {
    /// The sending device's paired identity.
    public let deviceId: String
    /// The sending device's platform tag.
    public let platform: String
    /// Unix epoch milliseconds at send time.
    public let at: Double

    /// - Parameters:
    ///   - deviceId: the sending device's paired identity.
    ///   - platform: the sending device's platform tag.
    ///   - at: Unix epoch milliseconds at send time.
    public init(deviceId: String, platform: String, at: Double) {
        self.deviceId = deviceId
        self.platform = platform
        self.at = at
    }
}

/// One conversation row the snapshot carries verbatim.
public struct HandoffContextRow: Equatable, Sendable {
    /// Authoring side of the row, as the source runtime recorded it.
    public let role: String
    /// Row text, already the source runtime's final rendering.
    public let text: String

    /// - Parameters:
    ///   - role: `user` or `assistant`.
    ///   - text: the row's text.
    public init(role: String, text: String) {
        self.role = role
        self.text = text
    }
}

/// One todo row the snapshot carries with its verbatim status.
public struct HandoffTodoRow: Equatable, Sendable {
    public let content: String
    public let status: String

    /// - Parameters:
    ///   - content: the todo item's text.
    ///   - status: the source runtime's status word, verbatim.
    public init(content: String, status: String) {
        self.content = content
        self.status = status
    }
}

/// One artifact reference the snapshot names for the receiving host.
public struct HandoffArtifactRef: Equatable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let status: String

    /// - Parameters:
    ///   - id: the artifact reference identity on the source runtime.
    ///   - kind: the coarse artifact kind tag.
    ///   - title: the human-facing artifact title.
    ///   - status: the artifact's last known lifecycle status.
    public init(id: String, kind: String, title: String, status: String) {
        self.id = id
        self.kind = kind
        self.title = title
        self.status = status
    }
}

/// The chapter-40 Handoff L1 device side: package one source session's
/// folded state as the snapshot the host renders, and send it through
/// `session/handoff` — the host creates the new full Session, pins its
/// title, and queues the rendered brief as its first user message. Inputs
/// stay flat so any runtime (the Lite fold included) adapts its state at
/// the call site without this package learning its types.
public enum SessionHandoff {
    /// One wire call the sender rides; production passes a curried signed
    /// `LinkClient.call`, tests a scripted closure.
    public typealias Call = (_ method: String, _ args: [String: LinkWire.RequestEnvelope.Payload.Value]) async throws -> LinkWire.ResponseEnvelope.Result.Value

    /// Build the snapshot wire value from one folded source state.
    /// - Parameters:
    ///   - sourceSessionId: the source runtime's session identity.
    ///   - capability: the capability whose requirement raised the handoff.
    ///   - provenance: device identity and send time.
    ///   - recentContext: trailing conversation rows, oldest first.
    ///   - planActive: whether the source session had plan mode active.
    ///   - todo: the source session's todo rows.
    ///   - artifactRefs: the source session's artifact references.
    ///   - modelPreference: the model the source runtime used, if known.
    /// - Returns: the `snapshot` object as a wire value.
    public static func snapshotValue(
        sourceSessionId: String,
        capability: String,
        provenance: HandoffProvenance,
        recentContext: [HandoffContextRow],
        planActive: Bool,
        todo: [HandoffTodoRow],
        artifactRefs: [HandoffArtifactRef],
        modelPreference: String? = nil
    ) -> LinkWire.RequestEnvelope.Payload.Value {
        var snapshot: [String: LinkWire.RequestEnvelope.Payload.Value] = [
            "sourceSessionId": .string(sourceSessionId),
            "sourceRuntime": .string("lite"),
            "requestedCapability": .string(capability),
            "recentContext": .array(recentContext.map { row in .object([
                "role": .string(row.role),
                "text": .string(row.text),
            ]) }),
            "planActive": .bool(planActive),
            "todo": .array(todo.map { item in .object([
                "content": .string(item.content),
                "status": .string(item.status),
            ]) }),
            "artifactRefs": .array(artifactRefs.map { artifact in .object([
                "id": .string(artifact.id),
                "kind": .string(artifact.kind),
                "title": .string(artifact.title),
                "status": .string(artifact.status),
            ]) }),
            "provenance": .object([
                "deviceId": .string(provenance.deviceId),
                "platform": .string(provenance.platform),
                "at": .number(provenance.at),
            ]),
        ]
        if let modelPreference {
            snapshot["modelPreference"] = .string(modelPreference)
        }
        return .object(snapshot)
    }

    /// Send one handoff snapshot; the host owns rendering.
    /// - Parameters:
    ///   - call: the wire call seam (a curried `LinkClient.call`).
    ///   - snapshot: the wire value `snapshotValue` built.
    /// - Returns: the new full Session's id, or nil when the host refuses
    ///   or the answer carries no session id.
    public static func send(
        _ call: Call,
        snapshot: LinkWire.RequestEnvelope.Payload.Value
    ) async -> String? {
        let value: LinkWire.ResponseEnvelope.Result.Value
        do {
            value = try await call("session/handoff", ["request": snapshot])
        } catch {
            return nil
        }
        guard case let .object(fields) = value,
              case let .string(sessionId) = fields["sessionId"] else { return nil }
        return sessionId
    }
}
