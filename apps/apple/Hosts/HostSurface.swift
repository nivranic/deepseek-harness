import SwiftUI

/// The host home surface: the administration face of a machine that RUNS
/// agents, not the consumer face of a companion. The skeleton lays out the
/// three host concerns — remote access, pairing issuance, and paired
/// devices — each honestly empty until the runtime embeds (the plan keeps
/// Runtime Authority on the desktop host; embedding is its later phase).
struct HostHomeView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("DSH Host")
                    .font(.title.bold())
                remoteAccessCard
                pairingCard
                devicesCard
            }
            .padding(24)
            .frame(maxWidth: 640, alignment: .leading)
        }
        .frame(minWidth: 480, minHeight: 420)
    }

    private var remoteAccessCard: some View {
        HostCard(title: "远程访问", systemImage: "network") {
            HostEmptyState(
                headline: "宿主运行时未内嵌",
                detail: "此壳等待内嵌的宿主运行时接管此开关；当前的 Runtime Authority 仍在桌面宿主上。"
            )
        }
    }

    private var pairingCard: some View {
        HostCard(title: "配对新设备", systemImage: "qrcode") {
            HostEmptyState(
                headline: "配对码由运行时签发",
                detail: "内嵌运行时落地后，这里展示一次性二维码载荷与有效期。"
            )
        }
    }

    private var devicesCard: some View {
        HostCard(title: "已配对设备", systemImage: "iphone.gen3") {
            HostEmptyState(
                headline: "尚无设备记录",
                detail: "运行时会在此列出每台已配对设备及其角色与吊销操作。"
            )
        }
    }
}

/// One host administration card.
struct HostCard<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quinary, in: .rect(cornerRadius: 12))
    }
}

/// The honest empty state every host card carries until the runtime embeds.
struct HostEmptyState: View {
    let headline: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(headline).font(.body.weight(.medium)).foregroundStyle(.secondary)
            Text(detail).font(.footnote).foregroundStyle(.tertiary)
        }
    }
}
