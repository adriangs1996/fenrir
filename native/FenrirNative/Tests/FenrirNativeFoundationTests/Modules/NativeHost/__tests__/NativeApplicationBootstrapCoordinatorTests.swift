import Foundation
import FenrirNativeShared
import NativeDistribution
import ServerConnection
import Settings
import Testing
import WorkspaceCoordinator
import WorkspaceIndex
@testable import FenrirNativeApp

@Suite("NativeHost application bootstrap coordinator")
struct NativeHostApplicationBootstrapCoordinatorTests {
    @Test("NativeHost startup readiness treats explicit bootstrap token as existing local server")
    func nativeHostStartupReadinessTreatsBootstrapTokenAsExistingLocalServer() {
        #expect(NativeApplicationBootstrapCoordinator.distributionStartupMode(environment: [
            "FENRIR_NATIVE_BOOTSTRAP_TOKEN": "desktop-bootstrap-token"
        ]) == .existingLocalServer)
        #expect(NativeApplicationBootstrapCoordinator.distributionStartupMode(environment: [
            "FENRIR_BOOTSTRAP_TOKEN": "  "
        ], canLaunchDevelopmentServer: false) == .localDefault)
        #expect(NativeApplicationBootstrapCoordinator.distributionStartupMode(
            environment: [:],
            canLaunchDevelopmentServer: false
        ) == .localDefault)
        #expect(NativeApplicationBootstrapCoordinator.distributionStartupMode(
            environment: [:],
            canLaunchDevelopmentServer: true
        ) == .existingLocalServer)
    }

    @Test("NativeHost startup uses prepared local default before opening workspace and socket hooks")
    @MainActor
    func nativeHostStartupUsesPreparedLocalDefaultBeforeRuntimeHooks() async {
        var events: [String] = []
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            assessDistributionReadiness: { .success(nativeHostReadyDistributionReport()) },
            prepareLocalDefault: {
                await MainActor.run {
                    events.append("prepare")
                }
                return .success(context)
            },
            resolveThemeTokens: { .resolve(.fenrirDark) },
            composeRuntime: { context, shouldShutdownPreparedLocalServer, themeTokens in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
                    themeTokens: themeTokens
                )
            },
            openInitialWorkspace: { _ in events.append("open-workspace") },
            startClientControlSocket: { _ in events.append("start-socket") },
            activateApplication: { events.append("activate") },
            logMessage: { _ in }
        )

        let snapshot = await coordinator.start()

        #expect(events == [
            "prepare",
            "compose:true",
            "open-workspace",
            "start-socket",
            "activate"
        ])
        #expect(snapshot.phase == .running(.preparedLocalDefault))
        #expect(snapshot.preparationError == nil)
    }

    @Test("NativeHost startup passes resolved theme tokens to runtime composition")
    @MainActor
    func nativeHostStartupPassesResolvedThemeTokensToRuntimeComposition() async {
        var capturedThemeID: Settings.ThemeID?
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            assessDistributionReadiness: { .success(nativeHostReadyDistributionReport()) },
            prepareLocalDefault: { .success(context) },
            resolveThemeTokens: { .resolve(.kanagawaDragon) },
            composeRuntime: { context, shouldShutdownPreparedLocalServer, themeTokens in
                capturedThemeID = themeTokens.themeID
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
                    themeTokens: themeTokens
                )
            },
            openInitialWorkspace: { _ in },
            startClientControlSocket: { _ in },
            activateApplication: {},
            logMessage: { _ in }
        )

        let snapshot = await coordinator.start()

        #expect(snapshot.phase == .running(.preparedLocalDefault))
        #expect(capturedThemeID == .kanagawaDragon)
    }

    @Test("Initial local workspace id is stable per workspace root and distinct across paths")
    @MainActor
    func initialLocalWorkspaceIDIsStablePerPath() {
        // D-002/D-012: a per-launch UUID would mint a new tmux session every
        // app run and orphan the previous one. The id must be a pure function
        // of the canonical workspace root path.
        let first = NativeApplicationRuntime.initialLocalWorkspaceID(workspaceRootPath: "/tmp/fenrir-stable-a")
        let second = NativeApplicationRuntime.initialLocalWorkspaceID(workspaceRootPath: "/tmp/fenrir-stable-a")
        let trailingSlash = NativeApplicationRuntime.initialLocalWorkspaceID(workspaceRootPath: "/tmp/fenrir-stable-a/")
        let other = NativeApplicationRuntime.initialLocalWorkspaceID(workspaceRootPath: "/tmp/fenrir-stable-b")

        #expect(first == second)
        #expect(first == trailingSlash)
        #expect(first != other)
        #expect(first.rawValue.hasPrefix("local-workspace-"))
        let suffix = first.rawValue.dropFirst("local-workspace-".count)
        #expect(suffix.count == 16)
        #expect(suffix.allSatisfy { $0.isHexDigit })

        // The default derivation (app workspace root) is stable across calls,
        // so relaunching the app reattaches the same tmux session.
        #expect(NativeApplicationRuntime.initialLocalWorkspaceID() == NativeApplicationRuntime.initialLocalWorkspaceID())
    }

    @Test("Native runtime projects the initial local workspace through the visible tmux projector")
    @MainActor
    func nativeRuntimeProjectsInitialWorkspaceThroughProjector() async {
        let projector = RecordingVisibleWorkspaceProjector()
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let runtime = NativeApplicationRuntime.live(
            serverConnection: context,
            shouldShutdownPreparedLocalServer: true,
            themeTokens: .resolve(.fenrirDark),
            visibleWorkspaceProjector: projector
        )

        runtime.openInitialWorkspace()
        let requests = await projector.waitForRequests(count: 1)
        if let workspaceID = requests.first?.workspaceID {
            _ = runtime.workspaceWindows.removeWorkspace(workspaceID: workspaceID)
        }

        #expect(requests.count == 1)
        #expect(requests.first?.requestID == "native-initial-workspace-project")
        #expect(requests.first?.workspaceID.rawValue.hasPrefix("local-workspace-") == true)
        #expect(requests.first?.identityWorkspaceID == requests.first?.workspaceID)
        #expect(requests.first?.canonicalPath == NativeLocalServerSupervisor.defaultWorkspaceRootURL().path)
        #expect(requests.first?.hasServer == false)
    }

    @Test("NativeHost preparation failure is observable and falls back deterministically")
    @MainActor
    func nativeHostPreparationFailureFallsBackDeterministically() async {
        var events: [String] = []
        var logs: [String] = []
        let fallbackContext = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            assessDistributionReadiness: { .success(nativeHostReadyDistributionReport()) },
            prepareLocalDefault: {
                await MainActor.run {
                    events.append("prepare")
                }
                return .failure(.localServerReadinessFailed)
            },
            fallbackLocalDefault: {
                events.append("fallback")
                return fallbackContext
            },
            resolveThemeTokens: { .resolve(.fenrirDark) },
            composeRuntime: { context, shouldShutdownPreparedLocalServer, themeTokens in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
                    themeTokens: themeTokens
                )
            },
            openInitialWorkspace: { _ in events.append("open-workspace") },
            startClientControlSocket: { _ in events.append("start-socket") },
            activateApplication: { events.append("activate") },
            logMessage: { message in
                logs.append(message)
            }
        )

        let snapshot = await coordinator.start()

        #expect(events == [
            "prepare",
            "fallback",
            "compose:false",
            "open-workspace",
            "start-socket",
            "activate"
        ])
        #expect(snapshot.phase == .running(.degradedLocalDefault(preparationError: .localServerReadinessFailed)))
        #expect(snapshot.preparationError == .localServerReadinessFailed)
        #expect(coordinator.runtime?.shouldShutdownPreparedLocalServer == false)
        #expect(logs.contains { $0.contains(ServerConnection.ServerConnectionError.localServerReadinessFailed.rawValue) })
    }

    @Test("NativeHost startup records distribution readiness diagnostics before preparing")
    @MainActor
    func nativeHostStartupRecordsDistributionReadinessDiagnostics() async {
        var events: [String] = []
        var logs: [String] = []
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let report = nativeHostReadyDistributionReport(
            canStart: false,
            diagnostics: [NativeDistribution.StartupDiagnostic(
                severity: .error,
                title: "tmux is required",
                message: "tmux was not found on PATH.",
                recoverySuggestion: "Install tmux 3.2 or newer."
            )]
        )
        let coordinator = NativeApplicationBootstrapCoordinator(
            assessDistributionReadiness: {
                await MainActor.run { events.append("readiness") }
                return .success(report)
            },
            prepareLocalDefault: {
                await MainActor.run { events.append("prepare") }
                return .success(context)
            },
            resolveThemeTokens: { .resolve(.fenrirDark) },
            composeRuntime: { context, shouldShutdownPreparedLocalServer, themeTokens in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
                    themeTokens: themeTokens
                )
            },
            openInitialWorkspace: { _ in events.append("open-workspace") },
            startClientControlSocket: { _ in events.append("start-socket") },
            activateApplication: { events.append("activate") },
            logMessage: { message in logs.append(message) }
        )

        let snapshot = await coordinator.start()

        #expect(events == [
            "readiness",
            "prepare",
            "compose:true",
            "open-workspace",
            "start-socket",
            "activate"
        ])
        #expect(snapshot.phase == .running(.degradedDistributionReadiness))
        #expect(snapshot.preparationError == nil)
        #expect(snapshot.distributionReadinessReport == report)
        #expect(logs.contains { $0.contains("tmux is required") && $0.contains("Install tmux") })
    }

    @Test("NativeHost termination invokes shutdown for prepared native-managed runtime")
    @MainActor
    func nativeHostTerminationInvokesPreparedShutdown() async {
        var events: [String] = []
        var logs: [String] = []
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            assessDistributionReadiness: { .success(nativeHostReadyDistributionReport()) },
            prepareLocalDefault: {
                await MainActor.run {
                    events.append("prepare")
                }
                return .success(context)
            },
            resolveThemeTokens: { .resolve(.fenrirDark) },
            composeRuntime: { context, shouldShutdownPreparedLocalServer, themeTokens in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
                    themeTokens: themeTokens
                )
            },
            openInitialWorkspace: { _ in events.append("open-workspace") },
            startClientControlSocket: { _ in events.append("start-socket") },
            activateApplication: { events.append("activate") },
            shutdownPreparedLocalServer: { shutdownContext in
                await MainActor.run {
                    events.append("shutdown:\(shutdownContext.sessionID.rawValue)")
                }
                return .failure(.localServerShutdownFailed)
            },
            logMessage: { message in
                logs.append(message)
            }
        )

        _ = await coordinator.start()
        let shutdown = await coordinator.terminate()

        #expect(events == [
            "prepare",
            "compose:true",
            "open-workspace",
            "start-socket",
            "activate",
            "shutdown:native-app-local"
        ])
        #expect(shutdown == NativeApplicationShutdownSnapshot(
            didRequestPreparedLocalServerShutdown: true,
            shutdownError: .localServerShutdownFailed
        ))
        #expect(coordinator.startupSnapshot.phase == NativeApplicationStartupPhase.terminated)
        #expect(logs.contains { $0.contains(ServerConnection.ServerConnectionError.localServerShutdownFailed.rawValue) })
    }

    @Test("NativeHost termination while preparing shuts down prepared context without opening UI")
    @MainActor
    func nativeHostTerminationWhilePreparingShutsDownPreparedContextWithoutOpeningUI() async {
        var events: [String] = []
        let gate = SuspendedNativeHostPrepareGate()
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            assessDistributionReadiness: { .success(nativeHostReadyDistributionReport()) },
            prepareLocalDefault: {
                await MainActor.run {
                    events.append("prepare-start")
                }
                await gate.markStartedAndWait()
                await MainActor.run {
                    events.append("prepare-finish")
                }
                return .success(context)
            },
            resolveThemeTokens: { .resolve(.fenrirDark) },
            composeRuntime: { context, shouldShutdownPreparedLocalServer, themeTokens in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
                    themeTokens: themeTokens
                )
            },
            openInitialWorkspace: { _ in events.append("open-workspace") },
            startClientControlSocket: { _ in events.append("start-socket") },
            activateApplication: { events.append("activate") },
            shutdownPreparedLocalServer: { shutdownContext in
                await MainActor.run {
                    events.append("shutdown:\(shutdownContext.sessionID.rawValue)")
                }
                return .failure(.localServerShutdownFailed)
            },
            logMessage: { _ in }
        )

        let startupTask = coordinator.startTask()
        await gate.waitUntilStarted()

        let terminationTask = Task { @MainActor in
            await coordinator.terminate(waitingFor: startupTask)
        }
        while !coordinator.terminationRequested {
            await Task.yield()
        }
        await gate.release()

        let startup = await startupTask.value
        let shutdown = await terminationTask.value

        #expect(events == [
            "prepare-start",
            "prepare-finish",
            "shutdown:native-app-local"
        ])
        #expect(startup.phase == NativeApplicationStartupPhase.terminated)
        #expect(coordinator.runtime == nil)
        #expect(shutdown == NativeApplicationShutdownSnapshot(
            didRequestPreparedLocalServerShutdown: true,
            shutdownError: .localServerShutdownFailed
        ))
    }
}

private actor RecordingVisibleWorkspaceProjector: NativeVisibleWorkspaceProjecting {
    struct ProjectionRequest: Equatable, Sendable {
        let requestID: RequestID
        let workspaceID: WorkspaceID
        let identityWorkspaceID: WorkspaceID?
        let canonicalPath: String?
        let hasServer: Bool
    }

    private var requests: [ProjectionRequest] = []

    func projectWorkspace(
        requestID: RequestID,
        workspaceID: WorkspaceID,
        identity: WorkspaceIndex.WorkspaceIdentity?,
        server: ServerConnection.Endpoint?
    ) async -> Result<WorkspaceIndex.WorkspaceSummary, WorkspaceCoordinator.WorkspaceCoordinatorError> {
        requests.append(ProjectionRequest(
            requestID: requestID,
            workspaceID: workspaceID,
            identityWorkspaceID: identity?.workspaceID,
            canonicalPath: identity?.canonicalPath,
            hasServer: server != nil
        ))
        return .success(WorkspaceIndex.WorkspaceSummary(
            workspaceID: workspaceID,
            displayName: workspaceID.rawValue,
            canonicalPath: identity?.canonicalPath,
            identity: identity,
            isOpenLocally: true,
            openState: WorkspaceIndex.WorkspaceOpenState(
                isOpenLocally: true,
                windowIDs: [FenrirWindowID(rawValue: "native-window-\(workspaceID.rawValue)")]
            ),
            status: .open
        ))
    }

    func waitForRequests(count: Int) async -> [ProjectionRequest] {
        for _ in 0..<100 {
            if requests.count >= count {
                return requests
            }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return requests
    }
}

private func nativeHostReadyDistributionReport(
    canStart: Bool = true,
    diagnostics: [NativeDistribution.StartupDiagnostic] = []
) -> NativeDistribution.StartupReadinessReport {
    NativeDistribution.StartupReadinessReport(
        mode: .localDefault,
        canStart: canStart,
        checks: [],
        diagnostics: diagnostics,
        generatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_002))
    )
}

private actor SuspendedNativeHostPrepareGate {
    private var started = false
    private var startedContinuations: [CheckedContinuation<Void, Never>] = []
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func markStartedAndWait() async {
        started = true
        for continuation in startedContinuations {
            continuation.resume()
        }
        startedContinuations.removeAll()
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
    }

    func waitUntilStarted() async {
        guard !started else {
            return
        }
        await withCheckedContinuation { continuation in
            startedContinuations.append(continuation)
        }
    }

    func release() {
        releaseContinuation?.resume()
        releaseContinuation = nil
    }
}
