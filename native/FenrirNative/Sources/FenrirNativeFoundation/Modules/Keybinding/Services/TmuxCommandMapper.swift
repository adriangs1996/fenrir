import Foundation
import FenrirNativeShared

public extension Keybinding {
    /// Maps raw tmux command strings (from `list-keys` records supplied by
    /// the runtime/server) to typed `FenrirKeyAction`s.
    ///
    /// D-028: only KNOWN commands become actions. Everything else — including
    /// `run-shell`, `if-shell`, `display-menu`, `choose-tree`,
    /// `list-sessions`, and non-rename `command-prompt` — maps to
    /// `.unsupported(reason:)` so the UI can give discrete feedback. The raw
    /// command string is never executed from the UI router.
    enum TmuxCommandMapper {
        // MARK: Mapping

        public static func map(_ command: String) -> TmuxCommandMapping {
            let raw = command.trimmingCharacters(in: .whitespacesAndNewlines)
            return map(tokens: tokenize(raw), raw: raw)
        }

        /// Compiles an effective keymap into the table-indexed form consumed
        /// by `TmuxPrefixStateMachine`. Later bindings for the same
        /// table+key win, matching tmux `bind-key` rebind semantics.
        public static func compile(_ keymap: EffectiveTmuxKeymap) -> CompiledTmuxKeymap {
            var tables: [String: [KeyStroke: CompiledTmuxBinding]] = [:]
            for binding in keymap.bindings {
                let compiled = CompiledTmuxBinding(
                    table: binding.table,
                    key: binding.key,
                    rawCommand: binding.command,
                    behavior: map(binding.command),
                    repeats: binding.repeats
                )
                tables[binding.table.rawValue, default: [:]][binding.key] = compiled
            }
            return CompiledTmuxKeymap(
                prefix: keymap.prefix,
                prefix2: keymap.prefix2,
                repeatTimeMs: keymap.repeatTimeMs,
                tables: tables
            )
        }

        private static func map(tokens: [String], raw: String) -> TmuxCommandMapping {
            guard let first = tokens.first, !first.isEmpty else {
                return .unsupported(reason: "Empty tmux command")
            }

            if tokens.dropFirst().contains(";") {
                return .unsupported(reason: "Multi-command tmux bindings are not supported: \(raw)")
            }

            let arguments = Array(tokens.dropFirst())

            switch canonicalCommand(first) {
            case .splitWindow:
                // tmux -h = HORIZONTAL layout split: the new pane sits
                // side-by-side (left/right) with the current pane. Default
                // (and -v) stacks panes top/bottom.
                let axis: PaneSplitAxis = arguments.contains("-h") ? .horizontal : .vertical
                return .action(.splitPane(axis: axis, followPaneCwd: followsPaneCwd(arguments)))

            case .newWindow:
                return .action(.newWindow(followPaneCwd: followsPaneCwd(arguments)))

            case .renameWindow:
                // A key binding cannot carry the final window name; the
                // native surface always prompts.
                return .action(.renameWindowPrompt)

            case .commandPrompt:
                if raw.contains("rename-window") {
                    return .action(.renameWindowPrompt)
                }
                return .unsupported(
                    reason: "command-prompt without a supported native surface (D-028 forbids raw command passthrough): \(raw)"
                )

            case .selectPane:
                if arguments.contains("-L") { return .action(.focusPane(.left)) }
                if arguments.contains("-R") { return .action(.focusPane(.right)) }
                if arguments.contains("-U") { return .action(.focusPane(.up)) }
                if arguments.contains("-D") { return .action(.focusPane(.down)) }
                if arguments.contains("-l") { return .action(.focusPane(.previous)) }
                if let target = value(after: "-t", in: arguments) {
                    if target == ":.+" { return .action(.focusPane(.next)) }
                    if target == ":.-" { return .action(.focusPane(.previous)) }
                    return .unsupported(reason: "select-pane target not supported natively: \(raw)")
                }
                return .unsupported(reason: "select-pane variant not supported natively: \(raw)")

            case .lastPane:
                return .action(.focusPane(.previous))

            case .nextWindow:
                return .action(.switchWindow(.next))

            case .previousWindow:
                return .action(.switchWindow(.previous))

            case .lastWindow:
                return .action(.switchWindow(.last))

            case .selectWindow:
                if arguments.contains("-n") { return .action(.switchWindow(.next)) }
                if arguments.contains("-p") { return .action(.switchWindow(.previous)) }
                if arguments.contains("-l") { return .action(.switchWindow(.last)) }
                if let target = value(after: "-t", in: arguments) {
                    // Raw tmux window index is passed through unchanged
                    // (":=3" and "3" both yield 3). Base-index alignment is
                    // the window model's job — it knows the runtime-reported
                    // base-index; remapping here would double-shift.
                    if let index = windowIndex(from: target) {
                        return .action(.switchWindow(.index(index)))
                    }
                    return .action(.switchWindow(.named(target)))
                }
                return .unsupported(reason: "select-window without a target: \(raw)")

            case .resizePane:
                if arguments.contains("-Z") {
                    return .action(.zoomPane)
                }
                let direction: PaneNavigationDirection?
                if arguments.contains("-L") { direction = .left }
                else if arguments.contains("-R") { direction = .right }
                else if arguments.contains("-U") { direction = .up }
                else if arguments.contains("-D") { direction = .down }
                else { direction = nil }
                guard let direction else {
                    return .unsupported(reason: "resize-pane without a supported direction: \(raw)")
                }
                let amount = arguments.compactMap { Int($0) }.last ?? 1
                return .action(.resizePane(direction: direction, amount: amount))

            case .killPane:
                return .action(.closePane(needsConfirmation: false))

            case .killWindow:
                return .action(.closeWindow(needsConfirmation: false))

            case .confirmBefore:
                return mapConfirmBefore(arguments: arguments, raw: raw)

            case .sendPrefix:
                return .action(.sendTmuxPrefix)

            case .switchClient:
                if let table = value(after: "-T", in: arguments) {
                    return .action(.activateTmuxKeyTable(TmuxKeyTable(table)))
                }
                if arguments.contains("-n") { return .action(.switchSession(.next)) }
                if arguments.contains("-p") { return .action(.switchSession(.previous)) }
                if arguments.contains("-l") { return .action(.switchSession(.last)) }
                if let target = value(after: "-t", in: arguments) {
                    return .action(.switchSession(.named(target)))
                }
                return .unsupported(reason: "switch-client variant not supported natively: \(raw)")

            case .copyMode:
                return .unsupported(
                    reason: "copy-mode is not supported in the native client yet; native scrollback/selection replaces it: \(raw)"
                )

            case .ifShell:
                return mapIfShell(arguments: arguments, raw: raw)

            case .forbiddenPassthrough:
                return .unsupported(
                    reason: "D-028 forbids raw tmux command passthrough from the UI router: \(raw)"
                )

            case .unknown:
                return .unsupported(reason: "Unsupported tmux command for native action routing: \(raw)")
            }
        }

        private static func mapConfirmBefore(arguments: [String], raw: String) -> TmuxCommandMapping {
            // confirm-before [-b] [-c confirm-key] [-p prompt] [-t target] command
            var index = 0
            while index < arguments.count {
                let token = arguments[index]
                if token == "-p" || token == "-c" || token == "-t" {
                    index += 2
                    continue
                }
                if token.hasPrefix("-"), token.count > 1 {
                    index += 1
                    continue
                }
                break
            }
            guard index < arguments.count else {
                return .unsupported(reason: "confirm-before without a wrapped command: \(raw)")
            }

            let innerTokens = Array(arguments[index...])
            let innerMapping: TmuxCommandMapping
            if innerTokens.count == 1, let block = braceContent(innerTokens[0]) {
                innerMapping = map(block)
            } else {
                innerMapping = map(tokens: innerTokens, raw: innerTokens.joined(separator: " "))
            }

            switch innerMapping {
            case .action(.closePane):
                return .action(.closePane(needsConfirmation: true))
            case .action(.closeWindow):
                return .action(.closeWindow(needsConfirmation: true))
            case let .action(action):
                return .action(action)
            case .unsupported:
                return .unsupported(reason: "confirm-before wraps an unsupported command: \(raw)")
            }
        }

        /// Recognizes the vim-tmux-navigator (christoomey) `if-shell` shape and
        /// routes it to `.navigatePaneVimAware`. Every other `if-shell` stays a
        /// D-028 forbidden passthrough — its branches could only be honored by
        /// executing raw command strings from the UI router.
        ///
        /// The christoomey binding is:
        ///   `if-shell "<is_vim ps check>" "send-keys C-h" "select-pane -L"`
        /// i.e. `if-shell [flags] <shell-command> <true-command> <false-command>`
        /// where the FALSE branch (3rd positional) selects a pane directionally.
        /// The condition and true branch are irrelevant to the native mapping —
        /// the host re-evaluates "is the focused pane vim-like?" live at
        /// execution time — so only the false branch's direction is extracted.
        private static func mapIfShell(arguments: [String], raw: String) -> TmuxCommandMapping {
            // if-shell [-bF] [-t target-pane] shell-command command [command]
            var index = 0
            var positionals: [String] = []
            while index < arguments.count {
                let token = arguments[index]
                if token == "-t" {
                    index += 2
                    continue
                }
                if token.hasPrefix("-"), token.count > 1 {
                    index += 1
                    continue
                }
                positionals.append(token)
                index += 1
            }
            // The navigator always supplies all three positionals; the false
            // branch is the third. Anything else is not the recognized shape.
            guard positionals.count >= 3 else {
                return forbiddenIfShell(raw)
            }
            let falseBranch = positionals[2]
            let innerMapping = map(braceContent(falseBranch) ?? falseBranch)
            guard case let .action(.focusPane(direction)) = innerMapping,
                  isVimNavigableDirection(direction)
            else {
                return forbiddenIfShell(raw)
            }
            return .action(.navigatePaneVimAware(direction: direction))
        }

        /// Only the four spatial `select-pane` directions (`-L/-D/-U/-R`) form
        /// a vim-navigator binding; `select-pane -l` (last pane, e.g. the
        /// `C-\` binding) has no spatial control byte and is not navigable.
        private static func isVimNavigableDirection(_ direction: PaneNavigationDirection) -> Bool {
            switch direction {
            case .left, .right, .up, .down:
                return true
            case .next, .previous:
                return false
            }
        }

        private static func forbiddenIfShell(_ raw: String) -> TmuxCommandMapping {
            .unsupported(reason: "D-028 forbids raw tmux command passthrough from the UI router: \(raw)")
        }

        // MARK: Tokenization

        /// Splits a tmux command string into argument tokens, honoring double
        /// quotes (with backslash escapes), single quotes, `{ … }` blocks
        /// (kept as one braced token), and backslash escapes. An escaped
        /// `\;` command separator surfaces as a standalone ";" token so
        /// multi-command bindings can be detected and refused.
        public static func tokenize(_ command: String) -> [String] {
            var tokens: [String] = []
            var current = ""
            var hasContent = false
            var index = command.startIndex

            func flush() {
                if hasContent {
                    tokens.append(current)
                    current = ""
                    hasContent = false
                }
            }

            while index < command.endIndex {
                let character = command[index]
                switch character {
                case " ", "\t":
                    flush()
                    index = command.index(after: index)

                case "\\":
                    let next = command.index(after: index)
                    if next < command.endIndex {
                        current.append(command[next])
                        hasContent = true
                        index = command.index(after: next)
                    } else {
                        current.append(character)
                        hasContent = true
                        index = next
                    }

                case "\"":
                    index = command.index(after: index)
                    while index < command.endIndex, command[index] != "\"" {
                        if command[index] == "\\" {
                            let next = command.index(after: index)
                            guard next < command.endIndex else { break }
                            current.append(command[next])
                            index = command.index(after: next)
                        } else {
                            current.append(command[index])
                            index = command.index(after: index)
                        }
                    }
                    hasContent = true
                    if index < command.endIndex {
                        index = command.index(after: index)
                    }

                case "'":
                    index = command.index(after: index)
                    while index < command.endIndex, command[index] != "'" {
                        current.append(command[index])
                        index = command.index(after: index)
                    }
                    hasContent = true
                    if index < command.endIndex {
                        index = command.index(after: index)
                    }

                case "{":
                    flush()
                    var depth = 1
                    var block = ""
                    index = command.index(after: index)
                    while index < command.endIndex, depth > 0 {
                        let inner = command[index]
                        if inner == "{" {
                            depth += 1
                        } else if inner == "}" {
                            depth -= 1
                            if depth == 0 {
                                break
                            }
                        }
                        block.append(inner)
                        index = command.index(after: index)
                    }
                    if index < command.endIndex {
                        index = command.index(after: index)
                    }
                    tokens.append("{\(block)}")

                default:
                    current.append(character)
                    hasContent = true
                    index = command.index(after: index)
                }
            }
            flush()
            return tokens
        }

        // MARK: Helpers

        private static func followsPaneCwd(_ arguments: [String]) -> Bool {
            value(after: "-c", in: arguments) == "#{pane_current_path}"
        }

        private static func value(after flag: String, in tokens: [String]) -> String? {
            guard let flagIndex = tokens.firstIndex(of: flag) else {
                return nil
            }
            let valueIndex = tokens.index(after: flagIndex)
            guard valueIndex < tokens.endIndex else {
                return nil
            }
            return tokens[valueIndex]
        }

        private static func windowIndex(from target: String) -> Int? {
            let normalized = target.trimmingCharacters(in: CharacterSet(charactersIn: ":="))
            return Int(normalized)
        }

        private static func braceContent(_ token: String) -> String? {
            guard token.hasPrefix("{"), token.hasSuffix("}"), token.count >= 2 else {
                return nil
            }
            return String(token.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
        }

        private enum Command {
            case splitWindow
            case newWindow
            case renameWindow
            case commandPrompt
            case selectPane
            case lastPane
            case nextWindow
            case previousWindow
            case lastWindow
            case selectWindow
            case resizePane
            case killPane
            case killWindow
            case confirmBefore
            case sendPrefix
            case switchClient
            case copyMode
            /// `if-shell`/`if`: only the vim-tmux-navigator shape is honored
            /// (as `.navigatePaneVimAware`); every other form is forbidden
            /// passthrough. Handled separately from `forbiddenPassthrough`.
            case ifShell
            /// Commands that could only be honored by executing raw command
            /// strings, which D-028 forbids from the UI router.
            case forbiddenPassthrough
            case unknown
        }

        private static func canonicalCommand(_ name: String) -> Command {
            switch name {
            case "split-window", "splitw":
                return .splitWindow
            case "new-window", "neww":
                return .newWindow
            case "rename-window", "renamew":
                return .renameWindow
            case "command-prompt":
                return .commandPrompt
            case "select-pane", "selectp":
                return .selectPane
            case "last-pane", "lastp":
                return .lastPane
            case "next-window", "next":
                return .nextWindow
            case "previous-window", "prev":
                return .previousWindow
            case "last-window", "last":
                return .lastWindow
            case "select-window", "selectw":
                return .selectWindow
            case "resize-pane", "resizep":
                return .resizePane
            case "kill-pane", "killp":
                return .killPane
            case "kill-window", "killw":
                return .killWindow
            case "confirm-before", "confirm":
                return .confirmBefore
            case "send-prefix":
                return .sendPrefix
            case "switch-client", "switchc":
                return .switchClient
            case "copy-mode":
                return .copyMode
            case "if-shell", "if":
                return .ifShell
            case "list-sessions", "ls", "choose-tree", "display-menu", "menu", "run-shell", "run":
                return .forbiddenPassthrough
            default:
                return .unknown
            }
        }
    }
}
