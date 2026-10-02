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
guard branches.count == 93 else {
    checkFailure("expected 92 known branches plus the opaque unknown branch, found \(branches.count)")
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
guard excluded.count == 92 else {
    checkFailure("the opaque unknown branch must exclude every known code, found \(excluded.count)")
}
print("PASS opaque unknown branch excludes all 92 known codes")

// Native Host roster adoption: the Swift mirror accepts the Android core's
// canonical roster document and rejects every documented violation of its
// vocabulary and invariants with the same rule names.
let rosterFixtures = fixtures.appendingPathComponent("native-host-roster", isDirectory: true)
let rosterNames = try FileManager.default.contentsOfDirectory(atPath: rosterFixtures.path).sorted()
guard rosterNames.contains("valid.json"),
    rosterNames.filter({ $0.hasPrefix("invalid-") }).count == 14 else {
    checkFailure("expected the valid roster fixture plus 14 invalid cases, found \(rosterNames)")
}
let valid = try NativeHostRoster.decode(try readFixture("native-host-roster/valid.json"))
guard valid.hosts.count == 2, valid.active == NativeHostRoster.hostKey(hostId: "host-desk", pinnedFingerprint: String(repeating: "a", count: 64)),
    valid.hosts[1].endpoint == "https://lab.example.com:8443" else {
    checkFailure("the canonical roster decoded with wrong content: \(valid)")
}
print("PASS roster mirror decodes the canonical document (2 hosts, active key, trailing-slash origin)")

for name in rosterNames where name.hasPrefix("invalid-") {
    do {
        _ = try NativeHostRoster.decode(try readFixture("native-host-roster/" + name))
        checkFailure("invalid roster case \(name) was accepted")
    } catch let error as NativeHostRosterError {
        guard !error.rule.isEmpty else { checkFailure("invalid roster case \(name) rejected without a rule") }
    }
}
print("PASS roster mirror rejects all \(rosterNames.filter { $0.hasPrefix("invalid-") }.count) invalid cases by rule")

guard NativeHostRoster.hostKey(hostId: "host-desk", pinnedFingerprint: String(repeating: "a", count: 64))
    != NativeHostRoster.hostKey(hostId: "host-desk", pinnedFingerprint: String(repeating: "b", count: 64)) else {
    checkFailure("the Host key must bind the fingerprint, not just the hostId")
}
print("PASS roster Host key binds the verified Host identity")

// Native model catalog adoption: the Swift mirror parses the Android core's
// session/modelCatalog response with the same leniency (typed drops and id
// fallbacks, never silent type coercion) and builds the same session/selectModel
// request envelope, the reasoning effort riding only when present.
let catalogFixtures = fixtures.appendingPathComponent("native-model-catalog", isDirectory: true)
let catalogNames = try FileManager.default.contentsOfDirectory(atPath: catalogFixtures.path).sorted()
guard catalogNames.contains("valid.json"),
    catalogNames.filter({ $0.hasPrefix("edge-") }).count == 3,
    catalogNames.filter({ $0.hasPrefix("invalid-") }).count == 1 else {
    checkFailure("expected the canonical catalog fixture plus 3 edge cases and 1 invalid case, found \(catalogNames)")
}
let catalog = try NativeModelCatalog.decode(try readFixture("native-model-catalog/valid.json"))
let visionReasoning = catalog.groups.first?.models.last?.reasoning
guard catalog.groups.count == 2,
    catalog.groups.first?.name == "DeepSeek 官方",
    catalog.groups.first?.models.count == 2,
    catalog.groups.first?.models.first?.reasoning == nil,
    visionReasoning?.efforts.map({ $0.id }) == ["off", "max", "low"],
    visionReasoning?.efforts.last?.name == "low",
    visionReasoning?.defaultEffort == "high",
    catalog.groups.last?.name == "custom-group",
    catalog.defaultProvider == "deepseek-official",
    catalog.defaultModel == "deepseek-v4-flash" else {
    checkFailure("the canonical model catalog decoded with wrong content: \(catalog)")
}
print("PASS model-catalog mirror decodes the canonical document (efforts with id-fallback names, nullable default)")

let missingIds = try NativeModelCatalog.decode(try readFixture("native-model-catalog/edge-missing-ids.json"))
let missingIdsExpected = NativeModelCatalog(groups: [
    NativeCatalogGroup(id: "g1", name: "g1", models: [
        NativeCatalogModel(id: "m1", name: "m1"),
        NativeCatalogModel(id: "m2", name: "m2", reasoning: NativeModelReasoning(
            efforts: [NativeEffortChoice(id: "e1", name: "e1")], defaultEffort: nil)),
    ]),
], defaultProvider: "", defaultModel: "")
guard missingIds == missingIdsExpected else {
    checkFailure("rows without a string id must drop and non-string defaults read as nil: \(missingIds)")
}
let typeFallbacks = try NativeModelCatalog.decode(try readFixture("native-model-catalog/edge-type-fallbacks.json"))
let typeFallbacksExpected = NativeModelCatalog(groups: [
    NativeCatalogGroup(id: "g", name: "g", models: [
        NativeCatalogModel(id: "m", name: "m", reasoning: nil),
    ]),
], defaultProvider: "", defaultModel: "")
guard typeFallbacks == typeFallbacksExpected else {
    checkFailure("non-string names must fall back to ids and non-object reasoning read as absent: \(typeFallbacks)")
}
let empty = try NativeModelCatalog.decode(try readFixture("native-model-catalog/edge-empty.json"))
guard empty == NativeModelCatalog(groups: [], defaultProvider: "", defaultModel: "") else {
    checkFailure("an empty document must decode to an empty catalog: \(empty)")
}
print("PASS model-catalog mirror drops and falls back exactly like the Android parser")

do {
    _ = try NativeModelCatalog.decode(try readFixture("native-model-catalog/invalid-malformed.json"))
    checkFailure("malformed catalog JSON must be rejected")
} catch {
    // Any parse error is the expected outcome for truncated JSON.
}
print("PASS model-catalog mirror rejects malformed catalog JSON")

let withEffort = NativeModelSelection(
    sessionId: "s1", provider: "deepseek-official",
    model: "deepseek-v4-flash-vision-exp", reasoningEffort: "max").wireBody()
let effortRequest = withEffort["request"] as? [String: Any]
let withoutEffort = NativeModelSelection(sessionId: "s1", provider: "p", model: "m").wireBody()
let plainRequest = withoutEffort["request"] as? [String: Any]
guard effortRequest?.count == 4,
    (effortRequest?["reasoningEffort"] as? String) == "max",
    (effortRequest?["sessionId"] as? String) == "s1",
    plainRequest?.count == 3,
    plainRequest?["reasoningEffort"] == nil else {
    checkFailure("the selectModel request envelope drifted; the effort must ride only when present")
}
print("PASS selectModel request envelope mirrors the Android wire (effort-free selection carries no extra key)")

// Native session-location facts adoption: the Swift mirror derives the §29 five
// fact sources with the same rules as the Android core (blank Host names fall
// back to hostIds, workspace basenames split both separators and skip blank
// segments, the newest permission/preset record wins, only the six §18-family
// state words name themselves, and the detail line needs a workspace).
let locationFixtures = fixtures.appendingPathComponent("native-location-facts", isDirectory: true)
let locationNames = try FileManager.default.contentsOfDirectory(atPath: locationFixtures.path).sorted()
guard locationNames.contains("valid.json"),
    locationNames.filter({ $0.hasPrefix("edge-") }).count == 4,
    locationNames.filter({ $0.hasPrefix("invalid-") }).count == 1 else {
    checkFailure("expected the canonical location fixture plus 4 edge cases and 1 invalid case, found \(locationNames)")
}
let locationValid = try NativeLocationFacts.decode(try readFixture("native-location-facts/valid.json"))
guard locationValid == NativeLocationFacts.Derived(
    facts: ["Work PC", "deepseek-harness", "read-only", "reconnecting"],
    detail: "full · E:\\Mix\\project\\deepseek-harness") else {
    checkFailure("the canonical location document derived wrong facts: \(locationValid)")
}
print("PASS location-facts mirror derives the canonical facts and detail lines")

let blankFallbacks = try NativeLocationFacts.decode(try readFixture("native-location-facts/edge-blank-fallbacks.json"))
guard blankFallbacks == NativeLocationFacts.Derived(facts: ["lab-2", "/"], detail: "full · /") else {
    checkFailure("blank names must fall back to hostIds and all-blank basenames to the whole path: \(blankFallbacks)")
}
let absent = try NativeLocationFacts.decode(try readFixture("native-location-facts/edge-absent-facts.json"))
guard absent == NativeLocationFacts.Derived(facts: [], detail: nil) else {
    checkFailure("an all-absent document must derive no facts and no detail: \(absent)")
}
let presetKept = try NativeLocationFacts.decode(try readFixture("native-location-facts/edge-preset-kept.json"))
guard presetKept == NativeLocationFacts.Derived(facts: ["custom-host-preset"], detail: nil) else {
    checkFailure("a permission/preset event without a string preset must keep the earlier value: \(presetKept)")
}
let unknownState = try NativeLocationFacts.decode(try readFixture("native-location-facts/edge-unknown-state.json"))
guard unknownState == NativeLocationFacts.Derived(facts: ["Desk", "src"], detail: "full · src") else {
    checkFailure("unknown state words must drop and other event types stay ignored: \(unknownState)")
}
print("PASS location-facts mirror keeps the Android fallbacks, preset precedence, and state-word drop")

do {
    _ = try NativeLocationFacts.decode(try readFixture("native-location-facts/invalid-malformed.json"))
    checkFailure("malformed location JSON must be rejected")
} catch {
    // Any parse error is the expected outcome for truncated JSON.
}
print("PASS location-facts mirror rejects malformed location JSON")

// Native view-location adoption: the Swift mirror encodes and decodes the §26
// handoff payload with the same grammar as the Android core and the Web Client
// (exact ordered ASCII JSON fields, prefixed base64url, exactly three keys on
// decode, safe-integer anchors with -0 rejected, fail-loud parse boundaries).
let viewFixtures = fixtures.appendingPathComponent("native-view-location", isDirectory: true)
let viewNames = try FileManager.default.contentsOfDirectory(atPath: viewFixtures.path).sorted()
guard viewNames.contains("valid.json"),
    viewNames.filter({ $0.hasPrefix("edge-") }).count == 3,
    viewNames.filter({ $0.hasPrefix("invalid-") }).count == 6 else {
    checkFailure("expected the canonical view-location fixture plus 3 edge cases and 6 invalid cases, found \(viewNames)")
}
func viewDoc(_ name: String) throws -> (location: NativeViewLocation?, encoded: String) {
    let root = try JSONSerialization.jsonObject(with: try readFixture("native-view-location/" + name)) as? [String: Any] ?? [:]
    let encoded = root["encoded"] as? String ?? ""
    let location = (root["location"] as? [String: Any]).map { doc in
        NativeViewLocation(hostId: doc["hostId"] as? String ?? "",
            sessionId: doc["sessionId"] as? String ?? "",
            anchorSeq: Int64((doc["anchorSeq"] as? NSNumber)?.doubleValue ?? -1))
    }
    return (location, encoded)
}
let viewValid = try viewDoc("valid.json")
guard try NativeViewLocations.decode(viewValid.encoded) == viewValid.location,
    NativeViewLocations.encode(viewValid.location!) == viewValid.encoded else {
    checkFailure("the canonical view-location payload must round-trip to the pinned bytes")
}
let viewZero = try viewDoc("edge-anchor-zero.json")
let viewEscaped = try viewDoc("edge-escaped-ids.json")
let viewMax = try viewDoc("edge-max-safe-integer.json")
guard try NativeViewLocations.decode(viewZero.encoded) == viewZero.location,
    NativeViewLocations.encode(viewZero.location!) == viewZero.encoded,
    try NativeViewLocations.decode(viewEscaped.encoded) == viewEscaped.location,
    NativeViewLocations.encode(viewEscaped.location!) == viewEscaped.encoded,
    try NativeViewLocations.decode(viewMax.encoded) == viewMax.location,
    NativeViewLocations.encode(viewMax.location!) == viewMax.encoded else {
    checkFailure("the zero anchor, escaped ids, and max-safe-integer payloads must round-trip to the pinned bytes")
}
print("PASS view-location mirror round-trips the canonical and edge payloads to identical bytes")

for name in ["invalid-unknown-prefix.json", "invalid-not-base64url.json", "invalid-not-json.json",
    "invalid-wrong-fields.json", "invalid-bad-anchor.json", "invalid-anchor-negative-zero.json"] {
    do {
        _ = try NativeViewLocations.decode(try viewDoc(name).encoded)
        checkFailure("\(name) must be rejected by the v1 grammar")
    } catch {
        // Every parse boundary failing loud is the expected outcome.
    }
}
print("PASS view-location mirror rejects every invalid payload class at its parse boundary")

// Native follow-resume adoption: the Swift mirror builds the §25 session/follow
// request envelope with the same rules as the Android core (a positive
// maxMessages page size, a non-negative fromSeq resume cursor riding only when
// present), structurally equal to the wire the Companion sends — structural,
// not byte, equality is the request-envelope contract.
let followFixtures = fixtures.appendingPathComponent("native-follow-resume", isDirectory: true)
let followNames = try FileManager.default.contentsOfDirectory(atPath: followFixtures.path).sorted()
guard followNames.contains("valid.json"),
    followNames.filter({ $0.hasPrefix("edge-") }).count == 3,
    followNames.filter({ $0.hasPrefix("invalid-") }).count == 1 else {
    checkFailure("expected the canonical follow fixture plus 3 edge cases and 1 invalid case, found \(followNames)")
}
func wireEqual(_ left: Any, _ right: Any) -> Bool {
    if let l = left as? [String: Any], let r = right as? [String: Any] {
        return l.count == r.count && l.allSatisfy { wireEqual($0.value, r[$0.key] ?? NSNull()) }
    }
    if let l = left as? String { return (right as? String) == l }
    if let l = left as? NSNumber { return (right as? NSNumber) == l }
    return left is NSNull && right is NSNull
}
func followDoc(_ name: String) throws -> [String: Any] {
    let root = try JSONSerialization.jsonObject(with: try readFixture("native-follow-resume/" + name)) as? [String: Any] ?? [:]
    let address: [String: Any]
    if (root["kind"] as? String) == "subagent" {
        address = NativeFollowResume.subagentAddress(
            parentSessionId: root["parentSessionId"] as? String ?? "",
            childSessionId: root["childSessionId"] as? String ?? "",
            mode: root["mode"] as? String ?? "")
    } else {
        address = NativeFollowResume.sessionAddress(sessionId: root["sessionId"] as? String ?? "")
    }
    return try NativeFollowResume.request(address: address,
        maxMessages: (root["maxMessages"] as? NSNumber)?.intValue ?? 0,
        cursor: (root["fromSeq"] as? NSNumber).map { Int64($0.intValue) })
}
for name in followNames where !name.hasPrefix("invalid-") {
    let expected = try JSONSerialization.jsonObject(with: try readFixture("native-follow-resume/" + name)) as? [String: Any] ?? [:]
    guard wireEqual(try followDoc(name), (expected["body"] as? [String: Any]) ?? [:]) else {
        checkFailure("the follow envelope for \(name) drifted from the pinned body")
    }
}
print("PASS follow-resume mirror builds the canonical and edge envelopes structurally equal to the pinned bodies")

do {
    _ = try followDoc("invalid-negative-seq.json")
    checkFailure("the negative resume cursor fixture must be rejected")
} catch NativeFollowResumeError.fromSeq {
    // The exact error case is the expected outcome.
}
do {
    _ = try NativeFollowResume.request(address: NativeFollowResume.sessionAddress(sessionId: "s-3"), maxMessages: 0, cursor: nil)
    checkFailure("a zero page size must be rejected")
} catch NativeFollowResumeError.maxMessages {
    // The exact error case is the expected outcome.
}
print("PASS follow-resume mirror rejects negative resume cursors and zero page sizes")

exit(0)
