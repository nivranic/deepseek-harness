/// The session/modelCatalog wire contract as the Android core parses it:
/// provider groups of routable models, each optionally carrying its reasoning
/// efforts and default. Mirrors SessionModel.modelCatalog in apps/android/core —
/// the Kotlin implementation is the authority; this mirror adopts the same JSON
/// vocabulary and the same leniency (typed mismatches drop or fall back to ids,
/// never silently coerce), so an Apple client reads the same catalog.
import Foundation

/// One selectable reasoning effort for an exact model route.
public struct NativeEffortChoice: Equatable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// Selectable reasoning metadata for one exact model route; absent models take no effort.
public struct NativeModelReasoning: Equatable, Sendable {
    public let efforts: [NativeEffortChoice]
    public let defaultEffort: String?

    public init(efforts: [NativeEffortChoice], defaultEffort: String?) {
        self.efforts = efforts
        self.defaultEffort = defaultEffort
    }
}

/// One routable model as the Host catalog publishes it.
public struct NativeCatalogModel: Equatable, Sendable {
    public let id: String
    public let name: String
    public let reasoning: NativeModelReasoning?

    public init(id: String, name: String, reasoning: NativeModelReasoning? = nil) {
        self.id = id
        self.name = name
        self.reasoning = reasoning
    }
}

/// One provider group in the Host model catalog.
public struct NativeCatalogGroup: Equatable, Sendable {
    public let id: String
    public let name: String
    public let models: [NativeCatalogModel]

    public init(id: String, name: String, models: [NativeCatalogModel]) {
        self.id = id
        self.name = name
        self.models = models
    }
}

/// Host-generation model catalog plus the deployment default selection.
public struct NativeModelCatalog: Equatable, Sendable {
    public let groups: [NativeCatalogGroup]
    public let defaultProvider: String
    public let defaultModel: String

    public init(groups: [NativeCatalogGroup], defaultProvider: String, defaultModel: String) {
        self.groups = groups
        self.defaultProvider = defaultProvider
        self.defaultModel = defaultModel
    }
}

private func catalogString(_ object: [String: Any], _ field: String) -> String? {
    object[field] as? String
}

extension NativeModelCatalog {
    /// Lenient decode mirroring SessionModel.modelCatalog: groups, models, and
    /// efforts without a string id are dropped; names default to their id;
    /// a non-object reasoning field reads as absent; the default selection's
    /// non-string members read as empty. Malformed JSON still fails; a
    /// non-object document reads as an empty catalog.
    public static func decode(_ data: Data) throws -> NativeModelCatalog {
        let root = (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let groups = (root["groups"] as? [Any] ?? []).compactMap { group -> NativeCatalogGroup? in
            guard let group = group as? [String: Any], let id = catalogString(group, "id") else { return nil }
            let models = (group["models"] as? [Any] ?? []).compactMap { entry -> NativeCatalogModel? in
                guard let entry = entry as? [String: Any], let modelId = catalogString(entry, "id") else { return nil }
                let reasoning = (entry["reasoning"] as? [String: Any]).map { metadata in
                    NativeModelReasoning(
                        efforts: (metadata["efforts"] as? [Any] ?? []).compactMap { choice -> NativeEffortChoice? in
                            guard let choice = choice as? [String: Any], let effortId = catalogString(choice, "id") else { return nil }
                            return NativeEffortChoice(id: effortId, name: catalogString(choice, "name") ?? effortId)
                        },
                        defaultEffort: catalogString(metadata, "defaultEffort"))
                }
                return NativeCatalogModel(id: modelId, name: catalogString(entry, "name") ?? modelId, reasoning: reasoning)
            }
            return NativeCatalogGroup(id: id, name: catalogString(group, "name") ?? id, models: models)
        }
        let defaultSelection = root["default"] as? [String: Any]
        return NativeModelCatalog(groups: groups,
            defaultProvider: defaultSelection.flatMap { catalogString($0, "provider") } ?? "",
            defaultModel: defaultSelection.flatMap { catalogString($0, "model") } ?? "")
    }
}

/// One model selection as the Android core sends it on session/selectModel.
public struct NativeModelSelection: Equatable, Sendable {
    public let sessionId: String
    public let provider: String
    public let model: String
    public let reasoningEffort: String?

    public init(sessionId: String, provider: String, model: String, reasoningEffort: String? = nil) {
        self.sessionId = sessionId
        self.provider = provider
        self.model = model
        self.reasoningEffort = reasoningEffort
    }

    /// The session/selectModel wire body: reasoningEffort rides only when
    /// present — an effort-free selection is byte-identical to the pre-effort wire.
    public func wireBody() -> [String: Any] {
        var request: [String: Any] = ["sessionId": sessionId, "provider": provider, "model": model]
        if let effort = reasoningEffort {
            request["reasoningEffort"] = effort
        }
        return ["request": request]
    }
}
