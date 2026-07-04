import Foundation
import FenrirNativeShared
import ServerConnection
import Testing
@testable import FenrirNativeApp

@Suite("Native local server supervisor")
struct NativeLocalServerSupervisorTests {
    @Test("Existing healthy server is discovered with an unauthenticated non-mutating probe")
    func existingHealthyServerFound() async throws {
        let prober = RecordingLocalServerProber(results: [
            .success(NativeLocalServerHTTPProbeResponse(statusCode: 204, headers: [:], body: Data()))
        ])
        let supervisor = makeSupervisor(prober: prober)

        let discovery = try await supervisor.discoverLocalServer(spec())

        #expect(discovery.status == .found)
        #expect(discovery.endpoint == spec().endpoint)
        let requests = await prober.requests
        #expect(requests.map(\.method) == ["GET"])
        #expect(requests[0].url.path == NativeLocalServerSupervisor.defaultProbePath)
        #expect(requests[0].url.path != "/api/auth/bootstrap/bearer")
    }

    @Test("Missing and unhealthy servers do not discover as found")
    func missingAndUnhealthyServer() async throws {
        let unhealthy = RecordingLocalServerProber(results: [
            .success(NativeLocalServerHTTPProbeResponse(statusCode: 503, headers: [:], body: Data()))
        ])
        let missing = RecordingLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing)
        ])

        let unhealthyDiscovery = try await makeSupervisor(prober: unhealthy).discoverLocalServer(spec())
        let missingDiscovery = try await makeSupervisor(prober: missing).discoverLocalServer(spec())

        #expect(unhealthyDiscovery.status == .unhealthy)
        #expect(unhealthyDiscovery.endpoint == nil)
        #expect(missingDiscovery.status == .missing)
        #expect(missingDiscovery.endpoint == nil)
    }

    @Test("Readiness timeout maps to stable local server readiness error")
    func readinessTimeout() async throws {
        let prober = RecordingLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing),
            .failure(NativeLocalServerSupervisorError.missing),
            .failure(NativeLocalServerSupervisorError.missing)
        ])
        let supervisor = makeSupervisor(prober: prober, pollIntervalMilliseconds: 1)

        await #expect(throws: ServerConnection.ServerConnectionError.localServerReadinessFailed) {
            _ = try await supervisor.waitForLocalServerReadiness(.existing(spec().endpoint), timeoutMilliseconds: 1)
        }
    }

    @Test("Readiness succeeds after failed probes")
    func readinessSucceedsAfterFailedProbes() async throws {
        let prober = RecordingLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing),
            .success(NativeLocalServerHTTPProbeResponse(statusCode: 503, headers: [:], body: Data())),
            .success(NativeLocalServerHTTPProbeResponse(statusCode: 204, headers: [:], body: Data()))
        ])
        let supervisor = makeSupervisor(prober: prober, pollIntervalMilliseconds: 1)

        let endpoint = try await supervisor.waitForLocalServerReadiness(.existing(spec().endpoint), timeoutMilliseconds: 1_000)

        #expect(endpoint == spec().endpoint)
        #expect(await prober.requests.count == 3)
    }

    @Test("Expected server identity mismatch is unhealthy")
    func expectedServerIdentityMismatchIsUnhealthy() async throws {
        let prober = RecordingLocalServerProber(results: [
            .success(NativeLocalServerHTTPProbeResponse(
                statusCode: 204,
                headers: ["X-Fenrir-Server-Identity": "other-server"],
                body: Data()
            ))
        ])
        let supervisor = makeSupervisor(prober: prober)

        let discovery = try await supervisor.discoverLocalServer(spec(expectedServerIdentity: "fenrir-server"))

        #expect(discovery.status == .unhealthy)
        #expect(discovery.endpoint == nil)
    }

    @Test("Readiness cancellation remains cancellation")
    func readinessCancellationRemainsCancellation() async throws {
        let prober = RecordingLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing)
        ])
        let supervisor = makeSupervisor(prober: prober, pollIntervalMilliseconds: 1_000)
        let task = Task {
            _ = try await supervisor.waitForLocalServerReadiness(.existing(spec().endpoint), timeoutMilliseconds: 10_000)
        }

        while await prober.requests.isEmpty {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        task.cancel()

        await #expect(throws: CancellationError.self) {
            try await task.value
        }
    }

    @Test("Spawn success returns process snapshot and redacts launch configuration secrets")
    func spawnSuccessReturnsProcessSnapshot() async throws {
        let launcher = RecordingProcessLauncher(launchResults: [.success(NativeLocalServerLaunchedProcess(processID: "pid-123"))])
        let supervisor = makeSupervisor(launcher: launcher)

        let snapshot = try await supervisor.spawnLocalServer(spec(), restartCount: 2)

        #expect(snapshot.processID == ServerConnection.LocalServerProcessID(rawValue: "pid-123"))
        #expect(snapshot.endpoint == spec().endpoint)
        #expect(snapshot.restartCount == 2)
        #expect(snapshot.startedAt == fixedTimestamp)
        let launchRequests = await launcher.launchRequests
        #expect(launchRequests.count == 1)
        #expect(String(describing: launchRequests[0]).contains("super-secret") == false)
    }

    @Test("Development launch configuration starts the monorepo server with a desktop bootstrap token")
    func developmentLaunchConfigurationStartsMonorepoServer() throws {
        let fileManager = FileManager.default
        let rootURL = fileManager.temporaryDirectory
            .appendingPathComponent("fenrir-native-dev-\(UUID().uuidString)")
        let serverSourceURL = rootURL.appendingPathComponent("apps/server/src", isDirectory: true)
        let nativePackageURL = rootURL.appendingPathComponent("native/FenrirNative", isDirectory: true)
        let workspaceURL = rootURL.appendingPathComponent("fixtures/workspace", isDirectory: true)
        try fileManager.createDirectory(at: serverSourceURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: nativePackageURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        try "{}".write(to: rootURL.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try "{}".write(to: rootURL.appendingPathComponent("apps/server/package.json"), atomically: true, encoding: .utf8)
        try "".write(to: rootURL.appendingPathComponent("apps/server/src/bin.ts"), atomically: true, encoding: .utf8)
        defer {
            try? fileManager.removeItem(at: rootURL)
        }

        let configuration = try #require(NativeLocalServerSupervisor.developmentLaunchConfiguration(
            environment: [
                "FENRIR_NATIVE_BOOTSTRAP_TOKEN": "dev-bootstrap-token",
                "FENRIR_NATIVE_WORKSPACE_ROOT": workspaceURL.path
            ],
            currentDirectoryURL: nativePackageURL,
            fileManager: fileManager
        ))

        #expect(configuration.executableURL.path == "/usr/bin/env")
        #expect(configuration.arguments == [
            "bun",
            "run",
            "src/bin.ts",
            "--mode",
            "desktop",
            "--host",
            NativeLocalServerSupervisor.defaultHost,
            "--port",
            String(NativeLocalServerSupervisor.defaultPort),
            "--no-browser",
            "--auto-bootstrap-project-from-cwd",
            workspaceURL.path
        ])
        #expect(configuration.environment["FENRIR_DESKTOP_BOOTSTRAP_TOKEN"] == "dev-bootstrap-token")
        #expect(configuration.environment["FENRIR_PORT"] == String(NativeLocalServerSupervisor.defaultPort))
        #expect(configuration.workingDirectoryURL?.path == rootURL.appendingPathComponent("apps/server").path)
    }

    @Test("Packaged debug bundle locates the monorepo server from the app bundle path")
    func packagedDebugBundleLaunchConfigurationStartsMonorepoServer() throws {
        let fileManager = FileManager.default
        let rootURL = fileManager.temporaryDirectory
            .appendingPathComponent("fenrir-native-debug-bundle-\(UUID().uuidString)")
        let serverSourceURL = rootURL.appendingPathComponent("apps/server/src", isDirectory: true)
        let bundleURL = rootURL.appendingPathComponent("native/FenrirNative/.build/package/Fenrir Native.app", isDirectory: true)
        let resourcesURL = bundleURL.appendingPathComponent("Contents/Resources", isDirectory: true)
        try fileManager.createDirectory(at: serverSourceURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: resourcesURL, withIntermediateDirectories: true)
        try "{}".write(to: rootURL.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)
        try "{}".write(to: rootURL.appendingPathComponent("apps/server/package.json"), atomically: true, encoding: .utf8)
        try "".write(to: rootURL.appendingPathComponent("apps/server/src/bin.ts"), atomically: true, encoding: .utf8)
        try """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>CFBundleExecutable</key>
          <string>FenrirNativeApp</string>
          <key>CFBundleIdentifier</key>
          <string>dev.fenrir.native.tests</string>
          <key>CFBundlePackageType</key>
          <string>APPL</string>
        </dict>
        </plist>
        """.write(to: bundleURL.appendingPathComponent("Contents/Info.plist"), atomically: true, encoding: .utf8)
        defer {
            try? fileManager.removeItem(at: rootURL)
        }
        let bundle = try #require(Bundle(url: bundleURL))

        let configuration = NativeLocalServerSupervisor.localDefaultLaunchConfiguration(
            bundle: bundle,
            environment: ["FENRIR_NATIVE_BOOTSTRAP_TOKEN": "debug-bundle-bootstrap-token"],
            currentDirectoryURL: URL(fileURLWithPath: "/"),
            fileManager: fileManager
        )

        #expect(configuration.executableURL.path == "/usr/bin/env")
        #expect(configuration.arguments == [
            "bun",
            "run",
            "src/bin.ts",
            "--mode",
            "desktop",
            "--host",
            NativeLocalServerSupervisor.defaultHost,
            "--port",
            String(NativeLocalServerSupervisor.defaultPort),
            "--no-browser",
            "--auto-bootstrap-project-from-cwd",
            rootURL.path
        ])
        #expect(configuration.environment["FENRIR_DESKTOP_BOOTSTRAP_TOKEN"] == "debug-bundle-bootstrap-token")
        #expect(configuration.workingDirectoryURL?.path == rootURL.appendingPathComponent("apps/server").path)
        #expect(NativeLocalServerSupervisor.defaultWorkspaceRootURL(
            currentDirectoryURL: URL(fileURLWithPath: "/"),
            bundle: bundle,
            fileManager: fileManager
        ).path == rootURL.path)
    }

    @Test("Spawn failure maps to stable local server spawn error")
    func spawnFailureMapsToStableError() async throws {
        let launcher = RecordingProcessLauncher(launchResults: [.failure(ExampleLaunchError())])
        let supervisor = makeSupervisor(launcher: launcher)

        await #expect(throws: ServerConnection.ServerConnectionError.localServerSpawnFailed) {
            _ = try await supervisor.spawnLocalServer(spec(), restartCount: 0)
        }
    }

    @Test("Shutdown of native-owned process calls launcher")
    func shutdownNativeOwnedProcessCallsLauncher() async throws {
        let launcher = RecordingProcessLauncher(launchResults: [.success(NativeLocalServerLaunchedProcess(processID: "pid-owned"))])
        let supervisor = makeSupervisor(launcher: launcher)
        let snapshot = try await supervisor.spawnLocalServer(spec(), restartCount: 0)

        try await supervisor.shutdownLocalServer(processID: snapshot.processID)

        #expect(await launcher.terminatedProcessIDs == ["pid-owned"])
    }

    @Test("Shutdown of external or unknown process is not killed")
    func shutdownExternalProcessIsNotKilled() async throws {
        let launcher = RecordingProcessLauncher(launchResults: [])
        let supervisor = makeSupervisor(launcher: launcher)

        try await supervisor.shutdownLocalServer(processID: ServerConnection.LocalServerProcessID(rawValue: "external-pid"))

        #expect(await launcher.terminatedProcessIDs.isEmpty)
    }

    @Test("Termination decision replaces only orphaned Fenrir servers")
    func terminationDecisionReplacesOnlyOrphanedFenrirServers() {
        let orphanBundled = NativeListeningServerProcess(
            processID: 4242,
            parentProcessID: 1,
            command: "/Applications/Fenrir.app/Contents/Resources/fenrir-server --mode desktop --port 31337"
        )
        let orphanDevelopment = NativeListeningServerProcess(
            processID: 4243,
            parentProcessID: 1,
            command: "bun run src/bin.ts --mode desktop --host 127.0.0.1 --port 31337"
        )
        let liveOwned = NativeListeningServerProcess(
            processID: 4244,
            parentProcessID: 987,
            command: "/Applications/Fenrir.app/Contents/Resources/fenrir-server --mode desktop --port 31337"
        )
        let foreign = NativeListeningServerProcess(
            processID: 4245,
            parentProcessID: 1,
            command: "/usr/local/bin/nginx -g daemon off;"
        )

        #expect(NativeLocalServerSupervisor.terminationDecision(for: orphanBundled) == .terminateOrphanedServer)
        #expect(NativeLocalServerSupervisor.terminationDecision(for: orphanDevelopment) == .terminateOrphanedServer)
        #expect(NativeLocalServerSupervisor.terminationDecision(for: liveOwned) == .keepLiveOwnedServer)
        #expect(NativeLocalServerSupervisor.terminationDecision(for: foreign) == .keepForeignProcess)
    }

    @Test("Terminate replaces an orphaned Fenrir server via SIGTERM without blocking")
    func terminateReplacesOrphanedServer() async throws {
        let orphan = NativeListeningServerProcess(
            processID: 909_090,
            parentProcessID: 1,
            command: "fenrir-server --mode desktop --port 31337"
        )
        let enumerator = FakePortListenerEnumerator(responses: [[orphan], []])
        let signals = SignalRecorder()
        let supervisor = makeSupervisor(portListeners: enumerator, signals: signals)

        try await supervisor.terminateUnmanagedLocalServer(endpoint: spec().endpoint)

        #expect(signals.sent == [SignalRecord(processID: 909_090, signal: SIGTERM)])
    }

    @Test("Terminate refuses to kill a server owned by another live instance")
    func terminateRefusesLiveOwnedServer() async throws {
        let liveOwned = NativeListeningServerProcess(
            processID: 909_091,
            parentProcessID: 4321,
            command: "fenrir-server --mode desktop --port 31337"
        )
        let enumerator = FakePortListenerEnumerator(responses: [[liveOwned]])
        let signals = SignalRecorder()
        let supervisor = makeSupervisor(portListeners: enumerator, signals: signals)

        await #expect(throws: ServerConnection.ServerConnectionError.localServerForeignOwned) {
            try await supervisor.terminateUnmanagedLocalServer(endpoint: spec().endpoint)
        }
        #expect(signals.sent.isEmpty)
    }

    @Test("Terminate refuses to kill a foreign process that appears on the port at kill time")
    func terminateRefusesForeignProcessOnPort() async throws {
        let foreign = NativeListeningServerProcess(
            processID: 909_092,
            parentProcessID: 1,
            command: "python3 -m http.server 31337"
        )
        let enumerator = FakePortListenerEnumerator(responses: [[foreign]])
        let signals = SignalRecorder()
        let supervisor = makeSupervisor(portListeners: enumerator, signals: signals)

        await #expect(throws: ServerConnection.ServerConnectionError.localServerForeignOwned) {
            try await supervisor.terminateUnmanagedLocalServer(endpoint: spec().endpoint)
        }
        #expect(signals.sent.isEmpty)
    }

    @Test("Terminate is a no-op when nothing listens on the port")
    func terminateWithNoListenersIsNoOp() async throws {
        let enumerator = FakePortListenerEnumerator(responses: [[]])
        let signals = SignalRecorder()
        let supervisor = makeSupervisor(portListeners: enumerator, signals: signals)

        try await supervisor.terminateUnmanagedLocalServer(endpoint: spec().endpoint)

        #expect(signals.sent.isEmpty)
    }

    @Test("ps listener rows parse pid, ppid, and full command")
    func psListenerRowsParse() {
        let output = """
          4242     1 /Applications/Fenrir.app/Contents/Resources/fenrir-server --mode desktop
         51500 51000 bun run src/bin.ts --mode desktop --host 127.0.0.1 --port 31337
        garbage row
          9999     1 /usr/local/bin/nginx
        """

        let parsed = NativeLSOFPortListenerEnumerator.parseProcessListing(output, restrictedTo: [4242, 51500])

        #expect(parsed == [
            NativeListeningServerProcess(
                processID: 4242,
                parentProcessID: 1,
                command: "/Applications/Fenrir.app/Contents/Resources/fenrir-server --mode desktop"
            ),
            NativeListeningServerProcess(
                processID: 51500,
                parentProcessID: 51000,
                command: "bun run src/bin.ts --mode desktop --host 127.0.0.1 --port 31337"
            )
        ])
    }

    private func makeSupervisor(
        launcher: RecordingProcessLauncher = RecordingProcessLauncher(launchResults: []),
        prober: RecordingLocalServerProber = RecordingLocalServerProber(results: []),
        pollIntervalMilliseconds: Int = 1,
        portListeners: any NativeLocalServerPortListenerEnumerating = FakePortListenerEnumerator(responses: [[]]),
        signals: SignalRecorder = SignalRecorder()
    ) -> NativeLocalServerSupervisor {
        NativeLocalServerSupervisor(
            launchConfiguration: NativeLocalServerLaunchConfiguration(
                executableURL: URL(fileURLWithPath: "/usr/bin/env"),
                arguments: ["fenrir-server"],
                environment: ["FENRIR_BOOTSTRAP_TOKEN": "super-secret"],
                workingDirectoryURL: URL(fileURLWithPath: "/tmp")
            ),
            launcher: launcher,
            prober: prober,
            clock: FixedFenrirClock(timestamp: fixedTimestamp),
            pollIntervalMilliseconds: pollIntervalMilliseconds,
            portListeners: portListeners,
            signalProcess: { processID, signal in
                signals.record(processID: processID, signal: signal)
            }
        )
    }

    private func spec(expectedServerIdentity: String? = nil) -> ServerConnection.LocalServerSpec {
        ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:49152",
            webSocketURL: "ws://127.0.0.1:49152/api/native/rpc/stream",
            expectedServerIdentity: expectedServerIdentity
        )
    }
}

private let fixedTimestamp = FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_001))

private struct FixedFenrirClock: FenrirClock {
    let timestamp: FenrirTimestamp

    func now() -> FenrirTimestamp {
        timestamp
    }
}

private struct ExampleLaunchError: Error {}

private actor RecordingLocalServerProber: NativeLocalServerHTTPProbing {
    private var results: [Result<NativeLocalServerHTTPProbeResponse, Error>]
    private(set) var requests: [NativeLocalServerHTTPProbeRequest] = []

    init(results: [Result<NativeLocalServerHTTPProbeResponse, Error>]) {
        self.results = results
    }

    func probeLocalServer(_ request: NativeLocalServerHTTPProbeRequest) async throws -> NativeLocalServerHTTPProbeResponse {
        requests.append(request)
        guard !results.isEmpty else {
            throw NativeLocalServerSupervisorError.missing
        }
        return try results.removeFirst().get()
    }
}

private actor RecordingProcessLauncher: ProcessLaunching {
    private var launchResults: [Result<NativeLocalServerLaunchedProcess, Error>]
    private(set) var launchRequests: [NativeLocalServerLaunchRequest] = []
    private(set) var terminatedProcessIDs: [String] = []

    init(launchResults: [Result<NativeLocalServerLaunchedProcess, Error>]) {
        self.launchResults = launchResults
    }

    func launchLocalServer(_ request: NativeLocalServerLaunchRequest) async throws -> NativeLocalServerLaunchedProcess {
        launchRequests.append(request)
        guard !launchResults.isEmpty else {
            throw ExampleLaunchError()
        }
        return try launchResults.removeFirst().get()
    }

    func terminateLocalServer(processID: String) async throws {
        terminatedProcessIDs.append(processID)
    }
}

private struct SignalRecord: Equatable, Sendable {
    let processID: pid_t
    let signal: Int32
}

private final class SignalRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var records: [SignalRecord] = []

    var sent: [SignalRecord] {
        lock.lock()
        defer { lock.unlock() }
        return records
    }

    func record(processID: pid_t, signal: Int32) {
        lock.lock()
        defer { lock.unlock() }
        records.append(SignalRecord(processID: processID, signal: signal))
    }
}

/// Replays queued listener snapshots; the last snapshot repeats once the
/// queue is drained (mirrors a port that stays in its final state).
private final class FakePortListenerEnumerator: NativeLocalServerPortListenerEnumerating, @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [[NativeListeningServerProcess]]

    init(responses: [[NativeListeningServerProcess]]) {
        self.responses = responses
    }

    func listeningServerProcesses(port: Int) async throws -> [NativeListeningServerProcess] {
        nextResponse()
    }

    private func nextResponse() -> [NativeListeningServerProcess] {
        lock.lock()
        defer { lock.unlock() }
        guard let next = responses.first else {
            return []
        }
        if responses.count > 1 {
            responses.removeFirst()
        }
        return next
    }
}
