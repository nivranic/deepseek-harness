import Foundation
import Observation
import SwiftUI

/// The Lite chat surface's state: one on-device session driven through the
/// loop, its journal persisted on every turn, and the folded domain state
/// exposed for rendering.
@MainActor
@Observable
public final class LiteChatViewModel {
    public private(set) var session: LiteSession
    public private(set) var driver: LiteLoopDriver
    public private(set) var lastHandoff: String?
    private let store: (any LiteSessionStoring)?

    /// - Parameters:
    ///   - sessionId: the durable journal identity.
    ///   - provider: the model seam; tests pass a scripted provider.
    ///   - execute: the bundled-tool executor.
    ///   - store: the journal store; nil keeps the session in memory only.
    public init(
        sessionId: String,
        provider: any LiteProviding,
        execute: @escaping LiteToolExecuting,
        store: (any LiteSessionStoring)? = nil
    ) {
        self.session = LiteSession(id: sessionId)
        self.driver = LiteLoopDriver(provider: provider, execute: execute)
        self.store = store
    }

    /// The folded domain state of the journal plus the live turn.
    public var state: LiteDomainState {
        driver.running ? driver.fold.state : session.state
    }

    /// Submit one prompt, then persist the turn's events to the journal.
    public func send(prompt: String) async {
        await driver.submit(prompt: prompt)
        // The journal takes the driver's whole event stream: replay equality
        // with the session would need the driver's event log, so the journal
        // records the fold-visible outcome events of this turn.
        session.record(.promptAccepted(requestId: "ui-\(UUID().uuidString)", content: prompt))
        session.record(.messageCompleted(text: driver.fold.state.conversation.last?.text ?? "", usage: nil))
        if let handoff = driver.fold.state.pendingHandoff {
            lastHandoff = handoff
            session.record(.handoffRequested(capability: handoff))
        } else {
            session.record(.turnCompleted)
        }
        if let store { try? await store.save(session) }
    }
}

/// The Lite chat surface: the conversation, the live stream partial, tool
/// rows with phases, artifacts, and the handoff banner.
public struct LiteChatView: View {
    @State private var draft = ""
    private let model: LiteChatViewModel

    /// - Parameter model: the chat view model.
    public init(model: LiteChatViewModel) {
        self.model = model
    }

    public var body: some View {
        let state = model.state
        VStack(spacing: 0) {
            if let handoff = model.lastHandoff {
                Label("此能力需要完整运行时（\(handoff)），已在宿主上继续。", systemImage: "arrow.triangle.turn.up.right.circle")
                    .font(.footnote)
                    .padding(.vertical, 6)
            }
            List {
                ForEach(Array(state.conversation.enumerated()), id: \.offset) { _, message in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(message.role == "user" ? "你" : "助手").font(.caption2).foregroundStyle(.tertiary)
                        Text(message.text).font(.callout)
                        if message.interrupted == true {
                            Text("已中断").font(.caption2).foregroundStyle(.orange)
                        }
                    }
                }
                if state.streaming.active {
                    Text(state.streaming.partialText.isEmpty ? "正在思考…" : state.streaming.partialText)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                ForEach(state.toolCalls, id: \.id) { call in
                    HStack {
                        Image(systemName: call.phase == .failed ? "xmark.octagon" : "wrench.and.screwdriver")
                        Text(call.name)
                        Spacer()
                        Text(call.phase == .running ? "执行中" : (call.phase == .failed ? "失败" : "完成"))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                ForEach(state.artifacts, id: \.id) { artifact in
                    Label(artifact.title, systemImage: "doc")
                        .font(.callout)
                }
            }
            HStack {
                TextField("输入…", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await submit() } }
                Button { Task { await submit() } } label: { Image(systemName: "paperplane") }
                    .disabled(draft.isEmpty || model.driver.running)
            }
            .padding()
        }
    }

    private func submit() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        await model.send(prompt: text)
    }
}
