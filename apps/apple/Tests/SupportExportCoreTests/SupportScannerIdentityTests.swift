import Foundation
import XCTest
@testable import SupportExportCore

final class SupportScannerIdentityTests: XCTestCase {
    private var fields: [String: Any] {
        ["schemaVersion": 1, "sourceSha": String(repeating: "a", count: 40), "treeSha": String(repeating: "b", count: 40),
         "archiveSha256": String(repeating: "c", count: 64), "scannerVersion": "8.30.1", "rulesDigest": String(repeating: "d", count: 64)]
    }

    private func parse(_ value: [String: Any]) throws -> SupportScannerIdentity {
        try SupportScannerIdentity(data: JSONSerialization.data(withJSONObject: value), linkedVersion: "8.30.1",
                                   linkedRulesDigest: String(repeating: "d", count: 64))
    }

    func testIdentitySelectsOnlyVerifiedFields() throws {
        var value = fields
        value["privateMetadata"] = "must-not-be-exported"
        let identity = try parse(value)
        let encoded = try JSONEncoder().encode(identity)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(Set(result.keys), Set(fields.keys))
        XCTAssertEqual(identity.sourceSha, fields["sourceSha"] as? String)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).contains("must-not-be-exported"))
    }

    func testMissingMalformedAndMismatchedIdentityRefuseWithFixedError() throws {
        let replacements: [(String, Any)] = [
            ("schemaVersion", true), ("schemaVersion", 2), ("sourceSha", String(repeating: "A", count: 40)),
            ("treeSha", "private-path"), ("archiveSha256", "short"), ("rulesDigest", String(repeating: "e", count: 64)),
            ("scannerVersion", "8.30.2"),
        ]
        for (key, replacement) in replacements {
            var value = fields; value[key] = replacement
            XCTAssertThrowsError(try parse(value)) { XCTAssertEqual($0 as? SupportExportError, .invalidScanner) }
        }
        for key in fields.keys {
            var value = fields; value.removeValue(forKey: key)
            XCTAssertThrowsError(try parse(value)) { XCTAssertEqual($0 as? SupportExportError, .invalidScanner) }
        }
        for data in [Data("invalid-json".utf8), Data(repeating: 32, count: 16385)] {
            XCTAssertThrowsError(try SupportScannerIdentity(data: data, linkedVersion: "8.30.1", linkedRulesDigest: String(repeating: "d", count: 64))) {
                XCTAssertEqual($0 as? SupportExportError, .invalidScanner)
            }
        }
    }
}
