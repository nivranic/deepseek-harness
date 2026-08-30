import SharedAppleRemoteCore
import SwiftUI

/// The pairing entry surface: the user pastes (or, in the app shell, scans)
/// the QR payload text, and the view pairs through a fresh client bound to
/// that payload's endpoint and fingerprint. On success the identity
/// persists in the keychain-backed store.
public struct HostPairingView: View {
    @State private var payloadText = ""
    @State private var deviceName = ""
    @State private var pairing = false
    @State private var failure: String?

    private let onPaired: (LinkClient) -> Void

    /// - Parameter onPaired: receives the paired client.
    public init(onPaired: @escaping (LinkClient) -> Void) {
        self.onPaired = onPaired
    }

    public var body: some View {
        CardSurface {
            VStack(alignment: .leading, spacing: 16) {
                Text("配对到宿主").font(.title2.bold())
                Text("在 Windows 宿主的设置页点击“配对新设备”，把二维码下方的内容粘贴到这里。")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                TextField("配对载荷（二维码内容）", text: $payloadText, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(.roundedBorder)
                TextField("设备名称", text: $deviceName)
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task { await pair() }
                } label: {
                    if pairing { ProgressView() } else { Text("配对") }
                }
                .buttonStyle(.companion)
                .disabled(payloadText.isEmpty || deviceName.isEmpty || pairing)
                if let failure {
                    Text(failure).font(.footnote).foregroundStyle(.red)
                }
            }
        }
        .padding()
    }

    private func pair() async {
        guard let data = payloadText.data(using: .utf8),
              let payload = try? JSONDecoder().decode(LinkPairingPayload.self, from: data),
              let endpoint = URL(string: payload.endpoint)
        else {
            failure = "配对载荷无法识别"
            return
        }
        pairing = true
        failure = nil
        defer { pairing = false }
        let store = KeychainLinkCredentialsStore()
        let client = LinkClient(baseURL: endpoint, pinnedFingerprint: payload.spkiFingerprint, store: store)
        do {
            _ = try await client.pair(payload: payload, deviceName: deviceName)
            onPaired(client)
        } catch {
            failure = RemoteSessionViewModel.message(of: error)
        }
    }
}
