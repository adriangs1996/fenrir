import Foundation
import FenrirNativeShared
import Settings

public extension Keybinding {
    enum KeybindingError: Error, Codable, Equatable, Sendable {
        case unavailable
        case tmuxImportFailed(String)
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "Keybinding", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeKeybindingModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeKeybindingModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case moduleRegistered(String)
    }

    enum KeyModifier: String, Codable, Equatable, Hashable, Sendable {
        case command
        case control
        case option
        case shift
    }

    struct KeyStroke: Codable, Equatable, Hashable, Sendable {
        public let key: String
        public let modifiers: Set<KeyModifier>

        public init(_ key: String, modifiers: Set<KeyModifier> = []) {
            self.key = key
            self.modifiers = modifiers
        }

        public static func command(_ key: String) -> KeyStroke {
            KeyStroke(key, modifiers: [.command])
        }

        public static func control(_ key: String) -> KeyStroke {
            KeyStroke(key, modifiers: [.control])
        }
    }

    struct TmuxPrefixBinding: Codable, Equatable, Hashable, Sendable {
        public let prefix: KeyStroke
        public let key: KeyStroke

        public init(prefix: KeyStroke, key: KeyStroke) {
            self.prefix = prefix
            self.key = key
        }
    }

    enum TmuxKeyTable: Codable, Equatable, Hashable, Sendable {
        case root
        case prefix
        case prefix2
        case custom(String)

        public init(_ rawValue: String) {
            switch rawValue {
            case "root":
                self = .root
            case "prefix":
                self = .prefix
            case "prefix2":
                self = .prefix2
            default:
                self = .custom(rawValue)
            }
        }

        public var rawValue: String {
            switch self {
            case .root:
                return "root"
            case .prefix:
                return "prefix"
            case .prefix2:
                return "prefix2"
            case let .custom(name):
                return name
            }
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            self.init(try container.decode(String.self))
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            try container.encode(rawValue)
        }
    }

    struct TmuxTableBinding: Codable, Equatable, Hashable, Sendable {
        public let table: TmuxKeyTable
        public let key: KeyStroke

        public init(table: TmuxKeyTable, key: KeyStroke) {
            self.table = table
            self.key = key
        }
    }

    enum KeybindingTrigger: Codable, Equatable, Hashable, Sendable {
        case native(KeyStroke)
        case terminal(KeyStroke)
        case tmuxPrefix(TmuxPrefixBinding)
        case tmuxTable(TmuxTableBinding)
    }

    enum PaneNavigationDirection: String, Codable, Equatable, Sendable {
        case left
        case right
        case up
        case down
        case next
        case previous

        /// The literal control byte a vim-tmux-navigator key produces when it
        /// is passed through to a full-screen app (nvim/fzf). christoomey binds
        /// C-h/j/k/l whose FALSE branch is `select-pane -L/-D/-U/-R`; when the
        /// pane runs vim the SAME control byte the user pressed is re-sent:
        /// C-h=0x08, C-j=0x0A, C-k=0x0B, C-l=0x0C. Only the four spatial
        /// directions have a control byte; `next`/`previous` return nil.
        public var vimNavigationControlByte: UInt8? {
            switch self {
            case .left:
                return 0x08 // C-h
            case .down:
                return 0x0A // C-j
            case .up:
                return 0x0B // C-k
            case .right:
                return 0x0C // C-l
            case .next, .previous:
                return nil
            }
        }
    }

    enum WindowSwitchTarget: Codable, Equatable, Sendable {
        case next
        case previous
        case last
        case index(Int)
        case named(String)
    }

    enum SessionSwitchTarget: Codable, Equatable, Sendable {
        case next
        case previous
        case last
        case named(String)
    }

    enum PaneSplitAxis: String, Codable, Equatable, Sendable {
        case horizontal
        case vertical
    }

    enum AgentComposerContextSource: Codable, Equatable, Sendable {
        case selection
        case viewport
        case lastLines(Int)
    }

    enum PalettePrefix: String, CaseIterable, Codable, Equatable, Sendable {
        case agent = "@"
        case shell = "$"
        case pane = "%"
        case workflow = "!"
        case help = "?"
    }

    enum FenrirKeyAction: Codable, Equatable, Sendable {
        case openPalette(prefix: PalettePrefix?)
        case openAgentComposer(context: AgentComposerContextSource)
        case focusPane(PaneNavigationDirection)
        /// vim-tmux-navigator (christoomey) root-table C-h/j/k/l. The binding
        /// is an `if-shell` that sends the key to the pane when it runs
        /// vim/nvim/fzf and otherwise `select-pane`s in `direction`. At
        /// execution time the host inspects the LIVE focused surface: if the
        /// pane's program has enabled MOUSE REPORTING (DECSET 1000/1002/1003/1006
        /// — the only signal libghostty exposes; NOT alt-screen) the literal
        /// control byte is written to the pane; otherwise native pane focus
        /// moves in `direction`. Only spatial directions are produced. Because
        /// christoomey's real `is_vim` check keys off the foreground process,
        /// mouse mode is only a proxy: a full-screen app that does not enable
        /// mouse reporting (classic vim, nvim `set mouse=`) is misread as a
        /// shell and has the key stolen for pane focus.
        case navigatePaneVimAware(direction: PaneNavigationDirection)
        case switchWindow(WindowSwitchTarget)
        case switchSession(SessionSwitchTarget)
        /// Split the focused pane.
        ///
        /// Axis semantics follow tmux exactly: `split-window -h` performs a
        /// HORIZONTAL layout split — the new pane sits side-by-side
        /// (left/right) with the current one — and maps to
        /// `PaneSplitAxis.horizontal`. `split-window -v` (the tmux default)
        /// stacks panes top/bottom and maps to `PaneSplitAxis.vertical`.
        /// `followPaneCwd` mirrors `-c "#{pane_current_path}"`: the new pane
        /// starts in the current pane's working directory.
        case splitPane(axis: PaneSplitAxis, followPaneCwd: Bool)
        /// Create a new window. `followPaneCwd` mirrors
        /// `-c "#{pane_current_path}"` on `new-window`.
        case newWindow(followPaneCwd: Bool)
        /// Open the native rename prompt for the current window. Produced for
        /// `command-prompt … rename-window …` bindings and direct
        /// `rename-window` bindings alike: a key binding cannot carry the
        /// final name, so the native surface always prompts.
        case renameWindowPrompt
        /// Resize the focused pane by `amount` tmux cells in `direction`.
        /// Whether the binding repeats without re-entering the prefix table
        /// comes from the surrounding binding record (`bind-key -r`), not
        /// from this action.
        case resizePane(direction: PaneNavigationDirection, amount: Int)
        /// Toggle pane zoom (`resize-pane -Z`).
        case zoomPane
        /// Close the focused pane. `needsConfirmation` is set when the tmux
        /// binding wrapped `kill-pane` in `confirm-before`.
        case closePane(needsConfirmation: Bool)
        /// Close the current window. `needsConfirmation` is set when the tmux
        /// binding wrapped `kill-window` in `confirm-before`.
        case closeWindow(needsConfirmation: Bool)
        case sendTmuxPrefix
        case activateTmuxKeyTable(TmuxKeyTable)
    }

    struct TmuxKeyBinding: Codable, Equatable, Sendable {
        public let table: TmuxKeyTable
        public let key: KeyStroke
        public let command: String
        /// Mirrors `bind-key -r`: while the repeat window is open the key can
        /// fire again without re-entering the prefix table.
        public let repeats: Bool

        public init(table: TmuxKeyTable = .prefix, key: KeyStroke, command: String, repeats: Bool = false) {
            self.table = table
            self.key = key
            self.command = command
            self.repeats = repeats
        }

        public init(table: String, key: KeyStroke, command: String, repeats: Bool = false) {
            self.init(table: TmuxKeyTable(table), key: key, command: command, repeats: repeats)
        }

        private enum CodingKeys: String, CodingKey {
            case table
            case key
            case command
            case repeats
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            table = try container.decode(TmuxKeyTable.self, forKey: .table)
            key = try container.decode(KeyStroke.self, forKey: .key)
            command = try container.decode(String.self, forKey: .command)
            repeats = try container.decodeIfPresent(Bool.self, forKey: .repeats) ?? false
        }
    }

    struct EffectiveTmuxKeymap: Codable, Equatable, Sendable {
        public static let defaultRepeatTimeMs = 500

        public let prefix: KeyStroke
        public let prefix2: KeyStroke?
        /// tmux `repeat-time` in milliseconds; bounds the repeat window for
        /// `bind-key -r` bindings.
        public let repeatTimeMs: Int
        public let bindings: [TmuxKeyBinding]

        public init(
            prefix: KeyStroke = .control("b"),
            prefix2: KeyStroke? = nil,
            repeatTimeMs: Int = EffectiveTmuxKeymap.defaultRepeatTimeMs,
            bindings: [TmuxKeyBinding]
        ) {
            self.prefix = prefix
            self.prefix2 = prefix2
            self.repeatTimeMs = repeatTimeMs
            self.bindings = bindings
        }

        private enum CodingKeys: String, CodingKey {
            case prefix
            case prefix2
            case repeatTimeMs
            case bindings
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            prefix = try container.decode(KeyStroke.self, forKey: .prefix)
            prefix2 = try container.decodeIfPresent(KeyStroke.self, forKey: .prefix2)
            repeatTimeMs = try container.decodeIfPresent(Int.self, forKey: .repeatTimeMs)
                ?? EffectiveTmuxKeymap.defaultRepeatTimeMs
            bindings = try container.decode([TmuxKeyBinding].self, forKey: .bindings)
        }
    }

    struct UserKeybindingOverride: Codable, Equatable, Sendable {
        public let trigger: KeybindingTrigger
        public let action: FenrirKeyAction
        public let reason: String

        public init(trigger: KeybindingTrigger, action: FenrirKeyAction, reason: String) {
            self.trigger = trigger
            self.action = action
            self.reason = reason
        }
    }

    enum KeybindingSource: String, Codable, Equatable, Sendable {
        case fenrirDefault
        case nativeOverride
        case userOverride
        case tmuxImport
    }

    struct ActionBinding: Codable, Equatable, Sendable {
        public let trigger: KeybindingTrigger
        public let action: FenrirKeyAction
        public let source: KeybindingSource
        public let sourceTable: TmuxKeyTable?

        public init(
            trigger: KeybindingTrigger,
            action: FenrirKeyAction,
            source: KeybindingSource,
            sourceTable: TmuxKeyTable? = nil
        ) {
            self.trigger = trigger
            self.action = action
            self.source = source
            self.sourceTable = sourceTable
        }
    }

    struct KeybindingConflict: Codable, Equatable, Sendable {
        public let trigger: KeybindingTrigger
        public let kept: ActionBinding
        public let rejected: ActionBinding
        public let policy: Settings.KeybindingConflictPolicy

        public init(
            trigger: KeybindingTrigger,
            kept: ActionBinding,
            rejected: ActionBinding,
            policy: Settings.KeybindingConflictPolicy
        ) {
            self.trigger = trigger
            self.kept = kept
            self.rejected = rejected
            self.policy = policy
        }
    }

    struct UnsupportedTmuxBinding: Codable, Equatable, Sendable {
        public let binding: TmuxKeyBinding
        public let reason: String

        public init(binding: TmuxKeyBinding, reason: String) {
            self.binding = binding
            self.reason = reason
        }
    }

    struct ImportTmuxKeymapInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let keymap: EffectiveTmuxKeymap
        public let preferences: Settings.KeybindingImportPreferences
        public let userOverrides: [UserKeybindingOverride]

        public init(
            requestID: RequestID,
            source: ActionSource,
            keymap: EffectiveTmuxKeymap,
            preferences: Settings.KeybindingImportPreferences = Settings.KeybindingImportPreferences(),
            userOverrides: [UserKeybindingOverride] = []
        ) {
            self.requestID = requestID
            self.source = source
            self.keymap = keymap
            self.preferences = preferences
            self.userOverrides = userOverrides
        }
    }

    struct ImportedKeybindingMap: Codable, Equatable, Sendable {
        public let bindings: [ActionBinding]
        public let conflicts: [KeybindingConflict]
        public let unsupportedBindings: [UnsupportedTmuxBinding]
        public let palettePrefixes: [PalettePrefix]
        public let prefix: KeyStroke
        public let prefix2: KeyStroke?

        public init(
            bindings: [ActionBinding],
            conflicts: [KeybindingConflict],
            unsupportedBindings: [UnsupportedTmuxBinding],
            palettePrefixes: [PalettePrefix] = PalettePrefix.allCases,
            prefix: KeyStroke = .control("b"),
            prefix2: KeyStroke? = nil
        ) {
            self.bindings = bindings
            self.conflicts = conflicts
            self.unsupportedBindings = unsupportedBindings
            self.palettePrefixes = palettePrefixes
            self.prefix = prefix
            self.prefix2 = prefix2
        }

        public func binding(for trigger: KeybindingTrigger) -> ActionBinding? {
            bindings.first { $0.trigger == trigger }
        }
    }

    struct ImportTmuxKeymapResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let importedMap: ImportedKeybindingMap
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, importedMap: ImportedKeybindingMap, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.importedMap = importedMap
            self.timestamp = timestamp
        }
    }

    struct ResolveKeybindingInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let trigger: KeybindingTrigger
        public let importedMap: ImportedKeybindingMap
        public let state: KeyTableState

        public init(
            requestID: RequestID,
            source: ActionSource,
            trigger: KeybindingTrigger,
            importedMap: ImportedKeybindingMap,
            state: KeyTableState = .root
        ) {
            self.requestID = requestID
            self.source = source
            self.trigger = trigger
            self.importedMap = importedMap
            self.state = state
        }
    }

    enum KeyTableState: Codable, Equatable, Sendable {
        case root
        case table(TmuxKeyTable)
    }

    struct UnsupportedKeybindingResolution: Codable, Equatable, Sendable {
        public let table: TmuxKeyTable?
        public let key: KeyStroke
        public let reason: String
        /// The raw tmux command string of the binding when one exists; nil
        /// when the key had no binding at all. Diagnostics only — D-028
        /// forbids executing this string.
        public let rawCommand: String?

        public init(table: TmuxKeyTable?, key: KeyStroke, reason: String, rawCommand: String? = nil) {
            self.table = table
            self.key = key
            self.reason = reason
            self.rawCommand = rawCommand
        }
    }

    enum KeybindingResolution: Codable, Equatable, Sendable {
        case fenrirAction(FenrirKeyAction)
        case enterTmuxKeyTable(TmuxKeyTable)
        case unsupported(UnsupportedKeybindingResolution)
        case passThroughToShell
    }

    struct ResolveKeybindingResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let resolution: KeybindingResolution
        public let emitsShellBytes: Bool
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            resolution: KeybindingResolution,
            emitsShellBytes: Bool,
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.resolution = resolution
            self.emitsShellBytes = emitsShellBytes
            self.timestamp = timestamp
        }
    }
}
