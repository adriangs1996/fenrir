import Foundation
import FenrirNativeShared

// MARK: - KeyStroke matching surface

public extension Keybinding.KeyStroke {
    /// Canonical named (non-character) keys understood by the tmux key syntax
    /// parser. Raw values are the tmux canonical spellings so `KeyStroke.key`
    /// stays stable across import, storage, and lookup.
    enum SpecialKey: String, CaseIterable, Codable, Equatable, Sendable {
        case escape = "Escape"
        case space = "Space"
        case enter = "Enter"
        case tab = "Tab"
        case backspace = "BSpace"
        case backTab = "BTab"
        case insert = "IC"
        case delete = "DC"
        case home = "Home"
        case end = "End"
        case pageUp = "PPage"
        case pageDown = "NPage"
        case up = "Up"
        case down = "Down"
        case left = "Left"
        case right = "Right"
        case f1 = "F1"
        case f2 = "F2"
        case f3 = "F3"
        case f4 = "F4"
        case f5 = "F5"
        case f6 = "F6"
        case f7 = "F7"
        case f8 = "F8"
        case f9 = "F9"
        case f10 = "F10"
        case f11 = "F11"
        case f12 = "F12"

        /// Case-insensitive lookup including tmux aliases
        /// (Esc, PageUp/PgUp, PageDown/PgDn).
        public static func canonical(named name: String) -> SpecialKey? {
            aliases[name.lowercased()]
        }

        private static let aliases: [String: SpecialKey] = {
            var table: [String: SpecialKey] = [:]
            for key in SpecialKey.allCases {
                table[key.rawValue.lowercased()] = key
            }
            table["esc"] = .escape
            table["pageup"] = .pageUp
            table["pgup"] = .pageUp
            table["pagedown"] = .pageDown
            table["pgdn"] = .pageDown
            return table
        }()

        /// The literal character the key produces, when it has one.
        public var character: Character? {
            switch self {
            case .space:
                return " "
            case .enter:
                return "\r"
            case .tab:
                return "\t"
            case .escape:
                return "\u{1B}"
            case .backspace:
                return "\u{7F}"
            default:
                return nil
            }
        }

        /// The `charactersIgnoringModifiers` value AppKit reports for this
        /// key, so an NSEvent adapter can match strokes without this module
        /// importing AppKit. Navigation and function keys use the NSEvent
        /// function-key Unicode points (NSUpArrowFunctionKey et al).
        public var appKitCharactersIgnoringModifiers: String {
            switch self {
            case .escape:
                return "\u{1B}"
            case .space:
                return " "
            case .enter:
                return "\r"
            case .tab:
                return "\t"
            case .backspace:
                return "\u{7F}"
            case .backTab:
                return "\u{19}"
            case .insert:
                return "\u{F727}"
            case .delete:
                return "\u{F728}"
            case .home:
                return "\u{F729}"
            case .end:
                return "\u{F72B}"
            case .pageUp:
                return "\u{F72C}"
            case .pageDown:
                return "\u{F72D}"
            case .up:
                return "\u{F700}"
            case .down:
                return "\u{F701}"
            case .left:
                return "\u{F702}"
            case .right:
                return "\u{F703}"
            case .f1:
                return "\u{F704}"
            case .f2:
                return "\u{F705}"
            case .f3:
                return "\u{F706}"
            case .f4:
                return "\u{F707}"
            case .f5:
                return "\u{F708}"
            case .f6:
                return "\u{F709}"
            case .f7:
                return "\u{F70A}"
            case .f8:
                return "\u{F70B}"
            case .f9:
                return "\u{F70C}"
            case .f10:
                return "\u{F70D}"
            case .f11:
                return "\u{F70E}"
            case .f12:
                return "\u{F70F}"
            }
        }
    }

    /// Non-nil when `key` is a canonical named key ("Escape", "Up", "PPage"…).
    var specialKey: SpecialKey? {
        SpecialKey(rawValue: key)
    }

    /// The literal character for this stroke when it has one (plain character
    /// keys and character-producing named keys such as Space/Enter/Tab).
    var character: Character? {
        if let specialKey {
            return specialKey.character
        }
        guard key.count == 1 else {
            return nil
        }
        return key.first
    }

    /// The string an AppKit adapter should compare against
    /// `NSEvent.charactersIgnoringModifiers` (combined with the stroke's
    /// `modifiers`). Nil for strokes that cannot be produced by a keyboard
    /// event, e.g. tmux mouse key names.
    var appKitCharactersIgnoringModifiers: String? {
        if let specialKey {
            return specialKey.appKitCharactersIgnoringModifiers
        }
        guard key.count == 1 else {
            return nil
        }
        return key
    }

    static let escape = Keybinding.KeyStroke(SpecialKey.escape.rawValue)
    static let space = Keybinding.KeyStroke(SpecialKey.space.rawValue)
}

public extension Keybinding {
    // MARK: - Server wire payload (mirrors the runtime keymap probe contract)

    /// One `list-keys` record as delivered by the server. `key` is raw tmux
    /// key syntax; `command` is the raw command string; `repeat` mirrors
    /// `bind-key -r`.
    struct TmuxKeymapWireBinding: Codable, Equatable, Sendable {
        public let table: String
        public let key: String
        public let command: String
        public let repeats: Bool

        public init(table: String, key: String, command: String, repeats: Bool = false) {
            self.table = table
            self.key = key
            self.command = command
            self.repeats = repeats
        }

        private enum CodingKeys: String, CodingKey {
            case table
            case key
            case command
            case repeats = "repeat"
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            table = try container.decode(String.self, forKey: .table)
            key = try container.decode(String.self, forKey: .key)
            command = try container.decode(String.self, forKey: .command)
            repeats = try container.decodeIfPresent(Bool.self, forKey: .repeats) ?? false
        }
    }

    /// The effective keymap payload from the runtime/server (D-028: never
    /// parsed from `.tmux.conf`; always captured from the live tmux server).
    /// Mirrors the `TmuxEffectiveKeymap` schema in
    /// `packages/contracts/src/terminalKernel.ts`.
    struct TmuxKeymapWirePayload: Codable, Equatable, Sendable {
        public let workspaceId: String?
        public let prefix: String
        public let prefix2: String?
        public let repeatTimeMs: Int?
        public let bindings: [TmuxKeymapWireBinding]

        public init(
            workspaceId: String? = nil,
            prefix: String,
            prefix2: String? = nil,
            repeatTimeMs: Int? = nil,
            bindings: [TmuxKeymapWireBinding]
        ) {
            self.workspaceId = workspaceId
            self.prefix = prefix
            self.prefix2 = prefix2
            self.repeatTimeMs = repeatTimeMs
            self.bindings = bindings
        }
    }

    // MARK: - Key spec parsing

    enum TmuxKeySpecError: Error, Codable, Equatable, Sendable {
        case emptySpec
        /// Modifier prefix without a key, e.g. "C-".
        case danglingModifier(String)
        /// Multi-character name that is not a known named key. tmux mouse key
        /// names (MouseDown1Pane, WheelUpStatus, …) land here on purpose: a
        /// keyboard adapter can never match them.
        case unknownKeyName(String)
    }

    // MARK: - Command mapping

    /// Result of mapping one raw tmux command string. D-028: unknown commands
    /// are never routed as command strings; they surface as `unsupported`
    /// with a reason for discrete feedback and diagnostics.
    enum TmuxCommandMapping: Codable, Equatable, Sendable {
        case action(FenrirKeyAction)
        case unsupported(reason: String)
    }

    /// A wire binding whose key spec could not be parsed into a `KeyStroke`.
    struct UnparseableTmuxBinding: Codable, Equatable, Sendable {
        public let table: String
        public let key: String
        public let command: String
        public let reason: String

        public init(table: String, key: String, command: String, reason: String) {
            self.table = table
            self.key = key
            self.command = command
            self.reason = reason
        }
    }

    // MARK: - Compiled keymap (state machine input)

    struct CompiledTmuxBinding: Codable, Equatable, Sendable {
        public let table: TmuxKeyTable
        public let key: KeyStroke
        public let rawCommand: String
        public let behavior: TmuxCommandMapping
        public let repeats: Bool

        public init(
            table: TmuxKeyTable,
            key: KeyStroke,
            rawCommand: String,
            behavior: TmuxCommandMapping,
            repeats: Bool
        ) {
            self.table = table
            self.key = key
            self.rawCommand = rawCommand
            self.behavior = behavior
            self.repeats = repeats
        }
    }

    /// Key-table indexed view of an `EffectiveTmuxKeymap` with every command
    /// already mapped, ready for `TmuxPrefixStateMachine` lookups.
    struct CompiledTmuxKeymap: Codable, Equatable, Sendable {
        public let prefix: KeyStroke
        public let prefix2: KeyStroke?
        public let repeatTimeMs: Int
        public let tables: [String: [KeyStroke: CompiledTmuxBinding]]

        public init(
            prefix: KeyStroke,
            prefix2: KeyStroke?,
            repeatTimeMs: Int,
            tables: [String: [KeyStroke: CompiledTmuxBinding]]
        ) {
            self.prefix = prefix
            self.prefix2 = prefix2
            self.repeatTimeMs = repeatTimeMs
            self.tables = tables
        }

        public func binding(in table: TmuxKeyTable, for key: KeyStroke) -> CompiledTmuxBinding? {
            tables[table.rawValue]?[key]
        }
    }

    // MARK: - Server keymap import action DTOs

    struct ImportServerTmuxKeymapInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource
        public let payload: TmuxKeymapWirePayload

        public init(requestID: RequestID, source: ActionSource, payload: TmuxKeymapWirePayload) {
            self.requestID = requestID
            self.source = source
            self.payload = payload
        }
    }

    struct ImportServerTmuxKeymapResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let keymap: EffectiveTmuxKeymap
        public let compiledKeymap: CompiledTmuxKeymap
        public let unparseableBindings: [UnparseableTmuxBinding]
        public let unsupportedBindings: [UnsupportedTmuxBinding]
        public let timestamp: FenrirTimestamp

        public init(
            requestID: RequestID,
            keymap: EffectiveTmuxKeymap,
            compiledKeymap: CompiledTmuxKeymap,
            unparseableBindings: [UnparseableTmuxBinding],
            unsupportedBindings: [UnsupportedTmuxBinding],
            timestamp: FenrirTimestamp
        ) {
            self.requestID = requestID
            self.keymap = keymap
            self.compiledKeymap = compiledKeymap
            self.unparseableBindings = unparseableBindings
            self.unsupportedBindings = unsupportedBindings
            self.timestamp = timestamp
        }
    }
}
