import Foundation
import FenrirNativeShared

public extension Keybinding {
    /// Value-type reducer that replicates tmux client key-table processing
    /// for the native app (D-028). The native app streams pane bytes, so the
    /// tmux server never sees prefix keys — this machine is the authoritative
    /// prefix/key-table/repeat-window state.
    ///
    /// Time is injected: every transition takes `now`, so hosts drive it from
    /// any clock (`KeybindingClock` in production, fixed timestamps in tests).
    ///
    /// Invariants, matching real tmux client behavior:
    /// - The pending prefix key is NEVER replayed to the terminal when the
    ///   sequence ends (action, unsupported, Escape, or timeout). tmux
    ///   swallows the prefix key on its own clients as well — the pane never
    ///   receives it. Replaying e.g. `C-s` would inject an XOFF flow-control
    ///   byte tmux clients never deliver.
    /// - Unbound keys in a non-root table are consumed (tmux discards them),
    ///   surfacing as discrete `unsupportedFeedback` instead of pane bytes.
    /// - During the repeat window, a key whose binding is not repeatable (or
    ///   that has no binding in the table) resets to root and is processed
    ///   again from root — exactly like tmux `CLIENT_REPEAT` handling.
    /// - Root-table bindings whose command has no native mapping fall through
    ///   to the terminal (D-028: uncaptured input falls through). Swallowing
    ///   them would break plain typing (e.g. root `C-i` bound to
    ///   `run-shell screenshot`); import-time diagnostics already recorded
    ///   them. Root bindings that DO map — including the christoomey
    ///   `C-h`…`C-l` vim-navigator `if-shell`s (→ `navigatePaneVimAware`) — are
    ///   consumed and executed like any other root binding (see `M-1`).
    struct TmuxPrefixStateMachine: Equatable, Sendable {
        public enum State: Equatable, Sendable {
            case idle
            case prefixPending(table: TmuxKeyTable, since: FenrirTimestamp)
            case repeatPending(table: TmuxKeyTable, deadline: FenrirTimestamp)
        }

        public enum Effect: Equatable, Sendable {
            /// The key was captured by the machine; do not forward it.
            case consumeKey
            case enterPrefix(TmuxKeyTable)
            case executeAction(FenrirKeyAction)
            /// A repeatable (`bind-key -r`) binding fired; the table stays
            /// active until `deadline` (now + repeat-time).
            case stayInRepeat(deadline: FenrirTimestamp)
            /// Discrete feedback for a key with no native mapping (bound to
            /// an unsupported command, or unbound in a non-root table).
            case unsupportedFeedback(UnsupportedKeybindingResolution)
            case exitPrefix
            /// Forward the key to the terminal. Never emitted for a pending
            /// prefix key (see type docs).
            case passThroughToTerminal(KeyStroke)
        }

        public let keymap: CompiledTmuxKeymap
        /// Optional idle-back timeout for a pending prefix with no follow-up
        /// key. tmux itself never expires the prefix table, so the default is
        /// nil; hosts may set it for UI hygiene.
        public let prefixTimeoutMs: Int?
        public private(set) var state: State

        public init(keymap: CompiledTmuxKeymap, prefixTimeoutMs: Int? = nil) {
            self.keymap = keymap
            self.prefixTimeoutMs = prefixTimeoutMs
            state = .idle
        }

        // MARK: Reducer

        public mutating func handleKey(_ key: KeyStroke, at now: FenrirTimestamp) -> [Effect] {
            var effects = expireIfNeeded(at: now)
            switch state {
            case .idle:
                effects.append(contentsOf: resolveFromIdle(key, at: now))
            case let .prefixPending(table, _):
                effects.append(contentsOf: resolve(in: table, repeatActive: false, key: key, at: now))
            case let .repeatPending(table, _):
                effects.append(contentsOf: resolve(in: table, repeatActive: true, key: key, at: now))
            }
            return effects
        }

        /// Hosts call this when their timer fires (repeat deadline or the
        /// optional prefix timeout). Also safe to call speculatively; it only
        /// emits when a deadline has actually lapsed.
        public mutating func handleTimeout(at now: FenrirTimestamp) -> [Effect] {
            expireIfNeeded(at: now)
        }

        // MARK: Private

        private mutating func expireIfNeeded(at now: FenrirTimestamp) -> [Effect] {
            switch state {
            case let .repeatPending(_, deadline) where now >= deadline:
                state = .idle
                return [.exitPrefix]
            case let .prefixPending(_, since):
                guard let timeout = prefixTimeoutMs else {
                    return []
                }
                let deadline = FenrirTimestamp(since.date.addingTimeInterval(Double(timeout) / 1000))
                guard now >= deadline else {
                    return []
                }
                state = .idle
                return [.exitPrefix]
            default:
                return []
            }
        }

        private mutating func resolveFromIdle(_ key: KeyStroke, at now: FenrirTimestamp) -> [Effect] {
            if key == keymap.prefix {
                state = .prefixPending(table: .prefix, since: now)
                return [.consumeKey, .enterPrefix(.prefix)]
            }
            if let prefix2 = keymap.prefix2, key == prefix2 {
                // tmux parity: prefix2 is an ALTERNATE key for the same
                // "prefix" key table — tmux has no "prefix2" table and the
                // server export (list-keys) can never emit one, so entering
                // it would swallow every follow-up key.
                state = .prefixPending(table: .prefix, since: now)
                return [.consumeKey, .enterPrefix(.prefix)]
            }
            if let binding = keymap.binding(in: .root, for: key) {
                switch binding.behavior {
                case let .action(action):
                    if binding.repeats, keymap.repeatTimeMs > 0 {
                        let deadline = repeatDeadline(from: now)
                        state = .repeatPending(table: .root, deadline: deadline)
                        return [.consumeKey, .executeAction(action), .stayInRepeat(deadline: deadline)]
                    }
                    return [.consumeKey, .executeAction(action)]
                case .unsupported:
                    // Root bindings we cannot execute natively fall through to
                    // the terminal; see type docs.
                    return [.passThroughToTerminal(key)]
                }
            }
            return [.passThroughToTerminal(key)]
        }

        private mutating func resolve(
            in table: TmuxKeyTable,
            repeatActive: Bool,
            key: KeyStroke,
            at now: FenrirTimestamp
        ) -> [Effect] {
            guard let binding = keymap.binding(in: table, for: key) else {
                if repeatActive {
                    // tmux parity: repeat window + unbound key resets to root
                    // and the key is processed again from root.
                    state = .idle
                    return [.exitPrefix] + resolveFromIdle(key, at: now)
                }
                if key.specialKey == .escape, key.modifiers.isEmpty {
                    // Escape cancels a pending prefix (when the imported table
                    // does not bind Escape itself). The prefix key is not
                    // replayed; see type docs.
                    state = .idle
                    return [.consumeKey, .exitPrefix]
                }
                state = .idle
                return [
                    .consumeKey,
                    .unsupportedFeedback(UnsupportedKeybindingResolution(
                        table: table,
                        key: key,
                        reason: "No binding for key in tmux table \(table.rawValue)"
                    )),
                    .exitPrefix
                ]
            }

            if repeatActive, !binding.repeats {
                // tmux parity: during the repeat window a non-repeatable
                // binding is NOT executed; the table resets to root and the
                // key is processed again from root.
                state = .idle
                return [.exitPrefix] + resolveFromIdle(key, at: now)
            }

            switch binding.behavior {
            case let .action(action):
                if binding.repeats, keymap.repeatTimeMs > 0 {
                    let deadline = repeatDeadline(from: now)
                    state = .repeatPending(table: table, deadline: deadline)
                    return [.consumeKey, .executeAction(action), .stayInRepeat(deadline: deadline)]
                }
                state = .idle
                return [.consumeKey, .executeAction(action), .exitPrefix]
            case let .unsupported(reason):
                state = .idle
                return [
                    .consumeKey,
                    .unsupportedFeedback(UnsupportedKeybindingResolution(
                        table: table,
                        key: key,
                        reason: reason,
                        rawCommand: binding.rawCommand
                    )),
                    .exitPrefix
                ]
            }
        }

        private func repeatDeadline(from now: FenrirTimestamp) -> FenrirTimestamp {
            FenrirTimestamp(now.date.addingTimeInterval(Double(keymap.repeatTimeMs) / 1000))
        }
    }
}
