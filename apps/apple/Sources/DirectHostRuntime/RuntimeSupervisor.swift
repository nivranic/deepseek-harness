#if os(macOS)
import Combine
import Foundation

/// Closed failure classes keep runtime output and authentication material out of diagnostics.
public enum RuntimeFailure: String, Equatable {
    case unavailable, invalidConfiguration, startFailed, startupTimeout, invalidAnnouncement, healthFailed, unexpectedExit, shutdownFailed
}

/// User-observable state of one owned runtime activation.
public enum RuntimeStatus: Equatable {
    case stopped, starting, ready, stopping, failed(RuntimeFailure)
}

/// The Mac carrier supplies deployment timing explicitly; invalid policies fail before launch.
public struct RuntimePolicy {
    public let startupMilliseconds: UInt64
    public let healthMilliseconds: UInt64
    public let requestMilliseconds: UInt64
    public let shutdownMilliseconds: UInt64

    public init(startupMilliseconds: UInt64, healthMilliseconds: UInt64,
                requestMilliseconds: UInt64, shutdownMilliseconds: UInt64) throws {
        guard [startupMilliseconds, healthMilliseconds, requestMilliseconds, shutdownMilliseconds]
            .allSatisfy({ (1...60000).contains($0) }) else { throw RuntimeFailure.startFailed }
        self.startupMilliseconds = startupMilliseconds
        self.healthMilliseconds = healthMilliseconds
        self.requestMilliseconds = requestMilliseconds
        self.shutdownMilliseconds = shutdownMilliseconds
    }
}

extension RuntimeFailure: Error {}

private final class LocalRedirects: NSObject, URLSessionTaskDelegate {
    let launch: URL
    init(_ launch: URL) { self.launch = launch }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map { RuntimeEndpoint.sameCarrier($0, as: launch) } == true ? request : nil)
    }
}

/// Owns the helper, its parent-lifetime pipe and one ephemeral HTTP health session.
/// The helper reaps the runtime group on parent death; detached tool groups require their own owner.
@MainActor
public final class RuntimeSupervisor: ObservableObject {
    @Published public private(set) var status: RuntimeStatus = .stopped
    /// Passed only to the local WebView; never persisted or included in status/error descriptions.
    @Published public private(set) var launchURL: URL?
    @Published public private(set) var activationID = UUID()

    @MainActor private final class Activation {
        let process = Process()
        let control = Pipe()
        let output = Pipe()
        let errors = Pipe()
        var outputReader: RuntimePipeReader?
        var errorReader: RuntimePipeReader?
        var buffer = Data()
        var stopping = false
        var failure: RuntimeFailure?
        var startup: Task<Void, Never>?
        var health: Task<Void, Never>?
        var session: URLSession?
        var waiters: [CheckedContinuation<Void, Never>] = []
    }

    private let executable: URL
    private let helper: URL
    private let home: URL?
    private let policy: RuntimePolicy
    private var activation: Activation?

    /// Invalid explicit home configuration fails on start without creating or using the default home.
    public init(executable: URL, helper: URL, home: URL, policy: RuntimePolicy, homeOverride: String? = nil) {
        self.executable = executable
        self.helper = helper
        self.home = try? RuntimeHome.resolve(defaultHome: home, override: homeOverride)
        self.policy = policy
    }

    /// Start only when the previous activation has exited. Duplicate starts join the existing state.
    public func start() {
        guard activation == nil else { return }
        guard let home else {
            status = .failed(.invalidConfiguration)
            return
        }
        guard [executable, helper, home].allSatisfy(\.isFileURL),
              FileManager.default.isExecutableFile(atPath: executable.path),
              FileManager.default.isExecutableFile(atPath: helper.path) else {
            status = .failed(.unavailable)
            return
        }
        do {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        } catch {
            status = .failed(.startFailed)
            return
        }
        let run = Activation()
        activation = run
        activationID = UUID()
        status = .starting
        launchURL = nil
        run.process.executableURL = helper
        run.process.arguments = [executable.path, String(policy.shutdownMilliseconds)]
        run.process.currentDirectoryURL = home
        let environment = ProcessInfo.processInfo.environment
        var childEnvironment = environment.filter { ["PATH", "HOME", "TMPDIR", "LANG"].contains($0.key) }
        childEnvironment["DSH_HOME"] = home.path
        childEnvironment["DSH_TELEMETRY_DISABLED"] = "1"
        run.process.environment = childEnvironment
        run.process.standardInput = run.control
        run.process.standardOutput = run.output
        run.process.standardError = run.errors
        run.process.terminationHandler = { [weak self, weak run] _ in
            Task { @MainActor in
                guard let self, let run else { return }
                self.finished(run)
            }
        }
        do {
            run.outputReader = try RuntimePipeReader(run.output.fileHandleForReading) { [weak self, weak run] data in
                Task { @MainActor in
                    guard let self, let run else { return }
                    self.consume(data, from: run)
                }
            }
            run.errorReader = try RuntimePipeReader(run.errors.fileHandleForReading) { _ in }
            try run.process.run()
        } catch {
            run.failure = .startFailed
            finished(run, launched: false)
            return
        }
        run.control.fileHandleForReading.closeFile()
        run.output.fileHandleForWriting.closeFile()
        run.errors.fileHandleForWriting.closeFile()
        run.startup = Task { [weak self, weak run] in
            guard let self, let run else { return }
            do { try await Task.sleep(nanoseconds: self.policy.startupMilliseconds * 1_000_000) }
            catch { return }
            self.fail(run, with: .startupTimeout)
        }
    }

    /// Close the parent pipe, then wait for the helper to finish runtime-group cleanup.
    public func stop() async {
        guard let run = activation else { return }
        if !run.stopping {
            run.stopping = true
            status = .stopping
            launchURL = nil
            run.startup?.cancel()
            run.health?.cancel()
            run.session?.invalidateAndCancel()
            run.control.fileHandleForWriting.closeFile()
        }
        await withCheckedContinuation { run.waiters.append($0) }
    }

    /// Restart preserves the home and waits for the old helper before opening another carrier.
    public func restart() async {
        await stop()
        guard activation == nil else { return }
        start()
    }

    private func fail(_ run: Activation, with failure: RuntimeFailure) {
        guard activation === run, !run.stopping else { return }
        run.failure = failure
        Task {
            guard self.activation === run else { return }
            await self.stop()
        }
    }

    private func consume(_ data: Data, from run: Activation) {
        guard activation === run, !run.stopping else { return }
        if data.isEmpty {
            if run.session == nil { fail(run, with: .invalidAnnouncement) }
            return
        }
        run.buffer.append(data)
        while let newline = run.buffer.firstIndex(of: 10) {
            let lineData = run.buffer.prefix(upTo: newline)
            run.buffer.removeSubrange(...newline)
            guard lineData.count <= 65536, let line = String(data: lineData, encoding: .utf8) else {
                fail(run, with: .invalidAnnouncement)
                return
            }
            guard line.hasPrefix("dsh web: http") else { continue }
            guard run.session == nil, let url = RuntimeEndpoint.parse(line) else {
                fail(run, with: .invalidAnnouncement)
                return
            }
            beginHealth(run, url: url)
        }
        if run.buffer.count > 65536 { fail(run, with: .invalidAnnouncement) }
    }

    private func beginHealth(_ run: Activation, url: URL) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Double(policy.requestMilliseconds) / 1000
        configuration.timeoutIntervalForResource = configuration.timeoutIntervalForRequest
        let session = URLSession(configuration: configuration, delegate: LocalRedirects(url), delegateQueue: nil)
        run.session = session
        run.health = Task { [weak self, weak run] in
            guard let self, let run else { return }
            while !Task.isCancelled {
                do {
                    let (data, response) = try await session.data(from: url)
                    guard self.activation === run, !run.stopping else { return }
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200, http.mimeType == "text/html",
                          let responseURL = http.url, RuntimeEndpoint.sameCarrier(responseURL, as: url),
                          String(data: data, encoding: .utf8)?.contains("__DSH_BOOT__") == true else {
                        throw RuntimeFailure.healthFailed
                    }
                    run.startup?.cancel()
                    self.launchURL = url
                    self.status = .ready
                    try await Task.sleep(nanoseconds: self.policy.healthMilliseconds * 1_000_000)
                } catch {
                    if !Task.isCancelled { self.fail(run, with: .healthFailed) }
                    return
                }
            }
        }
    }

    private func finished(_ run: Activation, launched: Bool = true) {
        guard activation === run else { return }
        run.startup?.cancel()
        run.health?.cancel()
        run.session?.invalidateAndCancel()
        run.outputReader?.cancel()
        run.errorReader?.cancel()
        for handle in [run.control.fileHandleForReading, run.control.fileHandleForWriting,
                       run.output.fileHandleForReading, run.output.fileHandleForWriting,
                       run.errors.fileHandleForReading, run.errors.fileHandleForWriting] {
            try? handle.close()
        }
        activation = nil
        launchURL = nil
        if let failure = run.failure { status = .failed(failure) }
        else if !run.stopping { status = .failed(.unexpectedExit) }
        else if launched && run.process.terminationStatus != 0 { status = .failed(.shutdownFailed) }
        else { status = .stopped }
        for waiter in run.waiters { waiter.resume() }
    }
}
#endif
