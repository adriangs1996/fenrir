import Foundation
import Testing
import FenrirNativeShared
import AuthSession
@testable import ServerConnection

@Suite("ServerConnection actions")
struct ServerConnectionTests {
    @Test("ResolveServerEndpoint preserves local and remote endpoint identity")
    func resolveEndpointPreservesIdentity() async throws {
        let local = localEndpoint()
        let remote = remoteEndpoint()
        let resolver = EndpointResolver(endpoints: [
            "local": local,
            "remote": remote
        ])
        let events = ServerEvents()
        let action = ServerConnection.ResolveServerEndpoint(
            resolver: resolver,
            clock: FixedClock(),
            events: events
        )

        let localResult = try await action.run(
            ServerConnection.ResolveServerEndpointInput(
                requestID: "resolve-local",
                launchIntent: .endpoint(local)
            )
        ).get()
        let remoteResult = try await action.run(
            ServerConnection.ResolveServerEndpointInput(
                requestID: "resolve-remote",
                launchIntent: .profile("remote-profile")
            )
        ).get()

        #expect(localResult.endpoint.kind == .local)
        #expect(localResult.endpoint.endpointID == "local-main")
        #expect(localResult.endpoint.authEndpointScope == AuthSession.EndpointScope(endpointID: "local-main"))
        #expect(remoteResult.endpoint.kind == .remote)
        #expect(remoteResult.endpoint.endpointID == "remote-main")
        #expect(remoteResult.endpoint.authEndpointScope == AuthSession.EndpointScope(endpointID: "remote-main", profileID: "remote-profile"))
        #expect(await events.count(kind: "ServerEndpointResolved") == 2)
    }

    @Test("OpenServerSession maps rejected auth to stable auth error")
    func openMapsAuthFailure() async {
        let action = ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .failure(AuthSession.AuthSessionError.bearerSessionRejected)),
            transport: TransportOpener(),
            store: ConnectionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: remoteEndpoint()
            )
        )

        #expect(result == .failure(.authRejected))
    }

    @Test("OpenServerSession rejects actor endpoint mismatches before transport open")
    func openRejectsActorEndpointMismatch() async {
        let transport = TransportOpener()
        let action = ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .success(authContext(endpointScope: localEndpoint().authEndpointScope))),
            transport: transport,
            store: ConnectionStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: remoteEndpoint()
            )
        )

        #expect(result == .failure(.authRejected))
        #expect(await transport.openCount() == 0)
    }

    @Test("OpenServerSession treats duplicate connects as idempotent")
    func openDuplicateConnectIsIdempotent() async throws {
        let endpoint = remoteEndpoint()
        let transport = TransportOpener()
        let action = ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope))),
            transport: transport,
            store: ConnectionStore(),
            clock: FixedClock()
        )

        let first = try await action.run(
            ServerConnection.OpenServerSessionInput(requestID: "open-1", endpoint: endpoint)
        ).get().session
        let second = try await action.run(
            ServerConnection.OpenServerSessionInput(requestID: "open-2", endpoint: endpoint)
        ).get().session

        #expect(first.sessionID == second.sessionID)
        #expect(await transport.openCount() == 1)
    }

    @Test("PrepareLocalServerConnection attaches to already-running default local server")
    func prepareLocalDefaultAttachesAlreadyRunningServer() async throws {
        let endpoint = localWebSocketEndpoint()
        let discovery = LocalDiscovery(discovery: .init(status: .found, endpoint: endpoint))
        let spawner = LocalSpawner()
        let readiness = LocalReadiness()
        let store = LocalSupervisorStore()

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: discovery,
            spawner: spawner,
            readiness: readiness,
            processManager: LocalProcessManager(),
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "prepare",
                mode: .localDefault(localServerSpec())
            )
        ).get()

        #expect(result.endpoint == endpoint)
        #expect(result.supervisorState.ownership == .external)
        #expect(result.supervisorState.status == .ready)
        #expect(await discovery.count() == 1)
        #expect(await spawner.spawnCount() == 0)
        #expect(await readiness.candidates() == [.existing(endpoint)])
    }

    @Test("PrepareLocalServerConnection replaces inherited server when attach policy demands it")
    func prepareLocalDefaultReplacesInheritedServer() async throws {
        let inheritedEndpoint = localWebSocketEndpoint()
        let discovery = LocalDiscovery(discovery: .init(status: .found, endpoint: inheritedEndpoint))
        let spawner = LocalSpawner()
        let readiness = LocalReadiness()
        let terminator = LocalForeignTerminator()
        let store = LocalSupervisorStore()

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: discovery,
            spawner: spawner,
            readiness: readiness,
            processManager: LocalProcessManager(),
            foreignTerminator: terminator,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "prepare",
                mode: .localDefault(localServerSpec()),
                attachPolicy: .replaceExisting
            )
        ).get()

        #expect(await terminator.terminatedEndpoints() == [inheritedEndpoint])
        #expect(result.supervisorState.ownership == .nativeManaged)
        #expect(await spawner.spawnCount() == 1)
        #expect(await readiness.candidates().count == 1)
    }

    @Test("PrepareLocalServerConnection fails fast when replacement is required but no terminator is wired")
    func prepareLocalDefaultFailsFastWithoutTerminatorForReplacement() async {
        let inheritedEndpoint = localWebSocketEndpoint()
        let discovery = LocalDiscovery(discovery: .init(status: .found, endpoint: inheritedEndpoint))
        let spawner = LocalSpawner()
        let readiness = LocalReadiness()

        // Degrading to attach would recreate the permanent-401 (an inherited
        // server can never authenticate this process's generated bootstrap
        // credential), so preparation must fail with the distinct error.
        let result = await ServerConnection.PrepareLocalServerConnection(
            discovery: discovery,
            spawner: spawner,
            readiness: readiness,
            processManager: LocalProcessManager(),
            stateStore: LocalSupervisorStore(),
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "prepare",
                mode: .localDefault(localServerSpec()),
                attachPolicy: .replaceExisting
            )
        )

        #expect(result == .failure(.localServerReplacementUnavailable))
        // Neither attach nor spawn may have happened.
        #expect(await spawner.spawnCount() == 0)
        #expect(await readiness.candidates().isEmpty)
    }

    @Test("PrepareLocalServerConnection reports failed local spawn")
    func prepareLocalDefaultReportsFailedSpawn() async {
        let discovery = LocalDiscovery(discovery: .init(status: .missing))
        let spawner = LocalSpawner(spawnError: ServerConnection.ServerConnectionError.localServerSpawnFailed)
        let readiness = LocalReadiness()

        let result = await ServerConnection.PrepareLocalServerConnection(
            discovery: discovery,
            spawner: spawner,
            readiness: readiness,
            processManager: LocalProcessManager(),
            stateStore: LocalSupervisorStore(),
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "prepare",
                mode: .localDefault(localServerSpec())
            )
        )

        #expect(result == .failure(.localServerSpawnFailed))
        #expect(await spawner.spawnCount() == 1)
        #expect(await readiness.candidates().isEmpty)
    }

    @Test("PrepareLocalServerConnection restarts spawned server after crash during readiness")
    func prepareLocalDefaultRestartsAfterCrashDuringConnect() async throws {
        let discovery = LocalDiscovery(discovery: .init(status: .missing))
        let spawner = LocalSpawner()
        let readiness = LocalReadiness(failures: [.localServerCrashed])
        let store = LocalSupervisorStore()

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: discovery,
            spawner: spawner,
            readiness: readiness,
            processManager: LocalProcessManager(),
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "prepare",
                mode: .localDefault(localServerSpec()),
                restartPolicy: ServerConnection.LocalServerRestartPolicy(maxCrashRestarts: 1)
            )
        ).get()

        #expect(result.supervisorState.ownership == .nativeManaged)
        #expect(result.supervisorState.restartCount == 1)
        #expect(result.supervisorState.process?.processID == "local-process-1")
        #expect(await spawner.spawnCount() == 2)
        #expect(await readiness.candidates().count == 2)
    }

    @Test("PrepareLocalServerConnection remote mode never discovers or spawns local server")
    func prepareRemoteModeDoesNotSpawnLocalServer() async throws {
        let discovery = LocalDiscovery(discovery: .init(status: .found, endpoint: localWebSocketEndpoint()))
        let spawner = LocalSpawner()
        let readiness = LocalReadiness()
        let remote = remoteEndpoint()

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: discovery,
            spawner: spawner,
            readiness: readiness,
            processManager: LocalProcessManager(),
            stateStore: LocalSupervisorStore(),
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "prepare",
                mode: .remote(remote)
            )
        ).get()

        #expect(result.endpoint == remote)
        #expect(result.supervisorState.ownership == .remote)
        #expect(result.supervisorState.status == .remote)
        #expect(await discovery.count() == 0)
        #expect(await spawner.spawnCount() == 0)
        #expect(await readiness.candidates().isEmpty)
    }

    @Test("PrepareLocalServerConnection remote mode shuts down prior native-owned local process")
    func prepareRemoteModeShutsDownPriorNativeOwnedLocalProcess() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let process = ServerConnection.LocalServerProcessSnapshot(
            processID: "local-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: process.endpoint,
            process: process,
            updatedAt: FixedClock().timestamp
        ))

        let remote = remoteEndpoint()
        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: LocalDiscovery(discovery: .init(status: .missing)),
            spawner: LocalSpawner(),
            readiness: LocalReadiness(),
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "remote",
                mode: .remote(remote)
            )
        ).get()

        let persisted = try await store.loadLocalServerSupervisorState()
        #expect(result.endpoint == remote)
        #expect(result.supervisorState.ownership == .remote)
        #expect(persisted?.ownership == .remote)
        #expect(await processManager.shutdowns() == ["local-process"])
    }

    @Test("PrepareLocalServerConnection existing local mode shuts down prior native-owned local process")
    func prepareExistingLocalModeShutsDownPriorNativeOwnedLocalProcess() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let priorProcess = ServerConnection.LocalServerProcessSnapshot(
            processID: "prior-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: priorProcess.endpoint,
            process: priorProcess,
            updatedAt: FixedClock().timestamp
        ))

        let externalEndpoint = alternateLocalWebSocketEndpoint()
        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: LocalDiscovery(discovery: .init(status: .found, endpoint: externalEndpoint)),
            spawner: LocalSpawner(),
            readiness: LocalReadiness(),
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "existing",
                mode: .existingLocal(localServerSpec())
            )
        ).get()

        let persisted = try await store.loadLocalServerSupervisorState()
        #expect(result.supervisorState.ownership == .external)
        #expect(persisted?.ownership == .external)
        #expect(await processManager.shutdowns() == ["prior-process"])
    }

    @Test("PrepareLocalServerConnection existing local mode preserves ownership for same native-owned endpoint")
    func prepareExistingLocalModePreservesSameNativeOwnedEndpoint() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let priorProcess = ServerConnection.LocalServerProcessSnapshot(
            processID: "prior-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: priorProcess.endpoint,
            process: priorProcess,
            updatedAt: FixedClock().timestamp
        ))

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: LocalDiscovery(discovery: .init(status: .found, endpoint: priorProcess.endpoint)),
            spawner: LocalSpawner(),
            readiness: LocalReadiness(),
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "existing-same",
                mode: .existingLocal(localServerSpec())
            )
        ).get()

        let persisted = try await store.loadLocalServerSupervisorState()
        #expect(result.supervisorState.ownership == .nativeManaged)
        #expect(result.supervisorState.process?.processID == "prior-process")
        #expect(persisted?.ownership == .nativeManaged)
        #expect(await processManager.shutdowns().isEmpty)
    }

    @Test("PrepareLocalServerConnection local default attach shuts down prior native-owned local process")
    func prepareLocalDefaultAttachShutsDownPriorNativeOwnedLocalProcess() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let priorProcess = ServerConnection.LocalServerProcessSnapshot(
            processID: "prior-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: priorProcess.endpoint,
            process: priorProcess,
            updatedAt: FixedClock().timestamp
        ))

        let externalEndpoint = alternateLocalWebSocketEndpoint()
        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: LocalDiscovery(discovery: .init(status: .found, endpoint: externalEndpoint)),
            spawner: LocalSpawner(),
            readiness: LocalReadiness(),
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "default-attach",
                mode: .localDefault(localServerSpec())
            )
        ).get()

        let persisted = try await store.loadLocalServerSupervisorState()
        #expect(result.supervisorState.ownership == .external)
        #expect(persisted?.ownership == .external)
        #expect(await processManager.shutdowns() == ["prior-process"])
    }

    @Test("PrepareLocalServerConnection local default attach preserves ownership for same native-owned endpoint")
    func prepareLocalDefaultAttachPreservesSameNativeOwnedEndpoint() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let priorProcess = ServerConnection.LocalServerProcessSnapshot(
            processID: "prior-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: priorProcess.endpoint,
            process: priorProcess,
            updatedAt: FixedClock().timestamp
        ))

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: LocalDiscovery(discovery: .init(status: .found, endpoint: priorProcess.endpoint)),
            spawner: LocalSpawner(),
            readiness: LocalReadiness(),
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "default-attach-same",
                mode: .localDefault(localServerSpec())
            )
        ).get()

        let persisted = try await store.loadLocalServerSupervisorState()
        #expect(result.supervisorState.ownership == .nativeManaged)
        #expect(result.supervisorState.process?.processID == "prior-process")
        #expect(persisted?.ownership == .nativeManaged)
        #expect(await processManager.shutdowns().isEmpty)
    }

    @Test("PrepareLocalServerConnection local default spawn shuts down prior native-owned local process")
    func prepareLocalDefaultSpawnShutsDownPriorNativeOwnedLocalProcess() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let priorProcess = ServerConnection.LocalServerProcessSnapshot(
            processID: "prior-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: priorProcess.endpoint,
            process: priorProcess,
            updatedAt: FixedClock().timestamp
        ))

        let result = try await ServerConnection.PrepareLocalServerConnection(
            discovery: LocalDiscovery(discovery: .init(status: .missing)),
            spawner: LocalSpawner(),
            readiness: LocalReadiness(),
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        ).run(
            ServerConnection.PrepareLocalServerConnectionInput(
                requestID: "spawn",
                mode: .localDefault(localServerSpec())
            )
        ).get()

        let persisted = try await store.loadLocalServerSupervisorState()
        #expect(result.supervisorState.ownership == .nativeManaged)
        #expect(result.supervisorState.process?.processID == "local-process-0")
        #expect(persisted?.process?.processID == "local-process-0")
        #expect(await processManager.shutdowns() == ["prior-process"])
    }

    @Test("ShutdownLocalServer only stops native-owned local processes")
    func shutdownLocalServerOnlyStopsNativeOwnedProcess() async throws {
        let store = LocalSupervisorStore()
        let processManager = LocalProcessManager()
        let externalState = ServerConnection.LocalServerSupervisorState(
            mode: .existingLocal(localServerSpec()),
            status: .ready,
            ownership: .external,
            endpoint: localWebSocketEndpoint(),
            updatedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(externalState)

        let shutdown = ServerConnection.ShutdownLocalServer(
            processManager: processManager,
            stateStore: store,
            clock: FixedClock()
        )
        let external = try await shutdown.run(
            ServerConnection.ShutdownLocalServerInput(requestID: "shutdown-external")
        ).get()

        let process = ServerConnection.LocalServerProcessSnapshot(
            processID: "local-process",
            endpoint: localWebSocketEndpoint(),
            startedAt: FixedClock().timestamp
        )
        try await store.saveLocalServerSupervisorState(ServerConnection.LocalServerSupervisorState(
            mode: .localDefault(localServerSpec()),
            status: .ready,
            ownership: .nativeManaged,
            endpoint: process.endpoint,
            process: process,
            updatedAt: FixedClock().timestamp
        ))
        let native = try await shutdown.run(
            ServerConnection.ShutdownLocalServerInput(requestID: "shutdown-native")
        ).get()

        #expect(!external.didShutdownProcess)
        #expect(native.didShutdownProcess)
        #expect(native.supervisorState?.status == .stopped)
        #expect(await processManager.shutdowns() == ["local-process"])
    }

    @Test("Reconnect increments generation and resubscribes active streams deterministically")
    func reconnectResubscribesStreams() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let streams = StreamOpener()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let open = ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        )
        let session = try await open.run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        let openStream = ServerConnection.OpenServerStream(
            streams: streams,
            store: store,
            clock: FixedClock()
        )
        _ = try await openStream.run(
            ServerConnection.OpenServerStreamInput(
                requestID: "stream",
                sessionID: session.sessionID,
                streamID: "pane-stream",
                method: "tmux.pane.subscribe",
                payload: "{}"
            )
        ).get()

        let reconnect = ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: streams,
            store: store,
            clock: FixedClock()
        )
        let result = try await reconnect.run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID
            )
        ).get()

        #expect(result.session.reconnectGeneration == 1)
        #expect(result.resubscribedStreams.map(\.streamID) == ["pane-stream"])
        #expect(result.resubscribedStreams.first?.openedGeneration == 1)
        #expect(await streams.openedGenerations(for: "pane-stream") == [0, 1])
    }

    @Test("Reconnect retries transport open up to policy max attempts")
    func reconnectRetriesTransportOpen() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        await transport.failNextOpenAttempts(2)

        let result = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(maxAttempts: 3)
            )
        ).get()

        #expect(result.session.reconnectGeneration == 1)
        #expect(await transport.openCount() == 4)
    }

    @Test("Reconnect applies exponential backoff between failed attempts")
    func reconnectAppliesExponentialBackoff() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let delay = RecordingReconnectDelay()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        await transport.failNextOpenAttempts(3)

        _ = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock(),
            reconnectDelay: delay
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(
                    maxAttempts: 4,
                    backoff: ServerConnection.ReconnectBackoff(
                        initialDelayMilliseconds: 100,
                        maxDelayMilliseconds: 250,
                        multiplier: 2
                    )
                )
            )
        ).get()

        #expect(await delay.delays() == [100, 200, 250])
    }

    @Test("Reconnect failure during stream resubscribe leaves persisted state unchanged")
    func reconnectResubscribeFailureDoesNotPartiallyCommit() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let streams = StreamOpener(failingStreamID: "pane-stream")
        let events = ServerEvents()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        try await store.saveStream(
            ServerConnection.StreamHandle(
                streamID: "pane-stream",
                method: "tmux.pane.subscribe",
                payload: "{}",
                status: .open,
                openedGeneration: 0
            ),
            sessionID: session.sessionID
        )

        let result = await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: streams,
            store: store,
            clock: FixedClock(),
            events: events
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID
            )
        )

        let persistedSession = try await store.loadSession(sessionID: session.sessionID)
        let persistedStreams = try await store.loadStreams(sessionID: session.sessionID)
        #expect(result == .failure(.sessionReconnectFailed))
        #expect(persistedSession?.reconnectGeneration == 0)
        #expect(persistedSession?.status == .connected)
        #expect(persistedStreams.first?.status == .open)
        #expect(persistedStreams.first?.openedGeneration == 0)
        #expect(await events.count(kind: "ServerStreamResubscribed") == 0)
        #expect(await events.count(kind: "ServerSessionReconnected") == 0)
    }

    @Test("Reconnect commit failure leaves persisted state unchanged and publishes no success events")
    func reconnectCommitFailureDoesNotPartiallyCommit() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let streams = StreamOpener()
        let events = ServerEvents()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        try await store.saveStream(
            ServerConnection.StreamHandle(
                streamID: "pane-stream",
                method: "tmux.pane.subscribe",
                payload: "{}",
                status: .open,
                openedGeneration: 0
            ),
            sessionID: session.sessionID
        )
        await store.failNextReconnectCommit()

        let result = await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: streams,
            store: store,
            clock: FixedClock(),
            events: events
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID
            )
        )

        let persistedSession = try await store.loadSession(sessionID: session.sessionID)
        let persistedStreams = try await store.loadStreams(sessionID: session.sessionID)
        #expect(result == .failure(.sessionReconnectFailed))
        #expect(persistedSession?.reconnectGeneration == 0)
        #expect(persistedStreams.first?.status == .open)
        #expect(persistedStreams.first?.openedGeneration == 0)
        #expect(await events.count(kind: "ServerStreamResubscribed") == 0)
        #expect(await events.count(kind: "ServerSessionReconnected") == 0)
    }

    @Test("Reconnect does not commit if disconnect wins the race")
    func reconnectDoesNotCommitAfterDisconnectRace() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let gate = OpenGate()
        let transport = BlockingReconnectTransport(gate: gate)
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        let reconnect = ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        )
        let task = Task {
            await reconnect.run(
                ServerConnection.ReconnectServerSessionInput(requestID: "reconnect", sessionID: session.sessionID)
            )
        }

        await gate.waitForStarted()
        _ = try await ServerConnection.CloseServerSession(
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.CloseServerSessionInput(requestID: "close", sessionID: session.sessionID)
        ).get()
        await gate.resume()

        let result = await task.value
        #expect(result == .failure(.invalidStateTransition))
        #expect(try await store.loadSession(sessionID: session.sessionID) == nil)
    }

    @Test("Reconnect rejects stale old-socket close while replacement transport opens")
    func reconnectRejectsStaleCloseDuringOpen() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let gate = OpenGate()
        let transport = BlockingReconnectTransport(gate: gate)
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        let task = Task {
            await ServerConnection.ReconnectServerSession(
                authProvider: auth,
                transport: transport,
                streams: StreamOpener(),
                store: store,
                clock: FixedClock()
            ).run(
                ServerConnection.ReconnectServerSessionInput(requestID: "reconnect", sessionID: session.sessionID)
            )
        }

        await gate.waitForStarted()
        let staleClose = await ServerConnection.HandleServerTransportClose(
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.HandleServerTransportCloseInput(
                requestID: "old-close",
                sessionID: session.sessionID,
                generation: 0,
                closeCode: .normal
            )
        )
        await gate.resume()

        let result = try await task.value.get()
        #expect(staleClose == .failure(.staleMessage))
        #expect(result.session.status == .connected)
        #expect(result.session.reconnectGeneration == 1)
    }

    @Test("Reconnect can refresh auth before transport open")
    func reconnectRefreshesAuthWhenPolicyRequiresIt() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let auth = RefreshingAuthProvider(
            initial: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "initial-auth"),
            refreshed: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "refreshed-auth")
        )
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        let result = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(refreshAuthBeforeReconnect: true)
            )
        ).get()

        #expect(result.session.authSessionID == "refreshed-auth")
        #expect(await auth.refreshCount() == 1)
    }

    @Test("Reconnect auth refresh failure restores previous session generation")
    func reconnectAuthRefreshFailureRestoresPreviousSession() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let auth = FailingRefreshAuthProvider(
            initial: authContext(endpointScope: endpoint.authEndpointScope),
            refreshError: ServerConnection.ServerConnectionError.authUnavailable
        )
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        let result = await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: TransportOpener(),
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(refreshAuthBeforeReconnect: true)
            )
        )

        let persisted = try await store.loadSession(sessionID: session.sessionID)
        #expect(result == .failure(.authUnavailable))
        #expect(persisted?.status == .connected)
        #expect(persisted?.reconnectGeneration == 0)
    }

    @Test("Reconnect auth endpoint mismatch restores previous session generation")
    func reconnectAuthEndpointMismatchRestoresPreviousSession() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let auth = RefreshingAuthProvider(
            initial: authContext(endpointScope: endpoint.authEndpointScope),
            refreshed: authContext(endpointScope: localEndpoint().authEndpointScope)
        )
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        let result = await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: TransportOpener(),
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(
                requestID: "reconnect",
                sessionID: session.sessionID,
                policy: ServerConnection.ReconnectPolicy(refreshAuthBeforeReconnect: true)
            )
        )

        let persisted = try await store.loadSession(sessionID: session.sessionID)
        #expect(result == .failure(.authRejected))
        #expect(persisted?.status == .connected)
        #expect(persisted?.reconnectGeneration == 0)
    }

    @Test("RefreshServerSession refreshes auth and advances generation")
    func refreshServerSessionRefreshesAuth() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "session")
        let auth = RefreshingAuthProvider(
            initial: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "initial-auth"),
            refreshed: authContext(endpointScope: endpoint.authEndpointScope, authSessionID: "refreshed-auth")
        )
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        let result = try await ServerConnection.RefreshServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.RefreshServerSessionInput(
                requestID: "refresh",
                sessionID: session.sessionID
            )
        ).get()

        #expect(result.session.authSessionID == "refreshed-auth")
        #expect(result.session.reconnectGeneration == 1)
        #expect(await auth.refreshCount() == 1)
    }

    @Test("Heartbeat rejects stale generations and accepts current generation")
    func heartbeatRejectsStaleGeneration() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let session = try await ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope))),
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        let action = ServerConnection.RecordServerHeartbeat(store: store, clock: FixedClock())
        let current = try await action.run(
            ServerConnection.RecordServerHeartbeatInput(
                requestID: "heartbeat-current",
                sessionID: session.sessionID,
                generation: 0
            )
        ).get()
        let stale = await action.run(
            ServerConnection.RecordServerHeartbeatInput(
                requestID: "heartbeat-stale",
                sessionID: session.sessionID,
                generation: 9
            )
        )

        #expect(current.session.lastHeartbeatAt == FixedClock().timestamp)
        #expect(stale == .failure(.staleMessage))
    }

    @Test("Transport close codes update connection state explicitly")
    func transportCloseCodesUpdateState() async throws {
        let endpoint = localEndpoint()
        let store = ConnectionStore()
        let session = try await ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope))),
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        let action = ServerConnection.HandleServerTransportClose(store: store, clock: FixedClock())
        let restart = try await action.run(
            ServerConnection.HandleServerTransportCloseInput(
                requestID: "restart",
                sessionID: session.sessionID,
                generation: 0,
                closeCode: .serverRestart
            )
        ).get().session
        let stale = await action.run(
            ServerConnection.HandleServerTransportCloseInput(
                requestID: "stale",
                sessionID: session.sessionID,
                generation: 99,
                closeCode: .normal
            )
        )

        #expect(restart.status == .degraded)
        #expect(stale == .failure(.staleMessage))
    }

    @Test("Local server restart degrades state and reconnect restores it")
    func localServerRestartReconnects() async throws {
        let endpoint = localEndpoint()
        let store = ConnectionStore()
        let transport = TransportOpener(sessionPrefix: "local")
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        _ = try await ServerConnection.HandleServerTransportClose(
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.HandleServerTransportCloseInput(
                requestID: "restart",
                sessionID: session.sessionID,
                generation: 0,
                closeCode: .serverRestart
            )
        ).get()

        let reconnected = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(requestID: "reconnect", sessionID: session.sessionID)
        ).get().session

        #expect(reconnected.status == .connected)
        #expect(reconnected.reconnectGeneration == 1)
    }

    @Test("Stream messages advance replay cursor and drop stale messages")
    func streamMessagesAdvanceReplayCursorAndDropStale() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let events = ServerEvents()
        let session = try await ServerConnection.OpenServerSession(
            authProvider: AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope))),
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        _ = try await ServerConnection.OpenServerStream(
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerStreamInput(
                requestID: "stream",
                sessionID: session.sessionID,
                streamID: "pane-stream",
                method: "tmux.pane.subscribeStream",
                payload: "{}"
            )
        ).get()

        let action = ServerConnection.RecordServerStreamMessage(store: store, clock: FixedClock(), events: events)
        let accepted = try await action.run(
            ServerConnection.RecordServerStreamMessageInput(
                requestID: "message-1",
                sessionID: session.sessionID,
                message: ServerConnection.ServerStreamMessage(
                    streamID: "pane-stream",
                    generation: 0,
                    replayCursor: ServerConnection.ReplayCursor(sequence: 10),
                    payload: "chunk"
                )
            )
        ).get()
        let staleSequence = try await action.run(
            ServerConnection.RecordServerStreamMessageInput(
                requestID: "message-2",
                sessionID: session.sessionID,
                message: ServerConnection.ServerStreamMessage(
                    streamID: "pane-stream",
                    generation: 0,
                    replayCursor: ServerConnection.ReplayCursor(sequence: 9),
                    payload: "old"
                )
            )
        ).get()
        let staleGeneration = try await action.run(
            ServerConnection.RecordServerStreamMessageInput(
                requestID: "message-3",
                sessionID: session.sessionID,
                message: ServerConnection.ServerStreamMessage(
                    streamID: "pane-stream",
                    generation: 99,
                    replayCursor: ServerConnection.ReplayCursor(sequence: 11),
                    payload: "old generation"
                )
            )
        ).get()

        #expect(accepted.accepted)
        #expect(accepted.stream.replayCursor?.sequence == 10)
        #expect(!staleSequence.accepted)
        #expect(!staleGeneration.accepted)
        #expect(await events.count(kind: "ServerStreamStaleMessageDropped") == 2)
    }

    @Test("SendServerRequest rejects stale response generations after reconnect")
    func sendRejectsStaleResponseGeneration() async throws {
        let endpoint = remoteEndpoint()
        let store = ConnectionStore()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let transport = TransportOpener()
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: transport,
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(requestID: "open", endpoint: endpoint)
        ).get().session

        _ = try await ServerConnection.ReconnectServerSession(
            authProvider: auth,
            transport: transport,
            streams: StreamOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.ReconnectServerSessionInput(requestID: "reconnect", sessionID: session.sessionID)
        ).get()

        let stale = await ServerConnection.SendServerRequest(
            sender: RequestSender(responseGeneration: 0),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.SendServerRequestInput(
                requestID: "send",
                sessionID: session.sessionID,
                request: ServerConnection.RequestEnvelope(method: "server.getConfig", payload: "{}")
            )
        )

        #expect(stale == .failure(.staleMessage))
        #expect(try await store.activeRequestCount(sessionID: session.sessionID) == 0)
    }

    @Test("Bounded event buffer drops oldest events under backpressure")
    func boundedEventBufferDropsOldestEvents() async {
        let buffer = ServerConnection.BoundedServerConnectionEventBuffer(capacity: 2)
        await buffer.publish(EventEnvelope(
            eventID: "one",
            eventKind: "one",
            timestamp: FixedClock().timestamp,
            event: .serverRequestStarted("one")
        ))
        await buffer.publish(EventEnvelope(
            eventID: "two",
            eventKind: "two",
            timestamp: FixedClock().timestamp,
            event: .serverRequestStarted("two")
        ))
        await buffer.publish(EventEnvelope(
            eventID: "three",
            eventKind: "three",
            timestamp: FixedClock().timestamp,
            event: .serverRequestStarted("three")
        ))

        let snapshot = await buffer.snapshot()
        #expect(snapshot.events.map(\.eventKind) == ["two", "three"])
        #expect(snapshot.droppedEventCount == 1)
    }

    @Test("GetServerConnectionHealth reports active requests and streams")
    func healthReportsActiveState() async throws {
        let endpoint = localEndpoint()
        let store = ConnectionStore()
        let auth = AuthProvider(result: .success(authContext(endpointScope: endpoint.authEndpointScope)))
        let session = try await ServerConnection.OpenServerSession(
            authProvider: auth,
            transport: TransportOpener(),
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.OpenServerSessionInput(
                requestID: "open",
                endpoint: endpoint
            )
        ).get().session

        try await store.incrementActiveRequestCount(sessionID: session.sessionID)
        try await store.saveStream(
            ServerConnection.StreamHandle(
                streamID: "stream",
                method: "events",
                payload: "{}",
                status: .open,
                openedGeneration: 0
            ),
            sessionID: session.sessionID
        )

        let result = try await ServerConnection.GetServerConnectionHealth(
            store: store,
            clock: FixedClock()
        ).run(
            ServerConnection.GetServerConnectionHealthInput(
                requestID: "health",
                sessionID: session.sessionID
            )
        ).get()

        #expect(result.health.status == .connected)
        #expect(result.health.activeRequestCount == 1)
        #expect(result.health.activeStreamCount == 1)
        #expect(result.health.endpoint?.endpointID == "local-main")
    }
}

private func localEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.Endpoint(
        endpointID: "local-main",
        kind: .local,
        transport: .unixDomainSocket(path: "/tmp/fenrir.sock"),
        httpBaseURL: "http://localhost:3000",
        displayName: "Local Fenrir"
    )
}

private func localWebSocketEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.Endpoint(
        endpointID: "local-main",
        kind: .local,
        transport: .webSocketURL("ws://127.0.0.1:4155/fenrir"),
        httpBaseURL: "http://127.0.0.1:4155",
        displayName: "Local Fenrir"
    )
}

private func alternateLocalWebSocketEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.Endpoint(
        endpointID: "local-alternate",
        kind: .local,
        transport: .webSocketURL("ws://127.0.0.1:4156/fenrir"),
        httpBaseURL: "http://127.0.0.1:4156",
        displayName: "Alternate Local Fenrir"
    )
}

private func localServerSpec() -> ServerConnection.LocalServerSpec {
    ServerConnection.LocalServerSpec(
        httpBaseURL: "http://127.0.0.1:4155",
        webSocketURL: "ws://127.0.0.1:4155/fenrir",
        readinessTimeoutMilliseconds: 100
    )
}

private func remoteEndpoint() -> ServerConnection.Endpoint {
    ServerConnection.Endpoint(
        endpointID: "remote-main",
        kind: .remote,
        transport: .webSocketURL("wss://remote.example/fenrir"),
        profileID: "remote-profile",
        httpBaseURL: "https://remote.example",
        displayName: "Remote Fenrir",
        expectedServerIdentity: "remote-server"
    )
}

private func capabilities() -> ServerConnection.Capabilities {
    ServerConnection.Capabilities(
        protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
        supportsTmuxKernel: true,
        supportsPaneStreams: true,
        supportsAuthenticatedActors: true
    )
}

private func authContext(
    endpointScope: AuthSession.EndpointScope,
    authSessionID: AuthSession.SessionID = "auth-session"
) -> ServerConnection.AuthContext {
    ServerConnection.AuthContext(
        authSessionID: authSessionID,
        actor: AuthSession.AuthenticatedActor(
            endpointScope: endpointScope,
            sessionID: authSessionID,
            subject: "native-client",
            role: .owner
        )
    )
}

private struct EndpointResolver: ServerConnection.ServerEndpointResolving {
    let endpoints: [String: ServerConnection.Endpoint]

    func resolveEndpoint(_ input: ServerConnection.ResolveServerEndpointInput) async throws -> ServerConnection.Endpoint {
        switch input.launchIntent {
        case .endpoint(let endpoint):
            return endpoint
        case .profile(let profileID):
            guard let endpoint = endpoints[profileID.rawValue.replacing("remote-profile", with: "remote")] else {
                throw ServerConnection.ServerConnectionError.endpointUnavailable
            }
            return endpoint
        case .none:
            guard let endpoint = endpoints["local"] else {
                throw ServerConnection.ServerConnectionError.endpointUnavailable
            }
            return endpoint
        }
    }
}

private actor LocalDiscovery: ServerConnection.LocalServerDiscovering {
    private let discovery: ServerConnection.LocalServerDiscovery
    private var discoveries = 0

    init(discovery: ServerConnection.LocalServerDiscovery) {
        self.discovery = discovery
    }

    func discoverLocalServer(_ spec: ServerConnection.LocalServerSpec) async throws -> ServerConnection.LocalServerDiscovery {
        discoveries += 1
        return discovery
    }

    func count() -> Int {
        discoveries
    }
}

private actor LocalForeignTerminator: ServerConnection.LocalServerForeignTerminating {
    private var endpoints: [ServerConnection.Endpoint] = []

    func terminateUnmanagedLocalServer(endpoint: ServerConnection.Endpoint) async throws {
        endpoints.append(endpoint)
    }

    func terminatedEndpoints() -> [ServerConnection.Endpoint] {
        endpoints
    }
}

private actor LocalSpawner: ServerConnection.LocalServerSpawning {
    private var spawns = 0
    private let spawnError: ServerConnection.ServerConnectionError?

    init(spawnError: ServerConnection.ServerConnectionError? = nil) {
        self.spawnError = spawnError
    }

    func spawnLocalServer(
        _ spec: ServerConnection.LocalServerSpec,
        restartCount: Int
    ) async throws -> ServerConnection.LocalServerProcessSnapshot {
        if let spawnError {
            spawns += 1
            throw spawnError
        }

        let processID = ServerConnection.LocalServerProcessID(rawValue: "local-process-\(spawns)")
        spawns += 1
        return ServerConnection.LocalServerProcessSnapshot(
            processID: processID,
            endpoint: spec.endpoint,
            startedAt: FixedClock().timestamp,
            restartCount: restartCount
        )
    }

    func spawnCount() -> Int {
        spawns
    }
}

private actor LocalReadiness: ServerConnection.LocalServerReadinessChecking {
    private var recordedCandidates: [ServerConnection.LocalServerReadinessCandidate] = []
    private var failures: [ServerConnection.ServerConnectionError]

    init(failures: [ServerConnection.ServerConnectionError] = []) {
        self.failures = failures
    }

    func waitForLocalServerReadiness(
        _ candidate: ServerConnection.LocalServerReadinessCandidate,
        timeoutMilliseconds: Int
    ) async throws -> ServerConnection.Endpoint {
        recordedCandidates.append(candidate)
        if !failures.isEmpty {
            throw failures.removeFirst()
        }

        switch candidate {
        case .existing(let endpoint):
            return endpoint
        case .spawned(let process):
            return process.endpoint
        }
    }

    func candidates() -> [ServerConnection.LocalServerReadinessCandidate] {
        recordedCandidates
    }
}

private actor LocalSupervisorStore: ServerConnection.LocalServerSupervisorStateStore {
    private var state: ServerConnection.LocalServerSupervisorState?

    func loadLocalServerSupervisorState() async throws -> ServerConnection.LocalServerSupervisorState? {
        state
    }

    func saveLocalServerSupervisorState(_ state: ServerConnection.LocalServerSupervisorState) async throws {
        self.state = state
    }

    func clearLocalServerSupervisorState() async throws {
        state = nil
    }
}

private actor LocalProcessManager: ServerConnection.LocalServerProcessManaging {
    private var shutdownProcessIDs: [ServerConnection.LocalServerProcessID] = []

    func shutdownLocalServer(processID: ServerConnection.LocalServerProcessID) async throws {
        shutdownProcessIDs.append(processID)
    }

    func shutdowns() -> [ServerConnection.LocalServerProcessID] {
        shutdownProcessIDs
    }
}

private struct AuthProvider: ServerConnection.ServerAuthSessionProviding {
    let result: Result<ServerConnection.AuthContext, Error>

    func authContext(endpoint: ServerConnection.Endpoint) async throws -> ServerConnection.AuthContext {
        try result.get()
    }

    func refreshAuthContext(
        endpoint: ServerConnection.Endpoint,
        currentAuthSessionID: AuthSession.SessionID
    ) async throws -> ServerConnection.AuthContext {
        try result.get()
    }
}

private actor RefreshingAuthProvider: ServerConnection.ServerAuthSessionProviding {
    let initial: ServerConnection.AuthContext
    let refreshed: ServerConnection.AuthContext
    private var refreshes = 0

    init(initial: ServerConnection.AuthContext, refreshed: ServerConnection.AuthContext) {
        self.initial = initial
        self.refreshed = refreshed
    }

    func authContext(endpoint: ServerConnection.Endpoint) async throws -> ServerConnection.AuthContext {
        initial
    }

    func refreshAuthContext(
        endpoint: ServerConnection.Endpoint,
        currentAuthSessionID: AuthSession.SessionID
    ) async throws -> ServerConnection.AuthContext {
        refreshes += 1
        return refreshed
    }

    func refreshCount() -> Int {
        refreshes
    }
}

private struct FailingRefreshAuthProvider: ServerConnection.ServerAuthSessionProviding {
    let initial: ServerConnection.AuthContext
    let refreshError: Error

    func authContext(endpoint: ServerConnection.Endpoint) async throws -> ServerConnection.AuthContext {
        initial
    }

    func refreshAuthContext(
        endpoint: ServerConnection.Endpoint,
        currentAuthSessionID: AuthSession.SessionID
    ) async throws -> ServerConnection.AuthContext {
        throw refreshError
    }
}

private actor TransportOpener: ServerConnection.ServerTransportOpening {
    let sessionPrefix: String
    private var opens = 0
    private var failingOpenAttempts = 0

    init(sessionPrefix: String = "session") {
        self.sessionPrefix = sessionPrefix
    }

    func openTransportSession(
        endpoint: ServerConnection.Endpoint,
        authContext: ServerConnection.AuthContext,
        clientProtocolVersion: ServerConnection.ProtocolVersion,
        generation: UInt64
    ) async throws -> ServerConnection.OpenedTransportSession {
        opens += 1
        if failingOpenAttempts > 0 {
            failingOpenAttempts -= 1
            throw ServerConnection.ServerConnectionError.transportUnavailable
        }
        return ServerConnection.OpenedTransportSession(
            sessionID: ServerConnection.SessionID(rawValue: "\(sessionPrefix)-\(generation)"),
            capabilities: capabilities()
        )
    }

    func closeTransportSession(sessionID: ServerConnection.SessionID, generation: UInt64) async throws {}

    func openCount() -> Int {
        opens
    }

    func failNextOpenAttempts(_ count: Int) {
        failingOpenAttempts = count
    }
}

private actor RecordingReconnectDelay: ServerConnection.ServerReconnectDelaying {
    private var recordedDelays: [Int] = []

    func delayBeforeReconnectAttempt(milliseconds: Int) async {
        recordedDelays.append(milliseconds)
    }

    func delays() -> [Int] {
        recordedDelays
    }
}

private actor OpenGate {
    private var started = false
    private var resumed = false
    private var startedWaiters: [CheckedContinuation<Void, Never>] = []
    private var resumeWaiters: [CheckedContinuation<Void, Never>] = []

    func signalStarted() {
        started = true
        let waiters = startedWaiters
        startedWaiters.removeAll()
        for waiter in waiters {
            waiter.resume()
        }
    }

    func waitForStarted() async {
        if started {
            return
        }
        await withCheckedContinuation { continuation in
            startedWaiters.append(continuation)
        }
    }

    func waitForResume() async {
        if resumed {
            return
        }
        await withCheckedContinuation { continuation in
            resumeWaiters.append(continuation)
        }
    }

    func resume() {
        resumed = true
        let waiters = resumeWaiters
        resumeWaiters.removeAll()
        for waiter in waiters {
            waiter.resume()
        }
    }
}

private actor BlockingReconnectTransport: ServerConnection.ServerTransportOpening {
    private let gate: OpenGate
    private var opens = 0

    init(gate: OpenGate) {
        self.gate = gate
    }

    func openTransportSession(
        endpoint: ServerConnection.Endpoint,
        authContext: ServerConnection.AuthContext,
        clientProtocolVersion: ServerConnection.ProtocolVersion,
        generation: UInt64
    ) async throws -> ServerConnection.OpenedTransportSession {
        opens += 1
        if generation > 0 {
            await gate.signalStarted()
            await gate.waitForResume()
        }
        return ServerConnection.OpenedTransportSession(
            sessionID: ServerConnection.SessionID(rawValue: "session-\(generation)"),
            capabilities: capabilities()
        )
    }

    func closeTransportSession(sessionID: ServerConnection.SessionID, generation: UInt64) async throws {}
}

private actor StreamOpener: ServerConnection.ServerStreamOpening {
    private var generationsByStreamID: [ServerConnection.StreamID: [UInt64]] = [:]
    private let failingStreamID: ServerConnection.StreamID?

    init(failingStreamID: ServerConnection.StreamID? = nil) {
        self.failingStreamID = failingStreamID
    }

    func openServerStream(
        session: ServerConnection.Session,
        stream: ServerConnection.StreamHandle
    ) async throws -> ServerConnection.StreamHandle {
        if stream.streamID == failingStreamID {
            throw ServerConnection.ServerConnectionError.streamResubscribeFailed
        }
        generationsByStreamID[stream.streamID, default: []].append(session.reconnectGeneration)
        return stream
    }

    func closeServerStream(
        session: ServerConnection.Session,
        streamID: ServerConnection.StreamID
    ) async throws {}

    func openedGenerations(for streamID: ServerConnection.StreamID) -> [UInt64] {
        generationsByStreamID[streamID] ?? []
    }
}

private struct RequestSender: ServerConnection.ServerRequestSending {
    let responseGeneration: UInt64

    func sendServerRequest(
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        ServerConnection.ResponseEnvelope(
            method: request.method,
            payload: "{}",
            generation: responseGeneration
        )
    }
}

private actor ConnectionStore: ServerConnection.ServerConnectionStore {
    private var session: ServerConnection.Session?
    private var requests: [ServerConnection.SessionID: Int] = [:]
    private var streams: [ServerConnection.SessionID: [ServerConnection.StreamID: ServerConnection.StreamHandle]] = [:]
    private var stats: [ServerConnection.SessionID: ServerConnection.TransportStats] = [:]
    private var shouldFailNextReconnectCommit = false

    func loadSession(sessionID: ServerConnection.SessionID?) async throws -> ServerConnection.Session? {
        guard let stored = session else {
            return nil
        }
        guard let sessionID else {
            return stored
        }
        return stored.sessionID == sessionID ? stored : nil
    }

    func saveSession(_ session: ServerConnection.Session) async throws {
        self.session = session
    }

    func deleteSession(sessionID: ServerConnection.SessionID) async throws {
        if session?.sessionID == sessionID {
            session = nil
        }
        streams.removeValue(forKey: sessionID)
        requests.removeValue(forKey: sessionID)
    }

    func nextReconnectGeneration(sessionID: ServerConnection.SessionID) async throws -> UInt64 {
        guard let session, session.sessionID == sessionID else {
            throw ServerConnection.ServerConnectionError.sessionClosed
        }
        return session.reconnectGeneration + 1
    }

    func activeRequestCount(sessionID: ServerConnection.SessionID) async throws -> Int {
        requests[sessionID] ?? 0
    }

    func incrementActiveRequestCount(sessionID: ServerConnection.SessionID) async throws {
        requests[sessionID, default: 0] += 1
    }

    func decrementActiveRequestCount(sessionID: ServerConnection.SessionID) async throws {
        requests[sessionID] = max(0, (requests[sessionID] ?? 0) - 1)
    }

    func loadStreams(sessionID: ServerConnection.SessionID) async throws -> [ServerConnection.StreamHandle] {
        Array((streams[sessionID] ?? [:]).values)
    }

    func saveStream(_ stream: ServerConnection.StreamHandle, sessionID: ServerConnection.SessionID) async throws {
        streams[sessionID, default: [:]][stream.streamID] = stream
    }

    func deleteStream(streamID: ServerConnection.StreamID, sessionID: ServerConnection.SessionID) async throws {
        streams[sessionID]?[streamID] = nil
    }

    func transportStats(sessionID: ServerConnection.SessionID) async throws -> ServerConnection.TransportStats {
        stats[sessionID] ?? ServerConnection.TransportStats()
    }

    func saveTransportStats(_ stats: ServerConnection.TransportStats, sessionID: ServerConnection.SessionID) async throws {
        self.stats[sessionID] = stats
    }

    func commitReconnect(_ commit: ServerConnection.ReconnectCommit) async throws {
        if shouldFailNextReconnectCommit {
            shouldFailNextReconnectCommit = false
            throw ServerConnection.ServerConnectionError.transportUnavailable
        }

        session = commit.session
        stats[commit.session.sessionID] = commit.transportStats
        for stream in commit.streams {
            streams[commit.session.sessionID, default: [:]][stream.streamID] = stream
        }
    }

    func failNextReconnectCommit() {
        shouldFailNextReconnectCommit = true
    }
}

private actor ServerEvents: ServerConnection.ServerConnectionEventPublishing {
    private var events: [EventEnvelope<ServerConnection.Event>] = []

    func publish(_ event: EventEnvelope<ServerConnection.Event>) async {
        events.append(event)
    }

    func count(kind: String) -> Int {
        events.filter { $0.eventKind == kind }.count
    }
}
