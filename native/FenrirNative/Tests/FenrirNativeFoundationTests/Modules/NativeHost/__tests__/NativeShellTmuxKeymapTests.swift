import AgentInteraction
import AppKit
import FenrirNativeShared
import Keybinding
import NativeRuntime
import PaneGrid
import Settings
import Testing
import WorkspaceIndex
import WorkspaceOverlays
@testable import FenrirNativeApp

// D-028 shell integration tests: NSEvent→KeyStroke translation, interception
// gating, typed action dispatch over a fake keymap runtime, conflict policy
// against reserved Fenrir shortcuts, and the keybinding-smoke resolution
// path. The keymap fixture mirrors the user's real bindings (prefix C-s).

@Suite("NativeHost tmux keymap shell integration", .serialized)
struct NativeShellTmuxKeymapTests {
    // MARK: - NSEvent → KeyStroke translation

    @Test("Translator maps AppKit key events to tmux-normalized KeyStrokes")
    func translatorMapsAppKitCharacters() {
        #expect(stroke("s", [.control]) == Keybinding.KeyStroke("s", modifiers: [.control]))
        // tmux case-folds control keys: C-S == C-s.
        #expect(stroke("S", [.control, .shift]) == Keybinding.KeyStroke("s", modifiers: [.control]))
        #expect(stroke("s", []) == Keybinding.KeyStroke("s"))
        // Shift folds into printable characters (S-a → A, shift-5 → %).
        #expect(stroke("A", [.shift]) == Keybinding.KeyStroke("A"))
        #expect(stroke("%", [.shift]) == Keybinding.KeyStroke("%"))
        #expect(stroke("\"", [.shift]) == Keybinding.KeyStroke("\""))
        #expect(stroke("1", [.option]) == Keybinding.KeyStroke("1", modifiers: [.option]))
        #expect(stroke("a", [.control, .option]) == Keybinding.KeyStroke("a", modifiers: [.control, .option]))
        // Named keys use the canonical tmux spellings.
        #expect(stroke("\u{1B}", []) == Keybinding.KeyStroke("Escape"))
        #expect(stroke(" ", []) == Keybinding.KeyStroke("Space"))
        #expect(stroke("\u{F700}", []) == Keybinding.KeyStroke("Up"))
        #expect(stroke("\u{F72C}", []) == Keybinding.KeyStroke("PPage"))
        #expect(stroke("\u{F708}", [.shift]) == Keybinding.KeyStroke("F5", modifiers: [.shift]))
        // Shift+Tab IS BTab — the shift flag folds into the key name.
        #expect(stroke("\u{19}", [.shift]) == Keybinding.KeyStroke("BTab"))
        // ⌘ shortcuts are never translated: they belong to the native shell.
        #expect(stroke("p", [.command]) == nil)
        #expect(NativeTmuxKeyEventTranslator.keyStroke(charactersIgnoringModifiers: nil, modifiers: []) == nil)
        #expect(NativeTmuxKeyEventTranslator.keyStroke(charactersIgnoringModifiers: "", modifiers: []) == nil)
    }

    @Test("Translated strokes match strokes parsed from tmux key syntax")
    @MainActor
    func translatorRoundTripsAgainstKeySpecParser() throws {
        let parsedPrefix = try Keybinding.TmuxKeySpecParser.parse("C-s").get()
        let event = keyEvent(characters: "s", modifiers: [.control], keyCode: 1)
        #expect(NativeTmuxKeyEventTranslator.keyStroke(for: event) == parsedPrefix)

        let parsedMeta = try Keybinding.TmuxKeySpecParser.parse("M-1").get()
        let metaEvent = keyEvent(characters: "1", modifiers: [.option], keyCode: 18)
        #expect(NativeTmuxKeyEventTranslator.keyStroke(for: metaEvent) == parsedMeta)
    }

    // MARK: - Conflict policy

    @Test("preferFenrir drops reserved root bindings and records the conflict")
    @MainActor
    func conflictPolicyPreferFenrirDropsReservedRootBindings() async throws {
        let controller = makeController(runtime: RecordingTmuxKeymapRuntime()).controller
        await loadKeymap(into: controller, policy: .preferFenrir)

        let engine = controller.tmuxKeymapEngine
        let reserved = Keybinding.KeyStroke("a", modifiers: [.control, .option])
        #expect(engine.machine?.keymap.binding(in: .root, for: reserved) == nil)
        #expect(engine.conflicts.count == 1)
        #expect(engine.conflicts.first?.rawCommand == "run-shell /tmp/reserved-collision.sh")
        // Non-conflicting root bindings survive the filter.
        let meta1 = Keybinding.KeyStroke("1", modifiers: [.option])
        #expect(engine.machine?.keymap.binding(in: .root, for: meta1) != nil)
    }

    @Test("preferTmux keeps the colliding tmux binding but still reports it")
    @MainActor
    func conflictPolicyPreferTmuxKeepsBinding() async throws {
        let controller = makeController(runtime: RecordingTmuxKeymapRuntime()).controller
        await loadKeymap(into: controller, policy: .preferTmux)

        let engine = controller.tmuxKeymapEngine
        let reserved = Keybinding.KeyStroke("a", modifiers: [.control, .option])
        #expect(engine.machine?.keymap.binding(in: .root, for: reserved) != nil)
        #expect(engine.conflicts.count == 1)
    }

    // MARK: - Interception gating

    @Test("Interception consumes the prefix key only on the terminal surface")
    @MainActor
    func interceptionGatesOnTerminalFocusAndOverlays() async throws {
        let fixture = makeController(runtime: RecordingTmuxKeymapRuntime())
        await loadKeymap(into: fixture.controller)

        // Terminal focused, no overlays: the prefix key is consumed and the
        // status bar shows the prefix chip.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.root.visibleTmuxPrefixChipText() == "C-s …")

        // Escape cancels the pending prefix cleanly.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "\u{1B}", modifiers: [], keyCode: 53)))
        #expect(fixture.root.visibleTmuxPrefixChipText() == nil)

        // Plain typing falls through to the terminal untouched.
        #expect(!fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [], keyCode: 1)))

        // With the palette open the machine is never consulted.
        fixture.controller.presentCommandPaletteFromClientControl(query: nil)
        #expect(!fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
    }

    @Test("Interception is inert while no keymap has been imported")
    @MainActor
    func interceptionInertWithoutKeymap() {
        let fixture = makeController(runtime: RecordingTmuxKeymapRuntime())
        #expect(!fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
    }

    // MARK: - Typed action dispatch

    @Test("Prefix-s splits the pane through the typed runtime with the live pane cwd token")
    @MainActor
    func prefixSplitDispatchesTypedSplitAction() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [], keyCode: 1)))
        await fixture.controller.waitForTmuxKeymapActions()

        // `-c "#{pane_current_path}"` fidelity: the literal token travels to
        // the server, where tmux expands it against the LIVE active pane cwd
        // — the workspace root would be wrong the moment the user cd's.
        #expect(runtime.calls == ["split:workspace-a:window-a:horizontal:#{pane_current_path}"])
        #expect(fixture.root.visibleTmuxPrefixChipText() == nil)
    }

    @Test("Prefix-n creates a window; prefix-f zooms the active pane")
    @MainActor
    func prefixWindowAndZoomActions() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "n", modifiers: [], keyCode: 45)))
        await fixture.controller.waitForTmuxKeymapActions()

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "f", modifiers: [], keyCode: 3)))
        await fixture.controller.waitForTmuxKeymapActions()

        #expect(runtime.calls.contains("new-window:workspace-a:#{pane_current_path}"))
        #expect(runtime.calls.contains("zoom:workspace-a:pane-a"))
    }

    @Test("Root M-1 select-window resolves the tmux index to a window focus dispatch")
    @MainActor
    func rootMetaDigitSwitchesWindow() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        // M-1 → select-window -t 1 → window with tmux index 1 ("window-b").
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "1", modifiers: [.option], keyCode: 18)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()

        #expect(fixture.paneGridRuntime.calls.contains("select:window-b:tmux-window-b"))
    }

    @Test("Kill-pane wrapped in confirm-before gates on the themed overlay")
    @MainActor
    func confirmFlowGatesKillPane() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "x", modifiers: [], keyCode: 7)))

        // No RPC before confirmation; the themed overlay is visible.
        await fixture.controller.waitForTmuxKeymapActions()
        #expect(runtime.calls.isEmpty)
        #expect(fixture.root.visibleOverlayTitles().contains("Confirm tmux Action"))

        fixture.root.overlayHost.visibleTmuxKeymapConfirmView()?.onConfirm?()
        await fixture.controller.waitForTmuxKeymapActions()

        #expect(runtime.calls == ["close-pane:workspace-a:pane-a"])
        #expect(!fixture.root.visibleOverlayTitles().contains("Confirm tmux Action"))
    }

    @Test("Cancelling the confirm overlay abandons the destructive action")
    @MainActor
    func confirmFlowCancelAbandonsAction() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "x", modifiers: [], keyCode: 7)))
        fixture.root.overlayHost.visibleTmuxKeymapConfirmView()?.onCancel?()

        // Confirming afterwards must not fire the abandoned action either.
        fixture.root.overlayHost.onConfirmTmuxKeymapAction?()
        await fixture.controller.waitForTmuxKeymapActions()
        #expect(runtime.calls.isEmpty)
    }

    @Test("Prefix-r prompts for a window name and dispatches the typed rename")
    @MainActor
    func renameFlowPromptsAndDispatchesRename() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "r", modifiers: [], keyCode: 15)))
        #expect(fixture.root.visibleOverlayTitles().contains("Rename Window"))

        fixture.root.overlayHost.visibleTmuxKeymapRenameView()?.onSubmit?("builds")
        await fixture.controller.waitForTmuxKeymapActions()

        #expect(runtime.calls == ["rename:workspace-a:window-a:builds"])
        #expect(!fixture.root.visibleOverlayTitles().contains("Rename Window"))
    }

    @Test("Second prefix key resolves send-prefix and writes the prefix byte")
    @MainActor
    func sendPrefixWritesLiteralPrefixByte() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()

        // C-s is XOFF (0x13): delivered as pane input bytes, never replayed
        // as a client key event.
        #expect(fixture.paneGridRuntime.calls.contains("write:pane-a:13"))
    }

    @Test("Unsupported prefix bindings surface as coalesced workspace toasts")
    @MainActor
    func unsupportedBindingProducesDiscreteFeedback() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        // prefix w → list-sessions: mapped as unsupported (D-028 forbids raw
        // command passthrough); the key is consumed, never forwarded.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "w", modifiers: [], keyCode: 13)))
        await fixture.controller.waitForTmuxKeymapActions()

        let feed = fixture.root.visibleNotificationsFeed()
        #expect(feed.contains { $0.body.contains("tmux binding not supported natively") && $0.body.contains("list-sessions") })
        #expect(runtime.calls.isEmpty)
    }

    // MARK: - Import lifecycle

    @Test("Import lifecycle respects the importTmuxKeybindings settings gate")
    @MainActor
    func importLifecycleRespectsSettingsGate() async throws {
        let provider = FakeTmuxKeymapProvider(payload: keymapWirePayload())
        let disabled = makeController(
            runtime: RecordingTmuxKeymapRuntime(),
            provider: provider,
            preferences: Settings.KeybindingImportPreferences(importTmuxKeybindings: false)
        )
        disabled.controller.importTmuxKeymap(force: true)
        await disabled.controller.waitForTmuxKeymapImport()
        #expect(!disabled.controller.tmuxKeymapEngine.isActive)
        #expect(provider.fetchCount == 0)

        let enabled = makeController(
            runtime: RecordingTmuxKeymapRuntime(),
            provider: provider,
            preferences: Settings.KeybindingImportPreferences(importTmuxKeybindings: true)
        )
        enabled.controller.importTmuxKeymap(force: true)
        await enabled.controller.waitForTmuxKeymapImport()
        #expect(enabled.controller.tmuxKeymapEngine.isActive)
        #expect(enabled.controller.tmuxKeymapEngine.prefixDisplay == "C-s")
        #expect(provider.fetchCount == 1)

        // Non-forced refreshes throttle after a fresh import.
        enabled.controller.importTmuxKeymap()
        await enabled.controller.waitForTmuxKeymapImport()
        #expect(provider.fetchCount == 1)
    }

    // MARK: - keybinding-smoke

    @Test("keybinding-smoke resolves sequences without executing by default")
    @MainActor
    func keybindingSmokeResolvesWithoutExecuting() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        let payload = await fixture.controller.runKeybindingSmoke(keys: "C-s s", execute: false)

        #expect(payload["keymapLoaded"] == "true")
        #expect(payload["prefix"] == "C-s")
        #expect(payload["executed"] == "false")
        #expect(payload["conflictCount"] == "1")
        #expect(payload["importedBindingCount"] == String(keymapWirePayload().bindings.count))
        let effects = payload["resolvedEffects"] ?? ""
        #expect(effects.contains("enterPrefix(prefix)"))
        #expect(effects.contains("executeAction(splitPane(horizontal))"))
        // Resolution-only: nothing executed, live machine still idle.
        #expect(runtime.calls.isEmpty)
        #expect(fixture.controller.tmuxKeymapEngine.machine?.state == .idle)
    }

    @Test("keybinding-smoke execute=true drives the live machine and actions")
    @MainActor
    func keybindingSmokeExecutesWhenRequested() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        let payload = await fixture.controller.runKeybindingSmoke(keys: "C-s t", execute: true)

        #expect(payload["executed"] == "true")
        #expect(runtime.calls == ["split:workspace-a:window-a:vertical:#{pane_current_path}"])
    }

    @Test("keybinding-smoke execute stays behind the FENRIR_SMOKE_OPS gate")
    @MainActor
    func keybindingSmokeExecuteRequiresSmokeOps() async throws {
        let registry = NativeWorkspaceWindowRegistry(
            agentPromptSubmitterFactory: UnavailablePromptSubmitterFactory()
        )
        let dispatcher = NativeHostVisibleStateDispatcher(workspaceWindows: registry, smokeOpsEnabled: false)

        let gated = await dispatcher.presentDiagnostics(NativeHostDiagnosticsInput(
            requestID: "keybinding-smoke-gated",
            operation: "keybinding-smoke",
            keys: "C-s s",
            execute: true
        ))
        #expect(gated == .failure(.permissionError))

        let missingKeys = await dispatcher.presentDiagnostics(NativeHostDiagnosticsInput(
            requestID: "keybinding-smoke-missing-keys",
            operation: "keybinding-smoke"
        ))
        #expect(missingKeys == .failure(.decodeError))
    }

    // MARK: - vim-tmux-navigator (root C-h/j/k/l)

    @Test("Root C-h resolves from idle to navigatePaneVimAware without a prefix")
    @MainActor
    func rootVimNavigatorResolvesFromIdle() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        let left = await fixture.controller.runKeybindingSmoke(keys: "C-h", execute: false)
        #expect((left["resolvedEffects"] ?? "").contains("executeAction(navigatePaneVimAware(left))"))

        let right = await fixture.controller.runKeybindingSmoke(keys: "C-l", execute: false)
        #expect((right["resolvedEffects"] ?? "").contains("executeAction(navigatePaneVimAware(right))"))
    }

    @Test("Root C-h passes the control byte through to the pane when the focused surface is vim-like")
    @MainActor
    func vimNavigatorPassesThroughWhenAltScreen() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        // Fake the focused ghostty surface reporting a full-screen app.
        fixture.root.terminalPaneHost.mouseReportingOverrideForTesting = { true }

        // C-h → navigatePaneVimAware(left) → literal C-h byte (0x08) to pane-a.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "h", modifiers: [.control], keyCode: 4)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()
        #expect(fixture.paneGridRuntime.calls.contains("write:pane-a:08"))

        // C-l → navigatePaneVimAware(right) → literal C-l byte (0x0C) to pane-a.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "l", modifiers: [.control], keyCode: 37)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()
        #expect(fixture.paneGridRuntime.calls.contains("write:pane-a:0c"))

        // Never moved native focus while the app owned the keys.
        #expect(!fixture.paneGridRuntime.calls.contains { $0.hasPrefix("focus:") })
    }

    @Test("Root C-l moves native pane focus when the focused surface is a plain shell")
    @MainActor
    func vimNavigatorMovesFocusWhenNotAltScreen() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        // Plain shell: no mouse-reporting/alt-screen.
        fixture.root.terminalPaneHost.mouseReportingOverrideForTesting = { false }

        // C-l → navigatePaneVimAware(right) → move focus to the pane on the
        // right of pane-a (pane-a2). No pane bytes are written.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "l", modifiers: [.control], keyCode: 37)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()

        #expect(fixture.paneGridRuntime.calls.contains("focus:pane-a2"))
        #expect(!fixture.paneGridRuntime.calls.contains { $0.hasPrefix("write:") })
    }

    // MARK: - IME marked text (preedit) guard

    @Test("Interception yields to the input method while marked text is composing")
    @MainActor
    func interceptionYieldsToMarkedText() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        // While the terminal composes IME preedit, the monitor must not
        // consume the prefix key (or any key): the input method owns them.
        fixture.root.terminalPaneHost.markedTextOverrideForTesting = { true }
        #expect(!fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.tmuxKeymapEngine.machine?.state == .idle)
        #expect(fixture.root.visibleTmuxPrefixChipText() == nil)

        // Composition ended: interception resumes untouched.
        fixture.root.terminalPaneHost.markedTextOverrideForTesting = { false }
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.root.visibleTmuxPrefixChipText() == "C-s …")
    }

    // MARK: - Grid model convergence (view state vs shell controller state)

    @Test("Keymap pane focus syncs the shell controller's active pane immediately")
    @MainActor
    func keymapFocusSyncsShellControllerActivePane() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        func windowA(_ state: PaneGrid.State) -> PaneGrid.WindowPresentation? {
            state.windows.first { $0.windowID == "window-a" }
        }
        #expect(windowA(fixture.controller.visiblePaneGridState())?.activePaneID == "pane-a")

        // C-s l → select-pane -R → focus moves to the pane right of pane-a.
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "s", modifiers: [.control], keyCode: 1)))
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "l", modifiers: [], keyCode: 37)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()

        #expect(fixture.paneGridRuntime.calls.contains("focus:pane-a2"))
        // BOTH grid state copies converge without waiting for a full layout
        // projection: a destructive C-s x right after C-s l must target the
        // pane the user is looking at, never the previously active one.
        #expect(windowA(fixture.root.terminalPaneHost.paneGridView.state)?.activePaneID == "pane-a2")
        #expect(windowA(fixture.controller.visiblePaneGridState())?.activePaneID == "pane-a2")
    }

    @Test("Keymap window select syncs the shell controller's active window immediately")
    @MainActor
    func keymapWindowSelectSyncsShellControllerActiveWindow() async throws {
        let runtime = RecordingTmuxKeymapRuntime()
        let fixture = makeController(runtime: runtime)
        await loadKeymap(into: fixture.controller)

        #expect(fixture.controller.visiblePaneGridState().activeWindowID == "window-a")

        // M-1 → select-window -t 1 → tmux index 1 is "window-b".
        #expect(fixture.controller.interceptKeyDownForTmuxKeymap(keyEvent(characters: "1", modifiers: [.option], keyCode: 18)))
        await fixture.root.terminalPaneHost.waitForPaneGridActions()

        #expect(fixture.root.terminalPaneHost.paneGridView.state.activeWindowID == "window-b")
        #expect(fixture.controller.visiblePaneGridState().activeWindowID == "window-b")
    }

    // MARK: - Key monitor lifecycle (close + reopen)

    @Test("Key monitor survives a user window close followed by a reopen")
    @MainActor
    func keyMonitorSurvivesCloseAndReopen() throws {
        let controller = NativeWorkspaceWindowController(
            state: shellState(),
            paneGridRuntime: MinimalRecordingPaneGridRuntime(),
            agentPromptSubmitter: UnavailablePromptSubmitter()
        )
        defer {
            controller.removeTmuxKeymapKeyMonitor()
            controller.window?.delegate = nil
            controller.close()
        }
        #expect(controller.isTmuxKeymapKeyMonitorInstalledForTesting)

        // Red-button close removes the monitor but keeps the controller in
        // the registry; reopening reuses it and must reinstall the monitor
        // when the window becomes key again — otherwise every imported tmux
        // keybinding silently dies for this workspace until relaunch.
        controller.windowWillClose(Notification(name: NSWindow.willCloseNotification))
        #expect(!controller.isTmuxKeymapKeyMonitorInstalledForTesting)

        controller.windowDidBecomeKey(Notification(name: NSWindow.didBecomeKeyNotification))
        #expect(controller.isTmuxKeymapKeyMonitorInstalledForTesting)
    }
}

// MARK: - Fixtures

/// Subset of the user's real effective keymap (prefix C-s, repeat 500ms) as
/// the Task A wire payload would deliver it, plus one deliberate root-table
/// collision with the reserved ⌃⌥A Fenrir shortcut.
private func keymapWirePayload() -> Keybinding.TmuxKeymapWirePayload {
    Keybinding.TmuxKeymapWirePayload(
        workspaceId: "workspace-a",
        prefix: "C-s",
        prefix2: nil,
        repeatTimeMs: 500,
        bindings: [
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "s", command: "split-window -h -c \"#{pane_current_path}\""),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "t", command: "split-window -v -c \"#{pane_current_path}\""),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "n", command: "new-window -c \"#{pane_current_path}\""),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "r", command: "command-prompt \"rename-window %%\""),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "f", command: "resize-pane -Z"),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "h", command: "select-pane -L"),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "l", command: "select-pane -R"),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "C-h", command: "resize-pane -L 5", repeats: true),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "x", command: "confirm-before -p \"kill-pane #P? (y/n)\" kill-pane"),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "&", command: "confirm-before -p \"kill-window #W? (y/n)\" kill-window"),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "w", command: "list-sessions"),
            Keybinding.TmuxKeymapWireBinding(table: "prefix", key: "C-s", command: "send-prefix"),
            Keybinding.TmuxKeymapWireBinding(table: "root", key: "M-1", command: "select-window -t 1"),
            // christoomey vim-tmux-navigator ROOT bindings (no prefix): the
            // vim-aware navigate action must resolve straight from idle.
            Keybinding.TmuxKeymapWireBinding(table: "root", key: "C-h", command: vimNavigatorCommand(sendKey: "C-h", selectPane: "-L")),
            Keybinding.TmuxKeymapWireBinding(table: "root", key: "C-j", command: vimNavigatorCommand(sendKey: "C-j", selectPane: "-D")),
            Keybinding.TmuxKeymapWireBinding(table: "root", key: "C-k", command: vimNavigatorCommand(sendKey: "C-k", selectPane: "-U")),
            Keybinding.TmuxKeymapWireBinding(table: "root", key: "C-l", command: vimNavigatorCommand(sendKey: "C-l", selectPane: "-R")),
            Keybinding.TmuxKeymapWireBinding(table: "root", key: "C-M-a", command: "run-shell /tmp/reserved-collision.sh")
        ]
    )
}

/// The christoomey vim-tmux-navigator binding string exactly as the user's
/// live keymap emits it: an `if-shell` whose false branch selects a pane
/// directionally.
private func vimNavigatorCommand(sendKey: String, selectPane: String) -> String {
    let condition = #"ps -o state= -o comm= -t '#{pane_tty}' | grep -iqE '^[^TXZ ]+ +(\S+/)?g?\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'"#
    return "if-shell \"\(condition)\" \"send-keys '\(sendKey)'\" \"select-pane \(selectPane)\""
}

private struct FixedKeybindingClock: Keybinding.KeybindingClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    }
}

@MainActor
private func loadKeymap(
    into controller: NativeWorkspaceRootViewController,
    payload: Keybinding.TmuxKeymapWirePayload = keymapWirePayload(),
    policy: Settings.KeybindingConflictPolicy = .preferFenrir
) async {
    let result = try? await Keybinding.ImportServerTmuxKeymap(clock: FixedKeybindingClock())
        .run(Keybinding.ImportServerTmuxKeymapInput(
            requestID: "native-shell-keymap-test-import",
            source: .test,
            payload: payload
        ))
        .get()
    guard let result else {
        Issue.record("Fixture keymap import unexpectedly failed")
        return
    }
    controller.tmuxKeymapEngine.apply(
        result,
        preferences: Settings.KeybindingImportPreferences(
            importTmuxKeybindings: true,
            conflictPolicy: policy
        )
    )
}

@MainActor
private struct ControllerFixture {
    let controller: NativeWorkspaceRootViewController
    let root: NativeWorkspaceRootView
    let paneGridRuntime: MinimalRecordingPaneGridRuntime
}

@MainActor
private func makeController(
    runtime: RecordingTmuxKeymapRuntime,
    provider: (any NativeWorkspaceTmuxKeymapProviding)? = nil,
    preferences: Settings.KeybindingImportPreferences = Settings.KeybindingImportPreferences()
) -> ControllerFixture {
    let paneGridRuntime = MinimalRecordingPaneGridRuntime()
    let controller = NativeWorkspaceRootViewController(
        controller: NativeWorkspaceShellController(state: shellState()),
        paneGridRuntime: paneGridRuntime,
        agentPromptSubmitter: UnavailablePromptSubmitter(),
        tmuxKeymapProvider: provider,
        tmuxKeymapRuntime: runtime,
        loadKeybindingImportPreferences: { preferences }
    )
    controller.loadView()
    let root = controller.view as! NativeWorkspaceRootView
    return ControllerFixture(controller: controller, root: root, paneGridRuntime: paneGridRuntime)
}

private func shellState() -> NativeWorkspaceShellState {
    NativeWorkspaceShellState(
        workspaceID: "workspace-a",
        nativeWindowID: "window-a",
        paneGridState: keymapPaneGridState(),
        sidebarItems: [
            WorkspaceIndex.WorkspaceSidebarItem(summary: WorkspaceIndex.WorkspaceSummary(
                workspaceID: "workspace-a",
                displayName: "Alpha",
                canonicalPath: "/repo/workspace-a",
                isOpenLocally: true,
                visibility: .visible,
                status: .open
            ))
        ],
        focusedSurface: .terminal(nil)
    )
}

private func keymapPaneGridState() -> PaneGrid.State {
    let paneA = PaneGrid.PanePresentation(
        paneID: "pane-a",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%1"),
        viewportID: "viewport-pane-a",
        title: "shell",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 60, rows: 36),
        isFocused: true
    )
    let paneA2 = PaneGrid.PanePresentation(
        paneID: "pane-a2",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%3"),
        viewportID: "viewport-pane-a2",
        title: "aux",
        rect: PaneGrid.PaneRect(x: 61, y: 0, columns: 59, rows: 36),
        isFocused: false
    )
    let paneB = PaneGrid.PanePresentation(
        paneID: "pane-b",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%2"),
        viewportID: "viewport-pane-b",
        title: "logs",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
        isFocused: true
    )
    return PaneGrid.State(
        workspaceID: "workspace-a",
        tmuxSessionID: "tmux-session-a",
        activeWindowID: "window-a",
        windows: [
            PaneGrid.WindowPresentation(
                windowID: "window-a",
                tmuxWindowID: "tmux-window-a",
                index: 0,
                title: "main",
                root: .split(axis: .horizontal, children: [.pane(paneA), .pane(paneA2)]),
                activePaneID: "pane-a",
                panes: [paneA, paneA2]
            ),
            PaneGrid.WindowPresentation(
                windowID: "window-b",
                tmuxWindowID: "tmux-window-b",
                index: 1,
                title: "logs",
                root: .pane(paneB),
                activePaneID: "pane-b",
                panes: [paneB]
            )
        ]
    )
}

@MainActor
private func keyEvent(
    characters: String,
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
        characters: characters,
        charactersIgnoringModifiers: characters,
        isARepeat: false,
        keyCode: keyCode
    )!
}

private func stroke(
    _ characters: String,
    _ modifiers: Set<Keybinding.KeyModifier>
) -> Keybinding.KeyStroke? {
    NativeTmuxKeyEventTranslator.keyStroke(
        charactersIgnoringModifiers: characters,
        modifiers: modifiers
    )
}

// MARK: - Fakes

private final class RecordingTmuxKeymapRuntime: NativeShellTmuxKeymapRuntimeControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func splitPane(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        axis: Keybinding.PaneSplitAxis,
        workingDirectory: String?
    ) async throws {
        append("split:\(workspaceID.rawValue):\(windowID.rawValue):\(axis.rawValue):\(workingDirectory ?? "nil")")
    }

    func createWindow(workspaceID: WorkspaceID, workingDirectory: String?) async throws {
        append("new-window:\(workspaceID.rawValue):\(workingDirectory ?? "nil")")
    }

    func renameWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID, name: String) async throws {
        append("rename:\(workspaceID.rawValue):\(windowID.rawValue):\(name)")
    }

    func closeWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws {
        append("close-window:\(workspaceID.rawValue):\(windowID.rawValue)")
    }

    func zoomPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        append("zoom:\(workspaceID.rawValue):\(paneID.rawValue)")
    }

    func closePane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        append("close-pane:\(workspaceID.rawValue):\(paneID.rawValue)")
    }

    private func append(_ call: String) {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(call)
    }
}

private final class FakeTmuxKeymapProvider: NativeWorkspaceTmuxKeymapProviding, @unchecked Sendable {
    private let lock = NSLock()
    private let payload: Keybinding.TmuxKeymapWirePayload
    private var counted = 0

    init(payload: Keybinding.TmuxKeymapWirePayload) {
        self.payload = payload
    }

    var fetchCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return counted
    }

    func fetchKeymap(workspaceID: WorkspaceID) async throws -> Keybinding.TmuxKeymapWirePayload {
        recordFetch()
        return payload
    }

    private func recordFetch() {
        lock.lock()
        counted += 1
        lock.unlock()
    }
}

private final class MinimalRecordingPaneGridRuntime: NativePaneGridRuntimeControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var calls: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func applyPaneGridState(_ state: PaneGrid.State) {}

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {}

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        append("focus:\(command.target.paneID.rawValue)")
    }

    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async throws {
        append("write:\(target.paneID.rawValue):\(bytes.map { String(format: "%02x", $0) }.joined())")
    }

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        append("resize:\(command.target.paneID.rawValue):\(command.delta):\(command.direction.rawValue)")
    }

    func resizeWindow(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws {
        append("resize-window:\(target.windowID.rawValue):\(size.columns):\(size.rows)")
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        append("select:\(command.windowID.rawValue):\(command.tmuxWindowID)")
    }

    private func append(_ call: String) {
        lock.lock()
        defer { lock.unlock() }
        recorded.append(call)
    }
}

private struct UnavailablePromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        throw AgentInteraction.AgentInteractionError.unavailable
    }
}

private struct UnavailablePromptSubmitterFactory: NativeAgentPromptSubmitterMaking {
    func makeSubmitter(for state: NativeWorkspaceShellState) -> any AgentInteraction.AgentPromptSubmitting {
        UnavailablePromptSubmitter()
    }
}
