import SwiftUI

/// The Subagent surface: the open session's direct children with their
/// durable labels and states, plus the read-only timeline of the selected
/// child.
public struct SubagentsView: View {
    private let sessionModel: RemoteSessionViewModel
    private let model: SubagentsViewModel

    /// - Parameters:
    ///   - sessionModel: the session view model naming the open parent.
    ///   - model: the subagent view model.
    public init(sessionModel: RemoteSessionViewModel, model: SubagentsViewModel) {
        self.sessionModel = sessionModel
        self.model = model
    }

    public var body: some View {
        NavigationStack {
            List {
                if let child = model.childTimeline {
                    Section("子代理对话") {
                        ForEach(child.active?.items ?? []) { item in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.kind).font(.caption2).foregroundStyle(.tertiary)
                                if !item.text.isEmpty {
                                    Text(item.text).font(.callout).lineLimit(6)
                                }
                            }
                        }
                        Button("收起") { model.closeChild() }
                    }
                }
                if let parent = sessionModel.active?.sessionId {
                    Section("子代理（\(parent)）") {
                        switch model.listState {
                        case .idle, .loading:
                            ProgressView("正在加载…")
                        case .failed(let message):
                            Label(message, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        case .ready:
                            if model.rows.isEmpty {
                                Text("当前会话没有子代理。")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(model.rows) { row in
                                Button {
                                    Task { await model.openChild(row) }
                                } label: {
                                    HStack {
                                        Image(systemName: row.activity == .running ? "bolt.fill" : "moon")
                                            .foregroundStyle(.secondary)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(row.label ?? row.id)
                                            Text(row.reason == nil ? (row.mode?.rawValue ?? "") : (row.reason?.rawValue ?? ""))
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        if row.activity == .running {
                                            Text("运行中").font(.caption2).foregroundStyle(.green)
                                        }
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                } else {
                    Text("先打开一个会话。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("子代理")
            .toolbar {
                ToolbarItem {
                    Button {
                        if let parent = sessionModel.active?.sessionId {
                            Task { await model.load(parentSessionId: parent) }
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(sessionModel.active?.sessionId == nil)
                }
            }
            .task(id: sessionModel.active?.sessionId) {
                guard let parent = sessionModel.active?.sessionId else { return }
                await model.load(parentSessionId: parent)
            }
        }
    }
}
