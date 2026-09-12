import CompanionUI
import Foundation
import SupportExportCore
import SupportScanner

/// The native shell binds the installed resource identity to the actual linked Go rules.
struct NativeDocumentScanner: DocumentScanner {
    let identity: SupportLibraryIdentity

    init(bundle: Bundle) throws {
        guard let url = bundle.url(forResource: "identity", withExtension: "json", subdirectory: "SupportScannerResources") else {
            throw SupportExportError.invalidScanner
        }
        do {
            let file = try FileHandle(forReadingFrom: url)
            let bytes: Data
            do {
                bytes = try file.read(upToCount: 16385) ?? Data()
            } catch {
                // A read failure already refuses this export; best-effort close cannot admit bytes.
                try? file.close()
                throw error
            }
            try file.close()
            identity = try SupportLibraryIdentity(data: bytes, linkedVersion: DSHSupportscannerVersion,
                                                  linkedRulesDigest: DSHSupportscannerRulesDigest())
        } catch {
            throw SupportExportError.invalidScanner
        }
    }

    func open(_ data: Data, policy: DocumentScanPolicy) throws -> any DocumentScanOperation {
        guard let operation = DSHSupportscannerOperation(data, maximumBytes: Int64(policy.maximumBytes),
                                                        scanMilliseconds: policy.scanMilliseconds) else {
            throw SupportExportError.invalidScanner
        }
        return NativeScanOperation(operation)
    }
}

/// Go owns synchronization between run and joined cancellation; this wrapper never mutates its operation.
private final class NativeScanOperation: DocumentScanOperation, @unchecked Sendable {
    private let operation: DSHSupportscannerOperation

    init(_ operation: DSHSupportscannerOperation) { self.operation = operation }

    func run() throws -> DocumentScanResult {
        guard let result = operation.run() else { throw SupportExportError.scanFailed }
        return DocumentScanResult(status: result.status(), data: result.data(), digest: result.digest())
    }

    func cancelAndJoin() { operation.cancel() }
}

/// Product identity belongs to the application bundle; scanner source identity remains a separate field.
func companionSupportExporter() throws -> CompanionSupportExporter {
    let scanner = try NativeDocumentScanner(bundle: .main)
    return CompanionSupportExporter(product: try SupportProductIdentity(info: Bundle.main.infoDictionary ?? [:]),
        applicationSource: try SupportApplicationSource(info: Bundle.main.infoDictionary ?? [:]),
        identity: scanner.identity, scanner: scanner, policy: try DocumentScanPolicy(maximumBytes: 16384, scanMilliseconds: 10000))
}
