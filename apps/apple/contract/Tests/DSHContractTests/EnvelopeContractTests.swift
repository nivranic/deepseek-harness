import XCTest
@testable import DSHContract

/// Swift consumption evidence for the candidate Remote failure contract: the
/// classification mirror equals the generated projection of the TypeScript
/// authority and references only codes the published envelope schema declares.
final class EnvelopeContractTests: XCTestCase {
    /// Resources resolve from the source tree rather than a bundle copy: the
    /// test target deliberately declares no resources, so SPM's resource-bundle
    /// accessor cannot reorder module emission on this toolchain.
    private struct Resources {
        private static let directory = URL(fileURLWithPath: #filePath, isDirectory: false)
            .deletingLastPathComponent()
            .appendingPathComponent("Resources", isDirectory: true)
        static let projection: [String: String] = {
            let url = directory.appendingPathComponent("remote-failure-classes.json")
            return try! JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
        }()
        static func schemaKnownCodes() throws -> Set<String> {
            let url = directory.appendingPathComponent("remote-errors.json")
            let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
            let branches = object["anyOf"] as! [[String: Any]]
            let known = branches.dropLast().map { branch in
                ((branch["properties"] as! [String: Any])["code"] as! [String: Any])["const"] as! String
            }
            XCTAssertEqual(branches.count, 85, "expected 84 known branches plus the opaque unknown branch")
            XCTAssertEqual(known.count, Set(known).count)
            return Set(known)
        }
    }

    func testMirrorEqualsTheGeneratedProjection() throws {
        let mirrored = Dictionary(uniqueKeysWithValues: RemoteFailureClasses.byCode.map { ($0.key, $0.value.rawValue) })
        XCTAssertEqual(Resources.projection, mirrored, "the Swift mirror drifted from the TypeScript authority")
    }

    func testClassificationReferencesOnlySchemaDeclaredCodes() throws {
        let knownCodes = try Resources.schemaKnownCodes()
        for code in RemoteFailureClasses.byCode.keys {
            XCTAssertTrue(knownCodes.contains(code), "classified code \(code) is not declared by the schema")
        }
    }

    func testUnclassifiedVocabularyCodeResolvesToUnknown() {
        XCTAssertEqual(RemoteFailureClass.unknown, RemoteFailureClasses.classify("gateway/service-unavailable"))
        XCTAssertEqual(RemoteFailureClass.unknown, RemoteFailureClasses.classify("future/some-code"))
    }

    func testSchemaDeclaresAnOpaqueUnknownBranch() throws {
        let url = Resources.directory.appendingPathComponent("remote-errors.json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let branches = object["anyOf"] as! [[String: Any]]
        let unknown = branches.last!
        let code = ((unknown["properties"] as! [String: Any])["code"] as! [String: Any])
        let excluded = (code["not"] as! [String: Any])["enum"] as! [String]
        XCTAssertEqual(84, excluded.count, "the opaque unknown branch must exclude every known code")
    }
}
