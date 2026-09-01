import CryptoKit
import Foundation

/// The Noise protocol name this transport speaks, 32 bytes exactly.
private let protocolName = Array("Noise_XX_25519_ChaChaPoly_SHA256".utf8)

/// X25519 key bytes and the AEAD tag length, both fixed by the suite.
private let keyBytes = 32
private let tagBytes = 16

/// One direction of a split Noise session: a ChaChaPoly key and its
/// message counter. The nonce is the Noise layout — four zero bytes then
/// the 64-bit little-endian counter.
public final class NoiseCipherState {
    /// The raw traffic key; the fixed-key vectors read it back.
    public let keyData: Data

    private let key: SymmetricKey
    private var counter: UInt64 = 0

    /// - Parameter key: the raw 32-byte traffic key from the handshake split.
    init(key raw: [UInt8]) {
        self.keyData = Data(raw)
        self.key = SymmetricKey(data: Data(raw))
    }

    /// AEAD seal at the current counter, then advance it.
    public func encryptWithAd(_ ad: [UInt8], _ plaintext: [UInt8]) throws -> [UInt8] {
        let sealed = try ChaChaPoly.seal(
            Data(plaintext),
            using: key,
            nonce: try noiseNonce(counter),
            authenticating: Data(ad),
        )
        counter += 1
        return [UInt8](sealed.ciphertext) + [UInt8](sealed.tag)
    }

    /// AEAD open at the current counter, then advance it; a bad tag throws.
    public func decryptWithAd(_ ad: [UInt8], _ ciphertext: [UInt8]) throws -> [UInt8] {
        guard ciphertext.count >= tagBytes else {
            throw NoiseError.shortCiphertext
        }
        let split = ciphertext.count - tagBytes
        let box = try ChaChaPoly.SealedBox(
            nonce: try noiseNonce(counter),
            ciphertext: Data(ciphertext[0..<split]),
            tag: Data(ciphertext[split...]),
        )
        let opened = try ChaChaPoly.open(box, using: key, authenticating: Data(ad))
        counter += 1
        return [UInt8](opened)
    }
}

/// Why a Noise operation failed, in one closed vocabulary.
public enum NoiseError: Error, Equatable {
    /// A ciphertext arrived shorter than the AEAD tag itself.
    case shortCiphertext
    /// A handshake message did not have the shape its step requires.
    case malformedHandshake
}

/// The Noise_XX handshake for either role (chapters 68/69: the relay's
/// "Noise 或 TLS" transport encryption). HTTP is only the courier: the
/// handshake messages ride request/response bodies, then every relay body
/// is one or more transport frames sealed with empty associated data.
/// Mirrors apps/relay/noise.mjs byte for byte; the fixed-key vectors pin
/// the agreement.
public final class NoiseHandshake {
    /// Which side of XX this state plays.
    public enum Role {
        case initiator
        case responder
    }

    private let role: Role
    private let staticKey: Curve25519.KeyAgreement.PrivateKey
    private let ephemeralKey: Curve25519.KeyAgreement.PrivateKey
    private var remoteStatic: [UInt8]?
    private var remoteEphemeral: [UInt8]?
    private var ck: [UInt8]
    private var h: [UInt8]
    private var key: SymmetricKey?
    private var counter: UInt64 = 0

    /// - Parameters:
    ///   - role: the side this state plays.
    ///   - staticScalar: pinned raw scalar for the fixed-key vectors; nil generates fresh.
    ///   - ephemeralScalar: pinned raw scalar for the fixed-key vectors; nil generates fresh.
    public init(role: Role, staticScalar: [UInt8]? = nil, ephemeralScalar: [UInt8]? = nil) {
        self.role = role
        self.staticKey = staticScalar.map { Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data($0)) }
            ?? Curve25519.KeyAgreement.PrivateKey()
        self.ephemeralKey = ephemeralScalar.map { Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data($0)) }
            ?? Curve25519.KeyAgreement.PrivateKey()
        self.ck = protocolName
        self.h = protocolName
    }

    /// The transcript hash right now — the HTTP session id after message 2.
    public var transcriptHash: [UInt8] { h }

    /// XX message 1 (initiator → responder): the ephemeral public key.
    public func writeMessage1() throws -> [UInt8] {
        let e = [UInt8](ephemeralKey.publicKey.rawRepresentation)
        mixHash(e)
        return e + try encryptAndHash([])
    }

    /// Ingest XX message 1 (responder side). */
    public func readMessage1(_ message: [UInt8]) throws {
        guard message.count >= keyBytes else { throw NoiseError.malformedHandshake }
        let re = Array(message[0..<keyBytes])
        remoteEphemeral = re
        mixHash(re)
        _ = try decryptAndHash(Array(message[keyBytes...]))
    }

    /// XX message 2 (responder → initiator): e, ee rekey, sealed s, es rekey.
    public func writeMessage2() throws -> [UInt8] {
        let e = [UInt8](ephemeralKey.publicKey.rawRepresentation)
        mixHash(e)
        mixKey(try x25519(ephemeralKey, remoteEphemeral!))
        let sealedStatic = try encryptAndHash([UInt8](staticKey.publicKey.rawRepresentation))
        mixKey(try x25519(staticKey, remoteEphemeral!))
        return e + sealedStatic + try encryptAndHash([])
    }

    /// Ingest XX message 2 (initiator side).
    public func readMessage2(_ message: [UInt8]) throws {
        guard message.count >= keyBytes + keyBytes + tagBytes + tagBytes else { throw NoiseError.malformedHandshake }
        var offset = 0
        let re = Array(message[offset..<(offset + keyBytes)])
        offset += keyBytes
        remoteEphemeral = re
        mixHash(re)
        mixKey(try x25519(ephemeralKey, re))
        remoteStatic = try decryptAndHash(Array(message[offset..<(offset + keyBytes + tagBytes)]))
        offset += keyBytes + tagBytes
        // XX's es token pairs the initiator's ephemeral with the responder's
        // static — the initiator reads DH(e, rs).
        mixKey(try x25519(ephemeralKey, remoteStatic!))
        _ = try decryptAndHash(Array(message[offset...]))
    }

    /// XX message 3 (initiator → responder): sealed s, es rekey.
    public func writeMessage3() throws -> [UInt8] {
        let sealedStatic = try encryptAndHash([UInt8](staticKey.publicKey.rawRepresentation))
        mixKey(try x25519(ephemeralKey, remoteStatic!))
        return sealedStatic + try encryptAndHash([])
    }

    /// Ingest XX message 3 (responder side).
    public func readMessage3(_ message: [UInt8]) throws {
        guard message.count >= keyBytes + tagBytes + tagBytes else { throw NoiseError.malformedHandshake }
        var offset = 0
        remoteStatic = try decryptAndHash(Array(message[offset..<(offset + keyBytes + tagBytes)]))
        offset += keyBytes + tagBytes
        // The responder reads es as DH(s, re).
        mixKey(try x25519(staticKey, remoteEphemeral!))
        _ = try decryptAndHash(Array(message[offset...]))
    }

    /// Split into transport states; the first carries initiator → responder.
    public func split() throws -> (send: NoiseCipherState, recv: NoiseCipherState) {
        let (k1, k2) = hkdf2(ck, [])
        let c1 = NoiseCipherState(key: k1)
        let c2 = NoiseCipherState(key: k2)
        return role == .initiator ? (c1, c2) : (c2, c1)
    }

    private func mixHash(_ data: [UInt8]) {
        h = [UInt8](SHA256.hash(data: Data(h + data)))
    }

    private func mixKey(_ ikm: [UInt8]) {
        let (nextCk, tempKey) = hkdf2(ck, ikm)
        ck = nextCk
        key = SymmetricKey(data: Data(tempKey))
        counter = 0
    }

    private func encryptAndHash(_ plaintext: [UInt8]) throws -> [UInt8] {
        let sealed: [UInt8]
        if let key {
            sealed = try chachaSeal(key, counter, h, plaintext)
            counter += 1
        } else {
            sealed = plaintext
        }
        mixHash(sealed)
        return sealed
    }

    private func decryptAndHash(_ sealed: [UInt8]) throws -> [UInt8] {
        let plaintext: [UInt8]
        if let key {
            plaintext = try chachaOpen(key, counter, h, sealed)
            counter += 1
        } else {
            plaintext = sealed
        }
        mixHash(sealed)
        return plaintext
    }

    /// The X25519 shared secret between one private key and one raw peer key.
    private func x25519(_ privateKey: Curve25519.KeyAgreement.PrivateKey, _ peerRaw: [UInt8]) throws -> [UInt8] {
        let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: Data(peerRaw))
        return [UInt8](try privateKey.sharedSecretFromKeyAgreement(with: peer).sharedKey)
    }
}

/// Frame one ciphertext: u16 big-endian length, then the bytes.
public func encodeNoiseFrame(_ ciphertext: [UInt8]) -> [UInt8] {
    [UInt8((ciphertext.count >> 8) & 0xff), UInt8(ciphertext.count & 0xff)] + ciphertext
}

/// Split a framed body into ciphertexts; a truncated tail throws.
public func decodeNoiseFrames(_ body: [UInt8]) throws -> [[UInt8]] {
    var frames: [[UInt8]] = []
    var offset = 0
    while offset < body.count {
        guard offset + 2 <= body.count else { throw NoiseError.shortCiphertext }
        let length = (Int(body[offset]) << 8) | Int(body[offset + 1])
        offset += 2
        guard offset + length <= body.count else { throw NoiseError.shortCiphertext }
        frames.append(Array(body[offset..<(offset + length)]))
        offset += length
    }
    return frames
}

/// The 12-byte Noise ChaChaPoly nonce: 4 zero bytes then the counter little-endian.
private func noiseNonce(_ counter: UInt64) throws -> ChaChaPoly.Nonce {
    var bytes = [UInt8](repeating: 0, count: 12)
    for index in 0..<8 {
        bytes[4 + index] = UInt8((counter >> (8 * UInt64(index))) & 0xff)
    }
    return try ChaChaPoly.Nonce(data: Data(bytes))
}

/// ChaCha20-Poly1305 seal; the output is ciphertext || tag.
private func chachaSeal(_ key: SymmetricKey, _ counter: UInt64, _ ad: [UInt8], _ plaintext: [UInt8]) throws -> [UInt8] {
    let sealed = try ChaChaPoly.seal(Data(plaintext), using: key, nonce: try noiseNonce(counter), authenticating: Data(ad))
    return [UInt8](sealed.ciphertext) + [UInt8](sealed.tag)
}

/// ChaCha20-Poly1305 open over ciphertext || tag; a bad tag throws.
private func chachaOpen(_ key: SymmetricKey, _ counter: UInt64, _ ad: [UInt8], _ ciphertext: [UInt8]) throws -> [UInt8] {
    guard ciphertext.count >= tagBytes else { throw NoiseError.shortCiphertext }
    let split = ciphertext.count - tagBytes
    let box = try ChaChaPoly.SealedBox(
        nonce: try noiseNonce(counter),
        ciphertext: Data(ciphertext[0..<split]),
        tag: Data(ciphertext[split...]),
    )
    return [UInt8](try ChaChaPoly.open(box, using: key, authenticating: Data(ad)))
}

private func hmacSHA256(_ key: [UInt8], _ data: [UInt8]) -> [UInt8] {
    [UInt8](HMAC<SHA256>.authenticationCode(for: Data(data), using: SymmetricKey(data: Data(key))))
}

/// Noise §4.3 HKDF with two outputs: temp = HMAC(ck, ikm); o1 = HMAC(temp, 1); o2 = HMAC(temp, o1||2).
private func hkdf2(_ chainingKey: [UInt8], _ ikm: [UInt8]) -> ([UInt8], [UInt8]) {
    let temp = hmacSHA256(chainingKey, ikm)
    let one = hmacSHA256(temp, [1])
    let two = hmacSHA256(temp, one + [2])
    return (one, two)
}
