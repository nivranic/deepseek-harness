import CryptoKit
import Foundation

/// The carrier's request-signature vocabulary: the canonical signing input,
/// the three credential headers, and the SPKI framing the fingerprint pins.
public enum LinkSigning {

    /// The exact credential headers every authenticated request carries.
    public static let deviceIdHeader = "x-dsh-device-id"
    public static let timestampHeader = "x-dsh-timestamp"
    public static let signatureHeader = "x-dsh-signature"

    /// The canonical input the host verifies:
    /// `timestamp\nmethod\npath\nsha256hex(body)` — byte-for-byte the
    /// TypeScript reference client's `linkSigningInput`.
    public static func signingInput(timestamp: String, method: String, path: String, bodySha256Hex: String) -> String {
        "\(timestamp)\n\(method)\n\(path)\n\(bodySha256Hex)"
    }

    /// Lowercase hex SHA-256 of the exact request body bytes.
    public static func sha256Hex(_ body: Data) -> String {
        SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
    }

    /// Base64 Ed25519 signature over the canonical input, UTF-8 encoded.
    public static func sign(input: String, privateKeyRaw: Data) throws -> String {
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: privateKeyRaw)
        let signature = try key.signature(for: Data(input.utf8))
        return signature.base64EncodedString()
    }

    /// The 44-byte SubjectPublicKeyInfo DER wrapping one Ed25519 public key:
    /// the fixed 12-byte header followed by the 32 raw key bytes.
    public static func ed25519SpkiDer(publicKeyRaw: Data) -> Data {
        var der = Data([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00])
        der.append(publicKeyRaw)
        return der
    }

    /// The SPKI DER for a P-256 public key given its 65-byte X9.63
    /// uncompressed point: the fixed 26-byte header followed by the point.
    public static func p256SpkiDer(uncompressedPoint: Data) -> Data {
        var der = Data([
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
            0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
        ])
        der.append(uncompressedPoint)
        return der
    }

    /// Lowercase hex SHA-256 of a DER structure — the fingerprint form the
    /// pairing payload and the host description carry.
    public static func spkiFingerprint(spkiDer: Data) -> String {
        sha256Hex(spkiDer)
    }
}
