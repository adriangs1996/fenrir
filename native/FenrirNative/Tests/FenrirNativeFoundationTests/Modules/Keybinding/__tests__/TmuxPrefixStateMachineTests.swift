import Foundation
import Testing
import FenrirNativeShared
import Keybinding

@Suite("Tmux prefix state machine (real keymap fixture, prefix C-s)")
struct TmuxPrefixStateMachineTests {
    private static let epoch = Date(timeIntervalSince1970: 1_700_000_000)

    private var prefix: Keybinding.KeyStroke { .control("s") }

    private func at(_ milliseconds: Int) -> FenrirTimestamp {
        FenrirTimestamp(Self.epoch.addingTimeInterval(Double(milliseconds) / 1000))
    }

    private func makeMachine(prefixTimeoutMs: Int? = nil) -> Keybinding.TmuxPrefixStateMachine {
        Keybinding.TmuxPrefixStateMachine(
            keymap: TmuxKeymapFixture.compiledKeymap(),
            prefixTimeoutMs: prefixTimeoutMs
        )
    }

    @Test("C-s enters the prefix table consuming the key")
    func prefixEntersTable() {
        var machine = makeMachine()
        let effects = machine.handleKey(prefix, at: at(0))

        #expect(effects == [.consumeKey, .enterPrefix(.prefix)])
        #expect(machine.state == .prefixPending(table: .prefix, since: at(0)))
    }

    @Test("C-s s splits horizontally following the pane cwd")
    func prefixSplitHorizontal() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init("s"), at: at(50))

        #expect(effects == [
            .consumeKey,
            .executeAction(.splitPane(axis: .horizontal, followPaneCwd: true)),
            .exitPrefix
        ])
        #expect(machine.state == .idle)
    }

    @Test("C-s t splits vertically following the pane cwd")
    func prefixSplitVertical() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init("t"), at: at(50))

        #expect(effects == [
            .consumeKey,
            .executeAction(.splitPane(axis: .vertical, followPaneCwd: true)),
            .exitPrefix
        ])
    }

    @Test("C-s n opens a new window following the pane cwd")
    func prefixNewWindow() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init("n"), at: at(50))

        #expect(effects == [
            .consumeKey,
            .executeAction(.newWindow(followPaneCwd: true)),
            .exitPrefix
        ])
    }

    @Test("C-s r opens the rename window prompt")
    func prefixRenamePrompt() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init("r"), at: at(50))

        #expect(effects == [.consumeKey, .executeAction(.renameWindowPrompt), .exitPrefix])
    }

    @Test(
        "C-s h/j/k/l focus panes directionally",
        arguments: [
            ("h", Keybinding.PaneNavigationDirection.left),
            ("j", Keybinding.PaneNavigationDirection.down),
            ("k", Keybinding.PaneNavigationDirection.up),
            ("l", Keybinding.PaneNavigationDirection.right)
        ] as [(String, Keybinding.PaneNavigationDirection)]
    )
    func prefixFocusDirections(key: String, direction: Keybinding.PaneNavigationDirection) {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init(key), at: at(50))

        #expect(effects == [.consumeKey, .executeAction(.focusPane(direction)), .exitPrefix])
    }

    @Test("C-s f and C-s z toggle pane zoom")
    func prefixZoom() {
        for key in ["f", "z"] {
            var machine = makeMachine()
            _ = machine.handleKey(prefix, at: at(0))
            #expect(machine.handleKey(.init(key), at: at(50))
                == [.consumeKey, .executeAction(.zoomPane), .exitPrefix])
        }
    }

    @Test("C-s x asks to close the pane with confirmation from confirm-before")
    func prefixKillPaneNeedsConfirmation() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        #expect(machine.handleKey(.init("x"), at: at(50))
            == [.consumeKey, .executeAction(.closePane(needsConfirmation: true)), .exitPrefix])
    }

    @Test("C-s C-h C-h C-h resizes three times inside one repeat window, no re-prefix")
    func repeatWindowResizesWithoutReprefix() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))

        let first = machine.handleKey(.control("h"), at: at(100))
        let second = machine.handleKey(.control("h"), at: at(300))
        let third = machine.handleKey(.control("h"), at: at(500))

        #expect(first == [
            .consumeKey,
            .executeAction(.resizePane(direction: .left, amount: 5)),
            .stayInRepeat(deadline: at(600))
        ])
        #expect(second == [
            .consumeKey,
            .executeAction(.resizePane(direction: .left, amount: 5)),
            .stayInRepeat(deadline: at(800))
        ])
        #expect(third == [
            .consumeKey,
            .executeAction(.resizePane(direction: .left, amount: 5)),
            .stayInRepeat(deadline: at(1000))
        ])
        #expect(machine.state == .repeatPending(table: .prefix, deadline: at(1000)))

        let noReprefix = (first + second + third).filter {
            if case .enterPrefix = $0 { return true }
            return false
        }
        #expect(noReprefix.isEmpty)
    }

    @Test("Repeat window mixes directions like tmux (C-h then C-j)")
    func repeatWindowMixesRepeatableBindings() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        _ = machine.handleKey(.control("h"), at: at(100))
        let effects = machine.handleKey(.control("j"), at: at(200))

        #expect(effects == [
            .consumeKey,
            .executeAction(.resizePane(direction: .down, amount: 5)),
            .stayInRepeat(deadline: at(700))
        ])
    }

    @Test("During repeat, an unbound key exits and is reprocessed from root (passes through)")
    func repeatWindowUnboundKeyFallsThrough() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        _ = machine.handleKey(.control("h"), at: at(100))

        let effects = machine.handleKey(.init("a"), at: at(200))

        #expect(effects == [.exitPrefix, .passThroughToTerminal(.init("a"))])
        #expect(machine.state == .idle)
    }

    @Test("During repeat, a non-repeatable prefix binding resets to root like tmux")
    func repeatWindowNonRepeatableBindingResetsToRoot() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        _ = machine.handleKey(.control("h"), at: at(100))

        // 'n' is bound (new-window) in the prefix table but not with -r:
        // tmux does NOT run it during repeat; the key reprocesses from root
        // where it is unbound and falls through.
        let effects = machine.handleKey(.init("n"), at: at(200))

        #expect(effects == [.exitPrefix, .passThroughToTerminal(.init("n"))])
    }

    @Test("M-1 resolves from idle via the root table")
    func rootTableAltNumberSelectsWindow() {
        var machine = makeMachine()
        let effects = machine.handleKey(.init("1", modifiers: [.option]), at: at(0))

        #expect(effects == [.consumeKey, .executeAction(.switchWindow(.index(1)))])
        #expect(machine.state == .idle)
    }

    @Test("Root bindings without a native mapping fall through to the terminal")
    func rootUnsupportedBindingsFallThrough() {
        var machine = makeMachine()
        // root C-i runs `run-shell screenshot`; the native client cannot run
        // it (D-028), so the key falls through instead of being swallowed.
        #expect(machine.handleKey(.control("i"), at: at(0))
            == [.passThroughToTerminal(.control("i"))])
    }

    @Test(
        "Root C-h/j/k/l vim-navigator if-shell resolves to navigatePaneVimAware from idle",
        arguments: [
            ("h", Keybinding.PaneNavigationDirection.left),
            ("j", Keybinding.PaneNavigationDirection.down),
            ("k", Keybinding.PaneNavigationDirection.up),
            ("l", Keybinding.PaneNavigationDirection.right)
        ] as [(String, Keybinding.PaneNavigationDirection)]
    )
    func rootVimNavigatorResolvesFromIdle(key: String, direction: Keybinding.PaneNavigationDirection) {
        var machine = makeMachine()
        // The christoomey root binding is captured, no prefix pressed: it must
        // resolve straight from the root table (like M-1) and be CONSUMED, not
        // passed through — the host decides passthrough-vs-navigate live.
        #expect(machine.handleKey(.control(key), at: at(0))
            == [.consumeKey, .executeAction(.navigatePaneVimAware(direction: direction))])
        #expect(machine.state == .idle)
    }

    @Test("C-s w gives discrete unsupported feedback (list-sessions) and exits")
    func prefixUnsupportedBindingGivesFeedback() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init("w"), at: at(50))

        #expect(effects.count == 3)
        #expect(effects.first == .consumeKey)
        #expect(effects.last == .exitPrefix)
        guard case let .unsupportedFeedback(resolution) = effects[1] else {
            Issue.record("Expected unsupported feedback, got \(effects)")
            return
        }
        #expect(resolution.table == .prefix)
        #expect(resolution.key == .init("w"))
        #expect(resolution.rawCommand == "list-sessions")
        #expect(resolution.reason.contains("D-028"))
        #expect(machine.state == .idle)
    }

    @Test("Second C-s resolves via the imported table to send-prefix, never hardcoded")
    func secondPrefixKeyResolvesFromTable() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(prefix, at: at(50))

        #expect(effects == [.consumeKey, .executeAction(.sendTmuxPrefix), .exitPrefix])
    }

    @Test("Escape exits prefix mode without feedback and without replaying the prefix")
    func escapeExitsPrefixMode() {
        var machine = makeMachine()
        let entry = machine.handleKey(prefix, at: at(0))
        let exit = machine.handleKey(.escape, at: at(50))

        #expect(exit == [.consumeKey, .exitPrefix])
        #expect(machine.state == .idle)

        // The consumed C-s must never be replayed to the terminal: tmux
        // swallows the prefix key too, and C-s would inject XOFF.
        let replayed = (entry + exit).contains { effect in
            if case let .passThroughToTerminal(key) = effect {
                return key == prefix
            }
            return false
        }
        #expect(!replayed)
    }

    @Test("Unbound key in prefix mode is consumed with unsupported feedback, prefix not replayed")
    func unboundPrefixKeyIsConsumed() {
        var machine = makeMachine()
        let entry = machine.handleKey(prefix, at: at(0))
        let effects = machine.handleKey(.init("F7"), at: at(50))

        #expect(effects.count == 3)
        #expect(effects.first == .consumeKey)
        #expect(effects.last == .exitPrefix)
        guard case let .unsupportedFeedback(resolution) = effects[1] else {
            Issue.record("Expected unsupported feedback, got \(effects)")
            return
        }
        #expect(resolution.table == .prefix)
        #expect(resolution.rawCommand == nil)
        #expect(machine.state == .idle)

        let passThroughs = (entry + effects).contains { effect in
            if case .passThroughToTerminal = effect {
                return true
            }
            return false
        }
        #expect(!passThroughs)
    }

    @Test("Repeat window times out via handleTimeout")
    func repeatWindowTimesOut() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        _ = machine.handleKey(.control("h"), at: at(100))

        #expect(machine.handleTimeout(at: at(400)) == [])
        #expect(machine.handleTimeout(at: at(600)) == [.exitPrefix])
        #expect(machine.state == .idle)

        // After the repeat window closed, C-h is a root vim-navigator binding
        // → resolves from idle to navigatePaneVimAware(left), consumed.
        #expect(machine.handleKey(.control("h"), at: at(700))
            == [.consumeKey, .executeAction(.navigatePaneVimAware(direction: .left))])
    }

    @Test("A key arriving after the repeat deadline is processed from idle")
    func lateKeyAfterRepeatDeadline() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        _ = machine.handleKey(.control("h"), at: at(100))

        let effects = machine.handleKey(.control("h"), at: at(2000))

        // Deadline lapsed: exit the repeat table, then reprocess C-h from idle
        // where it is the root vim-navigator binding (consumed, not replayed).
        #expect(effects == [
            .exitPrefix,
            .consumeKey,
            .executeAction(.navigatePaneVimAware(direction: .left))
        ])
        #expect(machine.state == .idle)
    }

    @Test("Pending prefix times out when a prefix timeout is configured")
    func pendingPrefixTimesOutWhenConfigured() {
        var machine = makeMachine(prefixTimeoutMs: 400)
        _ = machine.handleKey(prefix, at: at(0))

        #expect(machine.handleTimeout(at: at(200)) == [])
        #expect(machine.handleTimeout(at: at(500)) == [.exitPrefix])
        #expect(machine.state == .idle)
        #expect(machine.handleKey(.init("s"), at: at(600))
            == [.passThroughToTerminal(.init("s"))])
    }

    @Test("Pending prefix never times out by default, matching tmux")
    func pendingPrefixDoesNotTimeOutByDefault() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))

        #expect(machine.handleTimeout(at: at(60000)) == [])
        #expect(machine.handleKey(.init("c"), at: at(60050))
            == [.consumeKey, .executeAction(.newWindow(followPaneCwd: true)), .exitPrefix])
    }

    @Test("C-s 5 selects the raw tmux window index")
    func prefixNumberSelectsWindow() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        #expect(machine.handleKey(.init("5"), at: at(50))
            == [.consumeKey, .executeAction(.switchWindow(.index(5))), .exitPrefix])
    }

    @Test("Repeatable arrow bindings stay in repeat (C-s Up Up)")
    func repeatableArrowBindings() {
        var machine = makeMachine()
        _ = machine.handleKey(prefix, at: at(0))
        #expect(machine.handleKey(.init("Up"), at: at(100)) == [
            .consumeKey,
            .executeAction(.focusPane(.up)),
            .stayInRepeat(deadline: at(600))
        ])
        #expect(machine.handleKey(.init("Up"), at: at(200)) == [
            .consumeKey,
            .executeAction(.focusPane(.up)),
            .stayInRepeat(deadline: at(700))
        ])
    }

    @Test("Unmapped keys from idle pass through to the terminal")
    func idleUnmappedKeysPassThrough() {
        var machine = makeMachine()
        #expect(machine.handleKey(.init("a"), at: at(0)) == [.passThroughToTerminal(.init("a"))])
        #expect(machine.handleKey(.init("q", modifiers: [.command]), at: at(10))
            == [.passThroughToTerminal(.init("q", modifiers: [.command]))])
        #expect(machine.state == .idle)
    }

    // MARK: prefix2 (tmux: an ALTERNATE key for the SAME "prefix" table)

    private func makePrefix2Machine() -> Keybinding.TmuxPrefixStateMachine {
        let base = TmuxKeymapFixture.effectiveKeymap()
        let keymap = Keybinding.EffectiveTmuxKeymap(
            prefix: base.prefix,
            prefix2: .control("a"),
            repeatTimeMs: base.repeatTimeMs,
            bindings: base.bindings
        )
        return Keybinding.TmuxPrefixStateMachine(keymap: Keybinding.TmuxCommandMapper.compile(keymap))
    }

    @Test("prefix2 (C-a) enters the PREFIX table — tmux has no prefix2 table")
    func prefix2EntersPrefixTable() {
        var machine = makePrefix2Machine()
        let effects = machine.handleKey(.control("a"), at: at(0))

        #expect(effects == [.consumeKey, .enterPrefix(.prefix)])
        #expect(machine.state == .prefixPending(table: .prefix, since: at(0)))
    }

    @Test("C-a c creates a window exactly like C-s c")
    func prefix2FollowUpKeyResolvesFromPrefixTable() {
        var machine = makePrefix2Machine()
        _ = machine.handleKey(.control("a"), at: at(0))
        let effects = machine.handleKey(.init("c"), at: at(50))

        #expect(effects == [
            .consumeKey,
            .executeAction(.newWindow(followPaneCwd: true)),
            .exitPrefix
        ])
        #expect(machine.state == .idle)
    }

    @Test("C-a C-h opens the repeat window from the prefix table")
    func prefix2RepeatableBindingStaysInRepeat() {
        var machine = makePrefix2Machine()
        _ = machine.handleKey(.control("a"), at: at(0))
        let effects = machine.handleKey(.control("h"), at: at(100))

        #expect(effects == [
            .consumeKey,
            .executeAction(.resizePane(direction: .left, amount: 5)),
            .stayInRepeat(deadline: at(600))
        ])
        #expect(machine.state == .repeatPending(table: .prefix, deadline: at(600)))
    }
}
