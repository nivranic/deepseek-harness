import Foundation

/// The Remote wire envelope: exactly what the gateway's shared `/api` chain
/// expects, decoded from the TypeScript reference client byte-for-byte.
public enum LinkWire {

    /// One unary request body: `{ type, rpcId, method, payload: { args } }`.
    public struct RequestEnvelope: Encodable {
        public let type = "client-request"
        public let rpcId: String
        public let method: String
        public let payload: Payload

        public struct Payload: Encodable {
            public let args: [String: Value]

            /// A JSON value encoded straight through.
            public enum Value: Encodable {
                case string(String)
                case number(Double)
                case bool(Bool)
                case null
                case array([Value])
                case object([String: Value])

                public func encode(to encoder: Encoder) throws {
                    var container = encoder.singleValueContainer()
                    switch self {
                    case .string(let value): try container.encode(value)
                    case .number(let value): try container.encode(value)
                    case .bool(let value): try container.encode(value)
                    case .null: try container.encodeNil()
                    case .array(let values): try container.encode(values)
                    case .object(let entries): try container.encode(entries)
                    }
                }
            }

            public init(args: [String: Value]) {
                self.args = args
            }
        }

        public init(rpcId: String, method: String, args: [String: Payload.Value]) {
            self.rpcId = rpcId
            self.method = method
            self.payload = Payload(args: args)
        }
    }

    /// One unary response body: `{ type: "server-response", rpcId, result }`.
    public struct ResponseEnvelope: Decodable {
        public let type: String
        public let rpcId: String
        public let result: Result

        /// `{ ok: true, value }` or `{ ok: false, error }`.
        public struct Result: Decodable {
            public let ok: Bool
            public let value: Value?
            public let error: Failure?

            /// A JSON value decoded straight through.
            public enum Value: Decodable, Equatable {
                case string(String)
                case number(Double)
                case bool(Bool)
                case null
                case array([Value])
                case object([String: Value])

                public init(from decoder: Decoder) throws {
                    let container = try decoder.singleValueContainer()
                    if container.decodeNil() { self = .null; return }
                    if let value = try? container.decode(Bool.self) { self = .bool(value); return }
                    if let value = try? container.decode(Double.self) { self = .number(value); return }
                    if let value = try? container.decode(String.self) { self = .string(value); return }
                    if let value = try? container.decode([Value].self) { self = .array(value); return }
                    if let value = try? container.decode([String: Value].self) { self = .object(value); return }
                    throw DecodingError.dataCorruptedError(in: container, debugDescription: "unsupported JSON value")
                }
            }

            /// `{ code, message, details }` on a refused call.
            public struct Failure: Decodable, Equatable {
                public let code: String
                public let message: String
            }
        }
    }

    /// One NDJSON Remote-stream frame: `{"k":"v","v":…}` or `{"k":"e",…}`.
    public struct StreamFrame: Decodable {
        public let k: String
        public let v: ResponseEnvelope.Result.Value?
        public let c: String?
        public let m: String?

        /// `true` when the frame carries a stream value.
        public var isValue: Bool { k == "v" }
        /// `true` when the frame terminates the stream with a typed failure.
        public var isFailure: Bool { k == "e" }
    }
}
