import DirectHostRuntime
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// The Full Host uses the existing Web UI, with native lifecycle controls and local runtime diagnostics.
@MainActor
struct HostHomeView: View {
    @ObservedObject var runtime: RuntimeSupervisor
    @ObservedObject var support: HostSupportModel
    private let copy = HostCopy.current

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("DSH Host").font(.headline)
                Text(copy.status(runtime.status)).foregroundStyle(.secondary)
                    .accessibilityIdentifier("host.runtime.status")
                Spacer()
                Button(support.isPreparing ? copy.scanningDiagnostics : copy.exportDiagnostics) {
                    support.prepare(snapshot: runtime.supportSnapshot())
                }
                    .accessibilityIdentifier("host.support.export")
                    .help(copy.exportScope)
                    .disabled(support.isPreparing)
                if support.isPreparing {
                    Button(copy.cancelExport) { support.cancel() }
                        .accessibilityIdentifier("host.support.cancel")
                }
                if runtime.status == .ready {
                    Button(copy.restart) { Task { await runtime.restart() } }
                        .accessibilityIdentifier("host.runtime.restart")
                    Button(copy.stop) { Task { await runtime.stop() } }
                        .accessibilityIdentifier("host.runtime.stop")
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
        .fileExporter(isPresented: $support.exporting, document: support.document, contentType: .json,
                      defaultFilename: "dsh-host-runtime-diagnostics") { result in
            if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled {
                support.failed = true
            }
            support.document = nil
        }
        .alert(copy.exportFailed, isPresented: $support.failed) {
            Button(copy.dismiss, role: .cancel) {}
        } message: { Text(copy.exportRecovery) }
        .onDisappear { support.cancel() }
    }

    private var isFailed: Bool {
        if case .failed = runtime.status { return true }
        return false
    }
}

/// The application retains and awaits export work during normal termination, including when the runtime is stopped.
@MainActor
final class HostSupportModel: ObservableObject {
    @Published var document: SupportDocument?
    @Published var exporting = false
    @Published var failed = false
    @Published private var preparation: Task<Void, Never>?
    var isPreparing: Bool { preparation != nil }

    func prepare(snapshot: RuntimeSupportSnapshot) {
        guard preparation == nil else { return }
        preparation = Task { @MainActor in
            defer { preparation = nil }
            do {
                guard let resources = Bundle.main.resourceURL else { throw SupportExportError.unavailable }
                let policy = try SupportExportPolicy(maximumBytes: 16384, maximumReportBytes: 65536,
                                                     scanMilliseconds: 10000, shutdownMilliseconds: 1000)
                let exporter = RuntimeSupportExporter(scannerDirectory: resources.appendingPathComponent("SupportScanner"),
                                                      supervisor: resources.appendingPathComponent("Runtime/HostRuntimeSupervisor"), policy: policy)
                let verified = try await exporter.prepare(info: Bundle.main.infoDictionary ?? [:], snapshot: snapshot)
                try Task.checkCancellation()
                document = SupportDocument(export: verified)
                exporting = true
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }

    func cancel() { preparation?.cancel() }

    func shutdown() async {
        let pending = preparation
        pending?.cancel()
        await pending?.value
    }
}

/// Only the scanner's immutable result can become a saved document; importing arbitrary files is unsupported.
struct SupportDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    let export: RuntimeSupportExport

    init(export: RuntimeSupportExport) { self.export = export }
    init(configuration: ReadConfiguration) throws { throw SupportExportError.unavailable }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: export.data)
    }
}

private struct LocalRuntimeView: NSViewRepresentable {
    let launch: URL

    func makeCoordinator() -> Navigation { Navigation(launch: launch) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.setAccessibilityIdentifier("host.runtime.web")
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
