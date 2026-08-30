import Foundation

#if canImport(Security)
import Security
#endif

/// Keychain-backed credentials for a real deployment. One generic password
/// item per service account; the item migrates with the keychain's own
/// backups and never leaves the device.
public final class KeychainLinkCredentialsStore: LinkCredentialsStoring {
    private let service: String
    private let account: String

    /// - Parameters:
    ///   - service: the keychain service name; defaults to the dsh link one.
    ///   - account: the keychain account name; one host identity per app.
    public init(service: String = "ai.deepseek.dsh.link", account: String = "primary-host") {
        self.service = service
        self.account = account
    }

    public func load() -> LinkCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(LinkCredentials.self, from: data)
    }

    public func save(_ credentials: LinkCredentials) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        var query = baseQuery
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(query as CFDictionary, nil)
        }
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
