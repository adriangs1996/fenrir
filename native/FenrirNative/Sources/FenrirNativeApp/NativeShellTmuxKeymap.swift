import AppKit
import FenrirNativeShared
import Keybinding
import NativeRuntime
import ServerConnection
import Settings

// D-028 shell integration of the effective tmux keymap: the keymap is
// imported from the RUNTIME tmux server through the `tmux.keymap.get`
// contract (never parsed from `.tmux.conf`), compiled into the Keybinding
// module's prefix/key-table state machine, and driven from a per-window
// local keyDown monitor. Known commands dispatch as typed FenrirKeyActions
// over existing server contracts; unknown bindings surface as discrete
// feedback; uncaptured input falls through to the terminal.

// MARK: - Effective keymap provider (tmux.keymap.get)

/// Fetches the workspace's effective tmux keymap from the server (D-028:
/// the live tmux server is the only source of binding truth).
protocol NativeWorkspaceTmuxKeymapProviding: Sendable {
    func fetchKeymap(workspaceID: WorkspaceID) async throws -> Keybinding.TmuxKeymapWirePayload
}

struct NativeUnavailableTmuxKeymapProvider: NativeWorkspaceTmuxKeymapProviding {
    func fetchKeymap(workspaceID: WorkspaceID) async throws -> Keybinding.TmuxKeymapWirePayload {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }
}

struct NativeTmuxKeymapServerConnectionProvider: NativeWorkspaceTmuxKeymapProviding {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func fetchKeymap(workspaceID: WorkspaceID) async throws -> Keybinding.TmuxKeymapWirePayload {
        let payloadData = try JSONEncoder().encode(NativeTmuxKeymapGetRequest(
            actor: NativeTmuxKeymapRPCActor(sessionId: sessionID.rawValue, subject: "native-app"),
            workspaceId: workspaceID.rawValue
        ))
        let result = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: .generated(),
            sessionID: sessionID,
            request: ServerConnection.RequestEnvelope(
                method: "tmux.keymap.get",
                payload: String(decoding: payloadData, as: UTF8.self),
                retryPolicy: .retryOnceAfterReconnect
            )
        )).get()
        return try JSONDecoder().decode(
            Keybinding.TmuxKeymapWirePayload.self,
            from: Data(result.response.payload.utf8)
        )
    }
}

private struct NativeTmuxKeymapRPCActor: Encodable {
    let sessionId: String
    let subject: String
}

private struct NativeTmuxKeymapGetRequest: Encodable {
    let actor: NativeTmuxKeymapRPCActor
    let workspaceId: String
}

// MARK: - Keymap window/pane action runtime (typed server contracts)

/// Typed action ports the shell needs to execute D-028 keymap actions that
/// are not already covered by the existing pane-grid dispatch paths. All of
/// them resolve to server tmux contracts; the client never executes raw tmux
/// command strings (D-028).
protocol NativeShellTmuxKeymapRuntimeControlling: Sendable {
    func splitPane(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        axis: Keybinding.PaneSplitAxis,
        workingDirectory: String?
    ) async throws
    func createWindow(workspaceID: WorkspaceID, workingDirectory: String?) async throws
    func renameWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID, name: String) async throws
    func closeWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws
    func zoomPane(workspaceID: WorkspaceID, paneID: PaneID) async throws
    func closePane(workspaceID: WorkspaceID, paneID: PaneID) async throws
}

struct NativeUnavailableTmuxKeymapRuntimeController: NativeShellTmuxKeymapRuntimeControlling {
    func splitPane(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        axis: Keybinding.PaneSplitAxis,
        workingDirectory: String?
    ) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func createWindow(workspaceID: WorkspaceID, workingDirectory: String?) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func renameWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID, name: String) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func closeWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func zoomPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func closePane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }
}

/// The cwd sent for `followPaneCwd` keymap actions (`split-window`/
/// `new-window -c "#{pane_current_path}"` fidelity): the literal tmux format
/// token. The server passes cwd as ONE discrete argument to `-c`
/// (`quoteTmuxCommandArg`), where tmux format-expands it against the target
/// pane's LIVE working directory at execution time — a client-side snapshot
/// of the pane cwd would go stale the moment the user `cd`s. This is a fixed
/// constant, never user input, so no command strings ride through it (D-028).
enum NativeTmuxKeymapPaneCwd {
    static let followPaneCurrentPathToken = "#{pane_current_path}"
}

/// Server-backed keymap action runtime: window create/rename/close and pane
/// zoom/close go through the NativeRuntime module port
/// (`ServerTmuxRuntimeAdapter`). Plain-shell splits use the server's
/// `tmux.pane.create` contract with kind "shell" directly — the adapter only
/// exposes managed-process/agent pane creators today, and a keymap split must
/// stay a plain shell pane, never a fake managed process.
struct NativeServerTmuxKeymapRuntimeController: NativeShellTmuxKeymapRuntimeControlling {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let adapter: NativeRuntime.ServerTmuxRuntimeAdapter
    private let transport: any NativeRuntime.ServerRPCTransport

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        transport: any NativeRuntime.ServerRPCTransport
    ) {
        self.actor = actor
        adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)
        self.transport = transport
    }

    func splitPane(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        axis: Keybinding.PaneSplitAxis,
        workingDirectory: String?
    ) async throws {
        // tmux semantics preserved end to end: `split-window -h` is a
        // horizontal layout split (side-by-side panes) and maps to the
        // server's "horizontal" literal (see Keybinding.PaneSplitAxis docs).
        let payload = try JSONEncoder().encode(NativeTmuxShellPaneCreateRequest(
            actor: NativeTmuxKeymapRPCActor(sessionId: actor.authSessionID, subject: actor.subject),
            workspaceId: workspaceID.rawValue,
            windowId: windowID.rawValue,
            kind: "shell",
            split: axis == .horizontal ? "horizontal" : "vertical",
            cwd: workingDirectory
        ))
        _ = try await transport.request(NativeRuntime.ServerRPCRequest(
            requestID: RequestID(rawValue: "native-keymap-split-\(UUID().uuidString.lowercased())"),
            method: "tmux.pane.create",
            payload: payload
        ))
    }

    func createWindow(workspaceID: WorkspaceID, workingDirectory: String?) async throws {
        _ = try await adapter.createWindowRuntime(NativeRuntime.CreateWindowRuntimeInput(
            requestID: RequestID(rawValue: "native-keymap-new-window-\(UUID().uuidString.lowercased())"),
            workspaceID: workspaceID,
            actor: actor,
            name: nil,
            workingDirectory: workingDirectory,
            source: .workspaceShell
        ))
    }

    func renameWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID, name: String) async throws {
        _ = try await adapter.renameWindowRuntime(NativeRuntime.RenameWindowRuntimeInput(
            requestID: RequestID(rawValue: "native-keymap-rename-window-\(windowID.rawValue)"),
            workspaceID: workspaceID,
            windowID: windowID,
            name: name,
            actor: actor,
            source: .workspaceShell
        ))
    }

    func closeWindow(workspaceID: WorkspaceID, windowID: FenrirWindowID) async throws {
        _ = try await adapter.closeWindowRuntime(NativeRuntime.CloseWindowRuntimeInput(
            requestID: RequestID(rawValue: "native-keymap-close-window-\(windowID.rawValue)"),
            workspaceID: workspaceID,
            windowID: windowID,
            actor: actor,
            mode: .destroy,
            source: .workspaceShell
        ))
    }

    func zoomPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        _ = try await adapter.zoomPaneRuntime(NativeRuntime.ZoomPaneRuntimeInput(
            requestID: RequestID(rawValue: "native-keymap-zoom-\(paneID.rawValue)"),
            workspaceID: workspaceID,
            paneID: paneID,
            actor: actor,
            source: .workspaceShell
        ))
    }

    func closePane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        try await adapter.closePaneRuntime(NativeRuntime.ClosePaneRuntimeInput(
            requestID: RequestID(rawValue: "native-keymap-close-pane-\(paneID.rawValue)"),
            workspaceID: workspaceID,
            paneID: paneID,
            actor: actor,
            source: .workspaceShell
        ))
    }
}

/// Mirrors the server's `TmuxShellPaneCreateInput` ({actor, workspaceId,
/// windowId, kind: "shell", split, cwd?}); nil cwd is omitted from the wire.
private struct NativeTmuxShellPaneCreateRequest: Encodable {
    let actor: NativeTmuxKeymapRPCActor
    let workspaceId: String
    let windowId: String
    let kind: String
    let split: String
    let cwd: String?

    private enum CodingKeys: String, CodingKey {
        case actor
        case workspaceId
        case windowId
        case kind
        case split
        case cwd
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(actor, forKey: .actor)
        try container.encode(workspaceId, forKey: .workspaceId)
        try container.encode(windowId, forKey: .windowId)
        try container.encode(kind, forKey: .kind)
        try container.encode(split, forKey: .split)
        try container.encodeIfPresent(cwd, forKey: .cwd)
    }
}

// MARK: - NSEvent → KeyStroke translation

/// Translates AppKit key events into the Keybinding module's `KeyStroke`
/// shape so imported tmux bindings can be matched. Mirrors tmux key
/// normalization: control keys are case-folded (`C-S` == `C-s`) and shift
/// folds into printable characters (`S-a` → `A`, shift-5 → `%`), while named
/// keys keep an explicit shift modifier (`S-F5`); `Shift+Tab` is `BTab`.
///
/// Command-modified events are never translated — ⌘ shortcuts belong to the
/// native shell (`performKeyEquivalent`) and tmux key syntax cannot express
/// them.
enum NativeTmuxKeyEventTranslator {
    static func keyStroke(for event: NSEvent) -> Keybinding.KeyStroke? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.contains(.command) else {
            return nil
        }
        var modifiers: Set<Keybinding.KeyModifier> = []
        if flags.contains(.control) {
            modifiers.insert(.control)
        }
        if flags.contains(.option) {
            modifiers.insert(.option)
        }
        if flags.contains(.shift) {
            modifiers.insert(.shift)
        }
        return keyStroke(
            charactersIgnoringModifiers: event.charactersIgnoringModifiers,
            modifiers: modifiers
        )
    }

    static func keyStroke(
        charactersIgnoringModifiers: String?,
        modifiers: Set<Keybinding.KeyModifier>
    ) -> Keybinding.KeyStroke? {
        guard modifiers.contains(.command) == false,
              let raw = charactersIgnoringModifiers,
              let scalar = raw.unicodeScalars.first
        else {
            return nil
        }

        if let special = specialKeysByAppKitCharacters[String(scalar)] {
            var strokeModifiers = modifiers
            if special == .backTab {
                // Shift+Tab IS BTab in tmux syntax; the shift flag is folded
                // into the key name.
                strokeModifiers.remove(.shift)
            }
            return Keybinding.KeyStroke(special.rawValue, modifiers: strokeModifiers)
        }

        var character = String(Character(scalar))
        if let controlLetter = controlCharacterLetter(scalar), modifiers.contains(.control) {
            // Defensive: some synthetic events carry the control character in
            // charactersIgnoringModifiers; fold it back to its letter.
            character = controlLetter
        }
        guard let firstScalar = character.unicodeScalars.first,
              !CharacterSet.controlCharacters.contains(firstScalar)
        else {
            return nil
        }
        var strokeModifiers = modifiers
        if strokeModifiers.contains(.control) {
            character = character.lowercased()
        }
        // tmux folds shift into printable characters (`S-a` → `A`,
        // shift-5 → `%`): AppKit already reports the shifted character.
        strokeModifiers.remove(.shift)
        return Keybinding.KeyStroke(character, modifiers: strokeModifiers)
    }

    private static let specialKeysByAppKitCharacters: [String: Keybinding.KeyStroke.SpecialKey] =
        Dictionary(uniqueKeysWithValues: Keybinding.KeyStroke.SpecialKey.allCases.map {
            ($0.appKitCharactersIgnoringModifiers, $0)
        })

    private static func controlCharacterLetter(_ scalar: Unicode.Scalar) -> String? {
        guard scalar.value >= 0x01, scalar.value <= 0x1A else {
            return nil
        }
        guard let letter = Unicode.Scalar(scalar.value + 0x60) else {
            return nil
        }
        return String(Character(letter))
    }
}

// MARK: - Fenrir-reserved shell shortcuts (conflict policy)

/// KeyStrokes the native shell claims for itself
/// (`NativeWorkspaceShellKeyboardShortcut`). Under the default
/// `.preferFenrir` conflict policy an imported tmux ROOT binding on one of
/// these strokes yields to Fenrir and is recorded as a conflict. tmux key
/// syntax cannot express ⌘, so in practice only the control/option
/// combinations can collide.
enum NativeShellReservedKeybindings {
    static let strokes: Set<Keybinding.KeyStroke> = {
        var reserved: Set<Keybinding.KeyStroke> = [
            Keybinding.KeyStroke("p", modifiers: [.command]),
            Keybinding.KeyStroke("b", modifiers: [.command]),
            Keybinding.KeyStroke("d", modifiers: [.command, .shift]),
            Keybinding.KeyStroke("a", modifiers: [.command, .shift]),
            Keybinding.KeyStroke("a", modifiers: [.command, .option]),
            Keybinding.KeyStroke("a", modifiers: [.control, .option]),
            Keybinding.KeyStroke("u", modifiers: [.command, .shift])
        ]
        for slot in 1 ... 9 {
            reserved.insert(Keybinding.KeyStroke("\(slot)", modifiers: [.command]))
        }
        return reserved
    }()
}

/// A tmux binding dropped (or reported) because its stroke collides with a
/// reserved Fenrir shell shortcut. Diagnostics only.
struct NativeTmuxKeymapConflict: Equatable, Sendable {
    let table: String
    let key: Keybinding.KeyStroke
    let rawCommand: String
    let policy: Settings.KeybindingConflictPolicy
}

// MARK: - Keymap engine (state machine host)

/// Main-actor host for the imported keymap + prefix state machine. Owns the
/// D-028 conflict policy application and exposes pure resolution for the
/// `keybinding-smoke` diagnostics op (simulation never mutates live state).
@MainActor
final class NativeWorkspaceTmuxKeymapEngine {
    private(set) var machine: Keybinding.TmuxPrefixStateMachine?
    private(set) var effectiveKeymap: Keybinding.EffectiveTmuxKeymap?
    private(set) var conflicts: [NativeTmuxKeymapConflict] = []
    private(set) var unsupportedBindingCount = 0
    private(set) var unparseableBindingCount = 0
    private(set) var lastImportedAt: Date?

    var isActive: Bool {
        machine != nil
    }

    var importedBindingCount: Int {
        effectiveKeymap?.bindings.count ?? 0
    }

    var prefixDisplay: String {
        machine.map { Self.display($0.keymap.prefix) } ?? ""
    }

    func deactivate() {
        machine = nil
        effectiveKeymap = nil
        conflicts = []
        unsupportedBindingCount = 0
        unparseableBindingCount = 0
    }

    func apply(
        _ result: Keybinding.ImportServerTmuxKeymapResult,
        preferences: Settings.KeybindingImportPreferences,
        importedAt: Date = Date()
    ) {
        let filtered = Self.applyConflictPolicy(
            to: result.compiledKeymap,
            policy: preferences.conflictPolicy
        )
        machine = Keybinding.TmuxPrefixStateMachine(keymap: filtered.keymap)
        effectiveKeymap = result.keymap
        conflicts = filtered.conflicts
        unsupportedBindingCount = result.unsupportedBindings.count
        unparseableBindingCount = result.unparseableBindings.count
        lastImportedAt = importedAt
    }

    func handleKey(
        _ key: Keybinding.KeyStroke,
        at now: FenrirTimestamp
    ) -> [Keybinding.TmuxPrefixStateMachine.Effect] {
        guard machine != nil else {
            return []
        }
        return machine!.handleKey(key, at: now)
    }

    func handleTimeout(at now: FenrirTimestamp) -> [Keybinding.TmuxPrefixStateMachine.Effect] {
        guard machine != nil else {
            return []
        }
        return machine!.handleTimeout(at: now)
    }

    /// Resolves a key sequence against a COPY of the live machine (value
    /// semantics) so the smoke op can report what WOULD happen without
    /// executing anything or disturbing pending prefix state.
    func resolveWithoutExecuting(
        _ strokes: [Keybinding.KeyStroke],
        at now: FenrirTimestamp
    ) -> [String] {
        guard var simulated = machine else {
            return []
        }
        var names: [String] = []
        for stroke in strokes {
            for effect in simulated.handleKey(stroke, at: now) {
                names.append(Self.effectName(effect))
            }
        }
        return names
    }

    static func effectName(_ effect: Keybinding.TmuxPrefixStateMachine.Effect) -> String {
        switch effect {
        case .consumeKey:
            return "consumeKey"
        case let .enterPrefix(table):
            return "enterPrefix(\(table.rawValue))"
        case let .executeAction(action):
            return "executeAction(\(actionName(action)))"
        case .stayInRepeat:
            return "stayInRepeat"
        case let .unsupportedFeedback(resolution):
            return "unsupportedFeedback(\(resolution.key.key))"
        case .exitPrefix:
            return "exitPrefix"
        case let .passThroughToTerminal(key):
            return "passThroughToTerminal(\(display(key)))"
        }
    }

    static func actionName(_ action: Keybinding.FenrirKeyAction) -> String {
        switch action {
        case .openPalette:
            return "openPalette"
        case .openAgentComposer:
            return "openAgentComposer"
        case let .focusPane(direction):
            return "focusPane(\(direction.rawValue))"
        case let .navigatePaneVimAware(direction):
            return "navigatePaneVimAware(\(direction.rawValue))"
        case let .switchWindow(target):
            switch target {
            case .next: return "switchWindow(next)"
            case .previous: return "switchWindow(previous)"
            case .last: return "switchWindow(last)"
            case let .index(index): return "switchWindow(\(index))"
            case let .named(name): return "switchWindow(\(name))"
            }
        case .switchSession:
            return "switchSession"
        case let .splitPane(axis, _):
            return "splitPane(\(axis.rawValue))"
        case .newWindow:
            return "newWindow"
        case .renameWindowPrompt:
            return "renameWindowPrompt"
        case let .resizePane(direction, amount):
            return "resizePane(\(direction.rawValue),\(amount))"
        case .zoomPane:
            return "zoomPane"
        case .closePane:
            return "closePane"
        case .closeWindow:
            return "closeWindow"
        case .sendTmuxPrefix:
            return "sendTmuxPrefix"
        case .activateTmuxKeyTable:
            return "activateTmuxKeyTable"
        }
    }

    /// tmux-style display text for a stroke ("C-s", "M-1", "Escape").
    static func display(_ stroke: Keybinding.KeyStroke) -> String {
        var text = ""
        if stroke.modifiers.contains(.control) {
            text += "C-"
        }
        if stroke.modifiers.contains(.option) {
            text += "M-"
        }
        if stroke.modifiers.contains(.shift) {
            text += "S-"
        }
        if stroke.modifiers.contains(.command) {
            text += "Cmd-"
        }
        return text + stroke.key
    }

    static func applyConflictPolicy(
        to compiled: Keybinding.CompiledTmuxKeymap,
        policy: Settings.KeybindingConflictPolicy
    ) -> (keymap: Keybinding.CompiledTmuxKeymap, conflicts: [NativeTmuxKeymapConflict]) {
        var conflicts: [NativeTmuxKeymapConflict] = []
        // Only ROOT bindings can collide: every other table is reached after
        // a consumed prefix key, where Fenrir shortcuts no longer apply.
        guard var rootTable = compiled.tables[Keybinding.TmuxKeyTable.root.rawValue] else {
            return (compiled, [])
        }
        for (stroke, binding) in rootTable where NativeShellReservedKeybindings.strokes.contains(stroke) {
            conflicts.append(NativeTmuxKeymapConflict(
                table: binding.table.rawValue,
                key: stroke,
                rawCommand: binding.rawCommand,
                policy: policy
            ))
            // `.preferTmux` keeps the tmux binding; `.preferFenrir` and
            // `.reportOnly` both leave the Fenrir shortcut in charge (same
            // discipline as the Keybinding module's map builder).
            if policy != .preferTmux {
                rootTable.removeValue(forKey: stroke)
            }
        }
        conflicts.sort { Self.display($0.key) < Self.display($1.key) }
        guard !conflicts.isEmpty else {
            return (compiled, [])
        }
        var tables = compiled.tables
        tables[Keybinding.TmuxKeyTable.root.rawValue] = rootTable
        return (
            Keybinding.CompiledTmuxKeymap(
                prefix: compiled.prefix,
                prefix2: compiled.prefix2,
                repeatTimeMs: compiled.repeatTimeMs,
                tables: tables
            ),
            conflicts
        )
    }
}

// MARK: - Prefix key bytes (send-prefix)

enum NativeTmuxPrefixKeyBytes {
    /// The literal bytes tmux would deliver for the prefix key when a
    /// `send-prefix` binding fires (C-s → 0x13). Only control-character
    /// combinations and plain printable keys are expressible; anything else
    /// produces nil and the action becomes a no-op.
    static func bytes(for stroke: Keybinding.KeyStroke) -> Data? {
        if stroke.modifiers == [.control],
           let character = stroke.character,
           let ascii = character.asciiValue {
            let lower = Character(UnicodeScalar(ascii)).lowercased()
            if let lowerAscii = lower.first?.asciiValue, lowerAscii >= 0x61, lowerAscii <= 0x7A {
                return Data([lowerAscii - 0x60])
            }
            return nil
        }
        guard stroke.modifiers.isEmpty, let character = stroke.character else {
            return nil
        }
        return Data(String(character).utf8)
    }
}
