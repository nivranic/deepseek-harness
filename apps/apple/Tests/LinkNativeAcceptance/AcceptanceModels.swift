import Foundation
import SharedAppleRemoteCore

struct AcceptanceConfig: Decodable {
    let schemaVersion: Int
    let language: String
    let corpusPath: String
    let candidateResultPath: String
    let pairing: LinkPairingPayload
    let sessionId: String
    let controlEndpoint: String
    let controlToken: String
    let hostCommit: String
    let clientCommit: String
    let expectedResponseText: String
    let deviceName: String
}

struct AcceptanceCorpus: Decodable {
    struct Step: Decodable {
        let id: String
        let targetSessionId: String?
        let decoySessionId: String?
        let expectedSessionIds: [String]?
        let expectedTargetRelation: String?
        let text: String?
        let expectedAccepted: Bool?
        let expectedResponseText: String?
        let decoyErrorCode: String?
        let stallPrompt: String?
        let outcome: String?
        let fault: String?
        let expectedFollowReplacementCount: Int?
        let expectedEventReplacementCount: Int?
        let expectedAuthoritativeSnapshot: Bool?
        let expectedClientIdRefresh: Bool?
    }

    let schemaVersion: Int
    let contractVersion: Int
    let steps: [Step]
}

struct AcceptanceResult: Encodable {
    struct Step: Encodable {
        let id: String
        let status: String
    }

    let schemaVersion: Int
    let language: String
    let corpusSha256: String
    let hostCommit: String
    let clientCommit: String
    let linkProtocolVersion: Int
    let contractVersion: Int
    let sessionFormatVersion: Int
    let steps: [Step]
}

struct AcceptanceFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

let requiredStepIDs = [
    "pair",
    "connect",
    "describe",
    "list",
    "open",
    "history",
    "follow",
    "prompt",
    "stream",
    "approval",
    "cancel",
    "reconnect",
    "revoke",
]

func safeErrorDescription(_ error: Error) -> String {
    if let failure = error as? AcceptanceFailure {
        return failure.description
    }
    if let linkError = error as? LinkClientError {
        switch linkError {
        case .carrier(let status, _):
            return "link carrier rejected the request with status \(status)"
        case .unpaired:
            return "link client is unpaired"
        case .refused(let code, _):
            return "Remote endpoint refused the request with code \(code)"
        case .badWire:
            return "link carrier returned invalid wire data"
        }
    }
    if let urlError = error as? URLError {
        return "network request failed with URL error \(urlError.code.rawValue)"
    }
    if error is DecodingError {
        return "JSON decoding failed"
    }
    return "unexpected \(String(reflecting: type(of: error)))"
}
