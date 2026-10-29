import SwiftUI

/// The Files surface: the registered Workspace picker, one Workspace's
/// directory tree, and the paged text reader — all read-only host endpoints.
public struct FilesView: View {
    /// `.topBarLeading` exists only on iOS; macOS navigation bars place the
    /// same item with the automatic leading slot.
    private static var leadingToolbarPlacement: ToolbarItemPlacement {
        #if os(iOS)
        .topBarLeading
        #else
        .automatic
        #endif
    }

    /// The workspace menu rides the trailing end of the same bar; macOS has
    /// no top-bar trailing slot, so the primary-action corner carries it.
    private static var trailingToolbarPlacement: ToolbarItemPlacement {
        #if os(iOS)
        .topBarTrailing
        #else
        .primaryAction
        #endif
    }

    private let model: FilesViewModel

    /// - Parameter model: the files view model.
    public init(model: FilesViewModel) {
        self.model = model
    }

    public var body: some View {
        NavigationStack {
            List {
                if model.workspaces.isEmpty {
                    Text("宿主暂无已注册工作区。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let open = model.openFile {
                    Section(open.path) {
                        Text(open.text)
                            .font(.system(.caption, design: .monospaced))
                            .lineLimit(30)
                        HStack {
                            Text("\(open.loadedUnits)/\(open.totalUnits) 字符 · \(open.mediaType)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Spacer()
                            if open.hasMore {
                                Button("加载更多") { Task { await model.loadMore() } }
                                    .disabled(model.openingFile)
                            }
                            Button("关闭") { model.closeFile() }
                        }
                    }
                }
                if let error = model.openFileError {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }
                if model.selectedWorkspace != nil {
                    Section(directoryLabel) {
                        switch model.listState {
                        case .idle, .loading:
                            ProgressView("正在加载…")
                        case .failed(let message):
                            Label(message, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        case .ready:
                            ForEach(model.entries, id: \.name) { entry in
                                Button {
                                    Task { await model.open(entry) }
                                } label: {
                                    HStack {
                                        Image(systemName: entry.type == .directory ? "folder" : "doc")
                                            .foregroundStyle(.secondary)
                                        Text(entry.name)
                                        Spacer()
                                        if entry.type == .file, let size = entry.size {
                                            Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .navigationTitle("文件")
            .toolbar {
                ToolbarItem(placement: Self.leadingToolbarPlacement) {
                    Button {
                        Task { await model.goUp() }
                    } label: {
                        Image(systemName: "arrow.up.circle")
                    }
                    .disabled(model.directory.isEmpty)
                }
                ToolbarItem(placement: Self.trailingToolbarPlacement) {
                    Menu {
                        ForEach(model.workspaces) { workspace in
                            Button(workspace.title) {
                                Task { await model.select(workspaceId: workspace.id) }
                            }
                        }
                    } label: {
                        Image(systemName: "externaldrive")
                    }
                    .disabled(model.workspaces.isEmpty)
                }
            }
        }
    }

    private var directoryLabel: String {
        let title = model.workspaces.first { $0.id == model.selectedWorkspace }?.title ?? ""
        return model.directory.isEmpty ? title : "\(title)/\(model.directory)"
    }
}
