import Foundation

struct AcceptanceRecoveryStatus {
    let hostFinalCursor: Int
    let offlineSeqCount: Int
}

struct AcceptanceControlClient {
    private let baseURL: URL
    private let token: String
    private let session: URLSession

    init(endpoint: String, token: String) throws {
        guard let url = URL(string: endpoint),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host != nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil,
              !token.isEmpty else {
            throw AcceptanceFailure("control endpoint or token is invalid")
        }
        baseURL = url
        self.token = token
        session = URLSession(configuration: .ephemeral)
    }

    func startApproval() async throws {
        let (status, data) = try await request(path: "approval/start", method: "POST")
        guard status == 200,
              let response = try? JSONDecoder().decode(StartedResponse.self, from: data),
              response.started else {
            throw AcceptanceFailure("approval control did not start the request")
        }
    }

    func waitForApprovalResult(timeout: TimeInterval) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let (status, data) = try await request(path: "approval/result", method: "GET")
            if status == 200 {
                guard let response = try? JSONDecoder().decode(OutcomeResponse.self, from: data),
                      response.outcome == "allowed-once" else {
                    throw AcceptanceFailure("approval control returned the wrong outcome")
                }
                return
            }
            if status == 202 {
                guard let response = try? JSONDecoder().decode(PendingResponse.self, from: data),
                      response.pending else {
                    throw AcceptanceFailure("approval control returned an invalid pending response")
                }
                try await Task.sleep(nanoseconds: 50_000_000)
                continue
            }
            throw AcceptanceFailure("approval control returned unexpected status \(status)")
        }
        throw AcceptanceFailure("approval result timed out")
    }

    func revoke() async throws {
        let (status, data) = try await request(path: "revoke", method: "POST")
        guard status == 200,
              let response = try? JSONDecoder().decode(RevokedResponse.self, from: data),
              response.revoked else {
            throw AcceptanceFailure("revoke control did not revoke the paired device")
        }
    }

    func waitForRecoveryStatus(
        preFaultSeq: Int,
        timeout: TimeInterval
    ) async throws -> AcceptanceRecoveryStatus {
        guard preFaultSeq >= 0 else {
            throw AcceptanceFailure("recovery pre-fault sequence is invalid")
        }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let (status, data) = try await request(
                path: "recovery/status?preFaultSeq=\(preFaultSeq)",
                method: "GET"
            )
            if status == 200 {
                guard Self.hasExactObjectKeys(data, keys: ["hostFinalCursor", "offlineSeqCount"]),
                      let response = try? JSONDecoder().decode(RecoveryStatusResponse.self, from: data),
                      response.hostFinalCursor >= preFaultSeq,
                      response.offlineSeqCount >= 0 else {
                    throw AcceptanceFailure("recovery control returned an invalid completion response")
                }
                return AcceptanceRecoveryStatus(
                    hostFinalCursor: response.hostFinalCursor,
                    offlineSeqCount: response.offlineSeqCount
                )
            }
            if status == 202 {
                guard Self.hasExactObjectKeys(data, keys: ["pending"]),
                      let response = try? JSONDecoder().decode(PendingResponse.self, from: data),
                      response.pending else {
                    throw AcceptanceFailure("recovery control returned an invalid pending response")
                }
                try await Task.sleep(nanoseconds: 50_000_000)
                continue
            }
            throw AcceptanceFailure("recovery control returned unexpected status \(status)")
        }
        throw AcceptanceFailure("recovery status timed out")
    }

    private func request(path: String, method: String) async throws -> (Int, Data) {
        let trimmed = baseURL.absoluteString.hasSuffix("/")
            ? String(baseURL.absoluteString.dropLast())
            : baseURL.absoluteString
        guard let url = URL(string: "\(trimmed)/\(path)") else {
            throw AcceptanceFailure("control route is invalid")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        if method == "POST" { request.httpBody = Data() }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AcceptanceFailure("control request failed: \(safeErrorDescription(error))")
        }
        guard let http = response as? HTTPURLResponse else {
            throw AcceptanceFailure("control request returned a non-HTTP response")
        }
        return (http.statusCode, data)
    }

    private static func hasExactObjectKeys(_ data: Data, keys: Set<String>) -> Bool {
        guard let value = try? JSONSerialization.jsonObject(with: data),
              let object = value as? [String: Any] else {
            return false
        }
        return Set(object.keys) == keys
    }

    private struct StartedResponse: Decodable { let started: Bool }
    private struct PendingResponse: Decodable { let pending: Bool }
    private struct OutcomeResponse: Decodable { let outcome: String }
    private struct RevokedResponse: Decodable { let revoked: Bool }
    private struct RecoveryStatusResponse: Decodable {
        let hostFinalCursor: Int
        let offlineSeqCount: Int
    }
}
