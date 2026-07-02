import Foundation
import FenrirNativeShared
import ServerConnection
import Testing
@testable import FenrirNativeApp

@Suite("NativeHost application bootstrap coordinator")
struct NativeHostApplicationBootstrapCoordinatorTests {
    @Test("NativeHost startup uses prepared local default before opening workspace and socket hooks")
    @MainActor
    func nativeHostStartupUsesPreparedLocalDefaultBeforeRuntimeHooks() async {
        var events: [String] = []
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            prepareLocalDefault: {
                await MainActor.run {
                    events.append("prepare")
                }
                return .success(context)
            },
            composeRuntime: { context, shouldShutdownPreparedLocalServer in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer
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

    @Test("NativeHost preparation failure is observable and falls back deterministically")
    @MainActor
    func nativeHostPreparationFailureFallsBackDeterministically() async {
        var events: [String] = []
        var logs: [String] = []
        let fallbackContext = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
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
            composeRuntime: { context, shouldShutdownPreparedLocalServer in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer
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

    @Test("NativeHost termination invokes shutdown for prepared native-managed runtime")
    @MainActor
    func nativeHostTerminationInvokesPreparedShutdown() async {
        var events: [String] = []
        var logs: [String] = []
        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: "desktop-bootstrap-token")
        let coordinator = NativeApplicationBootstrapCoordinator(
            prepareLocalDefault: {
                await MainActor.run {
                    events.append("prepare")
                }
                return .success(context)
            },
            composeRuntime: { context, shouldShutdownPreparedLocalServer in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer
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
            composeRuntime: { context, shouldShutdownPreparedLocalServer in
                events.append("compose:\(shouldShutdownPreparedLocalServer)")
                return NativeApplicationRuntime.live(
                    serverConnection: context,
                    shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer
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
