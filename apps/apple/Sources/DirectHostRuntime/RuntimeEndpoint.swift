import Foundation

/// The launcher emits one authenticated IPv4 loopback root URL after its Loader settles.
public enum RuntimeEndpoint {
    /// Parse a complete stdout line without retaining unrelated runtime output.
    public static func parse(_ line: String) -> URL? {
        let prefix = "dsh web: "
        guard line.hasPrefix(prefix) else { return nil }
        let raw = String(line.dropFirst(prefix.count))
        guard !raw.contains(where: { $0.isWhitespace }),
              let parts = URLComponents(string: raw),
              parts.scheme == "http", parts.host == "127.0.0.1",
              let port = parts.port, (1...65535).contains(port),
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.path == "/", let query = parts.queryItems, query.count == 1,
              query[0].name == "token", let token = query[0].value, !token.isEmpty,
              token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") })
        else { return nil }
        return parts.url
    }

    /// Match an HTTP response or navigation to this runtime's sole local carrier.
    public static func sameCarrier(_ candidate: URL, as launch: URL) -> Bool {
        candidate.scheme == "http" && candidate.host == "127.0.0.1"
            && candidate.port == launch.port && candidate.user == nil && candidate.password == nil
    }
}
