import CompanionUI
import SharedAppleRemoteCore
import SwiftUI

/// The iPhone/iPad shell (plan chapters 49–51): the whole product surface is
/// CompanionUI; the shell only hosts it.
@main
struct CompanioniOSApp: App {
    var body: some Scene {
        WindowGroup {
            CompanionRootView(client: LinkClient.restore(store: KeychainLinkCredentialsStore()))
        }
    }
}
