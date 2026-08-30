import SwiftUI

/// The interaction inbox: pending approvals and questions as cards, each
/// answerable with the host's outcome vocabulary, and the refusal surface
/// for answers the host denied.
public struct InteractionInboxView: View {
    private let model: InteractionViewModel

    /// - Parameter model: the interaction view model.
    public init(model: InteractionViewModel) {
        self.model = model
    }

    public var body: some View {
        NavigationStack {
            Group {
                if model.inbox.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.shield")
                            .font(.largeTitle)
                            .foregroundStyle(.tertiary)
                        Text(model.clientId.isEmpty ? "未连接事件流" : "暂无待处理的审批或提问")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        if let refusal = model.lastRefusal {
                            Text(refusal).font(.caption).foregroundStyle(.red)
                        }
                    }
                } else {
                    List(model.inbox) { pending in
                        InteractionCard(model: model, pending: pending)
                    }
                }
            }
            .navigationTitle("审批")
            .task { await model.startWatching() }
        }
    }
}

/// One pending interaction with its answer row.
struct InteractionCard: View {
    let model: InteractionViewModel
    let pending: PendingInteraction

    var body: some View {
        CardSurface {
            VStack(alignment: .leading, spacing: 12) {
                Label(pending.title, systemImage: pending.kind == .approval ? "shield.checkerboard" : "questionmark.bubble")
                    .font(.body.weight(.semibold))
                if !pending.detail.isEmpty {
                    Text(pending.detail).font(.callout).foregroundStyle(.secondary)
                }
                HStack(spacing: 12) {
                    if pending.kind == .approval {
                        answerButton("允许一次", answer: .allowedOnce, role: .primary)
                        answerButton("拒绝", answer: .rejected, role: .destructive)
                    } else {
                        answerButton("忽略", answer: .cancelled, role: .secondary)
                    }
                    if model.answering { ProgressView() }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func answerButton(_ label: String, answer: InteractionAnswer, role: ButtonRole?) -> some View {
        Button(label, role: role) {
            Task { await model.answer(pending, with: answer) }
        }
        .buttonStyle(.companion)
    }
}
