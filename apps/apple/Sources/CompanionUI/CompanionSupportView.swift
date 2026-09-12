import SharedAppleRemoteCore
import SupportExportCore
import SwiftUI
import UniformTypeIdentifiers

/// Both paired and unpaired application roots offer the same local export operation.
@MainActor
struct CompanionSupportView: View {
    @ObservedObject var model: CompanionSupportModel
    let snapshot: () -> (link: LinkDiagnosticSnapshot?, connections: CompanionConnectionSnapshots)
    @Environment(\.locale) private var locale
    private var copy: CompanionSupportCopy { .select(locale) }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Button(model.isPreparing ? copy.scanning : copy.export) {
                    let value = snapshot()
                    model.prepare(link: value.link, connections: value.connections)
                }
                    .accessibilityIdentifier("companion.support.export")
                    .disabled(model.isPreparing || model.document != nil)
                Text(copy.scope).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if model.isPreparing {
                Button(copy.cancel) { model.cancel() }
                    .accessibilityIdentifier("companion.support.cancel")
            }
        }
        .padding(12)
        .background(.bar)
        .fileExporter(isPresented: $model.exporting, document: model.document, contentTypes: [.json],
                      defaultFilename: "dsh-companion-diagnostics") { result in
            model.finishedSaving(result)
        } onCancellation: {
            model.dismissExport()
        }
        .alert(copy.failed, isPresented: $model.failed) {
            Button(copy.dismiss, role: .cancel) {}
        } message: { Text(copy.recovery) }
    }
}

/// Preparation retains its owner until native execution and cancellation have both stopped.
@MainActor
final class CompanionSupportModel: ObservableObject {
    @Published var document: CompanionSupportDocument?
    @Published var exporting = false
    @Published var failed = false
    @Published private var preparation: Task<Void, Never>?
    private let makeExporter: @MainActor () throws -> CompanionSupportExporter
    var isPreparing: Bool { preparation != nil }

    init(makeExporter: @escaping @MainActor () throws -> CompanionSupportExporter) {
        self.makeExporter = makeExporter
    }

    func prepare(link: LinkDiagnosticSnapshot?, connections: CompanionConnectionSnapshots) {
        guard preparation == nil, document == nil else { return }
        failed = false
        preparation = Task { @MainActor in
            defer { preparation = nil }
            do {
                let exporter = try makeExporter()
                let approved = try await exporter.prepare(link: link, connections: connections)
                try Task.checkCancellation()
                document = CompanionSupportDocument(approved: approved)
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

    func finishedSaving(_ result: Result<URL, Error>) {
        if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled {
            failed = true
        }
        dismissExport()
    }

    func dismissExport() {
        exporting = false
        document = nil
    }
}

/// The system receives only the admitted bytes; arbitrary file import is unsupported.
struct CompanionSupportDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    let approved: ApprovedSupportDocument

    init(approved: ApprovedSupportDocument) { self.approved = approved }
    init(configuration: ReadConfiguration) throws { throw SupportExportError.unavailable }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: approved.data)
    }
}
