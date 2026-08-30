import Foundation
import SharedAppleRemoteCore

/// One hunk line of a projected change: added lines arrived with the call,
/// removed lines are what it replaced.
public struct DiffLine: Equatable {
    public let added: Bool
    public let text: String

    public init(added: Bool, text: String) {
        self.added = added
        self.text = text
    }
}

/// One read-only file change projected from a completed file-writing tool
/// call — the chapter-55 first-version review surface: one hunk per call,
/// counts first, no merging across calls.
public struct FileChange: Equatable {
    public let path: String
    public let added: Int
    public let removed: Int
    public let lines: [DiffLine]

    public init(path: String, added: Int, removed: Int, lines: [DiffLine]) {
        self.path = path
        self.added = added
        self.removed = removed
        self.lines = lines
    }
}

extension FileChange {
    /// Project the trajectory's completed file-writing calls into read-only
    /// changes in call order. Unknown tools, the read-only `view` command,
    /// calls that never completed, and unparseable or non-object arguments
    /// contribute nothing — a failed write changed no file.
    /// - Parameter calls: the folded tool trajectory, paired by `callId`.
    /// - Returns: the projected changes, one entry per contributing call.
    public static func project(_ calls: [CompanionDomainState.ToolCall]) -> [FileChange] {
        calls.compactMap(projectOne)
    }

    static func projectOne(_ call: CompanionDomainState.ToolCall) -> FileChange? {
        guard call.phase == .completed, let args = argumentsObject(call.arguments) else { return nil }
        func field(_ name: String) -> String? { WireShape.string(args, field: name) }
        switch call.name {
        case "write":
            return build(path: field("file_path"), removed: nil, added: field("content"))
        case "edit":
            return build(path: field("file_path"), removed: field("old_string"), added: field("new_string"))
        case "str_replace_editor":
            switch field("command") {
            case "create": return build(path: field("path"), removed: nil, added: field("file_text"))
            case "str_replace": return build(path: field("path"), removed: field("old_str"), added: field("new_str"))
            case "insert": return build(path: field("path"), removed: nil, added: field("new_str"))
            default: return nil
            }
        default:
            return nil
        }
    }

    /// Decode the call's argument JSON. The trajectory is a model/tool JSON
    /// boundary, so a malformed or non-object payload is an absent referent —
    /// skipped, never a crash; nothing else can reach this catch.
    static func argumentsObject(_ arguments: String) -> WireValue? {
        guard let data = arguments.data(using: .utf8),
              let value = try? JSONDecoder().decode(WireValue.self, from: data),
              case .object = value else { return nil }
        return value
    }

    static func build(path: String?, removed: String?, added: String?) -> FileChange? {
        guard let path = path, !path.isEmpty, removed != nil || added != nil else { return nil }
        let removedLines = removed.map(splitLines) ?? []
        let addedLines = added.map(splitLines) ?? []
        return FileChange(
            path: path,
            added: addedLines.count,
            removed: removedLines.count,
            lines: removedLines.map { DiffLine(added: false, text: $0) }
                + addedLines.map { DiffLine(added: true, text: $0) }
        )
    }

    /// Split text into diff lines: a single trailing newline opens no last
    /// empty line; empty text has none.
    static func splitLines(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        let body = text.hasSuffix("\n") ? String(text.dropLast()) : text
        return body.components(separatedBy: "\n")
    }
}
