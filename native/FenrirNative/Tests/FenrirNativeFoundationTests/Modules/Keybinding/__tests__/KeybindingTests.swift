import Foundation
import Testing
import FenrirNativeShared
import Settings
import Keybinding

@Suite("Keybinding module registration")
struct KeybindingTests {
    @Test("DescribeKeybindingModule exposes the Keybinding target")
    func describeModule() async throws {
        let action = Keybinding.DescribeKeybindingModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "keybinding", source: .test)).get()

        #expect(result.summary.moduleName == "Keybinding")
        #expect(result.requestID == "keybinding")
    }

    @Test("ImportTmuxKeymap maps common tmux pane, window, and session bindings")
    func importCommonTmuxMappings() async throws {
        let result = try await importMap(bindings: [
            .init(key: .init("h"), command: "select-pane -L"),
            .init(key: .init("l"), command: "select-pane -R"),
            .init(key: .init("k"), command: "select-pane -U"),
            .init(key: .init("j"), command: "select-pane -D"),
            .init(key: .init("n"), command: "next-window"),
            .init(key: .init("p"), command: "previous-window"),
            .init(key: .init("0"), command: "select-window -t :=0"),
            .init(key: .init(")"), command: "switch-client -n"),
            .init(key: .init("("), command: "switch-client -p"),
            .init(key: .init("L"), command: "switch-client -l"),
            .init(key: .init("%"), command: "split-window -h"),
            .init(key: .init("\""), command: "split-window -v"),
            .init(key: .init("c"), command: "new-window")
        ])

        #expect(result.action(forPrefixKey: "h") == .focusPane(.left))
        #expect(result.action(forPrefixKey: "l") == .focusPane(.right))
        #expect(result.action(forPrefixKey: "k") == .focusPane(.up))
        #expect(result.action(forPrefixKey: "j") == .focusPane(.down))
        #expect(result.action(forPrefixKey: "n") == .switchWindow(.next))
        #expect(result.action(forPrefixKey: "p") == .switchWindow(.previous))
        #expect(result.action(forPrefixKey: "0") == .switchWindow(.index(0)))
        #expect(result.action(forPrefixKey: ")") == .switchSession(.next))
        #expect(result.action(forPrefixKey: "(") == .switchSession(.previous))
        #expect(result.action(forPrefixKey: "L") == .switchSession(.last))
        #expect(result.action(forPrefixKey: "%") == .splitPane(.horizontal))
        #expect(result.action(forPrefixKey: "\"") == .splitPane(.vertical))
        #expect(result.action(forPrefixKey: "c") == .newWindow)
        #expect(result.unsupportedBindings.isEmpty)
    }

    @Test("Native defaults open the palette and agent composer context modes")
    func nativeDefaultsOpenPaletteAndAgentComposer() async throws {
        let result = try await importMap(bindings: [])

        #expect(result.binding(for: .native(.command("p")))?.action == .openPalette(prefix: nil))
        #expect(result.binding(for: .native(.init("a", modifiers: [.command, .shift])))?.action == .openAgentComposer(context: .selection))
        #expect(result.binding(for: .native(.init("a", modifiers: [.command, .option])))?.action == .openAgentComposer(context: .viewport))
        #expect(result.binding(for: .native(.init("a", modifiers: [.control, .option])))?.action == .openAgentComposer(context: .lastLines(80)))
        #expect(result.palettePrefixes == [.agent, .shell, .pane, .workflow, .help])
    }

    @Test("User overrides win over native defaults")
    func userOverridesWin() async throws {
        let result = try await importMap(
            bindings: [],
            userOverrides: [
                .init(
                    trigger: .native(.command("p")),
                    action: .openPalette(prefix: .workflow),
                    reason: "user configured workflow palette"
                )
            ]
        )

        #expect(result.binding(for: .native(.command("p")))?.action == .openPalette(prefix: .workflow))
        #expect(result.conflicts.count == 1)
        #expect(result.conflicts.first?.kept.source == .userOverride)
        #expect(result.conflicts.first?.rejected.source == .nativeOverride)
    }

    @Test("Native overrides are preserved during conflicts")
    func nativeOverridesArePreserved() async throws {
        let result = try await importMap(
            bindings: [],
            userOverrides: [
                .init(
                    trigger: .native(.command("p")),
                    action: .focusPane(.left),
                    reason: "first user mapping"
                ),
                .init(
                    trigger: .native(.command("p")),
                    action: .focusPane(.right),
                    reason: "latest user mapping"
                )
            ]
        )

        #expect(result.binding(for: .native(.command("p")))?.action == .focusPane(.right))
        #expect(result.conflicts.count == 2)
    }

    @Test("Unsupported tmux commands are reported without creating action bindings")
    func unsupportedCommandsAreReported() async throws {
        let unsupported = Keybinding.TmuxKeyBinding(key: .init("x"), command: "display-popup -E top")
        let result = try await importMap(bindings: [unsupported])

        #expect(result.action(forPrefixKey: "x") == nil)
        #expect(result.unsupportedBindings == [
            .init(binding: unsupported, reason: "Unsupported tmux command for native action routing: display-popup -E top")
        ])
    }

    @Test("Resolved Fenrir actions never emit shell bytes")
    func resolvedActionsDoNotEmitShellBytes() async throws {
        let importedMap = try await importMap(bindings: [
            .init(key: .init("h"), command: "select-pane -L")
        ])
        let action = Keybinding.ResolveKeybinding(clock: FixedClock())

        let resolved = try await action.run(.init(
            requestID: "keybinding.resolve",
            source: .test,
            trigger: .tmuxPrefix(.init(prefix: .control("b"), key: .init("h"))),
            importedMap: importedMap
        )).get()

        #expect(resolved.resolution == .fenrirAction(.focusPane(.left)))
        #expect(!resolved.emitsShellBytes)
    }

    @Test("Agent composer keybindings never emit shell bytes")
    func agentComposerKeybindingsDoNotEmitShellBytes() async throws {
        let importedMap = try await importMap(bindings: [])
        let action = Keybinding.ResolveKeybinding(clock: FixedClock())

        let resolved = try await action.run(.init(
            requestID: "keybinding.resolve.agent",
            source: .test,
            trigger: .native(.init("a", modifiers: [.command, .shift])),
            importedMap: importedMap
        )).get()

        #expect(resolved.resolution == .fenrirAction(.openAgentComposer(context: .selection)))
        #expect(!resolved.emitsShellBytes)
    }

    @Test("Unmapped keys pass through to the shell")
    func unmappedKeysPassThrough() async throws {
        let importedMap = try await importMap(bindings: [])
        let action = Keybinding.ResolveKeybinding(clock: FixedClock())

        let resolved = try await action.run(.init(
            requestID: "keybinding.resolve",
            source: .test,
            trigger: .native(.init("a")),
            importedMap: importedMap
        )).get()

        #expect(resolved.resolution == .passThroughToShell)
        #expect(resolved.emitsShellBytes)
    }
}

private extension KeybindingTests {
    func importMap(
        bindings: [Keybinding.TmuxKeyBinding],
        preferences: Settings.KeybindingImportPreferences = Settings.KeybindingImportPreferences(),
        userOverrides: [Keybinding.UserKeybindingOverride] = []
    ) async throws -> Keybinding.ImportedKeybindingMap {
        let action = Keybinding.ImportTmuxKeymap(clock: FixedClock())
        return try await action.run(.init(
            requestID: "keybinding.import",
            source: .test,
            keymap: .init(prefix: .control("b"), bindings: bindings),
            preferences: preferences,
            userOverrides: userOverrides
        )).get().importedMap
    }
}

private extension Keybinding.ImportedKeybindingMap {
    func action(forPrefixKey key: String) -> Keybinding.FenrirKeyAction? {
        binding(for: .tmuxPrefix(.init(prefix: .control("b"), key: .init(key))))?.action
    }
}
