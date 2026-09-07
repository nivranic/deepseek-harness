import DirectHostRuntime
import SwiftUI
import WebKit

/// The Full Host uses the runtime's existing Web UI and keeps only lifecycle controls in Swift.
struct HostHomeView: View {
    @ObservedObject var runtime: RuntimeSupervisor
    private let copy = HostCopy.current

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("DSH Host").font(.headline)
                Text(copy.status(runtime.status)).foregroundStyle(.secondary)
                    .accessibilityIdentifier("host.runtime.status")
                Spacer()
                if runtime.status == .ready {
                    Button(copy.restart) { Task { await runtime.restart() } }
                        .accessibilityIdentifier("host.runtime.restart")
                    Button(copy.stop) { Task { await runtime.stop() } }
                } else if runtime.status == .stopped || isFailed {
                    Button(copy.start) { runtime.start() }
                        .accessibilityIdentifier("host.runtime.start")
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            .padding(12)
            Divider()
            if let url = runtime.launchURL, runtime.status == .ready {
                LocalRuntimeView(launch: url).id(runtime.activationID)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "desktopcomputer").font(.largeTitle)
                    Text(copy.status(runtime.status))
                    if isFailed { Text(copy.recovery).font(.callout).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 760, minHeight: 540)
    }

    private var isFailed: Bool {
        if case .failed = runtime.status { return true }
        return false
    }
}

private struct LocalRuntimeView: NSViewRepresentable {
    let launch: URL

    func makeCoordinator() -> Navigation { Navigation(launch: launch) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.load(URLRequest(url: launch))
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {}

    final class Navigation: NSObject, WKNavigationDelegate {
        let launch: URL
        init(launch: URL) { self.launch = launch }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, RuntimeEndpoint.sameCarrier(url, as: launch) else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
