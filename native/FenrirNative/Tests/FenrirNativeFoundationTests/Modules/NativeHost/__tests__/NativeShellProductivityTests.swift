import AppKit
import AgentIntegration
import AgentInteraction
import FenrirNativeShared
import NativeRuntime
import Notifications
import PaneGrid
import Settings
import TerminalViewport
import Testing
import WorkspaceIndex
import WorkspaceOverlays
import WorkflowControl
@testable import FenrirNativeApp

@Suite("NativeHost D-045 shell productivity controls", .serialized)
struct NativeShellProductivityTests {
    @Test("Run button transitions idle -> running -> idle through a fake script runtime")
    @MainActor
    func runButtonStateTransitions() async throws {
        let runner = FakeScriptPaneRunner()
        let preferences = temporaryPreferencesStore()
        let runScript = Settings.ScriptDefinition(kind: .run, name: "Dev", command: "bun dev")
        let customScript = Settings.ScriptDefinition(kind: .custom, name: "web", command: "bun web")
        preferences.replaceRepositoryScripts([runScript, customScript], canonicalPath: "/repo/fenrir")

        let controller = makeController(scriptPaneRunner: runner, preferences: preferences)
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.refreshTitlebarControls()

        // Labels follow the Settings displayName contract: predefined kinds
        // render their kind label ("Run"), custom scripts the user name.
        let idle = rootView.titlebarControlsState()
        #expect(idle.run.phase == .idle)
        #expect(idle.run.title == "Run \(runScript.displayName)")
        #expect(idle.run.title == "Run Run")
        #expect(idle.run.menuItems.map(\.title) == ["Run", "web"])
        #expect(rootView.titlebarRunIndicatorVisible() == false)

        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()

        let running = rootView.titlebarControlsState()
        #expect(running.run.phase == .running)
        #expect(running.run.title == "Stop \(runScript.displayName)")
        // Visual contract: running shows the pulsing workflow-token dot.
        #expect(rootView.titlebarRunIndicatorVisible())
        let created = runner.createdRequests
        #expect(created.count == 1)
        #expect(created.first?.command == "bun dev")
        #expect(created.first?.title == "Dev")
        #expect(created.first?.workspaceID == "workspace-a")
        #expect(created.first?.windowID == "window-a")
        #expect(created.first?.workingDirectory == "/repo/fenrir")
        #expect(created.first?.processDefID.hasPrefix("script:") == true)

        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()

        let stopped = rootView.titlebarControlsState()
        #expect(stopped.run.phase == .idle)
        #expect(stopped.run.title == "Run \(runScript.displayName)")
        #expect(rootView.titlebarRunIndicatorVisible() == false)
        #expect(runner.closedPanes.count == 1)
        #expect(runner.closedPanes.first?.paneID == runner.stubbedPaneID)
    }

    @Test("Double-clicking Run or Stop cannot double-create or double-close script panes")
    @MainActor
    func runStopActionsAreNonReentrant() async throws {
        let runner = FakeScriptPaneRunner()
        let preferences = temporaryPreferencesStore()
        preferences.replaceRepositoryScripts(
            [Settings.ScriptDefinition(kind: .run, name: "Dev", command: "bun dev")],
            canonicalPath: "/repo/fenrir"
        )
        let controller = makeController(scriptPaneRunner: runner, preferences: preferences)
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.refreshTitlebarControls()

        // Double-click Run: the second synchronous click must be dropped by
        // the in-flight guard before any task runs.
        rootView.onRunPrimaryScript?()
        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()
        #expect(runner.createdRequests.count == 1)
        #expect(rootView.titlebarControlsState().run.phase == .running)

        // Double-click Stop: exactly one close RPC.
        rootView.onRunPrimaryScript?()
        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()
        #expect(runner.closedPanes.count == 1)
        #expect(rootView.titlebarControlsState().run.phase == .idle)
    }

    @Test("Stop failure keeps the running state and surfaces a workspace notification")
    @MainActor
    func stopFailureKeepsRunningStateAndNotifies() async throws {
        let runner = FailingStopScriptPaneRunner()
        let preferences = temporaryPreferencesStore()
        let runScript = Settings.ScriptDefinition(kind: .run, name: "Dev", command: "bun dev")
        preferences.replaceRepositoryScripts([runScript], canonicalPath: "/repo/fenrir")
        let controller = makeController(scriptPaneRunner: runner, preferences: preferences)
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.refreshTitlebarControls()

        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()
        #expect(rootView.titlebarControlsState().run.phase == .running)

        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()

        // The close RPC failed: the pane may still be alive server-side, so
        // the Stop state must not be cleared.
        #expect(runner.closeAttempts == 1)
        #expect(rootView.titlebarControlsState().run.phase == .running)
        #expect(rootView.titlebarRunIndicatorVisible())
        let latest = rootView.visibleNotificationsFeed().last
        #expect(latest?.title == "Stop \(runScript.displayName) failed")
        #expect(latest?.source == .system)
        #expect(rootView.visibleNotificationsUnreadCount() == 1)
    }

    @Test("Run-script smoke registers a transient script and reports the created pane")
    @MainActor
    func runScriptSmokeReturnsCreatedPane() async throws {
        let runner = FakeScriptPaneRunner()
        let controller = makeController(scriptPaneRunner: runner, preferences: temporaryPreferencesStore())
        _ = controller.view

        let payload = await controller.runRunScriptSmoke(scriptCommand: "echo smoke")

        #expect(payload["paneID"] == runner.stubbedPaneID.rawValue)
        #expect(payload["runButtonState"] == "running")
        #expect(payload["error"] == "")
        #expect(runner.createdRequests.first?.command == "echo smoke")
    }

    @Test("Stop smoke stops the tracked running script and reports the closed pane")
    @MainActor
    func stopSmokeStopsTrackedRunningScript() async throws {
        let runner = FakeScriptPaneRunner()
        let controller = makeController(scriptPaneRunner: runner, preferences: temporaryPreferencesStore())
        _ = controller.view

        // Stop without a running script reports a typed error payload.
        let idlePayload = await controller.runStopScriptSmoke()
        #expect(idlePayload["error"] == "no-running-script")
        #expect(idlePayload["stoppedPaneID"] == "")

        _ = await controller.runRunScriptSmoke(scriptCommand: "echo smoke")
        let payload = await controller.runStopScriptSmoke()

        #expect(payload["stoppedPaneID"] == runner.stubbedPaneID.rawValue)
        #expect(payload["error"] == "")
        #expect(runner.closedPanes.count == 1)
        #expect(runner.closedPanes.first?.paneID == runner.stubbedPaneID)
        #expect(payload["runButtonState"] == "unavailable")
    }

    @Test("Notifications badge count tracks ingest and mark-all-read")
    @MainActor
    func notificationsBadgeCountUpdates() async throws {
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        controller.ingestWorkspaceNotification(
            title: "test run finished",
            body: "386 pass, 0 fail",
            paneID: "pane-a",
            source: .terminalOSC
        )
        await controller.waitForProductivityActions()

        #expect(rootView.visibleNotificationsUnreadCount() == 1)
        #expect(rootView.titlebarControlsState().notificationUnreadCount == 1)

        controller.ingestWorkspaceNotification(
            title: "claude",
            body: "awaiting input",
            paneID: "pane-a",
            source: .agentPresence
        )
        await controller.waitForProductivityActions()

        #expect(rootView.visibleNotificationsUnreadCount() == 2)
        #expect(rootView.titlebarControlsState().notificationUnreadCount == 2)

        rootView.onMarkAllNotificationsRead?()
        await controller.waitForProductivityActions()

        #expect(rootView.visibleNotificationsUnreadCount() == 0)
        #expect(rootView.titlebarControlsState().notificationUnreadCount == 0)
        #expect(rootView.visibleNotificationsFeed().count == 2)
    }

    @Test("Jump-to-latest-unread focuses the notification pane and is only consumed when unread exists")
    @MainActor
    func jumpToLatestUnreadFocusDispatch() async throws {
        let runtime = FocusRecordingPaneGridRuntime()
        let controller = makeController(
            paneGridRuntime: runtime,
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        // No unread: the shortcut must fall through to the terminal.
        #expect(rootView.handleShellKeyboardShortcut(.jumpToLatestUnread) == false)

        controller.ingestWorkspaceNotification(
            title: "claude",
            body: "awaiting input",
            paneID: "pane-a",
            source: .agentPresence
        )
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 1)

        #expect(rootView.handleShellKeyboardShortcut(.jumpToLatestUnread) == true)
        await controller.waitForProductivityActions()

        let deadline = Date().addingTimeInterval(2)
        while runtime.focusedPaneIDs.isEmpty, Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        #expect(runtime.focusedPaneIDs.contains("pane-a"))
        #expect(rootView.visibleNotificationsUnreadCount() == 0)
    }

    @Test("Awaiting-input presence transition appends an agentPresence notification and attention ring")
    @MainActor
    func awaitingInputPresenceAppendsNotification() async throws {
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        controller.applyAgentPresence([presenceRecord(state: .busy, paneID: "pane-a")])
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 0)
        #expect(rootView.terminalPaneHost.paneGridView.renderedAttentionPaneIDs().isEmpty)

        controller.applyAgentPresence([presenceRecord(state: .awaitingInput, paneID: "pane-a")])
        await controller.waitForProductivityActions()

        #expect(rootView.visibleNotificationsUnreadCount() == 1)
        let latest = rootView.visibleNotificationsFeed().last
        #expect(latest?.title == "Claude Code")
        #expect(latest?.body == "awaiting input")
        #expect(latest?.source == .agentPresence)
        #expect(rootView.terminalPaneHost.paneGridView.renderedAttentionPaneIDs() == ["pane-a"])

        // Repeated awaiting-input records must not duplicate the notification.
        controller.applyAgentPresence([presenceRecord(state: .awaitingInput, paneID: "pane-a")])
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 1)
    }

    @Test("Killing an awaiting pane clears the workspace attention state")
    @MainActor
    func killedAwaitingPaneClearsWorkspaceAttention() async throws {
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        controller.applyAgentPresence([presenceRecord(state: .awaitingInput, paneID: "pane-a")])
        await controller.waitForProductivityActions()
        #expect(rootView.visibleAttentionWorkspaceIDs() == ["workspace-a"])

        // Reading the notification must not clear attention while the pane
        // still reports a waiting presence state.
        rootView.onMarkAllNotificationsRead?()
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 0)
        #expect(rootView.visibleAttentionWorkspaceIDs() == ["workspace-a"])

        // The pane dies without a final presence transition (tmux kill-pane,
        // agent crash): the reconciled server-owned layout no longer contains
        // it, so the stale waiting state must be pruned and the workspace
        // attention released (D-045 attention loop, D-038/D-043 driven).
        let replacementPane = PaneGrid.PanePresentation(
            paneID: "pane-b",
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%2"),
            streamID: nil,
            viewportID: "viewport-pane-b",
            title: "shell",
            rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
            isFocused: true
        )
        controller.applyReconnectedLayout(PaneGrid.State(
            workspaceID: "workspace-a",
            tmuxSessionID: "tmux-session-a",
            activeWindowID: "window-a",
            windows: [
                PaneGrid.WindowPresentation(
                    windowID: "window-a",
                    tmuxWindowID: "tmux-window-a",
                    index: 0,
                    title: "main",
                    root: .pane(replacementPane),
                    activePaneID: "pane-b",
                    panes: [replacementPane]
                )
            ]
        ))
        await controller.waitForProductivityActions()

        #expect(rootView.visibleAttentionWorkspaceIDs().isEmpty)
    }

    @Test("Workspace row metadata wires localServers ports and vcs branch (D-045)")
    @MainActor
    func workspaceRowMetadataWiresPortsAndBranch() async throws {
        let snapshot = NativeLocalServersSnapshot(
            servers: [
                NativeDiscoveredLocalServer(
                    host: "localhost",
                    port: 5173,
                    url: "http://localhost:5173",
                    processName: "vite",
                    pid: 4242
                ),
                NativeDiscoveredLocalServer(
                    host: "localhost",
                    port: 3000,
                    url: "http://localhost:3000",
                    processName: "next",
                    pid: 4243
                )
            ],
            scannedAt: "2026-07-03T00:00:00.000Z"
        )
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore(),
            localServersEventStream: FakeLocalServersEventStream(snapshots: [snapshot]),
            vcsStatusProvider: FakeVcsStatusProvider(refNames: ["/repo/fenrir": "term-em"])
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        controller.viewDidAppear()
        await controller.waitForWorkspaceMetadataActions()

        // Port chips arrive through the background stream loop.
        let deadline = Date().addingTimeInterval(2)
        while rootView.visibleLocalServerPortChips().isEmpty, Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }

        #expect(rootView.visibleLocalServerPortChips() == [
            NativeSidebarWorkspacePortChip(port: 3000),
            NativeSidebarWorkspacePortChip(port: 5173)
        ])
        #expect(rootView.visibleWorkspaceBranches() == ["workspace-a": "term-em"])
    }

    @Test("Editor default persistence round-trips through the preferences store")
    @MainActor
    func editorDefaultPersistenceRoundTrip() async throws {
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-editor-prefs-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("productivity-preferences.json", isDirectory: false)
        let preferences = NativeShellProductivityPreferencesStore(fileURL: fileURL)
        let launcher = FakeEditorLauncher()
        let opener = fakeEditorOpener(launcher: launcher)
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: preferences,
            editorOpener: opener
        )
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.refreshTitlebarControls()

        #expect(rootView.titlebarControlsState().editor.menuItems.map(\.targetID) == ["vscode", "finder"])

        rootView.onPickEditorTarget?("vscode")
        await controller.waitForProductivityActions()

        #expect(launcher.openedApplicationArguments.contains(["/repo/fenrir"]))
        #expect(preferences.editorTargetID(forRepositoryPath: "/repo/fenrir") == "vscode")

        // A fresh store over the same file must resolve the persisted choice.
        let reloaded = NativeShellProductivityPreferencesStore(fileURL: fileURL)
        #expect(reloaded.editorTargetID(forRepositoryPath: "/repo/fenrir") == "vscode")
        #expect(reloaded.load().editorTargets.defaultEditorID == "vscode")

        controller.refreshTitlebarControls()
        let controls = rootView.titlebarControlsState()
        #expect(controls.editor.title == "Open in VS Code")

        try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
    }

    @Test("$EDITOR target routes into a tmux pane instead of launching locally")
    @MainActor
    func environmentEditorRoutesToTerminalPane() async throws {
        let runner = FakeScriptPaneRunner()
        let launcher = FakeEditorLauncher()
        let controller = makeController(
            scriptPaneRunner: runner,
            preferences: temporaryPreferencesStore(),
            editorOpener: fakeEditorOpener(launcher: launcher, environmentEditor: "vim -u NONE")
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        rootView.onPickEditorTarget?("editor")
        await controller.waitForProductivityActions()

        #expect(launcher.openedApplicationArguments.isEmpty)
        let created = runner.createdRequests
        #expect(created.count == 1)
        #expect(created.first?.title == "$EDITOR")
        #expect(created.first?.command == "vim -u NONE /repo/fenrir")
    }

    @Test("Notifications panel overlay lists the feed and supports mark-all-read")
    @MainActor
    func notificationsPanelOverlay() async throws {
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        _ = controller.view

        controller.ingestWorkspaceNotification(
            title: "build finished",
            body: "0 errors",
            paneID: "pane-a",
            source: .terminalOSC
        )
        await controller.waitForProductivityActions()

        let payload = await controller.runNotificationsSmoke(expectedMarker: "build finished")
        #expect(payload["panelVisible"] == "true")
        #expect(payload["unreadCount"] == "1")
        // D-031/D-043: title/body never cross the diagnostics channel; the smoke
        // reports identifiers plus an expected-marker match instead.
        #expect(payload["latestTitle"] == nil)
        #expect(payload["latestSource"] == "terminalOSC")
        #expect(payload["latestPaneID"] == "pane-a")
        #expect(payload["latestMatchesExpected"] == "true")
        #expect(payload["latestNotificationID"]?.isEmpty == false)
        // Default behavior keeps the panel open (CI verification).
        #expect(payload["dismissed"] == "false")
        let rootView = controller.view as! NativeWorkspaceRootView
        #expect(rootView.visibleOverlayTitles().contains("Notifications"))
    }

    @Test("Notifications smoke with dismiss restores the prior overlay state after reading")
    @MainActor
    func notificationsSmokeDismissRestoresOverlayState() async throws {
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        controller.ingestWorkspaceNotification(
            title: "build finished",
            body: "0 errors",
            paneID: "pane-a",
            source: .terminalOSC
        )
        await controller.waitForProductivityActions()

        let payload = await controller.runNotificationsSmoke(expectedMarker: "build finished", dismiss: true)
        // The payload reflects the panel at read time; afterwards the prior
        // overlay state (closed) is restored for live sessions.
        #expect(payload["panelVisible"] == "true")
        #expect(payload["latestMatchesExpected"] == "true")
        #expect(payload["dismissed"] == "true")
        #expect(!rootView.visibleOverlayTitles().contains("Notifications"))

        // A panel the user already had open stays open even with dismiss.
        controller.presentNotificationsPanel()
        let secondPayload = await controller.runNotificationsSmoke(dismiss: true)
        #expect(secondPayload["dismissed"] == "false")
        #expect(rootView.visibleOverlayTitles().contains("Notifications"))
    }

    @Test("Coalesced notification repeats never re-present a macOS banner")
    func coalescedNotificationRepeatsSkipBanner() async throws {
        let presenter = RecordingBannerPresenter()
        let hub = NativeWorkspaceNotificationsHub(
            store: Notifications.inMemoryWorkspaceNotificationStore(clock: SystemFenrirClock()),
            bannerPresenter: presenter
        )
        let draft = Notifications.WorkspaceNotificationDraft(
            workspaceID: "workspace-a",
            paneID: "pane-a",
            title: "test run finished",
            body: "386 pass, 0 fail",
            source: .terminalOSC
        )

        let first = await hub.ingest(draft, isAppActive: false)
        #expect(first?.bannerPresented == true)
        #expect(presenter.presentedBanners.count == 1)

        // Same payload within the coalescing window: the record refreshes but
        // the banner port must not fire again.
        let second = await hub.ingest(draft, isAppActive: false)
        #expect(second != nil)
        #expect(second?.bannerPresented == false)
        #expect(presenter.presentedBanners.count == 1)
    }

    @Test("Awaiting-approval presence transition appends an agentPresence notification")
    @MainActor
    func awaitingApprovalPresenceAppendsNotification() async throws {
        let controller = makeController(
            scriptPaneRunner: FakeScriptPaneRunner(),
            preferences: temporaryPreferencesStore()
        )
        let rootView = controller.view as! NativeWorkspaceRootView

        controller.applyAgentPresence([presenceRecord(state: .busy, paneID: "pane-a")])
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 0)

        controller.applyAgentPresence([presenceRecord(state: .awaitingApproval, paneID: "pane-a")])
        await controller.waitForProductivityActions()

        #expect(rootView.visibleNotificationsUnreadCount() == 1)
        let latest = rootView.visibleNotificationsFeed().last
        #expect(latest?.title == "Claude Code")
        #expect(latest?.body == "approval required")
        #expect(latest?.source == .agentPresence)
        #expect(rootView.terminalPaneHost.paneGridView.renderedAttentionPaneIDs() == ["pane-a"])

        // Repeated awaiting-approval records must not duplicate the notification.
        controller.applyAgentPresence([presenceRecord(state: .awaitingApproval, paneID: "pane-a")])
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 1)

        // Approval wait followed by input wait is a distinct transition and notifies again.
        controller.applyAgentPresence([presenceRecord(state: .awaitingInput, paneID: "pane-a")])
        await controller.waitForProductivityActions()
        #expect(rootView.visibleNotificationsUnreadCount() == 2)
        #expect(rootView.visibleNotificationsFeed().last?.body == "awaiting input")
    }

    @Test("Script pane runner delegates to the NativeRuntime pane port (D-026) with a unique instance marker")
    func scriptPaneRunnerDelegatesToRuntimePort() async throws {
        let port = RecordingPaneRuntimePort()
        let actor = NativeRuntime.RuntimeActorIdentity(
            profileID: "local",
            authSessionID: "session-a",
            subject: "native-app"
        )
        let runner = NativeServerScriptPaneRunner(actor: actor, paneRuntime: port)
        let request = NativeScriptPaneRequest(
            workspaceID: "workspace-a",
            windowID: "window-a",
            workingDirectory: "/repo/fenrir",
            command: "bun dev",
            title: "Dev",
            processDefID: "script:dev"
        )

        let paneID = try await runner.createScriptPane(request)
        #expect(paneID == port.stubbedPaneID)

        let created = port.createInputs
        #expect(created.count == 1)
        let input = try #require(created.first)
        #expect(input.workspaceID == "workspace-a")
        #expect(input.windowID == "window-a")
        #expect(input.actor == actor)
        #expect(input.split == .horizontal)
        #expect(input.workingDirectory == "/repo/fenrir")
        #expect(input.managedProcess.title == "Dev")
        #expect(input.managedProcess.command == "bun dev")
        #expect(input.managedProcess.processDefID == "script:dev")
        #expect(input.managedProcess.instanceID.hasPrefix("script-"))

        // Every launch mints a fresh instance marker — that is how the
        // adapter identifies the created pane in server snapshots that
        // permanently retain closed panes.
        _ = try await runner.createScriptPane(request)
        let instanceIDs = port.createInputs.map(\.managedProcess.instanceID)
        #expect(Set(instanceIDs).count == 2)

        try await runner.closeScriptPane(workspaceID: "workspace-a", paneID: paneID)
        let closed = port.closeInputs
        #expect(closed.count == 1)
        #expect(closed.first?.workspaceID == "workspace-a")
        #expect(closed.first?.paneID == paneID)
        #expect(closed.first?.actor == actor)
    }

    @Test("Concurrent script pane creations are serialized per workspace")
    func concurrentScriptPaneCreationsAreSerialized() async throws {
        let port = OverlapDetectingPaneRuntimePort()
        let runner = NativeServerScriptPaneRunner(
            actor: NativeRuntime.RuntimeActorIdentity(
                profileID: "local",
                authSessionID: "session-a",
                subject: "native-app"
            ),
            paneRuntime: port
        )
        let request = NativeScriptPaneRequest(
            workspaceID: "workspace-a",
            windowID: "window-a",
            workingDirectory: "/repo/fenrir",
            command: "bun dev",
            title: "Dev",
            processDefID: "script:dev"
        )

        // Fire several creations concurrently: the create RPCs for the same
        // workspace must never overlap (metadata cannot cross-attach), and
        // every call still resolves its own pane from its own RPC response.
        let paneIDs = try await withThrowingTaskGroup(of: PaneID.self) { group in
            for _ in 0..<4 {
                group.addTask { try await runner.createScriptPane(request) }
            }
            var collected: [PaneID] = []
            for try await paneID in group {
                collected.append(paneID)
            }
            return collected
        }

        #expect(paneIDs.count == 4)
        #expect(Set(paneIDs).count == 4)
        let maxConcurrency = await port.maxObservedConcurrentCreates()
        #expect(maxConcurrency == 1)
        // The pane id returned to each caller is the one minted by its own
        // create response (identity by RPC response, never pane-set diffing).
        let mintedPaneIDs = await port.mintedPaneIDsByInstanceID()
        let createInstanceIDs = await port.createInstanceIDs()
        #expect(Set(paneIDs) == Set(createInstanceIDs.compactMap { mintedPaneIDs[$0] }))
    }

    @Test("Preferences write failures revert the cache and invoke the failure handler")
    func preferencesWriteFailureRevertsCacheAndNotifies() throws {
        // Parent path is a FILE, so directory creation (and the write) fails.
        let blockerURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-prefs-blocked-\(UUID().uuidString)", isDirectory: false)
        try Data("blocker".utf8).write(to: blockerURL)
        defer { try? FileManager.default.removeItem(at: blockerURL) }

        let store = NativeShellProductivityPreferencesStore(
            fileURL: blockerURL.appendingPathComponent("productivity-preferences.json", isDirectory: false)
        )
        let failures = FailureMessageBox()
        store.setPersistenceFailureHandler { message in
            failures.record(message)
        }

        let script = Settings.ScriptDefinition(kind: .run, name: "Dev", command: "bun dev")
        var preferences = NativeShellProductivityPreferences()
        preferences.scripts = preferences.scripts.replacingScripts(
            [script],
            scope: .repository(canonicalPath: "/repo/fenrir")
        )
        let didSave = store.save(preferences)

        #expect(didSave == false)
        #expect(failures.messages.count == 1)
        // The cache reverts to the last-persisted state (defaults here): it
        // must not claim scripts the disk does not have.
        #expect(store.load() == NativeShellProductivityPreferences())
        #expect(store.scripts(forRepositoryPath: "/repo/fenrir").isEmpty)
    }

    @Test("Undecodable preferences files are backed up before being overwritten")
    func corruptPreferencesFileIsBackedUpOnLoad() throws {
        let directoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-prefs-corrupt-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directoryURL) }
        let fileURL = directoryURL.appendingPathComponent("productivity-preferences.json", isDirectory: false)
        let corruptPayload = Data("{not valid json".utf8)
        try corruptPayload.write(to: fileURL)

        let store = NativeShellProductivityPreferencesStore(fileURL: fileURL)
        #expect(store.load() == NativeShellProductivityPreferences())

        // The corrupt bytes survive under a .corrupt suffix; the original
        // slot is free for the next save.
        let backupURL = fileURL.appendingPathExtension("corrupt")
        #expect(try Data(contentsOf: backupURL) == corruptPayload)
        #expect(!FileManager.default.fileExists(atPath: fileURL.path))

        let script = Settings.ScriptDefinition(kind: .run, name: "Dev", command: "bun dev")
        store.replaceRepositoryScripts([script], canonicalPath: "/repo/fenrir")
        let reloaded = NativeShellProductivityPreferencesStore(fileURL: fileURL)
        #expect(reloaded.scripts(forRepositoryPath: "/repo/fenrir").map(\.name) == ["Dev"])
    }

    @Test("Terminal notification forwarder routes OSC provenance into the workspace notification model")
    @MainActor
    func terminalNotificationForwarderRoutesProvenance() async throws {
        let router = RecordingNotificationRouter()
        let forwarder = NativeWorkspaceTerminalNotificationForwarder(resolveRouter: { router })

        try await forwarder.forwardTerminalNotification(TerminalViewport.TerminalNotificationEvent(
            title: "build finished",
            body: "0 errors",
            source: .osc9,
            provenance: TerminalViewport.TerminalStreamProvenance(
                workspaceID: "workspace-a",
                paneID: "pane-a",
                viewportID: "viewport-pane-a",
                streamID: StreamID(rawValue: "stream-a"),
                sequence: 7
            )
        ))

        let routed = router.routed
        #expect(routed.count == 1)
        #expect(routed.first?.workspaceID == "workspace-a")
        #expect(routed.first?.paneID == "pane-a")
        #expect(routed.first?.title == "build finished")
        #expect(routed.first?.body == "0 errors")
        #expect(routed.first?.source == .terminalOSC)
    }

    @Test("Script pane lifecycle re-projects the layout live and reconciles the running script")
    @MainActor
    func scriptPaneLifecycleRefreshesLayoutLive() async throws {
        let runner = FakeScriptPaneRunner()
        let preferences = temporaryPreferencesStore()
        preferences.replaceRepositoryScripts(
            [Settings.ScriptDefinition(kind: .run, name: "Dev", command: "bun dev")],
            canonicalPath: "/repo/fenrir"
        )
        let refreshCounter = RefreshCounter()
        let controller = makeController(
            scriptPaneRunner: runner,
            preferences: preferences,
            refreshWorkspaceLayout: { await refreshCounter.increment() }
        )
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.refreshTitlebarControls()

        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()
        #expect(await refreshCounter.count == 1)
        #expect(rootView.titlebarControlsState().run.phase == .running)

        // A live layout that no longer contains the script pane clears the
        // Stop state (server-owned tmux layout is the source of truth).
        controller.applyReconnectedLayout(productivityShellState().paneGridState)
        #expect(rootView.titlebarControlsState().run.phase == .idle)

        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()
        #expect(rootView.titlebarControlsState().run.phase == .running)

        // Stop also re-projects.
        rootView.onRunPrimaryScript?()
        await controller.waitForProductivityActions()
        #expect(await refreshCounter.count == 3)
        #expect(rootView.titlebarControlsState().run.phase == .idle)
    }

    // MARK: - Helpers

    @MainActor
    private func makeController(
        paneGridRuntime: any NativePaneGridRuntimeControlling = FocusRecordingPaneGridRuntime(),
        scriptPaneRunner: any NativeWorkspaceScriptPaneRunning,
        preferences: NativeShellProductivityPreferencesStore,
        editorOpener: NativeWorkspaceEditorOpening? = nil,
        localServersEventStream: (any NativeLocalServersEventStreaming)? = nil,
        vcsStatusProvider: (any NativeWorkspaceVcsStatusProviding)? = nil,
        refreshWorkspaceLayout: (@Sendable () async -> Void)? = nil
    ) -> NativeWorkspaceRootViewController {
        NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: productivityShellState()),
            paneGridRuntime: paneGridRuntime,
            agentPromptSubmitter: ProductivityRecordingPromptSubmitter(),
            productivityPreferences: preferences,
            scriptPaneRunner: scriptPaneRunner,
            editorOpener: editorOpener ?? fakeEditorOpener(launcher: FakeEditorLauncher()),
            notificationsHub: NativeWorkspaceNotificationsHub(
                store: Notifications.inMemoryWorkspaceNotificationStore(clock: SystemFenrirClock()),
                bannerPresenter: RecordingBannerPresenter()
            ),
            localServersEventStream: localServersEventStream,
            vcsStatusProvider: vcsStatusProvider,
            refreshWorkspaceLayout: refreshWorkspaceLayout,
            isAppActive: { true }
        )
    }

    private func temporaryPreferencesStore() -> NativeShellProductivityPreferencesStore {
        NativeShellProductivityPreferencesStore.ephemeral()
    }

    private func fakeEditorOpener(
        launcher: FakeEditorLauncher,
        environmentEditor: String? = nil
    ) -> NativeWorkspaceEditorOpening {
        let vscodeBundleIdentifiers = WorkspaceIndex.EditorTargetCatalog
            .target(withID: "vscode")?.detection.bundleIdentifiers ?? []
        let resolver = WorkspaceIndex.EditorTargetResolver(
            applicationLocator: FakeEditorApplicationLocator(installedBundleIdentifiers: Set(vscodeBundleIdentifiers)),
            fileChecker: FakeEditorFileChecker(existingPaths: ["/repo/fenrir"]),
            environment: FakeEditorEnvironment(values: environmentEditor.map { ["EDITOR": $0] } ?? [:])
        )
        return NativeWorkspaceEditorOpening(resolver: resolver, launcher: launcher)
    }

    private func presenceRecord(
        state: AgentIntegration.AgentPresenceState,
        paneID: PaneID
    ) -> AgentIntegration.AgentPresenceRecord {
        AgentIntegration.AgentPresenceRecord(event: AgentIntegration.AgentPresenceEvent(
            agentID: .claudeCode,
            state: state,
            provenance: AgentIntegration.AgentPresenceProvenance(
                workspaceID: "workspace-a",
                tabID: "window-a",
                paneID: paneID,
                viewportID: ViewportID(rawValue: "viewport-\(paneID.rawValue)")
            ),
            ingestedAt: FenrirTimestamp(Date())
        ))
    }
}

private func productivityShellState() -> NativeWorkspaceShellState {
    let pane = PaneGrid.PanePresentation(
        paneID: "pane-a",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%1"),
        streamID: nil,
        viewportID: "viewport-pane-a",
        title: "shell",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
        isFocused: true
    )
    let grid = PaneGrid.State(
        workspaceID: "workspace-a",
        tmuxSessionID: "tmux-session-a",
        activeWindowID: "window-a",
        windows: [
            PaneGrid.WindowPresentation(
                windowID: "window-a",
                tmuxWindowID: "tmux-window-a",
                index: 0,
                title: "main",
                root: .pane(pane),
                activePaneID: "pane-a",
                panes: [pane]
            )
        ]
    )
    return NativeWorkspaceShellState(
        workspaceID: "workspace-a",
        nativeWindowID: "window-a",
        paneGridState: grid,
        sidebarItems: [
            WorkspaceIndex.WorkspaceSidebarItem(summary: WorkspaceIndex.WorkspaceSummary(
                workspaceID: "workspace-a",
                displayName: "Fenrir",
                canonicalPath: "/repo/fenrir",
                isOpenLocally: true,
                status: .open
            ))
        ],
        focusedSurface: .terminal(nil)
    )
}

// MARK: - Fakes

private actor RefreshCounter {
    private(set) var count = 0

    func increment() {
        count += 1
    }
}

@MainActor
private final class RecordingNotificationRouter: NativeWorkspaceNotificationRouting {
    private(set) var routed: [(
        workspaceID: WorkspaceID,
        title: String?,
        body: String,
        paneID: PaneID?,
        source: Notifications.WorkspaceNotificationSource
    )] = []

    func routeWorkspaceNotification(
        workspaceID: WorkspaceID,
        title: String?,
        body: String,
        paneID: PaneID?,
        source: Notifications.WorkspaceNotificationSource
    ) {
        routed.append((workspaceID: workspaceID, title: title, body: body, paneID: paneID, source: source))
    }
}

private final class RecordingPaneRuntimePort: NativeRuntime.PaneRuntimeCreating, NativeRuntime.PaneRuntimeClosing, @unchecked Sendable {
    let stubbedPaneID: PaneID = "pane-script-9"
    private let lock = NSLock()
    private var creates: [NativeRuntime.CreatePaneRuntimeInput] = []
    private var closes: [NativeRuntime.ClosePaneRuntimeInput] = []

    var createInputs: [NativeRuntime.CreatePaneRuntimeInput] {
        lock.lock()
        defer { lock.unlock() }
        return creates
    }

    var closeInputs: [NativeRuntime.ClosePaneRuntimeInput] {
        lock.lock()
        defer { lock.unlock() }
        return closes
    }

    func createPaneRuntime(_ input: NativeRuntime.CreatePaneRuntimeInput) async throws -> NativeRuntime.PaneRuntimeState {
        recordCreate(input)
        return NativeRuntime.PaneRuntimeState(
            workspaceID: input.workspaceID,
            paneID: stubbedPaneID,
            status: .attached,
            windowID: input.windowID,
            stream: NativeRuntime.PaneStreamState(paneID: stubbedPaneID, streamID: nil, status: .subscribing)
        )
    }

    func closePaneRuntime(_ input: NativeRuntime.ClosePaneRuntimeInput) async throws {
        recordClose(input)
    }

    private func recordCreate(_ input: NativeRuntime.CreatePaneRuntimeInput) {
        lock.lock()
        defer { lock.unlock() }
        creates.append(input)
    }

    private func recordClose(_ input: NativeRuntime.ClosePaneRuntimeInput) {
        lock.lock()
        defer { lock.unlock() }
        closes.append(input)
    }
}

private final class FakeScriptPaneRunner: NativeWorkspaceScriptPaneRunning, @unchecked Sendable {
    let stubbedPaneID: PaneID = "pane-script-1"
    private let lock = NSLock()
    private var created: [NativeScriptPaneRequest] = []
    private var closed: [(workspaceID: WorkspaceID, paneID: PaneID)] = []

    var createdRequests: [NativeScriptPaneRequest] {
        lock.lock()
        defer { lock.unlock() }
        return created
    }

    var closedPanes: [(workspaceID: WorkspaceID, paneID: PaneID)] {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }

    func createScriptPane(_ request: NativeScriptPaneRequest) async throws -> PaneID {
        recordCreate(request)
        return stubbedPaneID
    }

    func closeScriptPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        recordClose(workspaceID: workspaceID, paneID: paneID)
    }

    private func recordCreate(_ request: NativeScriptPaneRequest) {
        lock.lock()
        defer { lock.unlock() }
        created.append(request)
    }

    private func recordClose(workspaceID: WorkspaceID, paneID: PaneID) {
        lock.lock()
        defer { lock.unlock() }
        closed.append((workspaceID: workspaceID, paneID: paneID))
    }
}

/// Create succeeds, close always fails — exercises the Stop failure path.
private final class FailingStopScriptPaneRunner: NativeWorkspaceScriptPaneRunning, @unchecked Sendable {
    let stubbedPaneID: PaneID = "pane-script-1"
    private let lock = NSLock()
    private var closeAttemptCount = 0

    var closeAttempts: Int {
        lock.lock()
        defer { lock.unlock() }
        return closeAttemptCount
    }

    func createScriptPane(_ request: NativeScriptPaneRequest) async throws -> PaneID {
        stubbedPaneID
    }

    func closeScriptPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        recordCloseAttempt()
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    private func recordCloseAttempt() {
        lock.lock()
        defer { lock.unlock() }
        closeAttemptCount += 1
    }
}

/// Detects overlapping `tmux.pane.create` calls and mints a distinct pane id
/// per response so callers can be checked for response-driven identity.
private actor OverlapDetectingPaneRuntimePort: NativeRuntime.PaneRuntimeCreating, NativeRuntime.PaneRuntimeClosing {
    private var activeCreates = 0
    private var maxConcurrentCreates = 0
    private var paneCounter = 0
    private var mintedByInstance: [String: PaneID] = [:]
    private var instanceOrder: [String] = []

    func createPaneRuntime(_ input: NativeRuntime.CreatePaneRuntimeInput) async throws -> NativeRuntime.PaneRuntimeState {
        activeCreates += 1
        maxConcurrentCreates = max(maxConcurrentCreates, activeCreates)
        // Suspend across the actor boundary so an unserialized concurrent
        // caller would be observed as overlapping.
        try? await Task.sleep(nanoseconds: 5_000_000)
        activeCreates -= 1
        paneCounter += 1
        let paneID = PaneID(rawValue: "pane-script-\(paneCounter)")
        mintedByInstance[input.managedProcess.instanceID] = paneID
        instanceOrder.append(input.managedProcess.instanceID)
        return NativeRuntime.PaneRuntimeState(
            workspaceID: input.workspaceID,
            paneID: paneID,
            status: .attached,
            windowID: input.windowID,
            stream: NativeRuntime.PaneStreamState(paneID: paneID, streamID: nil, status: .subscribing)
        )
    }

    func closePaneRuntime(_ input: NativeRuntime.ClosePaneRuntimeInput) async throws {}

    func maxObservedConcurrentCreates() -> Int {
        maxConcurrentCreates
    }

    func mintedPaneIDsByInstanceID() -> [String: PaneID] {
        mintedByInstance
    }

    func createInstanceIDs() -> [String] {
        instanceOrder
    }
}

private final class FailureMessageBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String] = []

    var messages: [String] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func record(_ message: String) {
        lock.lock()
        stored.append(message)
        lock.unlock()
    }
}

private final class FocusRecordingPaneGridRuntime: NativePaneGridRuntimeControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var focused: [PaneID] = []

    var focusedPaneIDs: [PaneID] {
        lock.lock()
        defer { lock.unlock() }
        return focused
    }

    func applyPaneGridState(_ state: PaneGrid.State) {}

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {}

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        recordFocus(command.target.paneID)
    }

    private func recordFocus(_ paneID: PaneID) {
        lock.lock()
        defer { lock.unlock() }
        focused.append(paneID)
    }

    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async throws {}

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {}

    func resizeWindow(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws {}

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {}
}

private actor ProductivityRecordingPromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        AgentInteraction.ServerPromptAccepted(
            promptID: RequestID(rawValue: "accepted-\(request.requestID.rawValue)"),
            acceptedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
        )
    }
}

private struct FakeEditorApplicationLocator: WorkspaceIndex.EditorApplicationLocating {
    let installedBundleIdentifiers: Set<String>

    func applicationURL(forBundleIdentifier bundleIdentifier: String) -> URL? {
        installedBundleIdentifiers.contains(bundleIdentifier)
            ? URL(fileURLWithPath: "/Applications/\(bundleIdentifier).app")
            : nil
    }
}

private struct FakeEditorFileChecker: WorkspaceIndex.EditorFileChecking {
    let existingPaths: Set<String>

    func fileExists(atPath path: String) -> Bool {
        existingPaths.contains(path)
    }
}

private struct FakeEditorEnvironment: WorkspaceIndex.EditorEnvironmentReading {
    let values: [String: String]

    func environmentValue(forKey key: String) -> String? {
        values[key]
    }
}

private final class FakeEditorLauncher: WorkspaceIndex.EditorTargetLaunching, @unchecked Sendable {
    private let lock = NSLock()
    private var openedArguments: [[String]] = []
    private var launchedProcesses: [(executablePath: String, arguments: [String])] = []

    var openedApplicationArguments: [[String]] {
        lock.lock()
        defer { lock.unlock() }
        return openedArguments
    }

    func openApplication(at url: URL, arguments: [String]) async throws {
        recordOpen(arguments)
    }

    func launchProcess(executablePath: String, arguments: [String]) async throws {
        recordLaunch(executablePath: executablePath, arguments: arguments)
    }

    private func recordOpen(_ arguments: [String]) {
        lock.lock()
        defer { lock.unlock() }
        openedArguments.append(arguments)
    }

    private func recordLaunch(executablePath: String, arguments: [String]) {
        lock.lock()
        defer { lock.unlock() }
        launchedProcesses.append((executablePath: executablePath, arguments: arguments))
    }
}

private final class RecordingBannerPresenter: Notifications.NotificationBannerPresenting, @unchecked Sendable {
    private let lock = NSLock()
    private var presented: [(title: String?, body: String)] = []

    var presentedBanners: [(title: String?, body: String)] {
        lock.lock()
        defer { lock.unlock() }
        return presented
    }

    func present(title: String?, body: String, workspaceID: WorkspaceID, paneID: PaneID?) async {
        recordPresent(title: title, body: body)
    }

    private func recordPresent(title: String?, body: String) {
        lock.lock()
        defer { lock.unlock() }
        presented.append((title: title, body: body))
    }
}

/// Yields the queued snapshots and then stays open, mirroring the live
/// localServers subscription (which never completes on its own).
private struct FakeLocalServersEventStream: NativeLocalServersEventStreaming {
    let snapshots: [NativeLocalServersSnapshot]

    func observeLocalServers() async -> AsyncThrowingStream<NativeLocalServersSnapshot, Error> {
        AsyncThrowingStream { continuation in
            for snapshot in snapshots {
                continuation.yield(snapshot)
            }
        }
    }
}

private struct FakeVcsStatusProvider: NativeWorkspaceVcsStatusProviding {
    let refNames: [String: String]

    func currentRefName(workspacePath: String) async throws -> String? {
        refNames[workspacePath]
    }
}
