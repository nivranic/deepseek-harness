import CompanionUI
import SharedAppleRemoteCore
import SwiftUI

/// The macOS companion shell (plan chapter 49): hosts the same
/// CompanionUI surface the iOS shell does, as a Mac window.
@main
struct CompanionMacApp: App {
    var body: some Scene {
        WindowGroup {
            CompanionRootView(client: LinkClient.restore(store: KeychainLinkCredentialsStore()))
        }
    }
}
