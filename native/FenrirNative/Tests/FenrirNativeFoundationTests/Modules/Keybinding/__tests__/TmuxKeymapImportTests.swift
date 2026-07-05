import Foundation
import Testing
import FenrirNativeShared
import Keybinding

@Suite("Server tmux keymap import (real keymap fixture)")
struct TmuxKeymapImportTests {
    private func importFixture() async throws -> Keybinding.ImportServerTmuxKeymapResult {
        try await Keybinding.ImportServerTmuxKeymap(clock: FixedClock()).run(.init(
            requestID: "keybinding.import.server",
            source: .test,
            payload: TmuxKeymapFixture.wirePayload()
        )).get()
    }

    @Test("Wire JSON decodes with the Task A field names, including repeat")
    func wireJSONDecodes() throws {
        let json = """
        {
          "workspaceId": "fenrir",
          "prefix": "C-s",
          "prefix2": null,
          "repeatTimeMs": 500,
          "bindings": [
            { "table": "prefix", "key": "s", "command": "split-window -h -c \\"#{pane_current_path}\\"", "repeat": false },
            { "table": "prefix", "key": "C-h", "command": "resize-pane -L 5", "repeat": true },
            { "table": "root", "key": "M-1", "command": "select-window -t 1" }
          ]
        }
        """
        let payload = try JSONDecoder().decode(
            Keybinding.TmuxKeymapWirePayload.self,
            from: Data(json.utf8)
        )

        #expect(payload.workspaceId == "fenrir")
        #expect(payload.prefix == "C-s")
        #expect(payload.prefix2 == nil)
        #expect(payload.repeatTimeMs == 500)
        #expect(payload.bindings.count == 3)
        #expect(payload.bindings[0].repeats == false)
        #expect(payload.bindings[1].repeats == true)
        // "repeat" omitted defaults to false
        #expect(payload.bindings[2].repeats == false)
        #expect(payload.bindings[0].command == ##"split-window -h -c "#{pane_current_path}""##)
    }

    @Test("Fixture payload imports the effective prefix and repeat time")
    func importsPrefixAndRepeatTime() async throws {
        let result = try await importFixture()

        #expect(result.keymap.prefix == .control("s"))
        #expect(result.keymap.prefix2 == nil)
        #expect(result.keymap.repeatTimeMs == 500)
        #expect(result.compiledKeymap.prefix == .control("s"))
        #expect(result.compiledKeymap.repeatTimeMs == 500)
    }

    @Test("Custom prefix-table bindings map to typed actions")
    func mapsCustomPrefixBindings() async throws {
        let compiled = try await importFixture().compiledKeymap

        func action(_ key: Keybinding.KeyStroke) -> Keybinding.FenrirKeyAction? {
            guard case let .action(action)? = compiled.binding(in: .prefix, for: key)?.behavior else {
                return nil
            }
            return action
        }

        #expect(action(.init("s")) == .splitPane(axis: .horizontal, followPaneCwd: true))
        #expect(action(.init("t")) == .splitPane(axis: .vertical, followPaneCwd: true))
        #expect(action(.init("n")) == .newWindow(followPaneCwd: true))
        #expect(action(.init("c")) == .newWindow(followPaneCwd: true))
        #expect(action(.init("r")) == .renameWindowPrompt)
        #expect(action(.init(",")) == .renameWindowPrompt)
        #expect(action(.init("h")) == .focusPane(.left))
        #expect(action(.init("j")) == .focusPane(.down))
        #expect(action(.init("k")) == .focusPane(.up))
        #expect(action(.init("l")) == .focusPane(.right))
        #expect(action(.init("f")) == .zoomPane)
        #expect(action(.init("z")) == .zoomPane)
        #expect(action(.init(";")) == .focusPane(.previous))
        #expect(action(.init("o")) == .focusPane(.next))
        #expect(action(.init("x")) == .closePane(needsConfirmation: true))
        #expect(action(.init("&")) == .closeWindow(needsConfirmation: true))
        #expect(action(.init("%")) == .splitPane(axis: .horizontal, followPaneCwd: true))
        #expect(action(.init("\"")) == .splitPane(axis: .vertical, followPaneCwd: true))
        #expect(action(.init("0")) == .switchWindow(.index(0)))
        #expect(action(.init("9")) == .switchWindow(.index(9)))
        #expect(action(.control("n")) == .switchWindow(.next))
        #expect(action(.control("p")) == .switchWindow(.previous))
        #expect(action(.control("s")) == .sendTmuxPrefix)
        #expect(action(.init("(")) == .switchSession(.previous))
        #expect(action(.init(")")) == .switchSession(.next))
        #expect(action(.init("L")) == .switchSession(.last))
    }

    @Test("Repeatable resize bindings keep the bind-key -r flag")
    func keepsRepeatFlags() async throws {
        let compiled = try await importFixture().compiledKeymap

        for key in [Keybinding.KeyStroke.control("h"), .control("j"), .control("k"), .control("r")] {
            let binding = compiled.binding(in: .prefix, for: key)
            #expect(binding?.repeats == true, "expected \(key) to repeat")
            guard case let .action(.resizePane(_, amount))? = binding?.behavior else {
                Issue.record("Expected resizePane for \(key)")
                continue
            }
            #expect(amount == 5)
        }
        #expect(compiled.binding(in: .prefix, for: .init("Up"))?.repeats == true)
        #expect(compiled.binding(in: .prefix, for: .init("n"))?.repeats == false)
    }

    @Test("Root table keeps M-1..M-9 select-window with raw indexes")
    func mapsRootAltNumbers() async throws {
        let compiled = try await importFixture().compiledKeymap

        for index in 1...9 {
            let binding = compiled.binding(in: .root, for: .init("\(index)", modifiers: [.option]))
            #expect(binding?.behavior == .action(.switchWindow(.index(index))))
        }
    }

    @Test("Unsupported commands are recorded as diagnostics with specific reasons")
    func recordsUnsupportedDiagnostics() async throws {
        let result = try await importFixture()

        func reason(forPrefixKey key: Keybinding.KeyStroke) -> String? {
            result.unsupportedBindings.first { $0.binding.table == .prefix && $0.binding.key == key }?.reason
        }

        let listSessions = reason(forPrefixKey: .init("w"))
        #expect(listSessions?.contains("D-028") == true)
        #expect(listSessions?.contains("list-sessions") == true)

        let runShell = reason(forPrefixKey: .init("p"))
        #expect(runShell?.contains("D-028") == true)

        let copyMode = reason(forPrefixKey: .init("["))
        #expect(copyMode?.contains("copy-mode") == true)

        let displayMenu = reason(forPrefixKey: .init("<"))
        #expect(displayMenu?.contains("D-028") == true)

        let commandPrompt = reason(forPrefixKey: .init(":"))
        #expect(commandPrompt?.contains("command-prompt") == true)

        // Unsupported bindings still land in the compiled keymap so the state
        // machine can give discrete feedback instead of leaking bytes.
        #expect(result.compiledKeymap.binding(in: .prefix, for: .init("w"))?.behavior
            == .unsupported(reason: listSessions ?? ""))
    }

    @Test("Mouse-only key specs are recorded as unparseable, keyboard specs all parse")
    func recordsUnparseableMouseBindings() async throws {
        let result = try await importFixture()

        let unparseableKeys = Set(result.unparseableBindings.map(\.key))
        #expect(unparseableKeys.contains("MouseDown1Pane"))
        #expect(unparseableKeys.contains("WheelUpStatus"))
        #expect(unparseableKeys.contains("DoubleClick1Pane"))
        #expect(unparseableKeys.contains("M-MouseDown3Pane"))

        // Every unparseable entry is a mouse key; the whole keyboard surface parsed.
        for entry in result.unparseableBindings {
            #expect(
                entry.key.contains("Mouse") || entry.key.contains("Wheel") || entry.key.contains("Click"),
                "unexpected unparseable key: \(entry.key)"
            )
        }

        // And nothing keyboard-parseable was dropped: all keyboard bindings
        // from the wire payload are present in the effective keymap.
        let payload = TmuxKeymapFixture.wirePayload()
        #expect(result.keymap.bindings.count == payload.bindings.count - result.unparseableBindings.count)
    }

    @Test("An unparseable prefix key spec fails the import")
    func unparseablePrefixFails() async throws {
        let action = Keybinding.ImportServerTmuxKeymap(clock: FixedClock())
        let result = await action.run(.init(
            requestID: "keybinding.import.badprefix",
            source: .test,
            payload: .init(prefix: "MouseDown1Pane", bindings: [])
        ))

        #expect(result == .failure(.tmuxImportFailed("Unparseable tmux prefix key spec: MouseDown1Pane")))
    }

    @Test("Missing repeat-time falls back to the tmux default")
    func missingRepeatTimeUsesDefault() async throws {
        let action = Keybinding.ImportServerTmuxKeymap(clock: FixedClock())
        let result = try await action.run(.init(
            requestID: "keybinding.import.defaultrepeat",
            source: .test,
            payload: .init(prefix: "C-b", bindings: [])
        )).get()

        #expect(result.keymap.repeatTimeMs == Keybinding.EffectiveTmuxKeymap.defaultRepeatTimeMs)
        #expect(result.keymap.prefix == .control("b"))
    }

    @Test("Unparseable prefix2 is recorded as a diagnostic, import continues")
    func unparseablePrefix2IsDiagnostic() async throws {
        let action = Keybinding.ImportServerTmuxKeymap(clock: FixedClock())
        let result = try await action.run(.init(
            requestID: "keybinding.import.badprefix2",
            source: .test,
            payload: .init(prefix: "C-s", prefix2: "WheelUpPane", bindings: [])
        )).get()

        #expect(result.keymap.prefix2 == nil)
        #expect(result.unparseableBindings.map(\.key) == ["WheelUpPane"])
    }
}
