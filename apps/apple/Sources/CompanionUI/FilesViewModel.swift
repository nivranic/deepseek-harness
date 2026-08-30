import Foundation
import Observation
import SharedAppleRemoteCore

/// One registered Workspace as the file browser's picker lists it.
public struct FilesWorkspaceRow: Identifiable, Equatable {
    public let id: String
    public let title: String
    /// Host directory path, shown as the picker's subtitle.
    public let path: String

    public init(id: String, title: String, path: String) {
        self.id = id
        self.title = title
        self.path = path
    }
}

/// One open text file's accumulated pages.
public struct OpenTextFile: Equatable {
    public let path: String
    public let mediaType: String
    public var text: String
    /// Offset of the next page in UTF-16 code units.
    public var loadedUnits: Int
    public let totalUnits: Int
    public var hasMore: Bool

    public init(
        path: String, mediaType: String, text: String,
        loadedUnits: Int, totalUnits: Int, hasMore: Bool
    ) {
        self.path = path
        self.mediaType = mediaType
        self.text = text
        self.loadedUnits = loadedUnits
        self.totalUnits = totalUnits
        self.hasMore = hasMore
    }
}

/// The Files surface's state machine: the registered Workspace list from
/// `workspace/follow`, one Workspace's directory tree through
/// `workspaceFiles/list`, and paged UTF-16 text reads through
/// `workspaceFiles/read` — the read-only endpoints whose containment, cap,
/// and binary policy the host owns. A file the host reports as too large for
/// an unbounded read reopens as explicit pages automatically.
@MainActor
@Observable
public final class FilesViewModel {
    /// UTF-16 code units requested per explicit page.
    static let pageSize = 65_536

    public enum ListState: Equatable {
        case idle
        case loading
        case ready
        case failed(String)
    }

    public private(set) var workspaces: [FilesWorkspaceRow] = []
    public private(set) var selectedWorkspace: String?
    /// Current directory relative to the Workspace root; '' names the root.
    public private(set) var directory: String = ""
    public private(set) var entries: [LinkFileEntry] = []
    public private(set) var listState: ListState = .idle
    public private(set) var openFile: OpenTextFile?
    public private(set) var openFileError: String?
    public private(set) var openingFile = false

    private let wire: any CompanionWireDriving
    private var followTask: Task<Void, Never>?

    /// - Parameter wire: the wire driver; tests pass a fake.
    public init(wire: any CompanionWireDriving) {
        self.wire = wire
    }

    deinit {
        // The view model is main-actor-bound by construction; its deinit
        // runs nonisolated, so the cancel borrows the isolation it knows holds.
        MainActor.assumeIsolated { followTask?.cancel() }
    }

    /// Follow the Workspace registry: the baseline seeds the picker, upserts
    /// and removes keep it live; order and archive frames do not affect which
    /// Workspaces are browsable and are ignored. The stream resubscribes on
    /// loss the way the interaction watcher does.
    public func start() async {
        followTask?.cancel()
        followTask = Task { [weak self] in
            guard let self else { return }
            do {
                let frames = try await self.wire.stream("workspace/follow", payload: [:])
                for try await frame in frames {
                    self.applyRegistryFrame(frame)
                }
                await self.restart()
            } catch is CancellationError {
                // Deliberate stop.
            } catch {
                await self.restart()
            }
        }
    }

    /// Stop following the registry; the collected rows stay for review.
    public func stop() {
        followTask?.cancel()
        followTask = nil
    }

    /// Select one Workspace and open its root.
    public func select(workspaceId: String) async {
        selectedWorkspace = workspaceId
        directory = ""
        closeFile()
        await loadDirectory()
    }

    /// Open one entry: directories navigate, files open the paged reader.
    public func open(_ entry: LinkFileEntry) async {
        if entry.type == .directory {
            directory = directory.isEmpty ? entry.name : "\(directory)/\(entry.name)"
            await loadDirectory()
            return
        }
        if entry.type == .file {
            await openText(path: directory.isEmpty ? entry.name : "\(directory)/\(entry.name)")
        }
    }

    /// Move to the current directory's parent; the root stays put.
    public func goUp() async {
        guard !directory.isEmpty else { return }
        directory = parent(of: directory)
        await loadDirectory()
    }

    /// Close the open file, if one is.
    public func closeFile() {
        openFile = nil
        openFileError = nil
    }

    /// Fetch the next page of the open file, when more remains.
    public func loadMore() async {
        guard let file = openFile, file.hasMore, !openingFile else { return }
        await readPage(path: file.path, offset: file.loadedUnits)
    }

    // MARK: - Internals

    private func restart() async {
        guard followTask != nil else { return }
        try? await Task.sleep(for: .seconds(1))
        guard followTask != nil else { return }
        await start()
    }

    private func loadDirectory() async {
        guard let workspaceId = selectedWorkspace else { return }
        listState = .loading
        var args: [String: WireValue] = ["workspaceId": .string(workspaceId)]
        if !directory.isEmpty { args["path"] = .string(directory) }
        do {
            let value = try await wire.call("workspaceFiles/list", args: args)
            guard let listed = ContractCodec.decode(LinkFileListValue.self, from: value) else {
                throw LinkClientError.badWire("workspaceFiles/list value did not decode")
            }
            directory = listed.path
            entries = listed.entries
            listState = .ready
        } catch {
            listState = .failed(Self.errorMessage(of: error))
        }
    }

    private func openText(path: String) async {
        openingFile = true
        openFileError = nil
        defer { openingFile = false }
        do {
            let value = try await wire.call("workspaceFiles/read", args: [
                "workspaceId": .string(selectedWorkspace ?? ""),
                "path": .string(path),
            ])
            applyReadValue(value, path: path)
        } catch let error as LinkClientError {
            // An unbounded read the host capped turns into the first page;
            // every other refusal surfaces as reader state.
            if case .refused(let code, _) = error, code == "file-too-large" {
                await readPage(path: path, offset: 0)
                return
            }
            openFileError = Self.errorMessage(of: error)
        } catch {
            openFileError = Self.errorMessage(of: error)
        }
    }

    private func readPage(path: String, offset: Int) async {
        openingFile = true
        openFileError = nil
        defer { openingFile = false }
        do {
            let value = try await wire.call("workspaceFiles/read", args: [
                "workspaceId": .string(selectedWorkspace ?? ""),
                "path": .string(path),
                "offset": .number(Double(offset)),
                "limit": .number(Double(Self.pageSize)),
            ])
            applyReadValue(value, path: path, startingAt: offset)
        } catch {
            openFileError = Self.errorMessage(of: error)
        }
    }

    private func applyReadValue(_ value: WireValue, path: String, startingAt offset: Int = 0) {
        guard let read = ContractCodec.decode(LinkFileReadValue.self, from: value) else {
            openFileError = "读取结果无法解码。"
            return
        }
        let end = offset + read.content.utf16.count
        if let file = openFile, file.path == path {
            openFile = OpenTextFile(
                path: path,
                mediaType: read.mediaType,
                text: file.text + read.content,
                loadedUnits: end,
                totalUnits: Int(read.size),
                hasMore: read.truncated
            )
            return
        }
        openFile = OpenTextFile(
            path: path,
            mediaType: read.mediaType,
            text: read.content,
            loadedUnits: end,
            totalUnits: Int(read.size),
            hasMore: read.truncated
        )
    }

    private func applyRegistryFrame(_ frame: WireValue) {
        let kind = WireShape.string(frame, field: "type") ?? ""
        switch kind {
        case "baseline":
            let value = WireShape.object(frame, field: "value") ?? .null
            let items = WireShape.array(value, field: "items") ?? []
            workspaces = items.compactMap { item in
                guard let id = WireShape.string(item, field: "workspaceId") else { return nil }
                return FilesWorkspaceRow(
                    id: id,
                    title: WireShape.string(item, field: "title") ?? id,
                    path: WireShape.string(item, field: "path") ?? ""
                )
            }
        case "upsert":
            guard let workspace = WireShape.object(frame, field: "workspace"),
                  let id = WireShape.string(workspace, field: "workspaceId") else { return }
            let row = FilesWorkspaceRow(
                id: id,
                title: WireShape.string(workspace, field: "title") ?? id,
                path: WireShape.string(workspace, field: "path") ?? ""
            )
            if let index = workspaces.firstIndex(where: { $0.id == id }) {
                workspaces[index] = row
            } else {
                workspaces.append(row)
            }
        case "remove":
            if let id = WireShape.string(frame, field: "workspaceId") {
                workspaces.removeAll { $0.id == id }
                if selectedWorkspace == id {
                    selectedWorkspace = nil
                    entries = []
                    directory = ""
                    closeFile()
                }
            }
        default:
            break
        }
    }

    private func parent(of path: String) -> String {
        let parts = path.split(separator: "/").map(String.init)
        return parts.count <= 1 ? "" : parts.dropLast().joined(separator: "/")
    }

    static func errorMessage(of error: Error) -> String {
        if let linkError = error as? LinkClientError,
           case .refused(let code, let message) = linkError {
            switch code {
            case "file-binary": return "二进制文件，无法预览。"
            case "path-outside-workspace": return "路径越出工作区根。"
            case "file-not-found": return "文件不存在。"
            case "not-a-regular-file": return "不是常规文件。"
            case "workspace-not-found": return "工作区不存在。"
            case "bad-request": return "请求参数无效。"
            default: return "\(code): \(message)"
            }
        }
        return RemoteSessionViewModel.message(of: error)
    }
}
