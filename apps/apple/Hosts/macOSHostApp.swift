import SwiftUI

/// The macOS Direct Host shell (plan chapter 49's fourth target): the
/// host-side runtime surface, deliberately separate from the companion —
/// host-only code lives in this target and never joins the companion ones.
@main
struct DirectHostMacApp: App {
    var body: some Scene {
        WindowGroup {
            HostHomeView()
        }
    }
}
