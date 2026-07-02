import Foundation
import FenrirNativeShared
import ServerConnection
import Testing
@testable import FenrirNativeApp

@Suite("NativeHost app server connection bootstrap")
struct NativeHostAppServerConnectionBootstrapTests {
    @Test("NativeHost prepared local default attaches to healthy local server and saves supervisor state")
    func nativeHostPreparedLocalDefaultAttachesHealthyServer() async throws {
        let prober = BootstrapLocalServerProber(results: [
            .success(.healthy),
            .success(.healthy)
        ])
        let launcher = BootstrapProcessLauncher(launchResults: [])
        let context = try await NativeAppServerConnectionContext.preparedLocalDefault(
            spec: spec(),
            supervisor: supervisor(launcher: launcher, prober: prober),
            bootstrapCredential: "desktop-bootstrap-token",
            requestID: "prepare-attach"
        ).get()

        let state = try await context.store.loadLocalServerSupervisorState()
        let session = try await context.store.loadSession(sessionID: context.sessionID)
        #expect(session?.endpoint == spec().endpoint)
        #expect(state?.endpoint == spec().endpoint)
        #expect(state?.ownership == .external)
        #expect(state?.status == .ready)
        #expect(await launcher.launchRequests.isEmpty)
        #expect(await prober.requests.map(\.url.path) == [
            NativeLocalServerSupervisor.defaultProbePath,
            NativeLocalServerSupervisor.defaultProbePath
        ])
    }

    @Test("NativeHost prepared local default spawns through native fakes and saves native-managed state")
    func nativeHostPreparedLocalDefaultSpawnsMissingServer() async throws {
        let prober = BootstrapLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing),
            .success(.healthy)
        ])
        let launcher = BootstrapProcessLauncher(launchResults: [
            .success(NativeLocalServerLaunchedProcess(processID: "native-pid"))
        ])
        let context = try await NativeAppServerConnectionContext.preparedLocalDefault(
            spec: spec(),
            supervisor: supervisor(launcher: launcher, prober: prober),
            bootstrapCredential: "desktop-bootstrap-token",
            requestID: "prepare-spawn"
        ).get()

        let state = try await context.store.loadLocalServerSupervisorState()
        let launchRequests = await launcher.launchRequests
        #expect(launchRequests.count == 1)
        #expect(launchRequests[0].endpoint == spec().endpoint)
        #expect(launchRequests[0].configuration.environment.isEmpty)
        #expect(state?.ownership == .nativeManaged)
        #expect(state?.status == .ready)
        #expect(state?.process?.processID.rawValue == "native-pid")
    }

    @Test("NativeHost prepared local default retains native owner for shutdown")
    func nativeHostPreparedLocalDefaultRetainsNativeOwnerForShutdown() async throws {
        let prober = BootstrapLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing),
            .success(.healthy)
        ])
        let launcher = BootstrapProcessLauncher(launchResults: [
            .success(NativeLocalServerLaunchedProcess(processID: "native-pid"))
        ])
        let context = try await NativeAppServerConnectionContext.preparedLocalDefault(
            spec: spec(),
            supervisor: supervisor(launcher: launcher, prober: prober),
            bootstrapCredential: "desktop-bootstrap-token",
            requestID: "prepare-spawn-shutdown"
        ).get()

        let shutdown = try await context.shutdownPreparedLocalServer(requestID: "shutdown-spawned").get()
        let state = try await context.store.loadLocalServerSupervisorState()

        #expect(shutdown.didShutdownProcess)
        #expect(shutdown.supervisorState?.status == .stopped)
        #expect(state?.status == .stopped)
        #expect(await launcher.terminatedProcessIDs == ["native-pid"])
    }

    @Test("NativeHost prepared local default readiness failure returns ServerConnection error")
    func nativeHostPreparedLocalDefaultReadinessFailureReturnsError() async {
        let prober = BootstrapLocalServerProber(results: [
            .failure(NativeLocalServerSupervisorError.missing),
            .failure(NativeLocalServerSupervisorError.missing),
            .failure(NativeLocalServerSupervisorError.missing)
        ])
        let launcher = BootstrapProcessLauncher(launchResults: [
            .success(NativeLocalServerLaunchedProcess(processID: "native-pid"))
        ])
        let result = await NativeAppServerConnectionContext.preparedLocalDefault(
            spec: spec(readinessTimeoutMilliseconds: 1),
            supervisor: supervisor(launcher: launcher, prober: prober),
            bootstrapCredential: "desktop-bootstrap-token",
            restartPolicy: ServerConnection.LocalServerRestartPolicy(maxCrashRestarts: 0),
            requestID: "prepare-failure"
        )

        guard case .failure(.localServerReadinessFailed) = result else {
            Issue.record("Expected localServerReadinessFailed, got \(result)")
            return
        }
        #expect(await launcher.launchRequests.count == 1)
    }

    @Test("NativeHost synchronous local default remains compatible")
    func nativeHostSynchronousLocalDefaultRemainsCompatible() async throws {
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let session = try await context.store.loadSession(sessionID: context.sessionID)
        let state = try await context.store.loadLocalServerSupervisorState()

        #expect(context.sessionID.rawValue == "native-app-local")
        #expect(session?.status == .connected)
        #expect(session?.endpoint.httpBaseURL == "http://127.0.0.1:31337")
        #expect(session?.endpoint.transport == .webSocketURL("ws://127.0.0.1:31337/ws"))
        #expect(state == nil)
    }

    private func supervisor(
        launcher: BootstrapProcessLauncher,
        prober: BootstrapLocalServerProber
    ) -> NativeLocalServerSupervisor {
        NativeLocalServerSupervisor(
            launchConfiguration: NativeLocalServerLaunchConfiguration(
                executableURL: URL(fileURLWithPath: "/app/fenrir-server")
            ),
            launcher: launcher,
            prober: prober,
            clock: BootstrapFenrirClock(),
            pollIntervalMilliseconds: 1
        )
    }

    private func spec(readinessTimeoutMilliseconds: Int = 1_000) -> ServerConnection.LocalServerSpec {
        ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:31337",
            webSocketURL: "ws://127.0.0.1:31337/ws",
            readinessTimeoutMilliseconds: readinessTimeoutMilliseconds
        )
    }
}

private extension NativeLocalServerHTTPProbeResponse {
    static var healthy: NativeLocalServerHTTPProbeResponse {
        NativeLocalServerHTTPProbeResponse(statusCode: 204, headers: [:], body: Data())
    }
}

private struct BootstrapFenrirClock: FenrirClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_002))
    }
}

private struct BootstrapLaunchError: Error {}

private actor BootstrapLocalServerProber: NativeLocalServerHTTPProbing {
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

private actor BootstrapProcessLauncher: ProcessLaunching {
    private var launchResults: [Result<NativeLocalServerLaunchedProcess, Error>]
    private(set) var launchRequests: [NativeLocalServerLaunchRequest] = []
    private(set) var terminatedProcessIDs: [String] = []

    init(launchResults: [Result<NativeLocalServerLaunchedProcess, Error>]) {
        self.launchResults = launchResults
    }

    func launchLocalServer(_ request: NativeLocalServerLaunchRequest) async throws -> NativeLocalServerLaunchedProcess {
        launchRequests.append(request)
        guard !launchResults.isEmpty else {
            throw BootstrapLaunchError()
        }
        return try launchResults.removeFirst().get()
    }

    func terminateLocalServer(processID: String) async throws {
        terminatedProcessIDs.append(processID)
    }
}
