import Foundation
import SharedAppleRemoteCore

/// The wire surface the view models depend on: one unary call and one
/// stream, both shaped exactly like the carrier's. Tests drive fakes; the
/// real adapter wraps `LinkClient`.
public protocol CompanionWireDriving: Actor {
    /// One signed unary RPC through the shared `/api` chain.
    /// - Parameters:
    ///   - method: canonical endpoint, for example `session/list`.
    ///   - args: named wire arguments as pass-through JSON.
    /// - Returns: the business value.
    func call(_ method: String, args: [String: WireValue]) async throws -> WireValue

    /// One NDJSON Remote stream.
    /// - Parameters:
    ///   - endpoint: canonical stream endpoint, for example `session/follow`.
    ///   - payload: the stream's opening payload arguments.
    /// - Returns: frame values in arrival order.
    func stream(_ endpoint: String, payload: [String: WireValue]) async throws -> AsyncThrowingStream<WireValue, Error>
}

/// The pass-through JSON value the view models exchange with the wire.
public typealias WireValue = LinkWire.WireValue

/// Wire-shaped helpers shared by the view models: field access on
/// pass-through JSON without inventing a parallel type system.
public enum WireShape {
    /// The string under one object field, or nil.
    public static func string(_ value: WireValue, field: String) -> String? {
        if case .object(let entries) = value { return entries[field].flatMap(stringOf) }
        return nil
    }

    /// The double under one object field, or nil.
    public static func number(_ value: WireValue, field: String) -> Double? {
        if case .object(let entries) = value { return entries[field].flatMap(numberOf) }
        return nil
    }

    /// The array under one object field, or nil.
    public static func array(_ value: WireValue, field: String) -> [WireValue]? {
        if case .object(let entries) = value { return entries[field].flatMap(arrayOf) }
        return nil
    }

    /// The nested object under one object field, or nil when the field is
    /// absent or carries a non-object value (an event-name string is not a
    /// payload object).
    public static func object(_ value: WireValue, field: String) -> WireValue? {
        if case .object(let entries) = value, case .object(let nested)? = entries[field] {
            return .object(nested)
        }
        return nil
    }

    private static func stringOf(_ value: WireValue) -> String? {
        if case .string(let text) = value { return text }
        return nil
    }

    private static func numberOf(_ value: WireValue) -> Double? {
        if case .number(let number) = value { return number }
        return nil
    }

    private static func arrayOf(_ value: WireValue) -> [WireValue]? {
        if case .array(let items) = value { return items }
        return nil
    }
}

extension LinkWire.ResponseEnvelope.Result.Value {
    /// JSON bytes of the pass-through value, for decoding the generated
    /// contract models straight off the wire. Nil when the value is not a
    /// JSON object root a contract payload could live in.
    public var jsonData: Data? {
        guard JSONSerialization.isValidJSONObject(jsonObject) else { return nil }
        return try? JSONSerialization.data(withJSONObject: jsonObject)
    }

    private var jsonObject: Any {
        switch self {
        case .string(let text): return text
        case .number(let number): return number
        case .bool(let flag): return flag
        case .null: return NSNull()
        case .array(let items): return items.map(\.jsonObject)
        case .object(let entries): return entries.mapValues(\.jsonObject)
        }
    }
}

/// Decode one generated contract model from a pass-through wire value.
/// Decoding failures return nil: an unknown-tag or future payload shape
/// renders through the generic projection instead of failing the timeline.
enum ContractCodec {
    static func decode<T: Decodable>(_ type: T.Type, from value: WireValue) -> T? {
        guard let data = value.jsonData else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/// The real wire over one paired `LinkClient`.
public actor LinkClientWireDriver: CompanionWireDriving {
    private let client: LinkClient

    /// - Parameter client: a paired client; calls throw `unpaired` before
    ///   the first successful pairing.
    public init(client: LinkClient) {
        self.client = client
    }

    public func call(_ method: String, args: [String: WireValue]) async throws -> WireValue {
        try await client.call(method, args: args)
    }

    public func stream(_ endpoint: String, payload: [String: WireValue]) async throws -> AsyncThrowingStream<WireValue, Error> {
        try await client.stream(endpoint, payload: payload)
    }
}
