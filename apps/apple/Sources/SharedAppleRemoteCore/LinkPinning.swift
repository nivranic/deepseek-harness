import CryptoKit
import Foundation

#if canImport(Security)
import Security
#endif

/// A `URLSessionDelegate` that refuses every server whose leaf certificate's
/// public key does not hash to the pinned fingerprint from the pairing
/// payload. The pin is checked in `didReceiveChallenge`, before any request
/// byte is written — a host that re-keys must be re-paired.
public final class LinkPinningDelegate: NSObject, URLSessionDelegate {
    private let pinnedFingerprint: String

    /// - Parameter pinnedFingerprint: lowercase hex SHA-256 of the host
    ///   certificate's SubjectPublicKeyInfo DER, from the pairing payload.
    public init(pinnedFingerprint: String) {
        self.pinnedFingerprint = pinnedFingerprint
    }

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        guard let fingerprint = LinkPinningDelegate.leafSpkiFingerprint(trust: trust) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        if fingerprint == pinnedFingerprint {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    /// SHA-256 of the leaf certificate's SPKI DER, or nil when the chain or
    /// the key bytes are unavailable. P-256 keys arrive as the 65-byte
    /// uncompressed point, which the fixed SPKI header then wraps.
    static func leafSpkiFingerprint(trust: SecTrust) -> String? {
        guard let certificate = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first else {
            return nil
        }
        // The modern call returns a bare SecKey on macOS and an optional on
        // iOS; a macOS failure still surfaces at the representation copy below.
        #if os(macOS)
        let key = SecCertificateCopyKey(certificate)
        #else
        guard let key = SecCertificateCopyKey(certificate) else { return nil }
        #endif
        guard let key else { return nil }
        var error: Unmanaged<CFError>?
        guard let keyData = SecKeyCopyExternalRepresentation(key, &error) as Data? else { return nil }
        let spkiDer: Data
        if keyData.count == 65 {
            spkiDer = LinkSigning.p256SpkiDer(uncompressedPoint: keyData)
        } else if keyData.count == 32 {
            spkiDer = LinkSigning.ed25519SpkiDer(publicKeyRaw: keyData)
        } else {
            return nil
        }
        return LinkSigning.spkiFingerprint(spkiDer: spkiDer)
    }
}
