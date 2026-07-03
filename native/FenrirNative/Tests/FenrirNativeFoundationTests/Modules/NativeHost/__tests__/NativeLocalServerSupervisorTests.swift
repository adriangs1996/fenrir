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

    private func makeSupervisor(
        launcher: RecordingProcessLauncher = RecordingProcessLauncher(launchResults: []),
        prober: RecordingLocalServerProber = RecordingLocalServerProber(results: []),
        pollIntervalMilliseconds: Int = 1
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
            pollIntervalMilliseconds: pollIntervalMilliseconds
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
