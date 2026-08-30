import SwiftUI

/// The session list with its loading and failure states.
public struct SessionListView: View {
    @State private var opened: Bool = false
    private let model: RemoteSessionViewModel

    /// - Parameter model: the session view model.
    public init(model: RemoteSessionViewModel) {
        self.model = model
    }

    public var body: some View {
        NavigationStack {
            Group {
                switch model.listState {
                case .idle, .loading:
                    ProgressView("正在加载会话…")
                case .failed(let message):
                    VStack(spacing: 12) {
                        Text(message).font(.footnote)
                        Button("重试") { Task { await model.loadSessions() } }
                            .buttonStyle(.companion)
                    }
                case .ready:
                    List(model.sessions) { row in
                        Button {
                            Task { await model.open(sessionId: row.id) }
                            opened = true
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.title).font(.body.weight(.medium))
                                if let updatedAt = row.updatedAt {
                                    Text(Self.stamp(updatedAt)).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("会话")
            .navigationDestination(isPresented: $opened) {
                SessionView(model: model)
            }
            .task { await model.loadSessions() }
        }
    }

    private static func stamp(_ epochSeconds: Double) -> String {
        Date(timeIntervalSince1970: epochSeconds).formatted(date: .abbreviated, time: .shortened)
    }
}

/// The open session: the folded timeline over the follow stream plus the
/// composer (prompt / cancel) and a reconnect affordance.
public struct SessionView: View {
    @State private var draft = ""
    private let model: RemoteSessionViewModel

    /// - Parameter model: the session view model with an open session.
    public init(model: RemoteSessionViewModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            if model.reconnecting {
                Label("连接中断，正在重连…", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption)
                    .padding(.vertical, 6)
            }
            List(model.active?.items ?? []) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.kind).font(.caption2).foregroundStyle(.tertiary)
                    if !item.text.isEmpty {
                        Text(item.text).font(.callout)
                    }
                }
            }
            if !model.images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.images) { ref in
                            AttachmentCard(ref: ref, model: model)
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical, 6)
            }
            HStack(spacing: 12) {
                TextField("发消息给宿主…", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await submit() } }
                Button {
                    Task { await submit() }
                } label: {
                    if model.sending { ProgressView() } else { Image(systemName: "paperplane") }
                }
                .buttonStyle(.companion)
                .disabled(draft.isEmpty || model.sending)
                Button {
                    Task { await model.cancelActive() }
                } label: {
                    Image(systemName: "stop.circle")
                }
                .buttonStyle(.companion)
            }
            .padding()
        }
        .navigationTitle("会话")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        await model.send(text: text)
    }
}

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// One folded image reference: renders fetched bytes when the cache holds
/// them, a fetch affordance otherwise.
struct AttachmentCard: View {
    let ref: CompanionDomainState.ImageRef
    let model: RemoteSessionViewModel

    var body: some View {
        if let image = loadedImage {
            image
                .resizable()
                .scaledToFill()
                .frame(width: 96, height: 96)
                .clipShape(.rect(cornerRadius: 10))
        } else {
            Button {
                Task { await model.readAttachment(ref.attachmentId) }
            } label: {
                VStack(spacing: 4) {
                    Image(systemName: "photo")
                    Text(ref.name ?? ref.mediaType).font(.caption2).lineLimit(1)
                    Text("载入").font(.caption2).foregroundStyle(.tertiary)
                }
                .frame(width: 96, height: 96)
                .background(.quaternary, in: .rect(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
    }

    /// Decode the cached bytes on whichever platform image type this build
    /// carries; nil when uncached or undecodable.
    private var loadedImage: Image? {
        guard let data = model.attachments[ref.attachmentId] else { return nil }
        #if canImport(UIKit)
        return UIImage(data: data).map { Image(uiImage: $0) }
        #elseif canImport(AppKit)
        return NSImage(data: data).map { Image(nsImage: $0) }
        #else
        return nil
        #endif
    }
}
