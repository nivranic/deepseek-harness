import XCTest
@testable import SharedAppleRemoteCore

/// The rendezvous skeleton's forwarding semantics (chapters 68/69).
final class RelayRendezvousTests: XCTestCase {
    func testRegistersDevicesAndForwardsReferencesToEveryDevice() {
        let relay = RelayRendezvous()
        let phone = relay.register(RelayDevice(accountId: "acct", deviceId: "phone", platform: "android"))
        let pad = relay.register(RelayDevice(accountId: "acct", deviceId: "pad", platform: "ios", pushToken: "apns-token"))
        XCTAssertEqual(relay.devices(accountId: "acct").count, 2)

        let delivered = relay.publish(
            accountId: "acct",
            envelope: RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1")
        )
        XCTAssertEqual(delivered, 2)

        XCTAssertEqual(relay.poll(token: phone), [RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1")])
        // Draining retires the queue.
        XCTAssertTrue(relay.poll(token: phone).isEmpty)
        XCTAssertEqual(relay.poll(token: pad), [RelayEnvelope(kind: "approval-waiting", sessionId: "s1", eventId: "e1")])
    }

    func testAccountsAreIsolatedAndUnknownTokensDrainNothing() {
        let relay = RelayRendezvous()
        let mine = relay.register(RelayDevice(accountId: "mine", deviceId: "phone", platform: "android"))
        relay.register(RelayDevice(accountId: "other", deviceId: "phone", platform: "android"))
        let delivered = relay.publish(
            accountId: "other",
            envelope: RelayEnvelope(kind: "task-completed", sessionId: "s9", turn: 1)
        )
        XCTAssertEqual(delivered, 1)
        XCTAssertTrue(relay.poll(token: mine).isEmpty)
        XCTAssertTrue(relay.poll(token: "rt-unknown").isEmpty)
    }
}
