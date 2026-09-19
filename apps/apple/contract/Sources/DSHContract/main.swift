/// Swift consumption evidence for the candidate Remote failure contract, as a
/// self-contained executable: the classification mirror equals the generated
/// projection of the TypeScript authority, references only codes the published
/// envelope schema declares, resolves unclassified codes to unknown, and the
/// schema's opaque branch excludes every known code. Plain exit codes carry
/// the verdict; no XCTest bundle is involved.
import Foundation

func checkFailure(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("FAIL " + message + "\n").utf8))
    exit(1)
}

let fixtures = URL(fileURLWithPath: #filePath, isDirectory: false)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("fixtures", isDirectory: true)

func readFixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixtures.appendingPathComponent(name))
}

let mirror = Dictionary(
    RemoteFailureClasses.byCode.map { ($0.key, $0.value.rawValue) },
    uniquingKeysWith: { left, _ in left },
)
let projection = try JSONDecoder().decode([String: String].self, from: readFixture("remote-failure-classes.json"))
guard mirror == projection else {
    checkFailure("the Swift mirror drifted from the TypeScript authority: \(mirror) != \(projection)")
}
print("PASS mirror equals the generated projection (\(mirror.count) codes)")

let schema = try JSONSerialization.jsonObject(with: readFixture("remote-errors.schema.json")) as! [String: Any]
let branches = schema["anyOf"] as! [[String: Any]]
guard branches.count == 85 else {
    checkFailure("expected 84 known branches plus the opaque unknown branch, found \(branches.count)")
}
let known = branches.dropLast().map {
    (($0["properties"] as! [String: Any])["code"] as! [String: Any])["const"] as! String
}
for code in RemoteFailureClasses.byCode.keys where !known.contains(code) {
    checkFailure("classified code \(code) is not declared by the schema")
}
print("PASS every classified code is schema-declared (\(known.count) known codes)")

guard RemoteFailureClasses.classify("gateway/service-unavailable") == RemoteFailureClass.unknown,
    RemoteFailureClasses.classify("future/some-code") == RemoteFailureClass.unknown else {
    checkFailure("unclassified codes must resolve to unknown")
}
print("PASS unclassified codes resolve to unknown")

let unknownBranch = branches.last!
let excluded = (((unknownBranch["properties"] as! [String: Any])["code"] as! [String: Any])["not"] as! [String: Any])["enum"] as! [String]
guard excluded.count == 84 else {
    checkFailure("the opaque unknown branch must exclude every known code, found \(excluded.count)")
}
print("PASS opaque unknown branch excludes all 84 known codes")

exit(0)
