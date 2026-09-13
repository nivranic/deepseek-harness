import Foundation
import SupportExportCore
import XCTest

final class SupportApplicationSourceTests: XCTestCase {
    private let source = String(repeating: "e", count: 40)
    private let tree = String(repeating: "f", count: 40)

    func testUnstampedBuildRemainsUnavailable() throws {
        XCTAssertNil(try SupportApplicationSource(info: [:]))
        XCTAssertNil(try SupportApplicationSource(info: ["DSHApplicationSourceSHA": "", "DSHApplicationSourceTree": ""]))
    }

    func testOnlyApplicationBuildFieldsReachTheDocument() throws {
        let value = try XCTUnwrap(SupportApplicationSource(info: [
            "DSHApplicationSourceSHA": source, "DSHApplicationSourceTree": tree,
            "scannerSourceSha": String(repeating: "a", count: 40), "privateMetadata": "private value",
        ]))
        let data = try JSONEncoder().encode(value)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        XCTAssertEqual(fields, ["producer": "application-build", "observation": "current", "sourceSha": source, "treeSha": tree])
    }

    func testPartialAndMalformedBuildMetadataRefusesExport() {
        let valid: [String: Any] = ["DSHApplicationSourceSHA": source, "DSHApplicationSourceTree": tree]
        let invalidValues: [Any] = ["", "$(UNRESOLVED)", String(repeating: "A", count: 40), source + "\n", true, 1]
        for key in ["DSHApplicationSourceSHA", "DSHApplicationSourceTree"] {
            for invalid in invalidValues {
                var value = valid
                value[key] = invalid
                XCTAssertThrowsError(try SupportApplicationSource(info: value)) {
                    XCTAssertEqual($0 as? SupportExportError, .invalidIdentity)
                }
            }
            var missing = valid
            missing.removeValue(forKey: key)
            XCTAssertThrowsError(try SupportApplicationSource(info: missing))
        }
    }
}
