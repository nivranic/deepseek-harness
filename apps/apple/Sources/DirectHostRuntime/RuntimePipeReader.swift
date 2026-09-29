#if os(macOS)
import Darwin
import Dispatch
import Foundation

/// Reads one available pipe chunk per event; cancellation closes the owned descriptor after handlers finish.
/// Descriptor state is immutable; DispatchSource serializes reads and descriptor closure.
final class RuntimePipeReader: @unchecked Sendable {
    private let descriptor: Int32
    private let source: DispatchSourceRead

    init(_ handle: FileHandle, receive: @escaping @Sendable (Data) -> Void) throws {
        let descriptor = fcntl(handle.fileDescriptor, F_DUPFD_CLOEXEC, 0)
        guard descriptor >= 0 else { throw RuntimeFailure.startFailed }
        self.descriptor = descriptor
        source = DispatchSource.makeReadSource(fileDescriptor: descriptor,
                                              queue: DispatchQueue(label: "dsh.host.runtime-pipe"))
        source.setEventHandler { [weak self] in self?.read(receive) }
        source.setCancelHandler { _ = Darwin.close(descriptor) }
        source.resume()
    }

    func cancel() { source.cancel() }

    private func read(_ receive: @Sendable (Data) -> Void) {
        var bytes = Data(count: 65536)
        let (count, error) = bytes.withUnsafeMutableBytes { buffer in
            let count = Darwin.read(descriptor, buffer.baseAddress, buffer.count)
            return (count, count < 0 ? errno : 0)
        }
        if count > 0 {
            bytes.count = count
            receive(bytes)
        } else if count == 0 || (error != EINTR && error != EAGAIN) {
            source.cancel()
            receive(Data())
        }
    }

    deinit { source.cancel() }
}
#endif
