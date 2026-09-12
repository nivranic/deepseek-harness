import Foundation

/// Build provenance must agree with the scanner version and rules in the linked native library.
public struct SupportLibraryIdentity: Encodable, Sendable {
    public let schemaVersion: Int
    public let sourceSha: String
    public let treeSha: String
    public let archiveSha256: String
    public let scannerVersion: String
    public let rulesDigest: String

    public init(data: Data, linkedVersion: String, linkedRulesDigest: String) throws {
        guard data.count <= 16384 else { throw SupportExportError.invalidScanner }
        do {
            let value = try JSONDecoder().decode(StoredIdentity.self, from: data)
            guard value.schemaVersion == 1, value.scannerVersion == linkedVersion,
                  value.rulesDigest == linkedRulesDigest,
                  Self.hex(value.sourceSha, length: 40), Self.hex(value.treeSha, length: 40),
                  Self.hex(value.archiveSha256, length: 64), Self.hex(value.rulesDigest, length: 64) else {
                throw SupportExportError.invalidScanner
            }
            schemaVersion = value.schemaVersion
            sourceSha = value.sourceSha
            treeSha = value.treeSha
            archiveSha256 = value.archiveSha256
            scannerVersion = value.scannerVersion
            rulesDigest = value.rulesDigest
        } catch {
            throw SupportExportError.invalidScanner
        }
    }

    private static func hex(_ value: String, length: Int) -> Bool {
        value.utf8.count == length && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private struct StoredIdentity: Decodable {
        let schemaVersion: Int
        let sourceSha: String
        let treeSha: String
        let archiveSha256: String
        let scannerVersion: String
        let rulesDigest: String
    }
}
