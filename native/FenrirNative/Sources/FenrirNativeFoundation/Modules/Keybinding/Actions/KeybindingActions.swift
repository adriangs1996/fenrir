import Foundation
import FenrirNativeShared
import Settings

public extension Keybinding {
    struct DescribeKeybindingModule: FenrirAction {
        public typealias Failure = KeybindingError

        public let clock: any KeybindingClock

        public init(clock: any KeybindingClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeKeybindingModuleInput) async -> Result<DescribeKeybindingModuleResult, KeybindingError> {
            let timestamp = clock.now()
            return .success(DescribeKeybindingModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct ImportTmuxKeymap: FenrirAction {
        public typealias Failure = KeybindingError

        public let clock: any KeybindingClock

        public init(clock: any KeybindingClock) {
            self.clock = clock
        }

        public func run(_ input: ImportTmuxKeymapInput) async -> Result<ImportTmuxKeymapResult, KeybindingError> {
            var builder = KeybindingMapBuilder(policy: input.preferences.conflictPolicy)
            nativeDefaultBindings.forEach { builder.insert($0) }
            input.userOverrides.forEach {
                builder.insert(ActionBinding(trigger: $0.trigger, action: $0.action, source: .userOverride))
            }

            var unsupported: [UnsupportedTmuxBinding] = []
            if input.preferences.importTmuxKeybindings {
                for binding in input.keymap.bindings {
                    switch tmuxAction(for: binding.command) {
                    case let .some(action):
                        builder.insert(ActionBinding(
                            trigger: tmuxTrigger(for: binding, keymap: input.keymap),
                            action: action,
                            source: .tmuxImport,
                            sourceTable: binding.table
                        ))
                    case .none:
                        if input.preferences.unsupportedPolicy == .collectDiagnostics {
                            unsupported.append(UnsupportedTmuxBinding(
                                binding: binding,
                                reason: "Unsupported tmux command for native action routing: \(binding.command)"
                            ))
                        }
                    }
                }
            }

            return .success(ImportTmuxKeymapResult(
                requestID: input.requestID,
                importedMap: ImportedKeybindingMap(
                    bindings: builder.bindings,
                    conflicts: builder.conflicts,
                    unsupportedBindings: unsupported,
                    prefix: input.keymap.prefix,
                    prefix2: input.keymap.prefix2
                ),
                timestamp: clock.now()
            ))
        }
    }

    struct ResolveKeybinding: FenrirAction {
        public typealias Failure = KeybindingError

        public let clock: any KeybindingClock

        public init(clock: any KeybindingClock) {
            self.clock = clock
        }

        public func run(_ input: ResolveKeybindingInput) async -> Result<ResolveKeybindingResult, KeybindingError> {
            let resolutionTrigger = Self.resolutionTrigger(for: input)

            if case .root = input.state,
               case let .terminal(key) = input.trigger,
               key == input.importedMap.prefix {
                return .success(ResolveKeybindingResult(
                    requestID: input.requestID,
                    resolution: .enterTmuxKeyTable(.prefix),
                    emitsShellBytes: false,
                    timestamp: clock.now()
                ))
            }

            if case .root = input.state,
               case let .terminal(key) = input.trigger,
               let prefix2 = input.importedMap.prefix2,
               key == prefix2 {
                return .success(ResolveKeybindingResult(
                    requestID: input.requestID,
                    resolution: .enterTmuxKeyTable(.prefix2),
                    emitsShellBytes: false,
                    timestamp: clock.now()
                ))
            }

            if let binding = input.importedMap.binding(for: resolutionTrigger) {
                return .success(ResolveKeybindingResult(
                    requestID: input.requestID,
                    resolution: .fenrirAction(binding.action),
                    emitsShellBytes: false,
                    timestamp: clock.now()
                ))
            }

            if case let .table(table) = input.state,
               case let .terminal(key) = input.trigger {
                return .success(ResolveKeybindingResult(
                    requestID: input.requestID,
                    resolution: .unsupported(.init(
                        table: table,
                        key: key,
                        reason: "No imported Fenrir action for tmux table \(table.rawValue)"
                    )),
                    emitsShellBytes: false,
                    timestamp: clock.now()
                ))
            }

            return .success(ResolveKeybindingResult(
                requestID: input.requestID,
                resolution: .passThroughToShell,
                emitsShellBytes: true,
                timestamp: clock.now()
            ))
        }

        private static func resolutionTrigger(for input: ResolveKeybindingInput) -> KeybindingTrigger {
            switch (input.state, input.trigger) {
            case (.root, let trigger):
                if case let .terminal(key) = trigger {
                    return .tmuxTable(.init(table: .root, key: key))
                }
                if case let .tmuxPrefix(binding) = trigger, binding.prefix == input.importedMap.prefix {
                    return .tmuxTable(.init(table: .prefix, key: binding.key))
                }
                return trigger
            case let (.table(table), .terminal(key)):
                return .tmuxTable(.init(table: table, key: key))
            case let (.table(table), .tmuxPrefix(binding)):
                return .tmuxTable(.init(table: table, key: binding.key))
            case (_, let trigger):
                return trigger
            }
        }
    }
}

private extension Keybinding {
    static func tmuxTrigger(for binding: TmuxKeyBinding, keymap _: EffectiveTmuxKeymap) -> KeybindingTrigger {
        return .tmuxTable(.init(table: binding.table, key: binding.key))
    }

    static var nativeDefaultBindings: [ActionBinding] {
        [
            ActionBinding(
                trigger: .native(.command("p")),
                action: .openPalette(prefix: nil),
                source: .nativeOverride
            ),
            ActionBinding(
                trigger: .native(.init("a", modifiers: [.command, .shift])),
                action: .openAgentComposer(context: .selection),
                source: .nativeOverride
            ),
            ActionBinding(
                trigger: .native(.init("a", modifiers: [.command, .option])),
                action: .openAgentComposer(context: .viewport),
                source: .nativeOverride
            ),
            ActionBinding(
                trigger: .native(.init("a", modifiers: [.control, .option])),
                action: .openAgentComposer(context: .lastLines(80)),
                source: .nativeOverride
            )
        ]
    }

    static func tmuxAction(for command: String) -> FenrirKeyAction? {
        let tokens = tmuxCommandTokens(command)
        guard let commandName = tokens.first else {
            return nil
        }

        switch commandName {
        case "select-pane":
            if tokens.contains("-L") { return .focusPane(.left) }
            if tokens.contains("-R") { return .focusPane(.right) }
            if tokens.contains("-U") { return .focusPane(.up) }
            if tokens.contains("-D") { return .focusPane(.down) }
            if tokens.contains("-t") { return .focusPane(.next) }
            return nil
        case "last-pane":
            return .focusPane(.previous)
        case "next-window":
            return .switchWindow(.next)
        case "previous-window":
            return .switchWindow(.previous)
        case "last-window":
            return .switchWindow(.last)
        case "select-window":
            if tokens.contains("-n") { return .switchWindow(.next) }
            if tokens.contains("-p") { return .switchWindow(.previous) }
            if let target = target(after: "-t", in: tokens) {
                if let index = tmuxWindowIndexTarget(target) {
                    return .switchWindow(.index(index))
                }
                return .switchWindow(.named(target))
            }
            return nil
        case "switch-client":
            if let table = target(after: "-T", in: tokens) {
                return .activateTmuxKeyTable(.init(table))
            }
            if tokens.contains("-n") { return .switchSession(.next) }
            if tokens.contains("-p") { return .switchSession(.previous) }
            if tokens.contains("-l") { return .switchSession(.last) }
            if let target = target(after: "-t", in: tokens) {
                return .switchSession(.named(target))
            }
            return nil
        case "new-window":
            return .newWindow
        case "kill-window":
            return .closeWindow
        case "split-window", "splitw":
            if tokens.contains("-h") { return .splitPane(.horizontal) }
            if tokens.contains("-v") { return .splitPane(.vertical) }
            return .splitPane(.vertical)
        case "send-prefix":
            return .sendTmuxPrefix
        case "command-prompt":
            return .openPalette(prefix: .help)
        case "choose-tree":
            return .openPalette(prefix: .shell)
        default:
            return nil
        }
    }

    static func tmuxCommandTokens(_ command: String) -> [String] {
        command.split(whereSeparator: \.isWhitespace).map(String.init)
    }

    static func target(after flag: String, in tokens: [String]) -> String? {
        guard let flagIndex = tokens.firstIndex(of: flag) else {
            return nil
        }

        let targetIndex = tokens.index(after: flagIndex)
        guard targetIndex < tokens.endIndex else {
            return nil
        }

        return tokens[targetIndex]
    }

    static func tmuxWindowIndexTarget(_ target: String) -> Int? {
        let normalized = target.trimmingCharacters(in: CharacterSet(charactersIn: ":="))
        return Int(normalized)
    }
}

private struct KeybindingMapBuilder {
    private let policy: Settings.KeybindingConflictPolicy
    private var bindingsByTrigger: [Keybinding.KeybindingTrigger: Keybinding.ActionBinding] = [:]

    private(set) var conflicts: [Keybinding.KeybindingConflict] = []

    init(policy: Settings.KeybindingConflictPolicy) {
        self.policy = policy
    }

    var bindings: [Keybinding.ActionBinding] {
        bindingsByTrigger.values.sorted { lhs, rhs in
            String(describing: lhs.trigger) < String(describing: rhs.trigger)
        }
    }

    mutating func insert(_ binding: Keybinding.ActionBinding) {
        guard let existing = bindingsByTrigger[binding.trigger] else {
            bindingsByTrigger[binding.trigger] = binding
            return
        }

        let kept: Keybinding.ActionBinding
        let rejected: Keybinding.ActionBinding
        if shouldReplace(existing: existing, candidate: binding) {
            bindingsByTrigger[binding.trigger] = binding
            kept = binding
            rejected = existing
        } else {
            kept = existing
            rejected = binding
        }

        conflicts.append(Keybinding.KeybindingConflict(
            trigger: binding.trigger,
            kept: kept,
            rejected: rejected,
            policy: policy
        ))
    }

    private func shouldReplace(
        existing: Keybinding.ActionBinding,
        candidate: Keybinding.ActionBinding
    ) -> Bool {
        if candidate.source == .userOverride {
            return true
        }

        if existing.source == .userOverride || existing.source == .nativeOverride {
            return false
        }

        switch policy {
        case .preferTmux:
            return candidate.source == .tmuxImport
        case .preferFenrir, .reportOnly:
            return false
        }
    }
}
