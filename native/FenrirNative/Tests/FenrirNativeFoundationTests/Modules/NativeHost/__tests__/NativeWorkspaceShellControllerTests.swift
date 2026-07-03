import AppKit
import AgentIntegration
import AgentInteraction
import AuthSession
import ClientControl
import Diagnostics
import FenrirNativeShared
import Keybinding
import NativeRuntime
import Notifications
import PaneGrid
import ServerConnection
import Settings
import TerminalViewport
import Testing
import WorkspaceCoordinator
import WorkspaceIndex
import WorkspaceOverlays
import WorkflowControl
@testable import FenrirNativeApp

@Suite("NativeHost workspace AppKit shell", .serialized)
struct NativeWorkspaceShellControllerTests {
    @Test("First shell composition is terminal workspace chrome, not a landing page")
    @MainActor
    func firstScreenHostsTerminalWorkspace() {
        let view = NativeWorkspaceRootView(state: state(), paneGridActions: FakePaneGridActions())

        #expect(view.terminalPaneHost.superview != nil)
        #expect(view.terminalPaneHost.paneGridView.superview === view.terminalPaneHost)
        #expect(view.terminalPaneHost.paneGridView.renderedPaneIDs() == ["pane-a"])
        #expect(view.terminalPaneHost.paneGridView.renderedTmuxPaneIDs() == ["%1"])
        #expect(view.terminalPaneHost.terminalView.rendererDescriptor.status == .degraded)
        #expect(view.terminalPaneHost.terminalView.attachedStreamID == nil)
        #expect(view.terminalPaneHost.terminalView.captureLastLines(maxLines: nil).text.contains("Fenrir tmux pane stream attached") == false)
        #expect(view.terminalPaneHost.terminalView.captureLastLines(maxLines: nil).text.contains("attached pane stream") == false)
        #expect(view.sidebarList.superview != nil)
        #expect(view.overlayHost.superview != nil)
        #expect(!allLabelStrings(in: view).contains("Fenrir NativeHost"))
        #expect(!allLabelStrings(in: view).contains("tmux workspace"))
        #expect(!allLabelStrings(in: view).contains("$ fenrir native terminal ready"))
    }


    @Test("Shell theme tokens propagate to chrome, sidebar, overlays, and pane host")
    @MainActor
    func shellThemeTokensPropagateToVisibleSurfaces() {
        let tokens = NativeShellThemeTokens.resolve(.kanagawa)
        let view = NativeWorkspaceRootView(
            state: state(),
            paneGridActions: FakePaneGridActions(),
            themeTokens: tokens
        )

        #expect(view.themeTokens.themeID == .kanagawa)
        #expect(view.sidebarList.themeTokens.themeID == .kanagawa)
        #expect(view.overlayHost.themeTokens.themeID == .kanagawa)
        #expect(view.terminalPaneHost.themeTokens.themeID == .kanagawa)
    }

    @Test("Shell resolves native tokens for desktop custom registry themes")
    @MainActor
    func shellResolvesDesktopCustomRegistryThemes() {
        let pierreDarkSoft = NativeShellThemeTokens.resolve(.pierreDarkSoft)
        let kanagawaDragon = NativeShellThemeTokens.resolve(.kanagawaDragon)

        #expect(pierreDarkSoft.themeID == .pierreDarkSoft)
        #expect(rgbHex(pierreDarkSoft.rootBackground) == 0x171717)
        #expect(rgbHex(pierreDarkSoft.accent) == 0x69B1FF)
        #expect(rgbHex(pierreDarkSoft.attentionBadge) == 0xFFD452)

        #expect(kanagawaDragon.themeID == .kanagawaDragon)
        #expect(rgbHex(kanagawaDragon.rootBackground) == 0x181616)
        #expect(rgbHex(kanagawaDragon.accent) == 0x8BA4B0)
        #expect(rgbHex(kanagawaDragon.attentionBadge) == 0xC4B28A)
    }

    @Test("Shell apply refreshes mounted PaneGrid state")
    @MainActor
    func applyRefreshesMountedPaneGridState() {
        let actions = FakePaneGridActions()
        let view = NativeWorkspaceRootView(state: state(), paneGridActions: actions)

        view.apply(state(paneGridState: shellPaneGridState(activeWindowID: "window-b")))

        #expect(view.terminalPaneHost.paneGridView.renderedPaneIDs() == ["pane-b"])
        #expect(view.terminalPaneHost.paneGridView.renderedTmuxPaneIDs() == ["%2"])
        #expect(actions.calls.contains("apply:window-b"))
    }

    @Test("Shell PaneGrid interactions reach action dispatcher")
    @MainActor
    func paneGridInteractionsReachActionDispatcher() async throws {
        let actions = FakePaneGridActions()
        let view = NativeWorkspaceRootView(state: state(), paneGridActions: actions)

        _ = view.terminalPaneHost.paneGridView.focusPane("pane-a")
        _ = view.terminalPaneHost.paneGridView.selectWindow("window-b", requestID: "select-b")
        _ = view.terminalPaneHost.paneGridView.requestResizeFocusedPane(delta: 7, unit: .pixels, direction: .right)

        await view.terminalPaneHost.waitForPaneGridActions()

        let interactionCalls = actions.calls.filter { !$0.hasPrefix("apply:") }
        #expect(interactionCalls == [
            "focus:pane-a:%1",
            "select:window-b:tmux-window-b",
            "resize:pane-a:7:pixels:right"
        ])
    }

    @Test("PaneGrid action controller syncs applied state before dispatching kernel commands")
    @MainActor
    func paneGridActionControllerSyncsAppliedStateBeforeDispatch() async {
        let kernel = RecordingPaneGridKernel()
        let controller = NativePaneGridActionController(
            initialState: shellPaneGridState(includeSecondWindow: false),
            kernel: kernel
        )
        let projectedState = shellPaneGridState(activeWindowID: "window-b")
        let window = projectedState.windows[1]
        let pane = window.panes[0]

        controller.applyPaneGridState(projectedState)
        _ = await controller.focusPane(pane.target(workspaceID: projectedState.workspaceID, window: window))
        var capturedSelection: PaneGrid.SelectTabWindowCommand?
        let commandSource = NativeTerminalPaneHostView(paneGridState: projectedState, paneGridActions: FakePaneGridActions())
        commandSource.paneGridView.onSelectWindow = { capturedSelection = $0 }
        _ = commandSource.paneGridView.selectWindow(window.windowID, requestID: "select-b")
        if let capturedSelection {
            _ = await controller.selectWindow(capturedSelection)
        }
        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: 4,
            unit: .cells,
            direction: .right
        ), in: projectedState)

        #expect(await kernel.calls == [
            "focus:pane-b:%2",
            "select:window-b:tmux-window-b",
            "resize:pane-b:4:cells:right"
        ])
    }

    @Test("Root controller wires PaneGrid interactions through runtime command port")
    @MainActor
    func rootControllerWiresPaneGridInteractionsThroughRuntimeCommandPort() async throws {
        let runtime = RecordingPaneGridRuntimeController()
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state()),
            paneGridRuntime: runtime,
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        _ = root.terminalPaneHost.paneGridView.focusPane("pane-a")
        _ = root.terminalPaneHost.paneGridView.requestResizeFocusedPane(delta: 7, unit: .pixels, direction: .right)
        _ = root.terminalPaneHost.paneGridView.selectWindow("window-b", requestID: "select-b")

        await root.terminalPaneHost.waitForPaneGridActions()

        let calls = runtime.calls
        #expect(calls.contains("focus:pane-a:%1"))
        #expect(calls.contains("resize:pane-a:7:pixels:right"))
        #expect(calls.contains("select:window-b:tmux-window-b"))
        #expect(calls.count == 3)
    }

    @Test("Native visible-state dispatcher removes an open workspace")
    @MainActor
    func visibleStateDispatcherRemovesOpenWorkspace() async throws {
        let registry = NativeWorkspaceWindowRegistry(
            agentPromptSubmitterFactory: RecordingAgentPromptSubmitterFactory()
        )
        registry.openInitialWorkspace()
        let dispatcher = NativeHostVisibleStateDispatcher(workspaceWindows: registry)

        let result = await dispatcher.removeWorkspace(ClientControl.RemoveWorkspaceInput(
            requestID: "remove-local-workspace",
            workspaceID: "local-workspace",
            source: .nativeHost
        ))

        guard case .success(let removed) = result else {
            Issue.record("Expected visible-state remove to succeed")
            return
        }
        #expect(removed.workspaceID == "local-workspace")
        #expect(registry.listVisibleWorkspaces().isEmpty)
    }

    @Test("Native visible-state dispatcher reports switched workspace as active")
    @MainActor
    func visibleStateDispatcherReportsSwitchedWorkspaceAsActive() async throws {
        let registry = NativeWorkspaceWindowRegistry(
            agentPromptSubmitterFactory: RecordingAgentPromptSubmitterFactory()
        )
        let dispatcher = NativeHostVisibleStateDispatcher(workspaceWindows: registry)

        _ = await dispatcher.openWorkspace(ClientControl.OpenWorkspaceInput(
            requestID: "open-a",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/tmp/fenrir-native-active-a"),
            source: .nativeHost
        ))
        _ = await dispatcher.openWorkspace(ClientControl.OpenWorkspaceInput(
            requestID: "open-b",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/tmp/fenrir-native-active-b"),
            source: .nativeHost
        ))
        _ = await dispatcher.switchWorkspace(ClientControl.SwitchWorkspaceInput(
            requestID: "switch-a",
            identity: WorkspaceIndex.WorkspaceIdentity(kind: .localPath, canonicalPath: "/tmp/fenrir-native-active-a"),
            source: .nativeHost
        ))

        let result = await dispatcher.listWorkspaces(ClientControl.ListWorkspacesInput(
            requestID: "list-active",
            source: .nativeHost
        ))

        guard case .success(let listed) = result else {
            Issue.record("Expected visible-state list to succeed")
            return
        }
        #expect(listed.activeWorkspaceID == WorkspaceID(rawValue: "fenrir-native-active-a"))
    }

    @Test("PaneGrid layout resize reaches runtime with measured size")
    @MainActor
    func paneGridLayoutResizeReachesRuntimeWithMeasuredSize() async throws {
        let runtime = RecordingPaneGridRuntimeController()
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state()),
            paneGridRuntime: runtime,
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        root.terminalPaneHost.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        root.terminalPaneHost.layoutSubtreeIfNeeded()

        await root.terminalPaneHost.waitForPaneGridActions()

        #expect(runtime.calls.contains { $0.hasPrefix("resize-absolute:pane-a:%1:") })
    }

    @Test("Runtime command port maps PaneGrid interactions to server RPC requests")
    @MainActor
    func runtimeCommandPortMapsPaneGridInteractionsToServerRPCRequests() async throws {
        let requestSender = RecordingServerRequestSender()
        let sessionID = ServerConnection.SessionID(rawValue: "session-a")
        let store = ConnectedServerConnectionStore(sessionID: sessionID)
        let sendServerRequest = ServerConnection.SendServerRequest(
            sender: requestSender,
            store: store,
            clock: NativeShellFixedClock()
        )
        let actor = NativeRuntime.RuntimeActorIdentity(
            profileID: "profile-a",
            authSessionID: "session-a",
            subject: "user-a"
        )
        let runtime = NativePaneGridAppRuntimeController(
            actor: actor,
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
        let controller = NativePaneGridActionController(
            initialState: shellPaneGridState(),
            runtime: runtime
        )
        let state = shellPaneGridState()
        let window = state.windows[0]
        let pane = window.panes[0]
        controller.markServerBackedPaneGridState(state)

        _ = await controller.focusPane(pane.target(workspaceID: state.workspaceID, window: window))
        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: 7,
            unit: .pixels,
            direction: .right
        ), in: state)
        var capturedSelection: PaneGrid.SelectTabWindowCommand?
        let commandSource = NativeTerminalPaneHostView(paneGridState: state, paneGridActions: FakePaneGridActions())
        commandSource.paneGridView.onSelectWindow = { capturedSelection = $0 }
        _ = commandSource.paneGridView.selectWindow("window-b", requestID: "select-b")
        if let capturedSelection {
            _ = await controller.selectWindow(capturedSelection)
        }

        #expect(await requestSender.methods == ["tmux.pane.focus", "tmux.pane.resize", "tmux.window.focus"])
        #expect(await requestSender.sessionIDs == [sessionID, sessionID, sessionID])
        #expect(await requestSender.stringPayloadValue(at: 0, key: "workspaceId") == "workspace-a")
        #expect(await requestSender.stringPayloadValue(at: 0, key: "paneId") == "pane-a")
        #expect(await requestSender.intPayloadValue(at: 1, key: "cols") == 121)
        #expect(await requestSender.intPayloadValue(at: 1, key: "rows") == 36)
        #expect(await requestSender.stringPayloadValue(at: 2, key: "windowId") == "window-b")
    }

    @Test("Runtime resize is not emitted before pane is server-backed")
    @MainActor
    func runtimeResizeIsNotEmittedBeforePaneIsServerBacked() async throws {
        let requestSender = RecordingServerRequestSender()
        let sessionID = ServerConnection.SessionID(rawValue: "session-a")
        let runtime = NativePaneGridAppRuntimeController(
            actor: NativeRuntime.RuntimeActorIdentity(
                profileID: "profile-a",
                authSessionID: "session-a",
                subject: "user-a"
            ),
            sessionID: sessionID,
            sendServerRequest: ServerConnection.SendServerRequest(
                sender: requestSender,
                store: ConnectedServerConnectionStore(sessionID: sessionID),
                clock: NativeShellFixedClock()
            )
        )
        let state = shellPaneGridState()
        let window = state.windows[0]
        let pane = window.panes[0]
        let controller = NativePaneGridActionController(initialState: state, runtime: runtime)

        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: 7,
            unit: .pixels,
            direction: .right
        ), in: state)
        await controller.resizePane(
            pane.target(workspaceID: state.workspaceID, window: window),
            size: TerminalViewport.Size(columns: 140, rows: 42, pixelWidth: 1120, pixelHeight: 756),
            in: state
        )

        #expect(await requestSender.methods == [])
    }

    @Test("Runtime resize emits after projection marks pane server-backed")
    @MainActor
    func runtimeResizeEmitsAfterProjectionMarksPaneServerBacked() async throws {
        let requestSender = RecordingServerRequestSender()
        let sessionID = ServerConnection.SessionID(rawValue: "session-a")
        let runtime = NativePaneGridAppRuntimeController(
            actor: NativeRuntime.RuntimeActorIdentity(
                profileID: "profile-a",
                authSessionID: "session-a",
                subject: "user-a"
            ),
            sessionID: sessionID,
            sendServerRequest: ServerConnection.SendServerRequest(
                sender: requestSender,
                store: ConnectedServerConnectionStore(sessionID: sessionID),
                clock: NativeShellFixedClock()
            )
        )
        let state = shellPaneGridState()
        let window = state.windows[0]
        let pane = window.panes[0]
        let controller = NativePaneGridActionController(initialState: state, runtime: runtime)

        controller.markServerBackedPaneGridState(state)
        await controller.resizePane(
            pane.target(workspaceID: state.workspaceID, window: window),
            size: TerminalViewport.Size(columns: 140, rows: 42, pixelWidth: 1120, pixelHeight: 756),
            in: state
        )

        #expect(await requestSender.methods == ["tmux.pane.resize"])
        #expect(await requestSender.stringPayloadValue(at: 0, key: "workspaceId") == "workspace-a")
        #expect(await requestSender.stringPayloadValue(at: 0, key: "paneId") == "pane-a")
        #expect(await requestSender.intPayloadValue(at: 0, key: "cols") == 140)
        #expect(await requestSender.intPayloadValue(at: 0, key: "rows") == 42)
    }

    @Test("Runtime resize preserves projected pane stream identity")
    @MainActor
    func runtimeResizePreservesProjectedPaneStreamIdentity() async {
        let runtime = RecordingPaneGridRuntimeController()
        let streamID = StreamID(rawValue: "stream-pane-a")
        let state = shellPaneGridState(streamID: streamID)
        let window = state.windows[0]
        let pane = window.panes[0]
        let controller = NativePaneGridActionController(initialState: state, runtime: runtime)

        controller.markServerBackedPaneGridState(state)
        await controller.resizePane(
            pane.target(workspaceID: state.workspaceID, window: window),
            size: TerminalViewport.Size(columns: 140, rows: 42, pixelWidth: 1120, pixelHeight: 756),
            in: state
        )

        let resizedPane = runtime.appliedStates.last?.windows[0].panes[0]
        #expect(resizedPane?.streamID == streamID)
        #expect(resizedPane?.rect.columns == 140)
        #expect(resizedPane?.rect.rows == 42)
    }

    @Test("NativeHost agent presence OSC forwarder stores valid terminal viewport presence")
    func nativeHostAgentPresenceOSCForwarderStoresValidPresence() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        let forwarder = NativeAgentPresenceOSCForwarder(
            ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal(
                store: store,
                clock: AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000)))
            )
        )
        let signal = TerminalViewport.ReservedOSCSignal(
            oscIdentifier: AgentIntegration.AgentPresenceSignal.oscIdentifier,
            payload: #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"codex","state":"awaitingInput","workspaceID":"workspace-a","paneID":"pane-a","sequence":12,"timestamp":"2023-11-14T22:13:20Z"}"#,
            provenance: TerminalViewport.ReservedOSCProvenance(
                workspaceID: "workspace-a",
                tabID: "window-a",
                paneID: "pane-a",
                viewportID: "viewport-a",
                streamID: "stream-a",
                sequence: 12
            )
        )

        try await forwarder.forwardReservedOSC(signal)
        let records = try await AgentIntegration.ListAgentPresence(
            store: store,
            clock: AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_001)))
        )
        .run(.init(requestID: "list-presence", workspaceID: "workspace-a", source: .test))
        .get()

        #expect(records.records.count == 1)
        guard let record = records.records.first else {
            Issue.record("Expected exactly one presence record")
            return
        }
        #expect(record.state == .awaitingInput)
        #expect(record.provenance.workspaceID == "workspace-a")
        #expect(record.provenance.tabID == "window-a")
        #expect(record.provenance.paneID == "pane-a")
        #expect(record.provenance.viewportID == "viewport-a")
        #expect(record.provenance.kind == .terminalViewportForwardedOSC)
    }

    @Test("NativeHost terminal viewport store saves loads overwrites and deletes state")
    func nativeHostTerminalViewportStoreSavesLoadsOverwritesAndDeletesState() async throws {
        let store = NativeAppTerminalViewportStore()
        let viewportID = ViewportID(rawValue: "viewport-store-a")
        let initialState = nativeHostTerminalViewportState(
            viewportID: viewportID,
            streamID: "stream-a",
            lastAppliedSequence: 1
        )
        let overwrittenState = nativeHostTerminalViewportState(
            viewportID: viewportID,
            streamID: "stream-b",
            lastAppliedSequence: 2
        )

        #expect(try await store.loadViewport(viewportID: viewportID) == nil)

        try await store.saveViewport(initialState)
        #expect(try await store.loadViewport(viewportID: viewportID) == initialState)

        try await store.saveViewport(overwrittenState)
        #expect(try await store.loadViewport(viewportID: viewportID) == overwrittenState)

        try await store.deleteViewport(viewportID: viewportID)
        #expect(try await store.loadViewport(viewportID: viewportID) == nil)
    }

    @Test("NativeHost terminal view renderer writer appends bytes in order")
    @MainActor
    func nativeHostTerminalViewRendererWriterAppendsBytesInOrder() async throws {
        let backend = NativeHostRecordingTerminalBackend()
        let terminalView = FenrirTerminalView(backend: backend)
        let writer = NativeTerminalViewRendererWriter(terminalView: terminalView)

        try await writer.ingestOutput(viewportID: "viewport-renderer-a", bytes: Data("one".utf8))
        try await writer.ingestOutput(viewportID: "viewport-renderer-a", bytes: Data("-two".utf8))
        try await writer.ingestOutput(viewportID: "viewport-renderer-a", bytes: Data("-three".utf8))

        #expect(backend.renderedText == "one-two-three")
        #expect(backend.outputs == [
            Data("one".utf8),
            Data("-two".utf8),
            Data("-three".utf8)
        ])
    }

    @Test("NativeHost terminal stream ingestor renders normal output and commits sequence")
    @MainActor
    func nativeHostTerminalStreamIngestorRendersNormalOutputAndCommitsSequence() async throws {
        let store = NativeAppTerminalViewportStore()
        let ingestor = NativeTerminalStreamIngestor(store: store)
        let backend = NativeHostRecordingTerminalBackend()
        let terminalView = FenrirTerminalView(backend: backend)
        let pane = PaneGrid.PanePresentation(
            paneID: "pane-ingest-a",
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%99"),
            streamID: "stream-ingest-a",
            viewportID: "viewport-ingest-a",
            title: "ingest",
            rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
            isFocused: true
        )

        let result = await ingestor.ingestOutput(
            workspaceID: "workspace-a",
            windowID: "window-a",
            pane: pane,
            streamID: "stream-ingest-a",
            sequence: 1,
            bytes: Data("hello".utf8),
            terminalView: terminalView
        )

        guard case .success = result else {
            Issue.record("Expected stream ingestor to succeed")
            return
        }
        #expect(backend.renderedText == "hello")
        let savedState = try await store.loadViewport(viewportID: "viewport-ingest-a")
        #expect(savedState?.lastAppliedSequence == 1)
        #expect(savedState?.streamID == "stream-ingest-a")
        #expect(savedState?.streamStatus == .attached)
    }

    @Test("NativeHost agent presence OSC forwarder drops malformed advisory payloads")
    func nativeHostAgentPresenceOSCForwarderDropsMalformedPayload() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        let clock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000)))
        let forwarder = NativeAgentPresenceOSCForwarder(
            ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal(store: store, clock: clock)
        )

        try await forwarder.forwardReservedOSC(TerminalViewport.ReservedOSCSignal(
            oscIdentifier: AgentIntegration.AgentPresenceSignal.oscIdentifier,
            payload: #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"codex","state":"busy","workspaceID":"other","paneID":"pane-a"}"#,
            provenance: TerminalViewport.ReservedOSCProvenance(
                workspaceID: "workspace-a",
                tabID: "window-a",
                paneID: "pane-a",
                viewportID: "viewport-a",
                streamID: "stream-a",
                sequence: 13
            )
        ))
        let records = try await AgentIntegration.ListAgentPresence(store: store, clock: clock)
            .run(.init(requestID: "list-presence", source: .test))
            .get()

        #expect(records.records.isEmpty)
    }

    @Test("NativeHost TerminalViewport module does not import AgentIntegration")
    func nativeHostTerminalViewportModuleDoesNotImportAgentIntegration() throws {
        let sources = try swiftSourceFiles(
            under: packageRoot().appendingPathComponent("Sources/FenrirNativeFoundation/Modules/TerminalViewport")
        )

        #expect(!sources.isEmpty)
        for source in sources {
            let text = try String(contentsOf: source, encoding: .utf8)
            #expect(!text.contains("import AgentIntegration"), "\(source.path) must not import AgentIntegration")
        }
    }

    @Test("Palette open file dispatches through native Neovim bridge")
    @MainActor
    func paletteOpenFileDispatchesThroughNativeNeovimBridge() async throws {
        let requestSender = RecordingServerRequestSender(responsesByMethod: [
            "tmux.workspace.getSnapshot": tmuxSnapshot(neovim: false),
            "tmux.neovimPane.create": tmuxSnapshot(neovim: true)
        ])
        let sessionID = ServerConnection.SessionID(rawValue: "session-neovim")
        let sendServerRequest = ServerConnection.SendServerRequest(
            sender: requestSender,
            store: ConnectedServerConnectionStore(sessionID: sessionID),
            clock: NativeShellFixedClock()
        )
        let actor = NativeRuntime.RuntimeActorIdentity(
            profileID: "profile-a",
            authSessionID: sessionID.rawValue,
            subject: "user-a"
        )
        let shellState = state(
            focusedSurface: .commandPalette,
            paletteFileItems: [
                WorkspaceOverlays.PaletteItem(
                    id: "file:/repo/App.swift",
                    domain: .files,
                    title: "App.swift",
                    subtitle: "/repo/App.swift",
                    action: .openFile("/repo/App.swift"),
                    baseScore: 120
                )
            ]
        )
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: shellState),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter(),
            neovimBridgeController: NativeNeovimServerConnectionControllerFactory(
                actor: actor,
                sessionID: sessionID,
                sendServerRequest: sendServerRequest
            ).makeController(for: shellState)
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        #expect(root.overlayHost.selectedPaletteItemID() == "file:/repo/App.swift")
        #expect(root.overlayHost.handleKeyboard(.submit))
        await controller.waitForNeovimActions()

        #expect(await requestSender.methods == ["tmux.workspace.getSnapshot", "tmux.workspace.getSnapshot", "tmux.neovimPane.create"])
        #expect(await requestSender.stringPayloadValue(at: 2, key: "workspaceId") == "workspace-a")
        #expect(await requestSender.stringPayloadValue(at: 2, key: "windowId") == "window-a")
        #expect(await requestSender.stringArrayPayloadValue(at: 2, key: "files") == ["/repo/App.swift"])
    }

    @Test("Agent server prompt submitter dispatches orchestration turn without pane writes")
    func agentServerPromptSubmitterDispatchesOrchestrationTurnWithoutPaneWrites() async throws {
        let requestSender = RecordingServerRequestSender()
        let sessionID = ServerConnection.SessionID(rawValue: "session-agent")
        let submitter = NativeAgentServerPromptSubmitter(
            workspaceID: "workspace-a",
            sessionID: sessionID,
            sendServerRequest: ServerConnection.SendServerRequest(
                sender: requestSender,
                store: ConnectedServerConnectionStore(sessionID: sessionID),
                clock: NativeShellFixedClock()
            )
        )

        let accepted = try await submitter.submitAgentPrompt(AgentInteraction.ServerPromptRequest(
            requestID: "agent-submit",
            composerID: "composer-a",
            target: AgentInteraction.TargetWorkspace(
                workspaceID: "workspace-a",
                originatingPaneID: "pane-a",
                originatingViewportID: "viewport-a"
            ),
            prompt: "Summarize this",
            attachments: [
                AgentInteraction.TerminalContextAttachment(
                    attachmentID: "context-a",
                    workspaceID: "workspace-a",
                    viewportID: "viewport-a",
                    paneID: "pane-a",
                    kind: .lastLines,
                    text: "redacted terminal context",
                    lineCount: 1,
                    characterCount: 25,
                    isTruncated: true,
                    redactionReport: AgentInteraction.RedactionReport(replacementCount: 1, labels: ["token"]),
                    capturedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
                )
            ]
        ))

        #expect(accepted.promptID == "agent-submit")
        #expect(await requestSender.methods == ["orchestration.dispatchCommand"])
        #expect(await requestSender.sessionIDs == [sessionID])
        #expect(await requestSender.stringPayloadValue(at: 0, key: "type") == "thread.turn.start")
        #expect(await requestSender.stringPayloadValue(at: 0, key: "runtimeMode") == "full-access")
        #expect(await requestSender.stringPayloadValue(at: 0, path: ["message", "role"]) == "user")
        #expect(await requestSender.stringPayloadValue(at: 0, path: ["message", "text"])?.contains("redacted terminal context") == true)
        #expect(await requestSender.stringPayloadValue(at: 0, path: ["bootstrap", "createThread", "projectId"]) == "workspace-a")
        #expect(await requestSender.methods.contains("tmux.pane.write") == false)
        #expect(await requestSender.methods.contains("terminal.write") == false)
    }

    @Test("Launched app server context submits through authenticated RPC transport")
    func launchedAppServerContextSubmitsThroughAuthenticatedRPCTransport() async throws {
        let transport = RecordingNativeAppServerRPCTransport()
        let submitter = NativeAppServerConnectionContext
            .localDefault(transport: transport, bootstrapCredential: "desktop-bootstrap-token")
            .agentPromptSubmitterFactory
            .makeSubmitter(for: state())

        let accepted = try await submitter.submitAgentPrompt(AgentInteraction.ServerPromptRequest(
            requestID: "agent-submit",
            composerID: "composer-a",
            target: AgentInteraction.TargetWorkspace(workspaceID: "workspace-a"),
            prompt: "Summarize this",
            attachments: []
        ))

        #expect(accepted.promptID == "agent-submit")
        #expect(await transport.bootstrapCredentials == ["desktop-bootstrap-token"])
        #expect(await transport.methods == ["orchestration.dispatchCommand"])
        #expect(await transport.httpBaseURLs == ["http://127.0.0.1:31337"])
        #expect(await transport.webSocketURLs == ["ws://127.0.0.1:31337/ws"])
        #expect(await transport.stringPayloadValue(at: 0, key: "type") == "thread.turn.start")
        #expect(await transport.methods.contains("tmux.pane.write") == false)
        #expect(await transport.methods.contains("terminal.write") == false)
    }

    @Test("Launched app server context streams live workflow events")
    func launchedAppServerContextStreamsLiveWorkflowEvents() async throws {
        let transport = WorkflowEventStreamNativeAppServerRPCTransport()
        let eventStream = NativeAppServerConnectionContext
            .localDefault(transport: transport, bootstrapCredential: "desktop-bootstrap-token")
            .workflowEventStreamFactory
            .makeEventStream(for: state(workspaceID: "project-1"))
        let output = await WorkflowControl.ObserveWorkflowEventStream(eventStream: eventStream).run(.init(
            requestID: "workflow-events",
            filter: .init(runIDs: ["run-a"]),
            source: .test
        ))
        var received: [WorkflowControl.WorkflowEventStreamItem] = []

        for try await item in output {
            received.append(item)
        }

        #expect(received.map { $0.kind } == [.runChanged, .eventAppended])
        #expect(received.map { $0.runID?.rawValue } == ["run-a", "run-a"])
        #expect(received.compactMap(\.event?.sequence) == [7])
        #expect(await transport.methods == ["subscribeWorkflowEvents"])
        #expect(await transport.bootstrapCredentials == ["desktop-bootstrap-token"])
    }

    @Test("Real server workflow integration lists and observes a run when explicitly enabled")
    func realServerWorkflowIntegrationListsAndObservesRunWhenEnabled() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["FENRIR_NATIVE_WORKFLOW_INTEGRATION"] == "1",
              let projectID = environment["FENRIR_NATIVE_WORKFLOW_PROJECT_ID"],
              let runID = environment["FENRIR_NATIVE_WORKFLOW_RUN_ID"],
              let bootstrap = environment["FENRIR_NATIVE_BOOTSTRAP_TOKEN"] ?? environment["FENRIR_BOOTSTRAP_TOKEN"]
        else {
            return
        }

        let context = NativeAppServerConnectionContext.localDefault(bootstrapCredential: bootstrap)
        let client = context.workflowServerClientFactory.makeClient(for: state(workspaceID: WorkspaceID(rawValue: projectID)))
        let runs = try await client.listWorkflowRuns(filter: .init(projectID: projectID))
        let timeline = try await client.getWorkflowTimeline(runID: WorkflowControl.WorkflowRunID(rawValue: runID))

        #expect(runs.contains { $0.runID.rawValue == runID })
        #expect(timeline.map(\.sequence) == timeline.map(\.sequence).sorted())
    }

    @Test("Native app RPC transport reuses bearer session for repeated composer submits")
    func nativeAppRPCTransportReusesBearerSessionForRepeatedComposerSubmits() async throws {
        let network = RecordingNativeAppServerRPCNetwork()
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(network: network)
        let endpoint = ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:31337",
            webSocketURL: "ws://127.0.0.1:31337/ws"
        ).endpoint
        let session = serverSession(sessionID: "native-app-local", endpoint: endpoint)
        let request = ServerConnection.RequestEnvelope(
            method: "orchestration.dispatchCommand",
            payload: #"{"type":"thread.turn.start"}"#
        )

        for index in 1...2 {
            _ = try await transport.sendAuthenticatedRPC(
                httpBaseURL: URL(string: "http://127.0.0.1:31337")!,
                webSocketURL: URL(string: "ws://127.0.0.1:31337/ws")!,
                bootstrapCredential: "desktop-bootstrap-token",
                session: session,
                requestID: RequestID(rawValue: "agent-submit-\(index)"),
                request: request
            )
        }

        #expect(await network.bootstrapCredentials == ["desktop-bootstrap-token"])
        #expect(await network.bearerTokens == ["bearer-session-token", "bearer-session-token"])
        #expect(await network.httpBaseURLs == ["http://127.0.0.1:31337", "http://127.0.0.1:31337"])
        #expect(await network.methods == ["orchestration.dispatchCommand", "orchestration.dispatchCommand"])
        #expect(await network.methods.contains("tmux.pane.write") == false)
        #expect(await network.methods.contains("terminal.write") == false)
    }

    @Test("Native app RPC transport shares first bootstrap across concurrent composer submits")
    func nativeAppRPCTransportSharesFirstBootstrapAcrossConcurrentComposerSubmits() async throws {
        let network = RecordingNativeAppServerRPCNetwork(exchangeDelayNanoseconds: 25_000_000)
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(network: network)
        let endpoint = ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:31337",
            webSocketURL: "ws://127.0.0.1:31337/ws"
        ).endpoint
        let session = serverSession(sessionID: "native-app-local", endpoint: endpoint)
        let request = ServerConnection.RequestEnvelope(
            method: "orchestration.dispatchCommand",
            payload: #"{"type":"thread.turn.start"}"#
        )

        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 1...2 {
                group.addTask {
                    _ = try await transport.sendAuthenticatedRPC(
                        httpBaseURL: URL(string: "http://127.0.0.1:31337")!,
                        webSocketURL: URL(string: "ws://127.0.0.1:31337/ws")!,
                        bootstrapCredential: "desktop-bootstrap-token",
                        session: session,
                        requestID: RequestID(rawValue: "agent-submit-\(index)"),
                        request: request
                    )
                }
            }
            try await group.waitForAll()
        }

        #expect(await network.bootstrapCredentials == ["desktop-bootstrap-token"])
        #expect(await network.bearerTokens == ["bearer-session-token", "bearer-session-token"])
        #expect(await network.httpBaseURLs == ["http://127.0.0.1:31337", "http://127.0.0.1:31337"])
        #expect(await network.methods == ["orchestration.dispatchCommand", "orchestration.dispatchCommand"])
    }

    @Test("Native app unary RPC transport posts JSON to HTTP compatibility endpoint")
    func nativeAppUnaryRPCTransportPostsJSONToHTTPCompatibilityEndpoint() async throws {
        let recorder = NativeRPCURLProtocolRecorder.shared
        recorder.configure([
            "/api/auth/bootstrap/bearer": [
                NativeRPCURLProtocolResponse(
                    statusCode: 200,
                    body: Data(#"{"sessionToken":"eyJzaWQiOiJhdXRoLXNlc3Npb24taHR0cCJ9.sig"}"#.utf8)
                )
            ],
            "/api/native/rpc": [
                NativeRPCURLProtocolResponse(statusCode: 200, body: Data(#"{"ok":true,"payload":{"workspaceId":"workspace-a"}}"#.utf8)),
                NativeRPCURLProtocolResponse(statusCode: 200, body: Data(#"{"ok":true,"payload":{"workspaceId":"workspace-a","reconnected":true}}"#.utf8)),
                NativeRPCURLProtocolResponse(statusCode: 200, body: Data(#"{"ok":true,"payload":{"workspaceId":"workspace-a","snapshot":true}}"#.utf8))
            ]
        ])
        let transport = ServerConnection.NativeURLSessionServerRPCTransport(network: ServerConnection.NativeURLSessionServerRPCNetwork(urlSession: nativeRPCRecordingURLSession()))
        let endpoint = ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:31337",
            webSocketURL: "ws://127.0.0.1:31337/ws"
        ).endpoint
        let session = serverSession(sessionID: "native-app-local", endpoint: endpoint)

        let rpcRequests: [(String, String)] = [
            ("tmux.workspace.ensure", #"{"actor":{"sessionId":"stale-session","subject":"user-a"},"projectId":"project-a","cwd":"/repo"}"#),
            ("tmux.workspace.reconnect", #"{"actor":{"sessionId":"stale-session","subject":"user-a"},"workspaceId":"workspace-a"}"#),
            ("tmux.workspace.getSnapshot", #"{"actor":{"sessionId":"stale-session","subject":"user-a"},"workspaceId":"workspace-a"}"#)
        ]
        for (index, rpcRequest) in rpcRequests.enumerated() {
            _ = try await transport.sendAuthenticatedRPC(
                httpBaseURL: URL(string: "http://127.0.0.1:31337")!,
                webSocketURL: URL(string: "ws://127.0.0.1:31337/ws")!,
                bootstrapCredential: "desktop-bootstrap-token",
                session: session,
                requestID: RequestID(rawValue: "native-rpc-\(index)"),
                request: ServerConnection.RequestEnvelope(method: rpcRequest.0, payload: rpcRequest.1)
            )
        }

        let requests = recorder.requests
        #expect(requests.map(\.path) == [
            "/api/auth/bootstrap/bearer",
            "/api/native/rpc",
            "/api/native/rpc",
            "/api/native/rpc"
        ])
        #expect(!requests.map(\.path).contains("/api/auth/ws-token"))
        #expect(requests.map(\.method) == ["POST", "POST", "POST", "POST"])
        #expect(requests.dropFirst().map(\.authorization) == [
            "Bearer eyJzaWQiOiJhdXRoLXNlc3Npb24taHR0cCJ9.sig",
            "Bearer eyJzaWQiOiJhdXRoLXNlc3Npb24taHR0cCJ9.sig",
            "Bearer eyJzaWQiOiJhdXRoLXNlc3Npb24taHR0cCJ9.sig"
        ])

        let bodies = try requests.dropFirst().map(nativeRPCJSONObject)
        #expect(bodies.compactMap { $0["method"] as? String } == [
            "tmux.workspace.ensure",
            "tmux.workspace.reconnect",
            "tmux.workspace.getSnapshot"
        ])
        #expect(bodies.compactMap { $0["requestId"] as? String } == [
            "native-rpc-0",
            "native-rpc-1",
            "native-rpc-2"
        ])
        let payloads = bodies.compactMap { $0["payload"] as? [String: Any] }
        #expect(payloads.first?["projectId"] as? String == "project-a")
        #expect(payloads.first?["cwd"] as? String == "/repo")
        #expect(payloads.compactMap { ($0["actor"] as? [String: Any])?["sessionId"] as? String } == [
            "auth-session-http",
            "auth-session-http",
            "auth-session-http"
        ])
    }

    @Test("Native app unary RPC transport decodes deterministic ok false errors")
    func nativeAppUnaryRPCTransportDecodesDeterministicOKFalseErrors() async throws {
        let recorder = NativeRPCURLProtocolRecorder.shared
        recorder.configure([
            "/api/native/rpc": [
                NativeRPCURLProtocolResponse(
                    statusCode: 200,
                    body: Data(#"{"ok":false,"error":"ServerSessionClosed"}"#.utf8)
                )
            ]
        ])
        let network = ServerConnection.NativeURLSessionServerRPCNetwork(urlSession: nativeRPCRecordingURLSession())

        do {
            _ = try await network.sendUnaryNativeRPC(
                httpBaseURL: URL(string: "http://127.0.0.1:31337")!,
                bearerToken: "bearer-session-token",
                requestID: "native-rpc-error",
                request: ServerConnection.RequestEnvelope(
                    method: "tmux.workspace.ensure",
                    payload: #"{"workspaceId":"workspace-a"}"#
                )
            )
            Issue.record("Expected ok:false native RPC response to throw")
        } catch let error as ServerConnection.ServerConnectionError {
            #expect(error == .sessionClosed)
        }

        let requests = recorder.requests
        #expect(requests.map(\.path) == ["/api/native/rpc"])
        #expect(requests.first?.authorization == "Bearer bearer-session-token")
    }

    @Test("Runtime resize clamps absolute pane size to server contract bounds")
    @MainActor
    func runtimeResizeClampsAbsolutePaneSizeToServerContractBounds() async throws {
        let requestSender = RecordingServerRequestSender()
        let sessionID = ServerConnection.SessionID(rawValue: "session-a")
        let store = ConnectedServerConnectionStore(sessionID: sessionID)
        let runtime = NativePaneGridAppRuntimeController(
            actor: NativeRuntime.RuntimeActorIdentity(
                profileID: "profile-a",
                authSessionID: "session-a",
                subject: "user-a"
            ),
            sessionID: sessionID,
            sendServerRequest: ServerConnection.SendServerRequest(
                sender: requestSender,
                store: store,
                clock: NativeShellFixedClock()
            )
        )
        let state = shellPaneGridState(columns: 22, rows: 6)
        let window = state.windows[0]
        let pane = window.panes[0]
        let controller = NativePaneGridActionController(initialState: state, runtime: runtime)
        controller.markServerBackedPaneGridState(state)

        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: -200,
            unit: .pixels,
            direction: .right
        ), in: state)
        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: -200,
            unit: .pixels,
            direction: .down
        ), in: state)
        controller.applyPaneGridState(shellPaneGridState(columns: 999, rows: 499))
        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: 40,
            unit: .cells,
            direction: .right
        ), in: state)
        await controller.resizePane(PaneGrid.PaneResizeAllocation(
            paneID: pane.paneID,
            delta: 40,
            unit: .cells,
            direction: .down
        ), in: state)
        await controller.resizePane(
            pane.target(workspaceID: state.workspaceID, window: window),
            size: TerminalViewport.Size(columns: 1, rows: 1, pixelWidth: 8, pixelHeight: 16),
            in: state
        )
        await controller.resizePane(
            pane.target(workspaceID: state.workspaceID, window: window),
            size: TerminalViewport.Size(columns: 2000, rows: 900, pixelWidth: 16_000, pixelHeight: 14_400),
            in: state
        )

        #expect(await requestSender.methods == [
            "tmux.pane.resize",
            "tmux.pane.resize",
            "tmux.pane.resize",
            "tmux.pane.resize",
            "tmux.pane.resize",
            "tmux.pane.resize"
        ])
        #expect(await requestSender.intPayloadValue(at: 0, key: "cols") == 20)
        #expect(await requestSender.intPayloadValue(at: 0, key: "rows") == 6)
        #expect(await requestSender.intPayloadValue(at: 1, key: "cols") == 22)
        #expect(await requestSender.intPayloadValue(at: 1, key: "rows") == 5)
        #expect(await requestSender.intPayloadValue(at: 2, key: "cols") == 1000)
        #expect(await requestSender.intPayloadValue(at: 2, key: "rows") == 499)
        #expect(await requestSender.intPayloadValue(at: 3, key: "cols") == 999)
        #expect(await requestSender.intPayloadValue(at: 3, key: "rows") == 500)
        #expect(await requestSender.intPayloadValue(at: 4, key: "cols") == 20)
        #expect(await requestSender.intPayloadValue(at: 4, key: "rows") == 5)
        #expect(await requestSender.intPayloadValue(at: 5, key: "cols") == 1000)
        #expect(await requestSender.intPayloadValue(at: 5, key: "rows") == 500)
    }

    @Test("Sidebar projection preserves visibility and notification counts")
    func sidebarProjectionFeedsVisibleNotificationRows() {
        var controller = NativeWorkspaceShellController(state: state())
        let projection = WorkspaceIndex.WorkspaceSidebarProjection(
            items: [
                sidebarItem("workspace-a", name: "Alpha", visibility: .visible, unread: 3, level: .attention),
                sidebarItem("workspace-b", name: "Hidden", visibility: .hidden, unread: 9, level: .badge)
            ],
            capturedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        )

        controller.updateSidebar(projection)

        #expect(controller.state.sidebarItems.map(\.workspaceID.rawValue) == ["workspace-a", "workspace-b"])
        #expect(controller.state.sidebarItems[0].notificationCount == 3)
        #expect(controller.state.sidebarItems[0].notificationLevel == .attention)
        #expect(controller.state.sidebarItems[1].visibility == .hidden)
    }

    @Test("Sidebar collapse returns focus to the terminal deterministically")
    func sidebarCollapseReturnsFocusToTerminal() {
        var controller = NativeWorkspaceShellController(state: state())

        controller.focusSidebar()
        #expect(controller.state.focusedSurface == .sidebar)

        controller.toggleSidebarVisibility()

        #expect(!controller.state.isSidebarVisible)
        #expect(controller.state.focusedSurface == .terminal(nil))

        controller.focusSidebar()
        #expect(controller.state.focusedSurface == .terminal(nil))
    }

    @Test("Palette and overlays restore focus in stack order")
    func paletteAndOverlayFocusRestoreInStackOrder() {
        var controller = NativeWorkspaceShellController(state: state())
        let overlayID = WorkspaceOverlays.OverlayID(rawValue: "agent-composer")

        controller.focusSidebar()
        controller.presentOverlay(overlayID)
        controller.focusSidebar()
        controller.presentCommandPalette()

        #expect(controller.state.focusedSurface == .commandPalette)

        controller.dismissCommandPalette()
        #expect(controller.state.focusedSurface == .overlay(overlayID))

        controller.closeOverlay(overlayID)
        #expect(controller.state.focusedSurface == .sidebar)
    }

    @Test("Overlay host ignores keyboard while terminal owns focus")
    @MainActor
    func overlayHostIgnoresKeyboardWhileTerminalOwnsFocus() {
        let host = NativeOverlayHostView()
        var dismissed = false
        host.onDismissCommandPalette = { dismissed = true }

        host.apply(
            focusedSurface: .terminal("pane-a"),
            activeOverlayIDs: [],
            paletteItems: [paletteItem("alpha", title: "Alpha")]
        )

        #expect(host.isHidden)
        #expect(!host.isCapturingKeyboard)
        #expect(!host.handleKeyboard(.moveDown))
        #expect(!dismissed)
    }

    @Test("Command palette keyboard navigation dispatches selected action")
    @MainActor
    func commandPaletteKeyboardNavigationDispatchesSelectedAction() {
        let host = NativeOverlayHostView()
        var executedItems: [WorkspaceOverlays.PaletteItem] = []
        host.onExecutePaletteItem = { executedItems.append($0) }

        host.apply(
            focusedSurface: .commandPalette,
            activeOverlayIDs: [],
            paletteItems: [
                paletteItem("alpha", title: "Alpha"),
                paletteItem("beta", title: "Beta"),
                paletteItem("gamma", title: "Gamma", keywords: ["logs"])
            ]
        )

        #expect(!host.isHidden)
        #expect(host.isCapturingKeyboard)
        #expect(host.visibleOverlayTitles() == ["Command Palette"])
        #expect(host.selectedPaletteItemID() == "alpha")

        #expect(host.handleKeyboard(.moveDown))
        #expect(host.selectedPaletteItemID() == "beta")
        #expect(host.handleKeyboard(.controlN))
        #expect(host.selectedPaletteItemID() == "gamma")
        #expect(host.handleKeyboard(.controlP))
        #expect(host.selectedPaletteItemID() == "beta")
        #expect(host.handleKeyboard(.insertText("log")))
        #expect(host.selectedPaletteItemID() == "gamma")
        #expect(host.handleKeyboard(.submit))
        #expect(executedItems.map(\.id) == ["gamma"])
    }

    @Test("Command palette Escape dismisses without dispatching selection")
    @MainActor
    func commandPaletteEscapeDismissesWithoutDispatchingSelection() {
        let host = NativeOverlayHostView()
        var dismissCount = 0
        var executedItems: [WorkspaceOverlays.PaletteItem] = []
        host.onDismissCommandPalette = { dismissCount += 1 }
        host.onExecutePaletteItem = { executedItems.append($0) }

        host.apply(
            focusedSurface: .commandPalette,
            activeOverlayIDs: [],
            paletteItems: [paletteItem("alpha", title: "Alpha")]
        )

        #expect(host.handleKeyboard(.escape))
        #expect(dismissCount == 1)
        #expect(executedItems.isEmpty)
    }

    @Test("Overlay host keeps compact palette layout stable")
    @MainActor
    func overlayHostKeepsCompactPaletteLayoutStable() {
        let host = NativeOverlayHostView(frame: NSRect(x: 0, y: 0, width: 280, height: 240))

        host.apply(
            focusedSurface: .commandPalette,
            activeOverlayIDs: [],
            paletteItems: [paletteItem("alpha", title: "A command with a deliberately long compact-width title")]
        )
        host.layoutSubtreeIfNeeded()

        #expect(!host.isHidden)
        #expect(host.isCapturingKeyboard)
        #expect(host.selectedPaletteItemID() == "alpha")
        #expect(allLabelStrings(in: host).contains("A command with a deliberately long compact-width title"))
    }

    @Test("Overlay stack renders diagnostics and closes focused overlay by keyboard")
    @MainActor
    func overlayStackRendersDiagnosticsAndClosesFocusedOverlayByKeyboard() {
        let host = NativeOverlayHostView()
        let diagnosticsID = WorkspaceOverlays.OverlayID(rawValue: "diagnostics")
        var closedIDs: [WorkspaceOverlays.OverlayID] = []
        host.onCloseOverlay = { closedIDs.append($0) }

        host.apply(
            focusedSurface: .overlay(diagnosticsID),
            activeOverlayIDs: [diagnosticsID],
            paletteItems: []
        )

        #expect(!host.isHidden)
        #expect(host.isCapturingKeyboard)
        #expect(host.visibleOverlayTitles() == ["Diagnostics"])
        #expect(host.handleKeyboard(.escape))
        #expect(closedIDs == [diagnosticsID])
    }

    @Test("Root view dispatches command palette action callbacks")
    @MainActor
    func rootViewDispatchesCommandPaletteActionCallbacks() {
        let view = NativeWorkspaceRootView(
            state: state(focusedSurface: .commandPalette),
            paneGridActions: FakePaneGridActions()
        )
        var actions: [WorkspaceOverlays.PaletteAction] = []
        view.onExecutePaletteAction = { actions.append($0) }

        #expect(view.overlayHost.isCapturingKeyboard)
        #expect(view.overlayHost.selectedPaletteItemID() == "workspace-workspace-a")
        #expect(view.overlayHost.handleKeyboard(.submit))
        #expect(actions == [.switchWorkspace("workspace-a")])
    }

    @Test("Command palette exposes persistent settings entry for agent integrations")
    @MainActor
    func commandPaletteExposesSettingsEntryForAgentIntegrations() {
        let view = NativeWorkspaceRootView(
            state: state(focusedSurface: .commandPalette),
            paneGridActions: FakePaneGridActions()
        )
        var actions: [WorkspaceOverlays.PaletteAction] = []
        view.onExecutePaletteAction = { actions.append($0) }

        view.setPaletteQuery("settings")

        #expect(view.overlayHost.selectedPaletteItemID() == "action-settings-agent-integrations")
        #expect(view.overlayHost.handleKeyboard(.submit))
        #expect(actions == [.runAction("action-settings-agent-integrations")])
    }

    @Test("Root controller opens command palette and diagnostics from shell keyboard shortcuts")
    @MainActor
    func rootControllerOpensOverlaysFromShellKeyboardShortcuts() {
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        #expect(!root.overlayHost.isCapturingKeyboard)
        #expect(root.handleShellKeyboardShortcut(.commandPalette))
        #expect(root.overlayHost.isCapturingKeyboard)
        #expect(root.overlayHost.visibleOverlayTitles() == ["Command Palette"])

        #expect(root.overlayHost.handleKeyboard(.escape))
        #expect(!root.overlayHost.isCapturingKeyboard)

        #expect(root.handleShellKeyboardShortcut(.diagnostics))
        #expect(root.overlayHost.isCapturingKeyboard)
        #expect(root.overlayHost.visibleOverlayTitles() == ["Diagnostics"])
    }

    @Test("Client control settings action opens agent integration settings panel")
    @MainActor
    func clientControlSettingsActionOpensAgentIntegrationSettingsPanel() {
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        controller.executePaletteActionFromClientControl(actionID: "action-settings-agent-integrations")

        #expect(root.overlayHost.isCapturingKeyboard)
        #expect(root.overlayHost.visibleOverlayTitles() == ["Agent Integrations"])
    }

    @Test("Root controller applies live workflow stream items while workflow overlay is open")
    @MainActor
    func rootControllerAppliesLiveWorkflowStreamItemsWhileWorkflowOverlayIsOpen() async throws {
        let stream = WorkflowEventStreamFake(items: [
            WorkflowControl.WorkflowEventStreamItem(kind: .runChanged, run: nativeIntegrationWorkflowRun(runID: "run-a", updatedAtSeconds: 1)),
            WorkflowControl.WorkflowEventStreamItem(kind: .eventAppended, event: workflowTimelineEvent(
                eventID: "event-a",
                kind: .notificationEmitted,
                title: "Workflow needs attention",
                sequence: 7
            ))
        ])
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(workspaceID: "workspace-a", focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter(),
            workflowEventStream: stream
        )
        controller.loadView()

        controller.presentWorkflowPanelFromClientControl(operation: "list")
        try await waitUntil {
            let state = (controller.view as! NativeWorkspaceRootView).visibleWorkflowState()
            return state.runs.map { $0.runID.rawValue }.contains("run-a") &&
                state.timeline?.events.map { $0.eventID.rawValue } == ["event-a"] &&
                controller.visibleNotificationState()?.unreadCount == 1
        }

        let root = controller.view as! NativeWorkspaceRootView
        #expect(root.overlayHost.visibleOverlayTitles() == ["Workflows"])
        #expect(root.visibleWorkflowState().timeline?.nextSequence == 8)
        #expect(await stream.filters == [WorkflowControl.WorkflowEventStreamFilter(projectID: "workspace-a")])
        #expect(controller.visibleNotificationState()?.unreadCount == 1)
        #expect(controller.visibleNotificationState()?.level == .badge)
    }

    @Test("Diagnostics overlay renders Diagnostics report rows instead of static optimistic rows")
    @MainActor
    func diagnosticsOverlayRendersDiagnosticsReportRows() async {
        let diagnosticsStore = Diagnostics.inMemoryDiagnosticsStore()
        let diagnostics = NativeDiagnosticsActionController(store: diagnosticsStore)
        await diagnostics.record(
            category: .workflow,
            severity: .error,
            workspaceID: "workspace-a",
            title: "Workflow failed",
            message: "Workflow command rejected",
            metadata: ["runID": "run-a"]
        )
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter(),
            diagnosticsActions: diagnostics
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        #expect(root.handleShellKeyboardShortcut(.diagnostics))
        await controller.waitForDiagnosticsActions()

        let labels = allLabelStrings(in: root.overlayHost)
        #expect(labels.contains("Workflow: 1"))
        #expect(labels.contains("Native shell: 1"))
        #expect(!labels.contains("Server connection: ready for local or remote sessions"))
    }

    @Test("Root controller opens mounted agent composer from shell keyboard shortcut")
    @MainActor
    func rootControllerOpensMountedAgentComposerFromShellKeyboardShortcut() async {
        let submitter = RecordingAgentPromptSubmitter()
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: submitter
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        #expect(root.handleShellKeyboardShortcut(.agentComposer(.lastLines(2))))
        await controller.waitForAgentComposerActions()

        let composerView = root.overlayHost.visibleAgentComposerView()
        #expect(root.overlayHost.visibleOverlayTitles() == ["Agent Composer"])
        #expect(composerView != nil)
        #expect(composerView?.provenanceText == "Last lines from pane pane-a, viewport viewport-pane-a")
        #expect(composerView?.displayedAttachmentText.contains("Fenrir tmux pane stream attached") == false)

        composerView?.setDraft(" explain this pane ")
        composerView?.submit(requestID: "agent-submit")
        await controller.waitForAgentComposerActions()

        #expect(await submitter.requests.map(\.prompt) == ["explain this pane"])
        #expect(root.overlayHost.visibleAgentComposerView()?.composer.status == .submitted)
    }

    @Test("Composer context smoke survives palette and server-projected layout")
    @MainActor
    func composerContextSmokeSurvivesPaletteAndServerProjectedLayout() async {
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(workspaceID: "workspace-a", focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView
        root.setFrameSize(NSSize(width: 900, height: 620))
        root.layoutSubtreeIfNeeded()

        #expect(root.handleShellKeyboardShortcut(.commandPalette))
        controller.applyReconnectedLayout(shellPaneGridState(activeWindowID: "window-b"))
        let marker = "native-agent-context-existing-terminal"
        let terminal = root.terminalPaneHost.terminalView
        terminal.applyRuntimeOutput(Data("first \(marker)\nsecond \(marker)\nthird \(marker)\n".utf8))

        let lastLines = await controller.runAgentComposerContextSmoke(
            contextSource: .lastLines(3),
            expectedMarker: marker
        )
        #expect(lastLines["overlayVisible"] == "true")
        #expect(lastLines["contextKind"] == "lastLines")
        #expect(lastLines["attachmentContainsMarker"] == "true")
        #expect(lastLines["paneTextUnchangedByComposer"] == "true")
        #expect(lastLines["agentWroteIntoPane"] == "false")

        let selectedText = "second \(marker)"
        let selection = await controller.runAgentComposerContextSmoke(
            contextSource: .selection,
            expectedMarker: marker,
            selectionText: selectedText
        )
        #expect(selection["overlayVisible"] == "true")
        #expect(selection["contextKind"] == "selection")
        #expect(selection["selectionWasApplied"] == "true")
        #expect(selection["attachmentContainsMarker"] == "true")
        #expect(selection["attachmentMatchesSelectedText"] == "true")
        #expect(selection["agentWroteIntoPane"] == "false")
    }

    @Test("Composer context smoke absorbs delayed terminal stream chunks before baseline")
    @MainActor
    func composerContextSmokeAbsorbsDelayedTerminalStreamChunksBeforeBaseline() async {
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(workspaceID: "workspace-a", focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView
        root.setFrameSize(NSSize(width: 900, height: 620))
        root.layoutSubtreeIfNeeded()

        let marker = "native-agent-context-delayed-terminal"
        let terminal = root.terminalPaneHost.terminalView
        terminal.applyRuntimeOutput(Data("first \(marker)\n".utf8))

        let delayedOutput = Task { @MainActor in
            await Task.yield()
            terminal.applyRuntimeOutput(Data("second \(marker)\n".utf8))
            try? await Task.sleep(nanoseconds: 50_000_000)
            terminal.applyRuntimeOutput(Data("third \(marker)\n".utf8))
        }

        let lastLines = await controller.runAgentComposerContextSmoke(
            contextSource: .lastLines(3),
            expectedMarker: marker
        )
        await delayedOutput.value

        #expect(lastLines["overlayVisible"] == "true")
        #expect(lastLines["contextKind"] == "lastLines")
        #expect(lastLines["attachmentContainsMarker"] == "true")
        #expect(lastLines["paneTextUnchangedByComposer"] == "true")
        #expect(lastLines["agentWroteIntoPane"] == "false")
        #expect(root.visibleAgentComposerState()?.attachments.first?.text.contains("third \(marker)") == true)
    }

    @Test("Projected pane terminal capture is populated by real stream chunks")
    @MainActor
    func projectedPaneTerminalCaptureUsesStreamChunks() async throws {
        var continuation: AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error>.Continuation?
        let stream = AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error> { current in
            continuation = current
        }
        let state = shellPaneGridState(streamID: "stream-pane-a")
        let host = NativeTerminalPaneHostView(
            paneGridState: state,
            paneGridActions: FakePaneGridActions(),
            paneStreamSubscriber: { workspaceID, pane, backfill in
                #expect(workspaceID == "workspace-a")
                #expect(pane.paneID == "pane-a")
                #expect(pane.streamID == "stream-pane-a")
                #expect(backfill == .latest)
                return stream
            }
        )
        let marker = "real-stream-backfill-marker"

        #expect(host.terminalView.captureLastLines(maxLines: nil).text.contains(marker) == false)
        #expect(host.terminalView.captureLastLines(maxLines: nil).text.contains("Fenrir tmux pane stream attached") == false)

        continuation?.yield(NativeRuntime.PaneStreamEnvelope(
            paneID: "pane-a",
            streamID: "stream-pane-a",
            kind: .output,
            sequence: 12,
            bytes: Data("\(marker)\n".utf8)
        ))

        try await waitUntil {
            host.terminalView.captureLastLines(maxLines: nil).text.contains(marker)
        }
        continuation?.finish()
    }

    @Test("Visible pane stream identity changes reattach on the same viewport")
    @MainActor
    func visiblePaneStreamIdentityChangesReattachOnSameViewport() async throws {
        let recorder = StreamSubscriptionRecorder()
        let host = NativeTerminalPaneHostView(
            paneGridState: shellPaneGridState(streamID: "stream-pane-a"),
            paneGridActions: FakePaneGridActions(),
            paneStreamSubscriber: recorder.subscribe(workspaceID:pane:backfill:)
        )

        try await waitUntil {
            recorder.streamIDs == ["stream-pane-a"]
        }

        host.applyPaneGrid(shellPaneGridState(streamID: "stream-pane-a-reconnected"))

        try await waitUntil {
            recorder.streamIDs == ["stream-pane-a", "stream-pane-a-reconnected"]
        }
        #expect(recorder.backfills == [.latest, .latest])
        #expect(host.terminalView.attachedStreamID == "stream-pane-a-reconnected")

        let marker = "same-viewport-new-stream-marker"
        recorder.yield(
            NativeRuntime.PaneStreamEnvelope(
                paneID: "pane-a",
                streamID: "stream-pane-a-reconnected",
                kind: .output,
                sequence: 30,
                bytes: Data("\(marker)\n".utf8)
            ),
            streamID: "stream-pane-a-reconnected"
        )

        try await waitUntil {
            host.terminalView.captureLastLines(maxLines: nil).text.contains(marker)
        }
        recorder.finishAll()
    }

    @Test("Visible pane stream reconnect uses cursor after observed output")
    @MainActor
    func visiblePaneStreamReconnectUsesCursorAfterObservedOutput() async throws {
        let recorder = StreamSubscriptionRecorder()
        let host = NativeTerminalPaneHostView(
            paneGridState: shellPaneGridState(streamID: "stream-pane-a"),
            paneGridActions: FakePaneGridActions(),
            paneStreamSubscriber: recorder.subscribe(workspaceID:pane:backfill:)
        )

        try await waitUntil {
            recorder.streamIDs == ["stream-pane-a"]
        }
        recorder.yield(
            NativeRuntime.PaneStreamEnvelope(
                paneID: "pane-a",
                streamID: "stream-pane-a",
                kind: .output,
                sequence: 42,
                bytes: Data("cursor-established\n".utf8)
            ),
            streamID: "stream-pane-a"
        )

        try await waitUntil {
            host.terminalView.captureLastLines(maxLines: nil).text.contains("cursor-established")
        }
        host.applyPaneGrid(shellPaneGridState(streamID: "stream-pane-a-reconnected"))

        try await waitUntil {
            recorder.streamIDs == ["stream-pane-a", "stream-pane-a-reconnected"]
        }
        #expect(recorder.backfills == [.latest, .fromSeq(42)])
        recorder.finishAll()
    }

    @Test("Selecting a server-backed window attaches its real pane stream")
    @MainActor
    func selectingServerBackedWindowAttachesVisiblePaneStream() async throws {
        let recorder = StreamSubscriptionRecorder()
        let state = shellPaneGridState(streamID: "stream-pane-a")
        let host = NativeTerminalPaneHostView(
            paneGridState: state,
            paneGridActions: SelectReturningPaneGridActions(nextState: shellPaneGridState(activeWindowID: "window-b", streamID: "stream-pane-a")),
            paneStreamSubscriber: recorder.subscribe(workspaceID:pane:backfill:)
        )

        try await waitUntil {
            recorder.paneIDs.contains("pane-a")
        }
        _ = host.paneGridView.selectWindow("window-b", requestID: "select-b")
        await host.waitForPaneGridActions()
        try await waitUntil {
            recorder.paneIDs.contains("pane-b")
        }

        let marker = "selected-window-real-stream-marker"
        recorder.yield(
            NativeRuntime.PaneStreamEnvelope(
                paneID: "pane-b",
                streamID: "stream-pane-a-b",
                kind: .output,
                sequence: 21,
                bytes: Data("\(marker)\n".utf8)
            ),
            paneID: "pane-b"
        )
        try await waitUntil {
            host.terminalView.captureLastLines(maxLines: nil).text.contains(marker)
        }
        recorder.finishAll()
    }

    @Test("Opening composer after layout resize does not write into pane text")
    @MainActor
    func openingComposerAfterLayoutResizeDoesNotWriteIntoPaneText() async {
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView
        root.setFrameSize(NSSize(width: 900, height: 620))
        root.layoutSubtreeIfNeeded()
        let terminal = root.terminalPaneHost.terminalView
        terminal.applyRuntimeOutput(Data("stable composer context marker\n".utf8))
        let before = terminal.captureLastLines(maxLines: nil).text

        root.setFrameSize(NSSize(width: 720, height: 520))
        root.layoutSubtreeIfNeeded()
        #expect(root.handleShellKeyboardShortcut(.agentComposer(.lastLines(2))))
        await controller.waitForAgentComposerActions()

        #expect(root.overlayHost.visibleOverlayTitles() == ["Agent Composer"])
        #expect(root.visibleAgentComposerState()?.attachments.first?.text.contains("stable composer context marker") == true)
        #expect(terminal.captureLastLines(maxLines: nil).text == before)
    }

    @Test("Root controller cancel closes mounted agent composer overlay")
    @MainActor
    func rootControllerCancelClosesMountedAgentComposerOverlay() async {
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a"))),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter()
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        #expect(root.handleShellKeyboardShortcut(.agentComposer(.selection)))
        await controller.waitForAgentComposerActions()
        root.overlayHost.visibleAgentComposerView()?.cancel(requestID: "agent-cancel")
        await controller.waitForAgentComposerActions()

        #expect(!root.overlayHost.isCapturingKeyboard)
        #expect(root.overlayHost.visibleOverlayTitles().isEmpty)
    }

    @Test("Root view maps AppKit key equivalents to overlay shortcuts")
    @MainActor
    func rootViewMapsAppKitKeyEquivalentsToOverlayShortcuts() {
        let view = NativeWorkspaceRootView(state: state(), paneGridActions: FakePaneGridActions())
        var openedPalette = 0
        var openedDiagnostics = 0
        var composerContexts: [Keybinding.AgentComposerContextSource] = []
        view.onPresentCommandPalette = { openedPalette += 1 }
        view.onPresentDiagnosticsOverlay = { openedDiagnostics += 1 }
        view.onPresentAgentComposer = { composerContexts.append($0) }

        #expect(view.performKeyEquivalent(with: keyEvent(key: "p", modifiers: [.command], keyCode: 35)))
        #expect(view.performKeyEquivalent(with: keyEvent(key: "d", modifiers: [.command, .shift], keyCode: 2)))
        #expect(view.performKeyEquivalent(with: keyEvent(key: "a", modifiers: [.command, .shift], keyCode: 0)))
        #expect(view.performKeyEquivalent(with: keyEvent(key: "a", modifiers: [.command, .option], keyCode: 0)))
        #expect(view.performKeyEquivalent(with: keyEvent(key: "a", modifiers: [.control, .option], keyCode: 0)))
        #expect(openedPalette == 1)
        #expect(openedDiagnostics == 1)
        #expect(composerContexts == [.selection, .viewport, .lastLines(80)])
    }

    @Test("Root controller executes workspace switcher selections")
    @MainActor
    func rootControllerExecutesWorkspaceSwitcherSelections() {
        var switchedWorkspaces: [WorkspaceID] = []
        let controller = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state(focusedSurface: .commandPalette)),
            paneGridRuntime: RecordingPaneGridRuntimeController(),
            agentPromptSubmitter: RecordingAgentPromptSubmitter(),
            switchWorkspace: { switchedWorkspaces.append($0) }
        )
        controller.loadView()
        let root = controller.view as! NativeWorkspaceRootView

        #expect(root.overlayHost.selectedPaletteItemID() == "workspace-workspace-a")
        #expect(root.overlayHost.handleKeyboard(.submit))
        #expect(switchedWorkspaces == ["workspace-a"])
        #expect(!root.overlayHost.isCapturingKeyboard)
    }

    @Test("Reconnect banner state does not steal terminal focus")
    func reconnectBannerDoesNotStealFocus() {
        var controller = NativeWorkspaceShellController(state: state(focusedSurface: .terminal("pane-a")))

        controller.setReconnectBanner(NativeReconnectBannerState(message: "Reconnecting to local Fenrir server"))

        #expect(controller.state.reconnectBanner?.message == "Reconnecting to local Fenrir server")
        #expect(controller.state.focusedSurface == .terminal("pane-a"))
    }

    @Test("Workflow notification events project to workspace sidebar attention")
    @MainActor
    func workflowNotificationEventsProjectToWorkspaceSidebarAttention() async throws {
        let notifications = NativeWorkflowNotificationController(workspaceID: "workspace-a")

        let state = await notifications.projectNotifications(from: [
            workflowTimelineEvent(
                kind: .notificationEmitted,
                title: "Workflow needs review",
                body: "Review generated tasks",
                payload: .object(["level": .string("warning")])
            )
        ])

        #expect(state == WorkspaceIndex.WorkspaceNotificationState(unreadCount: 1, level: .attention))
    }

    @Test("Workspace shell applies workflow notification badge to the active workspace")
    func workspaceShellAppliesWorkflowNotificationBadge() {
        var controller = NativeWorkspaceShellController(state: state())

        controller.updateWorkspaceNotifications(WorkspaceIndex.WorkspaceNotificationState(
            unreadCount: 3,
            level: .attention
        ))

        #expect(controller.state.sidebarItems.first?.notificationCount == 3)
        #expect(controller.state.sidebarItems.first?.notificationLevel == .attention)
    }

    @Test("Server event graph reconnects workspace projections without duplicate UI state")
    func serverEventGraphReconnectsWorkspaceProjectionsWithoutDuplicateUIState() async throws {
        let endpoint = ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:31337",
            webSocketURL: "ws://127.0.0.1:31337/ws"
        ).endpoint
        let session = serverSession(sessionID: "session-reconnect", endpoint: endpoint)
        let sessionHandler = RecordingNativeServerSessionReconnectHandler(session: session)
        let workspaceHandler = RecordingNativeWorkspaceReconnectHandler()
        let workflowRefresher = RecordingNativeWorkflowProjectionRefresher()
        let notificationRefresher = RecordingNativeNotificationProjectionRefresher()
        let agentRefresher = RecordingNativeAgentInteractionRefresher()
        let graph = NativeServerEventIntegrationGraph(
            sessionHandler: sessionHandler,
            workspaceHandler: workspaceHandler,
            workflowRefresher: workflowRefresher,
            notificationRefresher: notificationRefresher,
            agentRefresher: agentRefresher
        )
        await graph.trackWorkspace(
            NativeServerEventGraphWorkspace(identity: WorkspaceIndex.WorkspaceIdentity(kind: .project, workspaceID: "workspace-a")),
            workspaceID: "workspace-a"
        )
        await graph.trackWorkflowRun("run-a")
        await graph.trackAgentComposer("composer-a", workspaceID: "workspace-a")

        let close = ServerConnection.HandleServerTransportCloseInput(
            requestID: "reconnect-1",
            sessionID: "session-reconnect",
            generation: 1,
            closeCode: .serverRestart,
            reason: "server restarted"
        )
        let first = try await graph.handleTransportCloseAndReconnect(close).get()
        let second = try await graph.handleTransportCloseAndReconnect(close).get()

        #expect(first.workspaces.map(\.workspace.workspaceID.rawValue) == ["workspace-a"])
        #expect(second.workspaces.map(\.workspace.workspaceID.rawValue) == ["workspace-a"])
        #expect(second.workflowRuns.map(\.runID.rawValue) == ["run-a"])
        #expect(second.workflowTimelines.count == 1)
        #expect(second.workflowTimelines[0].events.map(\.eventID.rawValue) == ["workflow-event-1", "workflow-event-2"])
        #expect(second.notifications.map(\.workspaceID.rawValue) == ["workspace-a"])
        #expect(second.agentInteractions.flatMap(\.activeComposerIDs).map(\.rawValue) == ["composer-a"])
        #expect(first.failures.isEmpty)
        #expect(second.failures.isEmpty)
        #expect(await sessionHandler.closeCalls == 1)
        #expect(await sessionHandler.reconnectCalls == 2)
        #expect(await workspaceHandler.reconnectWorkspaceIDs == ["workspace-a", "workspace-a"])
        #expect(await workflowRefresher.observedAfterSequences == [nil, 3])
        #expect(await notificationRefresher.recordedNotificationEventIDs == ["workflow-event-2", "workflow-event-2"])
        #expect(await notificationRefresher.projectedWorkspaceIDs == ["workspace-a", "workspace-a"])
    }

    @Test("NativeHost server reconnect events use integration graph when wired")
    func nativeHostServerReconnectEventsUseIntegrationGraphWhenWired() async throws {
        let dispatcher = RecordingNativeHostClientControlDispatcher()
        let integration = RecordingNativeServerEventReconnectIntegration(session: serverSession(
            sessionID: "session-event",
            endpoint: ServerConnection.LocalServerSpec(
                httpBaseURL: "http://127.0.0.1:31337",
                webSocketURL: "ws://127.0.0.1:31337/ws"
            ).endpoint
        ))
        let controller = NativeHostServerEventController(
            controller: NativeHostControlController(dispatcher: dispatcher),
            integration: integration,
            defaultSessionID: "session-event"
        )

        let response = await controller.dispatch(NativeHostServerEvent.reconnectWorkspace(
            requestID: "server-reconnect-integrated",
            workspaceID: "workspace-a",
            serverID: "server-a",
            serverURL: "ws://127.0.0.1:9876",
            generation: 4
        ))

        #expect(response.ok)
        #expect(response.resultKind == "ServerReconnectProjected")
        #expect(response.payload["workspaceCount"] == "1")
        #expect(await dispatcher.calls.isEmpty)
        #expect(await integration.inputs.map(\.workspaceID.rawValue) == ["workspace-a"])
        #expect(await integration.inputs.map(\.sessionID.rawValue) == ["session-event"])
        #expect(await integration.inputs.map(\.generation) == [4])
    }

    @Test("Native app server request failures dispatch reconnect events into production controller")
    func nativeAppServerRequestFailuresDispatchReconnectEventsIntoProductionController() async throws {
        let transport = FailingNativeAppServerRPCTransport()
        let context = NativeAppServerConnectionContext.localDefault(
            transport: transport,
            bootstrapCredential: "bootstrap-token"
        )
        let dispatcher = RecordingNativeHostClientControlDispatcher()
        let integration = RecordingNativeServerEventReconnectIntegration(session: serverSession(
            sessionID: context.sessionID,
            endpoint: ServerConnection.LocalServerSpec(
                httpBaseURL: "http://127.0.0.1:31337",
                webSocketURL: "ws://127.0.0.1:31337/ws"
            ).endpoint
        ))
        await context.serverEventSource.setController(NativeHostServerEventController(
            controller: NativeHostControlController(dispatcher: dispatcher),
            integration: integration,
            defaultSessionID: context.sessionID
        ))

        let result = await context.sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: "rpc-failure-workspace",
            sessionID: context.sessionID,
            request: ServerConnection.RequestEnvelope(
                method: "tmux.workspace.getSnapshot",
                payload: #"{"workspaceId":"workspace-a"}"#
            )
        ))

        guard case .failure = result else {
            Issue.record("Expected failing transport to keep the original request failed")
            return
        }
        #expect(await transport.methods == ["tmux.workspace.getSnapshot"])
        #expect(await dispatcher.calls.isEmpty)
        #expect(await integration.inputs.map(\.workspaceID.rawValue) == ["workspace-a"])
        #expect(await integration.inputs.map(\.sessionID.rawValue) == [context.sessionID.rawValue])
    }

    @Test("Native app server request rejections do not dispatch reconnect events")
    func nativeAppServerRequestRejectionsDoNotDispatchReconnectEvents() async throws {
        let transport = RejectingNativeAppServerRPCTransport()
        let context = NativeAppServerConnectionContext.localDefault(
            transport: transport,
            bootstrapCredential: "bootstrap-token"
        )
        let dispatcher = RecordingNativeHostClientControlDispatcher()
        let integration = RecordingNativeServerEventReconnectIntegration(session: serverSession(
            sessionID: context.sessionID,
            endpoint: ServerConnection.LocalServerSpec(
                httpBaseURL: "http://127.0.0.1:31337",
                webSocketURL: "ws://127.0.0.1:31337/ws"
            ).endpoint
        ))
        await context.serverEventSource.setController(NativeHostServerEventController(
            controller: NativeHostControlController(dispatcher: dispatcher),
            integration: integration,
            defaultSessionID: context.sessionID
        ))

        let result = await context.sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: "rpc-rejected-workspace",
            sessionID: context.sessionID,
            request: ServerConnection.RequestEnvelope(
                method: "tmux.workspace.getSnapshot",
                payload: #"{"workspaceId":"workspace-a"}"#
            )
        ))

        guard case .failure = result else {
            Issue.record("Expected rejected RPC to keep the original request failed")
            return
        }
        #expect(await transport.methods == ["tmux.workspace.getSnapshot"])
        #expect(await dispatcher.calls.isEmpty)
        #expect(await integration.inputs.isEmpty)
    }

    @Test("Production server event graph restores pane layout from tmux runtime snapshot")
    @MainActor
    func productionServerEventGraphRestoresPaneLayoutFromTmuxRuntimeSnapshot() async throws {
        let transport = SnapshotNativeAppServerRPCTransport()
        let context = NativeAppServerConnectionContext.localDefault(
            transport: transport,
            bootstrapCredential: "bootstrap-token"
        )
        let registry = NativeWorkspaceWindowRegistry(agentPromptSubmitterFactory: RecordingAgentPromptSubmitterFactory())
        let graph = context.serverEventIntegrationGraph(workspaceWindows: registry)
        let controller = NativeHostServerEventController(
            controller: NativeHostControlController(dispatcher: RecordingNativeHostClientControlDispatcher()),
            integration: graph,
            defaultSessionID: context.sessionID,
            projectionApplier: NativeVisibleReconnectProjectionApplier(workspaceWindows: registry)
        )

        let response = await controller.dispatch(.reconnectWorkspace(
                requestID: "server-restart-runtime-restore",
                workspaceID: "workspace-a",
                serverID: "local",
                serverURL: "ws://127.0.0.1:31337/ws",
                sessionID: context.sessionID,
                generation: 0
        ))

        #expect(await transport.methods == ["server.getConfig", "tmux.workspace.getSnapshot", "workflows.listProjectWorkflows", "workflows.getRun", "workflows.getTimeline"])
        #expect(response.ok)
        #expect(response.payload["workspaceCount"] == "1")
        #expect(response.payload["notificationProjectionCount"] == "1")
        let panes = registry.visiblePaneGridState(workspaceID: "workspace-a")?.windows.flatMap { $0.panes } ?? []
        #expect(panes.map { $0.paneID.rawValue } == ["pane-a", "pane-b"])
        #expect(panes.map { $0.tmuxPaneID.rawValue } == ["%1", "%2"])
        #expect(panes.map { $0.rect.y } == [0, 18])
        #expect(!panes.map { $0.paneID.rawValue }.contains("pane-workspace-a"))
        #expect(registry.visibleNotificationState(workspaceID: "workspace-a")?.unreadCount == 1)
        #expect(registry.visibleNotificationState(workspaceID: "workspace-a")?.level == .attention)
    }

    @Test("Production server event graph resubscribes active stream handles on reconnect")
    @MainActor
    func productionServerEventGraphResubscribesActiveStreamHandlesOnReconnect() async throws {
        let transport = SnapshotNativeAppServerRPCTransport()
        let context = NativeAppServerConnectionContext.localDefault(
            transport: transport,
            bootstrapCredential: "bootstrap-token"
        )
        try await context.store.saveStream(ServerConnection.StreamHandle(
            streamID: "pane-stream",
            method: "tmux.pane.subscribeStream",
            payload: #"{"paneId":"pane-a"}"#,
            status: .open,
            openedGeneration: 0
        ), sessionID: context.sessionID)

        let registry = NativeWorkspaceWindowRegistry(agentPromptSubmitterFactory: RecordingAgentPromptSubmitterFactory())
        let graph = context.serverEventIntegrationGraph(workspaceWindows: registry)
        let controller = NativeHostServerEventController(
            controller: NativeHostControlController(dispatcher: RecordingNativeHostClientControlDispatcher()),
            integration: graph,
            defaultSessionID: context.sessionID,
            projectionApplier: NativeVisibleReconnectProjectionApplier(workspaceWindows: registry)
        )

        let response = await controller.dispatch(.reconnectWorkspace(
            requestID: "server-restart-stream-resubscribe",
            workspaceID: "workspace-a",
            serverID: "local",
            serverURL: "ws://127.0.0.1:31337/ws",
            sessionID: context.sessionID,
            generation: 0
        ))
        let streams = try await context.store.loadStreams(sessionID: context.sessionID)

        #expect(response.ok)
        #expect(await transport.methods == ["server.getConfig", "tmux.workspace.getSnapshot", "workflows.listProjectWorkflows", "workflows.getRun", "workflows.getTimeline"])
        #expect(streams.map { $0.streamID } == ["pane-stream"])
        #expect(streams.first?.status == .open)
        #expect(streams.first?.openedGeneration == 1)
    }

    @Test("Server event graph action wrappers can be constructed for live smoke wiring")
    func serverEventGraphActionWrappersCanBeConstructedForLiveSmokeWiring() async throws {
        guard ProcessInfo.processInfo.environment["FENRIR_NATIVE_SERVER_EVENT_SMOKE"] == "1" else {
            return
        }

        let store = ConnectedServerConnectionStore(sessionID: "session-smoke")
        let requestSender = RecordingServerRequestSender()
        let send = ServerConnection.SendServerRequest(
            sender: requestSender,
            store: store,
            clock: NativeShellFixedClock()
        )
        _ = NativeWorkflowProjectionRefreshActions(
            listAction: WorkflowControl.ListWorkflowRuns(
                clock: FixedClock(),
                serverClient: NativeWorkflowUnavailableServerClient()
            ),
            observeAction: WorkflowControl.ObserveWorkflowRunTimeline(
                clock: FixedClock(),
                serverClient: NativeWorkflowUnavailableServerClient()
            )
        )
        _ = NativeNotificationProjectionRefreshAction(
            action: Notifications.ProjectWorkspaceNotifications(
                clock: FixedClock(),
                store: Notifications.inMemoryNotificationStore()
            )
        )

        let runtime = NativePaneGridAppRuntimeController(
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "profile-a", authSessionID: "session-smoke", subject: "user-a"),
            sessionID: "session-smoke",
            sendServerRequest: send
        )
        let gridState = shellPaneGridState()
        let controller = NativePaneGridActionController(initialState: gridState, runtime: runtime)
        _ = await controller.focusPane(gridState.windows[0].panes[0].target(workspaceID: "workspace-a", window: gridState.windows[0]))

        #expect(await requestSender.methods == ["tmux.pane.focus"])
    }

    @MainActor
    private func allLabelStrings(in view: NSView) -> [String] {
        var labels: [String] = []
        if let field = view as? NSTextField {
            labels.append(field.stringValue)
        }
        for subview in view.subviews {
            labels.append(contentsOf: allLabelStrings(in: subview))
        }
        return labels
    }
}

private actor RecordingNativeServerSessionReconnectHandler: NativeServerSessionReconnectHandling {
    private let session: ServerConnection.Session
    private(set) var closeCalls = 0
    private(set) var reconnectCalls = 0

    init(session: ServerConnection.Session) {
        self.session = session
    }

    func handleTransportClose(_ input: ServerConnection.HandleServerTransportCloseInput) async -> Result<ServerConnection.Session, ServerConnection.ServerConnectionError> {
        closeCalls += 1
        return .success(session.withStatus(.reconnecting, generation: input.generation))
    }

    func reconnectSession(_ input: ServerConnection.ReconnectServerSessionInput) async -> Result<ServerConnection.Session, ServerConnection.ServerConnectionError> {
        reconnectCalls += 1
        return .success(session.withStatus(.connected, generation: UInt64(reconnectCalls)))
    }
}

private actor WorkflowEventStreamFake: WorkflowControl.WorkflowEventStreaming {
    private let items: [WorkflowControl.WorkflowEventStreamItem]
    private(set) var filters: [WorkflowControl.WorkflowEventStreamFilter] = []

    init(items: [WorkflowControl.WorkflowEventStreamItem]) {
        self.items = items
    }

    func observeWorkflowEvents(filter: WorkflowControl.WorkflowEventStreamFilter) async -> AsyncThrowingStream<WorkflowControl.WorkflowEventStreamItem, Error> {
        filters.append(filter)
        return AsyncThrowingStream { continuation in
            for item in items {
                continuation.yield(item)
            }
            continuation.finish()
        }
    }
}

private actor RecordingNativeServerEventReconnectIntegration: NativeServerEventReconnectIntegrating {
    private let session: ServerConnection.Session
    private(set) var inputs: [NativeServerWorkspaceReconnectEventInput] = []

    init(session: ServerConnection.Session) {
        self.session = session
    }

    func reconnectWorkspaceFromServerEvent(
        _ input: NativeServerWorkspaceReconnectEventInput
    ) async -> Result<NativeServerReconnectProjection, ServerConnection.ServerConnectionError> {
        inputs.append(input)
        let workspace = WorkspaceIndex.WorkspaceSummary(
            workspaceID: input.workspaceID,
            displayName: input.workspaceID.rawValue,
            isOpenLocally: true,
            status: .open
        )
        return .success(NativeServerReconnectProjection(
            requestID: input.requestID,
            session: session,
            workspaces: [
                WorkspaceCoordinator.WorkspaceExperience(workspace: workspace, serverSelection: .local)
            ],
            workflowRuns: [],
            workflowTimelines: [],
            notifications: [],
            agentInteractions: [],
            failures: []
        ))
    }
}

private actor RecordingNativeHostClientControlDispatcher: NativeHostClientControlDispatching {
    private(set) var calls: [String] = []

    func openWorkspace(_ input: ClientControl.OpenWorkspaceInput) async -> Result<ClientControl.OpenWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("open")
        return .failure(.unavailable)
    }

    func switchWorkspace(_ input: ClientControl.SwitchWorkspaceInput) async -> Result<ClientControl.SwitchWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("switch")
        return .failure(.unavailable)
    }

    func listWorkspaces(_ input: ClientControl.ListWorkspacesInput) async -> Result<ClientControl.ListWorkspacesResult, ClientControl.ClientControlError> {
        calls.append("list")
        return .failure(.unavailable)
    }

    func attachWorkspace(_ input: ClientControl.AttachWorkspaceInput) async -> Result<ClientControl.AttachWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("attach")
        return .failure(.unavailable)
    }

    func removeWorkspace(_ input: ClientControl.RemoveWorkspaceInput) async -> Result<ClientControl.RemoveWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("remove")
        return .failure(.unavailable)
    }

    func focusWorkspace(_ input: ClientControl.FocusWorkspaceInput) async -> Result<ClientControl.FocusWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("focus")
        return .failure(.unavailable)
    }

    func controlWorkspace(_ input: ClientControl.ControlWorkspaceInput) async -> Result<ClientControl.ControlWorkspaceResult, ClientControl.ClientControlError> {
        calls.append("control")
        return .failure(.unavailable)
    }
}

private actor RecordingNativeWorkspaceReconnectHandler: NativeWorkspaceExperienceReconnectHandling {
    private(set) var reconnectWorkspaceIDs: [String] = []

    func reconnectWorkspaceExperience(_ input: WorkspaceCoordinator.ReconnectWorkspaceExperienceInput) async -> Result<WorkspaceCoordinator.ReconnectWorkspaceExperienceResult, WorkspaceCoordinator.WorkspaceCoordinatorError> {
        let workspaceID = input.identity.workspaceID ?? WorkspaceID(rawValue: "workspace-a")
        reconnectWorkspaceIDs.append(workspaceID.rawValue)
        let summary = WorkspaceIndex.WorkspaceSummary(
            workspaceID: workspaceID,
            displayName: workspaceID.rawValue,
            isOpenLocally: true,
            status: .open
        )
        let experience = WorkspaceCoordinator.WorkspaceExperience(
            workspace: summary,
            serverSelection: input.serverSelection,
            layout: shellPaneGridState()
        )
        return .success(WorkspaceCoordinator.ReconnectWorkspaceExperienceResult(
            requestID: input.requestID,
            experience: experience,
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        ))
    }
}

private actor RecordingNativeWorkflowProjectionRefresher: NativeWorkflowProjectionRefreshing {
    private(set) var observedAfterSequences: [Int?] = []

    func listWorkflowRuns(_ input: WorkflowControl.ListWorkflowRunsInput) async -> Result<WorkflowControl.ListWorkflowRunsResult, WorkflowControl.WorkflowControlError> {
        .success(WorkflowControl.ListWorkflowRunsResult(
            requestID: input.requestID,
            runs: [
                nativeIntegrationWorkflowRun(runID: "run-a", updatedAtSeconds: TimeInterval(observedAfterSequences.count + 1))
            ],
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        ))
    }

    func observeWorkflowRunTimeline(_ input: WorkflowControl.ObserveWorkflowRunTimelineInput) async -> Result<WorkflowControl.ObserveWorkflowRunTimelineResult, WorkflowControl.WorkflowControlError> {
        observedAfterSequences.append(input.afterSequence)
        let events: [WorkflowControl.WorkflowTimelineEvent]
        if input.afterSequence == nil {
            events = [
                workflowTimelineEvent(eventID: "workflow-event-1", kind: .runStarted, title: "Started", sequence: 1),
                workflowTimelineEvent(eventID: "workflow-event-2", kind: .notificationEmitted, title: "Step", sequence: 2)
            ]
        } else {
            events = [
                workflowTimelineEvent(eventID: "workflow-event-2", kind: .notificationEmitted, title: "Step", sequence: 2)
            ]
        }
        return .success(WorkflowControl.ObserveWorkflowRunTimelineResult(
            requestID: input.requestID,
            timeline: WorkflowControl.WorkflowRunTimeline(
                runID: input.runID,
                events: events,
                projectedStatus: .running,
                nextSequence: 3,
                replayedFromSequence: input.afterSequence,
                replayIncludesHistoricalEvents: input.afterSequence == nil
            ),
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        ))
    }
}

private actor RecordingNativeNotificationProjectionRefresher: NativeNotificationProjectionRefreshing {
    private(set) var projectedWorkspaceIDs: [String] = []
    private(set) var recordedNotificationEventIDs: [String] = []

    func recordWorkflowNotification(
        workspaceID: WorkspaceID,
        event: WorkflowControl.WorkflowTimelineEvent,
        source: ActionSource
    ) async -> Result<Notifications.CreateNotificationResult, Notifications.NotificationsError> {
        recordedNotificationEventIDs.append(event.eventID.rawValue)
        return .success(Notifications.CreateNotificationResult(
            requestID: RequestID(rawValue: "record-\(event.eventID.rawValue)"),
            notification: Notifications.NotificationRecord(
                id: Notifications.NotificationID(rawValue: "notification-\(event.eventID.rawValue)"),
                workspaceID: workspaceID,
                source: .workflow(runID: event.runID.rawValue),
                severity: .warning,
                title: event.title,
                message: event.body ?? event.title,
                dedupeKey: Notifications.NotificationDedupeKey(rawValue: "workflow:\(event.eventID.rawValue)"),
                createdAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
                updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1))
            ),
            deduped: false,
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        ))
    }

    func projectWorkspaceNotifications(_ input: Notifications.ProjectWorkspaceNotificationsInput) async -> Result<Notifications.ProjectWorkspaceNotificationsResult, Notifications.NotificationsError> {
        projectedWorkspaceIDs.append(input.workspaceID.rawValue)
        return .success(Notifications.ProjectWorkspaceNotificationsResult(
            requestID: input.requestID,
            projection: Notifications.WorkspaceNotificationProjection(
                workspaceID: input.workspaceID,
                activeCount: 1,
                unacknowledgedCount: 1,
                highestSeverity: .warning,
                items: []
            ),
            timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1))
        ))
    }
}

private actor RecordingNativeAgentInteractionRefresher: NativeAgentInteractionRefreshing {
    func refreshAgentInteractions(_ input: NativeAgentInteractionRefreshInput) async -> Result<NativeAgentInteractionRefreshResult, AgentInteraction.AgentInteractionError> {
        .success(NativeAgentInteractionRefreshResult(
            requestID: input.requestID,
            workspaceID: input.workspaceID,
            activeComposerIDs: input.activeComposerIDs
        ))
    }
}

private extension ServerConnection.Session {
    func withStatus(_ status: ServerConnection.ConnectionStatus, generation: UInt64) -> ServerConnection.Session {
        ServerConnection.Session(
            sessionID: sessionID,
            endpoint: endpoint,
            actor: actor,
            authSessionID: authSessionID,
            capabilities: capabilities,
            status: status,
            openedAt: openedAt,
            lastHeartbeatAt: lastHeartbeatAt,
            reconnectGeneration: generation
        )
    }
}

private func nativeIntegrationWorkflowRun(
    runID: WorkflowControl.WorkflowRunID,
    updatedAtSeconds: TimeInterval
) -> WorkflowControl.WorkflowRunSnapshot {
    WorkflowControl.WorkflowRunSnapshot(
        runID: runID,
        workflowID: "workflow-a",
        projectID: "workspace-a",
        originThreadID: "thread-a",
        trigger: .manual,
        name: "Reconnect workflow",
        status: .running,
        startedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
        lastUpdatedAt: FenrirTimestamp(Date(timeIntervalSince1970: updatedAtSeconds))
    )
}

private func workflowTimelineEvent(
    eventID: WorkflowControl.WorkflowEventID = "workflow-event-1",
    kind: WorkflowControl.WorkflowEventKind,
    title: String,
    body: String? = nil,
    payload: WorkflowControl.WorkflowJSONValue = .object([:]),
    sequence: Int = 1
) -> WorkflowControl.WorkflowTimelineEvent {
    WorkflowControl.WorkflowTimelineEvent(
        eventID: eventID,
        workflowID: "workflow-a",
        runID: "run-a",
        kind: kind,
        title: title,
        body: body,
        payload: payload,
        sequence: sequence,
        createdAt: FenrirTimestamp(Date(timeIntervalSince1970: TimeInterval(sequence)))
    )
}

private func state(
    workspaceID: WorkspaceID = "workspace-a",
    focusedSurface: NativeWorkspaceFocusSurface = .terminal(nil),
    paneGridState: PaneGrid.State = shellPaneGridState(),
    activeOverlayIDs: [WorkspaceOverlays.OverlayID] = [],
    paletteFileItems: [WorkspaceOverlays.PaletteItem] = []
) -> NativeWorkspaceShellState {
    NativeWorkspaceShellState(
        workspaceID: workspaceID,
        nativeWindowID: "window-a",
        paneGridState: paneGridState,
        sidebarItems: [
            sidebarItem("workspace-a", name: "Alpha", visibility: .visible, unread: 2, level: .badge)
        ],
        paletteFileItems: paletteFileItems,
        focusedSurface: focusedSurface,
        activeOverlayIDs: activeOverlayIDs
    )
}

private func paletteItem(
    _ id: String,
    title: String,
    keywords: [String] = []
) -> WorkspaceOverlays.PaletteItem {
    WorkspaceOverlays.PaletteItem(
        id: id,
        domain: .actions,
        title: title,
        subtitle: "\(title) command",
        keywords: keywords,
        action: .runAction(id),
        baseScore: 10
    )
}

private func tmuxSnapshot(neovim: Bool) -> String {
    let neovimPane = neovim
        ? """
        ,
            {
              "paneId": "pane-nvim",
              "workspaceId": "workspace-a",
              "windowId": "window-a",
              "tmuxPaneId": "%2",
              "cwd": "/repo",
              "x": 120,
              "y": 0,
              "cols": 120,
              "rows": 36,
              "status": "running",
              "metadata": {
                "kind": "neovim",
                "title": "nvim",
                "neovim": {
                  "bootstrapId": "nvim-bootstrap",
                  "workspaceId": "workspace-a",
                  "windowId": "window-a",
                  "cwd": "/repo",
                  "profileId": "default",
                  "themeId": "fenrir-dark",
                  "keybindingProfileId": "native-compatible",
                  "bridgeSocketPath": "/tmp/fenrir-nvim.sock",
                  "files": ["/repo/App.swift"],
                  "launchSource": "user",
                  "bootstrapEnvKeys": ["NVIM_LISTEN_ADDRESS"]
                }
              },
              "stream": {
                "streamId": "stream-pane-nvim",
                "paneId": "pane-nvim",
                "lowSeq": 0,
                "highSeq": 0,
                "droppedCount": 0
              },
              "createdAt": "2026-01-01T00:00:00.000Z",
              "updatedAt": "2026-01-01T00:00:00.000Z"
            }
        """
        : ""
    return """
    {
      "workspace": {
        "workspaceId": "workspace-a",
        "tmuxSessionName": "tmux-workspace-a",
        "status": "running",
        "activeWindowId": "window-a"
      },
      "windows": [
        {
          "windowId": "window-a",
          "workspaceId": "workspace-a",
          "tmuxWindowId": "@1",
          "tmuxWindowIndex": 0,
          "name": "editor",
          "status": "running",
          "activePaneId": "pane-a"
        }
      ],
      "panes": [
        {
          "paneId": "pane-a",
          "workspaceId": "workspace-a",
          "windowId": "window-a",
          "tmuxPaneId": "%1",
          "cwd": "/repo",
          "x": 0,
          "y": 0,
          "cols": 120,
          "rows": 36,
          "status": "running",
          "metadata": {
            "kind": "shell",
            "title": "shell",
            "neovim": null
          },
          "stream": {
            "streamId": "stream-pane-a",
            "paneId": "pane-a",
            "lowSeq": 0,
            "highSeq": 0,
            "droppedCount": 0
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
        \(neovimPane)
      ],
      "revision": 1
    }
    """
}

private func tmuxSplitSnapshot() -> String {
    """
    {
      "workspace": {
        "workspaceId": "workspace-a",
        "tmuxSessionName": "tmux-workspace-a",
        "status": "running",
        "activeWindowId": "window-a"
      },
      "windows": [
        {
          "windowId": "window-a",
          "workspaceId": "workspace-a",
          "tmuxWindowId": "@1",
          "tmuxWindowIndex": 0,
          "name": "editor",
          "status": "running",
          "activePaneId": "pane-a"
        }
      ],
      "panes": [
        {
          "paneId": "pane-a",
          "workspaceId": "workspace-a",
          "windowId": "window-a",
          "tmuxPaneId": "%1",
          "cwd": "/repo",
          "x": 0,
          "y": 0,
          "cols": 120,
          "rows": 18,
          "status": "running",
          "metadata": {
            "kind": "shell",
            "title": "top",
            "neovim": null
          },
          "stream": {
            "streamId": "stream-pane-a",
            "paneId": "pane-a",
            "lowSeq": 0,
            "highSeq": 0,
            "droppedCount": 0
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        },
        {
          "paneId": "pane-b",
          "workspaceId": "workspace-a",
          "windowId": "window-a",
          "tmuxPaneId": "%2",
          "cwd": "/repo",
          "x": 0,
          "y": 18,
          "cols": 120,
          "rows": 18,
          "status": "running",
          "metadata": {
            "kind": "shell",
            "title": "bottom",
            "neovim": null
          },
          "stream": {
            "streamId": "stream-pane-b",
            "paneId": "pane-b",
            "lowSeq": 0,
            "highSeq": 0,
            "droppedCount": 0
          },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "revision": 1
    }
    """
}

private actor RecordingAgentPromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    private(set) var requests: [AgentInteraction.ServerPromptRequest] = []

    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        requests.append(request)
        return AgentInteraction.ServerPromptAccepted(
            promptID: RequestID(rawValue: "accepted-\(request.requestID.rawValue)"),
            acceptedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
        )
    }
}

private struct RecordingAgentPromptSubmitterFactory: NativeAgentPromptSubmitterMaking {
    func makeSubmitter(for state: NativeWorkspaceShellState) -> any AgentInteraction.AgentPromptSubmitting {
        RecordingAgentPromptSubmitter()
    }
}

@MainActor
private func keyEvent(
    key: String,
    modifiers: NSEvent.ModifierFlags,
    keyCode: UInt16
) -> NSEvent {
    NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: modifiers,
        timestamp: 0,
        windowNumber: 0,
        context: nil,
        characters: key,
        charactersIgnoringModifiers: key,
        isARepeat: false,
        keyCode: keyCode
    )!
}

private func shellPaneGridState(
    activeWindowID: FenrirWindowID = "window-a",
    includeSecondWindow: Bool = true,
    columns: Int = 120,
    rows: Int = 36,
    streamID: StreamID? = nil
) -> PaneGrid.State {
    let paneA = PaneGrid.PanePresentation(
        paneID: "pane-a",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%1"),
        streamID: streamID,
        viewportID: "viewport-pane-a",
        title: "shell",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: columns, rows: rows),
        isFocused: true
    )
    let paneB = PaneGrid.PanePresentation(
        paneID: "pane-b",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%2"),
        streamID: streamID.map { StreamID(rawValue: "\($0.rawValue)-b") },
        viewportID: "viewport-pane-b",
        title: "shell-b",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: columns, rows: rows),
        isFocused: true
    )
    var windows = [
        PaneGrid.WindowPresentation(
            windowID: "window-a",
            tmuxWindowID: "tmux-window-a",
            index: 0,
            title: "main",
            root: .pane(paneA),
            activePaneID: "pane-a",
            panes: [paneA]
        )
    ]
    if includeSecondWindow {
        windows.append(PaneGrid.WindowPresentation(
            windowID: "window-b",
            tmuxWindowID: "tmux-window-b",
            index: 1,
            title: "logs",
            root: .pane(paneB),
            activePaneID: "pane-b",
            panes: [paneB]
        ))
    }
    return PaneGrid.State(
        workspaceID: "workspace-a",
        tmuxSessionID: "tmux-session-a",
        activeWindowID: activeWindowID,
        windows: windows
    )
}

private func nativeHostTerminalViewportState(
    viewportID: ViewportID,
    streamID: StreamID? = nil,
    lastAppliedSequence: UInt64? = nil
) -> TerminalViewport.State {
    TerminalViewport.State(
        viewportID: viewportID,
        workspaceID: "workspace-a",
        tabID: "window-a",
        paneID: "pane-a",
        streamID: streamID,
        lastAppliedSequence: lastAppliedSequence,
        isFocused: true,
        rendererStatus: .ready,
        streamStatus: streamID == nil ? .detached : .attached,
        size: TerminalViewport.Size(columns: 120, rows: 36, pixelWidth: 960, pixelHeight: 720)
    )
}

@MainActor
private func waitUntil(
    timeoutNanoseconds: UInt64 = 250_000_000,
    condition: @escaping @MainActor () -> Bool
) async throws {
    let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
    while !condition() {
        if DispatchTime.now().uptimeNanoseconds >= deadline {
            Issue.record("Timed out waiting for condition")
            return
        }
        try await Task.sleep(nanoseconds: 5_000_000)
    }
}

@MainActor
private final class NativeHostRecordingTerminalBackend: FenrirTerminalBackend {
    let descriptor = TerminalViewport.RendererDescriptor(rendererID: "native-host-recording-terminal", status: .ready)
    private(set) var outputs: [Data] = []
    private(set) var renderedText = ""

    func mount(in hostView: NSView) {
        _ = hostView
    }

    func unmount() {}

    func attach(streamID: StreamID) {
        _ = streamID
    }

    func detach(streamID: StreamID) {
        _ = streamID
    }

    func applyOutput(_ bytes: Data) {
        outputs.append(bytes)
        renderedText += String(decoding: bytes, as: UTF8.self)
    }

    func sendUserInput(_ bytes: Data) {
        _ = bytes
    }

    func resize(_ size: TerminalViewport.Size) {
        _ = size
    }

    func setFocused(_ focused: Bool) {
        _ = focused
    }

    func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: "")
    }

    func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: renderedText)
    }

    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        _ = maxLines
        return TerminalViewport.CapturedTextBuffer(text: renderedText)
    }
}

private final class FakePaneGridActions: NativePaneGridActionDispatching, @unchecked Sendable {
    private let lock = NSLock()
    private var recordedCalls: [String] = []

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedCalls
    }

    func applyPaneGridState(_ state: PaneGrid.State) {
        append("apply:\(state.activeWindowID.rawValue)")
    }

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {
        append("server-backed:\(state.activeWindowID.rawValue)")
    }

    func focusPane(_ target: PaneGrid.PaneKernelTarget) async -> PaneGrid.State? {
        append("focus:\(target.paneID.rawValue):\(target.tmuxPaneID.rawValue)")
        return nil
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async -> PaneGrid.State? {
        append("select:\(command.windowID.rawValue):\(command.tmuxWindowID)")
        return nil
    }

    func resizePane(_ allocation: PaneGrid.PaneResizeAllocation, in state: PaneGrid.State) async {
        append("resize:\(allocation.paneID.rawValue):\(allocation.delta):\(allocation.unit.rawValue):\(allocation.direction.rawValue)")
    }

    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: TerminalViewport.Size, in state: PaneGrid.State) async {
        append("resize-absolute:\(target.paneID.rawValue):\(target.tmuxPaneID.rawValue):\(size.columns):\(size.rows)")
    }

    private func append(_ call: String) {
        lock.lock()
        defer { lock.unlock() }
        recordedCalls.append(call)
    }
}

private final class SelectReturningPaneGridActions: NativePaneGridActionDispatching, @unchecked Sendable {
    private let nextState: PaneGrid.State

    init(nextState: PaneGrid.State) {
        self.nextState = nextState
    }

    func applyPaneGridState(_ state: PaneGrid.State) {}
    func markServerBackedPaneGridState(_ state: PaneGrid.State) {}
    func focusPane(_ target: PaneGrid.PaneKernelTarget) async -> PaneGrid.State? { nil }
    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async -> PaneGrid.State? { nextState }
    func resizePane(_ allocation: PaneGrid.PaneResizeAllocation, in state: PaneGrid.State) async {}
    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: TerminalViewport.Size, in state: PaneGrid.State) async {}
}

private final class StreamSubscriptionRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var continuations: [PaneID: AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error>.Continuation] = [:]
    private var continuationsByStreamID: [StreamID: AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error>.Continuation] = [:]
    private var recordedPaneIDs: [PaneID] = []
    private var recordedStreamIDs: [StreamID] = []
    private var recordedBackfills: [NativeRuntime.BackfillMode] = []

    var paneIDs: [PaneID] {
        lock.lock()
        defer { lock.unlock() }
        return recordedPaneIDs
    }

    var streamIDs: [StreamID] {
        lock.lock()
        defer { lock.unlock() }
        return recordedStreamIDs
    }

    var backfills: [NativeRuntime.BackfillMode] {
        lock.lock()
        defer { lock.unlock() }
        return recordedBackfills
    }

    func subscribe(
        workspaceID: WorkspaceID,
        pane: PaneGrid.PanePresentation,
        backfill: NativeRuntime.BackfillMode
    ) async -> AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error> {
        _ = workspaceID
        return AsyncThrowingStream { continuation in
            lock.lock()
            recordedPaneIDs.append(pane.paneID)
            if let streamID = pane.streamID {
                recordedStreamIDs.append(streamID)
                continuationsByStreamID[streamID] = continuation
            }
            recordedBackfills.append(backfill)
            continuations[pane.paneID] = continuation
            lock.unlock()
        }
    }

    func yield(_ envelope: NativeRuntime.PaneStreamEnvelope, paneID: PaneID) {
        lock.lock()
        let continuation = continuations[paneID]
        lock.unlock()
        continuation?.yield(envelope)
    }

    func yield(_ envelope: NativeRuntime.PaneStreamEnvelope, streamID: StreamID) {
        lock.lock()
        let continuation = continuationsByStreamID[streamID]
        lock.unlock()
        continuation?.yield(envelope)
    }

    func finishAll() {
        lock.lock()
        let values = Array(continuations.values)
        continuations.removeAll()
        continuationsByStreamID.removeAll()
        lock.unlock()
        values.forEach { $0.finish() }
    }
}

private final class RecordingPaneGridRuntimeController: NativePaneGridRuntimeControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var recordedCalls: [String] = []
    private var recordedAppliedStates: [PaneGrid.State] = []

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recordedCalls
    }

    var appliedStates: [PaneGrid.State] {
        lock.lock()
        defer { lock.unlock() }
        return recordedAppliedStates
    }

    func applyPaneGridState(_ state: PaneGrid.State) {
        lock.lock()
        defer { lock.unlock() }
        recordedAppliedStates.append(state)
    }

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {}

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        append("focus:\(command.target.paneID.rawValue):\(command.target.tmuxPaneID.rawValue)")
    }

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        append("resize:\(command.target.paneID.rawValue):\(command.delta):\(command.unit.rawValue):\(command.direction.rawValue)")
    }

    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws {
        append("resize-absolute:\(target.paneID.rawValue):\(target.tmuxPaneID.rawValue):\(size.columns):\(size.rows)")
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        append("select:\(command.windowID.rawValue):\(command.tmuxWindowID)")
    }

    private func append(_ call: String) {
        lock.lock()
        defer { lock.unlock() }
        recordedCalls.append(call)
    }
}

private struct NativeRPCURLProtocolResponse: Sendable {
    let statusCode: Int
    let body: Data
}

private struct RecordedNativeRPCURLRequest: Sendable {
    let path: String
    let method: String
    let authorization: String?
    let contentType: String?
    let body: String
}

private final class NativeRPCURLProtocolRecorder: @unchecked Sendable {
    static let shared = NativeRPCURLProtocolRecorder()

    private let lock = NSLock()
    private var responsesByPath: [String: [NativeRPCURLProtocolResponse]] = [:]
    private var recordedRequests: [RecordedNativeRPCURLRequest] = []

    var requests: [RecordedNativeRPCURLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recordedRequests
    }

    func configure(_ responsesByPath: [String: [NativeRPCURLProtocolResponse]]) {
        lock.lock()
        defer { lock.unlock() }
        self.responsesByPath = responsesByPath
        recordedRequests = []
    }

    func response(for request: RecordedNativeRPCURLRequest) -> NativeRPCURLProtocolResponse {
        lock.lock()
        defer { lock.unlock() }
        recordedRequests.append(request)
        var responses = responsesByPath[request.path] ?? []
        if responses.isEmpty {
            return NativeRPCURLProtocolResponse(
                statusCode: 500,
                body: Data(#"{"error":"Unexpected native RPC recording request."}"#.utf8)
            )
        }
        let response = responses.removeFirst()
        responsesByPath[request.path] = responses
        return response
    }
}

private final class RecordingNativeRPCURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let recorded = RecordedNativeRPCURLRequest(
            path: request.url?.path ?? "",
            method: request.httpMethod ?? "",
            authorization: headerValue("authorization", in: request),
            contentType: headerValue("content-type", in: request),
            body: String(decoding: requestBodyData(in: request), as: UTF8.self)
        )
        let client = client
        let url = request.url ?? URL(string: "http://127.0.0.1")!
        let stub = NativeRPCURLProtocolRecorder.shared.response(for: recorded)
        let response = HTTPURLResponse(
            url: url,
            statusCode: stub.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["content-type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func headerValue(_ name: String, in request: URLRequest) -> String? {
        request.allHTTPHeaderFields?.first(where: { $0.key.lowercased() == name })?.value
    }

    private func requestBodyData(in request: URLRequest) -> Data {
        if let body = request.httpBody {
            return body
        }
        guard let stream = request.httpBodyStream else {
            return Data()
        }

        stream.open()
        defer { stream.close() }

        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count > 0 {
                data.append(buffer, count: count)
            } else {
                break
            }
        }
        return data
    }
}

private func nativeRPCRecordingURLSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RecordingNativeRPCURLProtocol.self]
    return URLSession(configuration: configuration)
}

private func nativeRPCJSONObject(_ request: RecordedNativeRPCURLRequest) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: Data(request.body.utf8), options: []) as? [String: Any] else {
        throw ServerConnection.ServerConnectionError.protocolMismatch
    }
    return object
}

private actor RecordingServerRequestSender: ServerConnection.ServerRequestSending {
    private var requests: [(sessionID: ServerConnection.SessionID, requestID: RequestID, request: ServerConnection.RequestEnvelope)] = []
    private let responsesByMethod: [String: String]

    init(responsesByMethod: [String: String] = [:]) {
        self.responsesByMethod = responsesByMethod
    }

    var methods: [String] {
        requests.map(\.request.method)
    }

    var sessionIDs: [ServerConnection.SessionID] {
        requests.map(\.sessionID)
    }

    func stringPayloadValue(at index: Int, key: String) -> String? {
        payloadDictionary(at: index)?[key] as? String
    }

    func intPayloadValue(at index: Int, key: String) -> Int? {
        payloadDictionary(at: index)?[key] as? Int
    }

    func stringArrayPayloadValue(at index: Int, key: String) -> [String]? {
        payloadDictionary(at: index)?[key] as? [String]
    }

    func stringPayloadValue(at index: Int, path: [String]) -> String? {
        var value: Any? = payloadDictionary(at: index)
        for key in path {
            value = (value as? [String: Any])?[key]
        }
        return value as? String
    }

    private func payloadDictionary(at index: Int) -> [String: Any]? {
        guard requests.indices.contains(index),
              let object = try? JSONSerialization.jsonObject(with: Data(requests[index].request.payload.utf8)),
              let dictionary = object as? [String: Any]
        else {
            return nil
        }
        return dictionary
    }

    func sendServerRequest(
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        requests.append((session.sessionID, requestID, request))
        return ServerConnection.ResponseEnvelope(
            method: request.method,
            payload: responsesByMethod[request.method] ?? "{}",
            generation: session.reconnectGeneration
        )
    }
}

private actor ConnectedServerConnectionStore: ServerConnection.ServerConnectionStore {
    private var session: ServerConnection.Session
    private var activeRequests = 0

    init(
        sessionID: ServerConnection.SessionID,
        endpoint: ServerConnection.Endpoint = ServerConnection.Endpoint(
            endpointID: "local-main",
            kind: .local,
            transport: .unixDomainSocket(path: "/tmp/fenrir.sock"),
            httpBaseURL: "http://localhost:3000",
            displayName: "Local Fenrir"
        )
    ) {
        let authSessionID = AuthSession.SessionID(rawValue: sessionID.rawValue)
        let actor = AuthSession.AuthenticatedActor(
            endpointScope: endpoint.authEndpointScope,
            sessionID: authSessionID,
            subject: "native-client",
            role: .owner
        )
        session = ServerConnection.Session(
            sessionID: sessionID,
            endpoint: endpoint,
            actor: actor,
            authSessionID: authSessionID,
            capabilities: ServerConnection.Capabilities(
                protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
                supportsTmuxKernel: true,
                supportsPaneStreams: true,
                supportsAuthenticatedActors: true
            ),
            status: .connected,
            openedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
            reconnectGeneration: 0
        )
    }

    func loadSession(sessionID: ServerConnection.SessionID?) async throws -> ServerConnection.Session? {
        guard sessionID == nil || sessionID == session.sessionID else {
            return nil
        }
        return session
    }

    func saveSession(_ session: ServerConnection.Session) async throws {
        self.session = session
    }

    func deleteSession(sessionID: ServerConnection.SessionID) async throws {}

    func nextReconnectGeneration(sessionID: ServerConnection.SessionID) async throws -> UInt64 {
        session.reconnectGeneration + 1
    }

    func activeRequestCount(sessionID: ServerConnection.SessionID) async throws -> Int {
        activeRequests
    }

    func incrementActiveRequestCount(sessionID: ServerConnection.SessionID) async throws {
        activeRequests += 1
    }

    func decrementActiveRequestCount(sessionID: ServerConnection.SessionID) async throws {
        activeRequests = max(0, activeRequests - 1)
    }

    func loadStreams(sessionID: ServerConnection.SessionID) async throws -> [ServerConnection.StreamHandle] {
        []
    }

    func saveStream(_ stream: ServerConnection.StreamHandle, sessionID: ServerConnection.SessionID) async throws {}

    func deleteStream(streamID: ServerConnection.StreamID, sessionID: ServerConnection.SessionID) async throws {}

    func transportStats(sessionID: ServerConnection.SessionID) async throws -> ServerConnection.TransportStats {
        ServerConnection.TransportStats()
    }

    func saveTransportStats(_ stats: ServerConnection.TransportStats, sessionID: ServerConnection.SessionID) async throws {}

    func commitReconnect(_ commit: ServerConnection.ReconnectCommit) async throws {
        session = commit.session
    }
}

private struct NativeShellFixedClock: ServerConnection.ServerConnectionClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1))
    }
}

private func serverSession(
    sessionID: ServerConnection.SessionID,
    endpoint: ServerConnection.Endpoint
) -> ServerConnection.Session {
    let authSessionID = AuthSession.SessionID(rawValue: sessionID.rawValue)
    let actor = AuthSession.AuthenticatedActor(
        endpointScope: endpoint.authEndpointScope,
        sessionID: authSessionID,
        subject: "native-client",
        role: .owner
    )
    return ServerConnection.Session(
        sessionID: sessionID,
        endpoint: endpoint,
        actor: actor,
        authSessionID: authSessionID,
        capabilities: ServerConnection.Capabilities(
            protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
            supportsTmuxKernel: true,
            supportsPaneStreams: true,
            supportsAuthenticatedActors: true
        ),
        status: .connected,
        openedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1)),
        reconnectGeneration: 0
    )
}

private actor WorkflowEventStreamNativeAppServerRPCTransport: ServerConnection.NativeServerRPCTransporting {
    private(set) var methods: [String] = []
    private(set) var bootstrapCredentials: [String] = []

    func sendAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        ServerConnection.ResponseEnvelope(method: request.method, payload: #"{}"#, generation: session.reconnectGeneration)
    }

    func streamAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        methods.append(request.method)
        bootstrapCredentials.append(bootstrapCredential)
        return AsyncThrowingStream { continuation in
            for payload in Self.payloads {
                continuation.yield(Data(payload.utf8))
            }
            continuation.finish()
        }
    }

    private static let payloads: [String] = [
        #"{"type":"workflow.run.changed","run":{"runId":"run-a","workflowId":"workflow-a","projectId":"project-1","originThreadId":"thread-a","trigger":"manual","name":"Run A","args":{},"runtimeContext":null,"status":"running","summary":null,"startedAt":"2026-01-01T00:00:00Z","completedAt":null,"lastUpdatedAt":"2026-01-01T00:00:01Z","steps":[],"agents":[],"tasks":[],"inputRequests":[]}}"#,
        #"{"type":"workflow.event.appended","event":{"eventId":"event-a","workflowId":"workflow-a","runId":"run-a","stepId":null,"agentId":null,"taskId":null,"kind":"workflow.step.started","title":"Step started","body":null,"payload":{},"sequence":7,"createdAt":"2026-01-01T00:00:02Z"}}"#,
        #"{"type":"workflow.changed","workflow":{"workflowId":"workflow-a"}}"#,
        #"{"type":"workflow.event.appended","event":{"eventId":"event-no-run","workflowId":"workflow-a","runId":null,"stepId":null,"agentId":null,"taskId":null,"kind":"workflow.draft.created","title":"Draft","body":null,"payload":{},"sequence":8,"createdAt":"2026-01-01T00:00:03Z"}}"#,
        #"{"type":"workflow.run.changed","run":{"runId":"run-b","workflowId":"workflow-b","projectId":"project-1","originThreadId":"thread-a","trigger":"manual","name":"Run B","args":{},"runtimeContext":null,"status":"running","summary":null,"startedAt":"2026-01-01T00:00:00Z","completedAt":null,"lastUpdatedAt":"2026-01-01T00:00:01Z","steps":[],"agents":[],"tasks":[],"inputRequests":[]}}"#
    ]
}

private actor RecordingNativeAppServerRPCTransport: ServerConnection.NativeServerRPCTransporting {
    private(set) var bootstrapCredentials: [String] = []
    private(set) var httpBaseURLs: [String] = []
    private(set) var webSocketURLs: [String] = []
    private(set) var methods: [String] = []
    private var payloads: [[String: Any]] = []

    func sendAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        bootstrapCredentials.append(bootstrapCredential)
        httpBaseURLs.append(httpBaseURL.absoluteString)
        webSocketURLs.append(webSocketURL.absoluteString)
        methods.append(request.method)
        if let payload = try JSONSerialization.jsonObject(with: Data(request.payload.utf8), options: []) as? [String: Any] {
            payloads.append(payload)
        }
        return ServerConnection.ResponseEnvelope(
            method: request.method,
            payload: #"{"accepted":true}"#,
            generation: session.reconnectGeneration
        )
    }

    func streamAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish()
        }
    }

    func stringPayloadValue(at index: Int, key: String) -> String? {
        guard payloads.indices.contains(index) else {
            return nil
        }
        return payloads[index][key] as? String
    }
}

private actor FailingNativeAppServerRPCTransport: ServerConnection.NativeServerRPCTransporting {
    private(set) var methods: [String] = []

    func sendAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        methods.append(request.method)
        throw ServerConnection.ServerConnectionError.transportUnavailable
    }

    func streamAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish(throwing: ServerConnection.ServerConnectionError.transportUnavailable)
        }
    }
}

private actor RejectingNativeAppServerRPCTransport: ServerConnection.NativeServerRPCTransporting {
    private(set) var methods: [String] = []

    func sendAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        methods.append(request.method)
        throw ServerConnection.ServerConnectionError.requestRejected
    }

    func streamAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish(throwing: ServerConnection.ServerConnectionError.requestRejected)
        }
    }
}

private actor SnapshotNativeAppServerRPCTransport: ServerConnection.NativeServerRPCTransporting {
    private(set) var methods: [String] = []

    func sendAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> ServerConnection.ResponseEnvelope {
        methods.append(request.method)
        let payload: String
        switch request.method {
        case "tmux.workspace.getSnapshot":
            payload = tmuxSplitSnapshot()
        case "workflows.listProjectWorkflows":
            payload = """
            {"runs":[{"runId":"run-a","workflowId":"workflow-a","projectId":"workspace-a","originThreadId":"thread-a","trigger":"manual","name":"Reconnect workflow","args":{},"runtimeContext":null,"status":"running","summary":null,"startedAt":{"date":"2026-01-01T00:00:00Z"},"completedAt":null,"lastUpdatedAt":{"date":"2026-01-01T00:00:01Z"},"steps":[],"agents":[],"tasks":[],"inputRequests":[]}]}
            """
        case "workflows.getRun":
            payload = """
            {"runId":"run-a","workflowId":"workflow-a","projectId":"workspace-a","originThreadId":"thread-a","trigger":"manual","name":"Reconnect workflow","args":{},"runtimeContext":null,"status":"running","summary":null,"startedAt":{"date":"2026-01-01T00:00:00Z"},"completedAt":null,"lastUpdatedAt":{"date":"2026-01-01T00:00:01Z"},"steps":[],"agents":[],"tasks":[],"inputRequests":[]}
            """
        case "workflows.getTimeline":
            payload = """
            {"events":[{"eventId":"workflow-event-notification","workflowId":"workflow-a","runId":"run-a","kind":"workflow.notification.emitted","title":"Workflow needs attention","body":"Review the workflow result","payload":{"level":"warning"},"sequence":1,"createdAt":{"date":"2026-01-01T00:00:01Z"}}]}
            """
        default:
            payload = #"{"accepted":true}"#
        }
        return ServerConnection.ResponseEnvelope(
            method: request.method,
            payload: payload,
            generation: session.reconnectGeneration
        )
    }

    func streamAuthenticatedRPC(
        httpBaseURL: URL,
        webSocketURL: URL,
        bootstrapCredential: String,
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish()
        }
    }
}

private actor RecordingNativeAppServerRPCNetwork: ServerConnection.NativeServerRPCNetworking {
    private(set) var bootstrapCredentials: [String] = []
    private(set) var bearerTokens: [String] = []
    private(set) var httpBaseURLs: [String] = []
    private(set) var methods: [String] = []
    private let exchangeDelayNanoseconds: UInt64

    init(exchangeDelayNanoseconds: UInt64 = 0) {
        self.exchangeDelayNanoseconds = exchangeDelayNanoseconds
    }

    func exchangeBearerSession(httpBaseURL: URL, credential: String) async throws -> ServerConnection.NativeBearerSession {
        bootstrapCredentials.append(credential)
        if exchangeDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: exchangeDelayNanoseconds)
        }
        return ServerConnection.NativeBearerSession(token: "bearer-session-token", authSessionID: "auth-session-native-test")
    }

    func sendUnaryNativeRPC(
        httpBaseURL: URL,
        bearerToken: String,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async throws -> String {
        httpBaseURLs.append(httpBaseURL.absoluteString)
        bearerTokens.append(bearerToken)
        methods.append(request.method)
        return #"{"accepted":true}"#
    }

    func streamNativeRPC(
        httpBaseURL: URL,
        bearerToken: String,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope
    ) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish()
        }
    }
}

private actor RecordingPaneGridKernel: PaneGrid.PaneKernelControlling {
    private(set) var calls: [String] = []

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        calls.append("focus:\(command.target.paneID.rawValue):\(command.target.tmuxPaneID.rawValue)")
    }

    func splitPane(_ command: PaneGrid.SplitPaneCommand) async throws -> PaneID {
        command.target.paneID
    }

    func closePane(_ command: PaneGrid.ClosePaneCommand) async throws {}

    func movePane(_ command: PaneGrid.MovePaneCommand) async throws {}

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        calls.append("resize:\(command.target.paneID.rawValue):\(command.delta):\(command.unit.rawValue):\(command.direction.rawValue)")
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        calls.append("select:\(command.windowID.rawValue):\(command.tmuxWindowID)")
    }
}

private func packageRoot() -> URL {
    var fileURL = URL(fileURLWithPath: #filePath)
    while fileURL.lastPathComponent != "FenrirNative" {
        let next = fileURL.deletingLastPathComponent()
        if next.path == fileURL.path {
            return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        }
        fileURL = next
    }
    return fileURL
}

private func swiftSourceFiles(under directory: URL) throws -> [URL] {
    guard let enumerator = FileManager.default.enumerator(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
    ) else {
        return []
    }

    return try enumerator.compactMap { item in
        guard let url = item as? URL, url.pathExtension == "swift" else {
            return nil
        }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey])
        return values.isRegularFile == true ? url : nil
    }
}

private func rgbHex(_ color: NSColor) -> UInt32 {
    UInt32(round(color.redComponent * 255)) << 16
        | UInt32(round(color.greenComponent * 255)) << 8
        | UInt32(round(color.blueComponent * 255))
}

private extension PaneGrid.PanePresentation {
    func target(workspaceID: WorkspaceID, window: PaneGrid.WindowPresentation) -> PaneGrid.PaneKernelTarget {
        PaneGrid.PaneKernelTarget(
            workspaceID: workspaceID,
            windowID: window.windowID,
            tmuxWindowID: window.tmuxWindowID,
            paneID: paneID,
            tmuxPaneID: tmuxPaneID
        )
    }
}

private func sidebarItem(
    _ workspaceID: WorkspaceID,
    name: String,
    visibility: WorkspaceIndex.WorkspaceVisibility,
    unread: Int,
    level: WorkspaceIndex.WorkspaceNotificationLevel
) -> WorkspaceIndex.WorkspaceSidebarItem {
    WorkspaceIndex.WorkspaceSidebarItem(summary: WorkspaceIndex.WorkspaceSummary(
        workspaceID: workspaceID,
        displayName: name,
        isOpenLocally: workspaceID == "workspace-a",
        visibility: visibility,
        notifications: WorkspaceIndex.WorkspaceNotificationState(unreadCount: unread, level: level),
        status: workspaceID == "workspace-a" ? .open : .available
    ))
}
