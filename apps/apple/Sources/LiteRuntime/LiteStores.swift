import Foundation

/// Durable Lite session identity.
public struct LiteSession: Equatable {
    public let id: String
    public private(set) var events: [LiteEvent]

    /// - Parameter id: stable session identity (also the storage key).
    public init(id: String, events: [LiteEvent] = []) {
        self.id = id
        self.events = events
    }

    /// Append one event to the journal.
    public mutating func record(_ event: LiteEvent) {
        events.append(event)
    }

    /// Replay the journal through the Behavior-Spec fold.
    public var state: LiteDomainState {
        var fold = LiteFold()
        for event in events { fold.apply(event) }
        return fold.state
    }
}

/// Persists Lite session journals — one append-only JSON-lines file per
/// session, one encoded event per line (plan chapter 11's journal shape).
public protocol LiteSessionStoring: Actor {
    /// Persist the session's complete journal, replacing any prior one.
    /// - Parameter session: the session whose events are durable.
    /// - Throws on storage failure.
    func save(_ session: LiteSession) async throws

    /// Load one session's journal.
    /// - Parameter id: the session identity.
    /// - Returns the replayable session, or nil when none is stored.
    /// - Throws on storage failure or a corrupt journal line.
    func load(id: String) async throws -> LiteSession?

    /// Remove one session's journal.
    /// - Parameter id: the session identity to delete.
    /// - Throws on storage failure.
    func delete(id: String) async throws
}

/// File-backed session journals under a directory, `<id>.litejournal`.
public actor LiteFileSessionStore: LiteSessionStoring {
    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    /// - Parameter directory: the directory holding one journal file per session.
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.directory = directory
    }

    private func file(for id: String) -> URL {
        directory.appendingPathComponent("\(id).litejournal")
    }

    public func save(_ session: LiteSession) async throws {
        let lines = try session.events.map { event in
            String(data: try encoder.encode(event), encoding: .utf8)!
        }
        try lines.joined(separator: "\n").appending("\n").data(using: .utf8)!.write(to: file(for: session.id), options: .atomic)
    }

    public func load(id: String) async throws -> LiteSession? {
        let url = file(for: id)
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        var session = LiteSession(id: id)
        for line in text.split(separator: "\n") where !line.isEmpty {
            session.record(try decoder.decode(LiteEvent.self, from: Data(line.utf8)))
        }
        return session
    }

    public func delete(id: String) async throws {
        try? FileManager.default.removeItem(at: file(for: id))
    }
}

/// Stores artifact content out-of-band (plan chapter 56): events carry only
/// references and status; bytes live in the resource channel.
public protocol LiteArtifactStoring: Actor {
    /// Write one artifact's bytes under its id.
    /// - Parameters:
    ///   - id: the artifact reference identity.
    ///   - data: the complete content bytes.
    /// - Throws on storage failure.
    func put(id: String, data: Data) async throws

    /// Read one artifact's bytes.
    /// - Parameter id: the artifact reference identity.
    /// - Returns the stored bytes, or nil when absent.
    /// - Throws on storage failure.
    func get(id: String) async throws -> Data?

    /// Remove one artifact's bytes.
    /// - Parameter id: the artifact reference identity.
    /// - Throws on storage failure.
    func remove(id: String) async throws
}

/// File-backed artifact content under a directory, `<id>.artifact`.
public actor LiteFileArtifactStore: LiteArtifactStoring {
    private let directory: URL

    /// - Parameter directory: the directory holding one content file per artifact.
    public init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        self.directory = directory
    }

    private func file(for id: String) -> URL {
        directory.appendingPathComponent("\(id).artifact")
    }

    public func put(id: String, data: Data) async throws {
        try data.write(to: file(for: id), options: .atomic)
    }

    public func get(id: String) async throws -> Data? {
        try? Data(contentsOf: file(for: id))
    }

    public func remove(id: String) async throws {
        try? FileManager.default.removeItem(at: file(for: id))
    }
}
