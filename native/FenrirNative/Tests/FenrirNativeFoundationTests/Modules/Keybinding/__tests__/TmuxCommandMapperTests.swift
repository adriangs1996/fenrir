import Foundation
import Testing
import FenrirNativeShared
import Keybinding

@Suite("Tmux command mapper")
struct TmuxCommandMapperTests {
    private func map(_ command: String) -> Keybinding.TmuxCommandMapping {
        Keybinding.TmuxCommandMapper.map(command)
    }

    /// Builds the christoomey vim-tmux-navigator binding string exactly as the
    /// user's live keymap emits it (captured 2026-07-04): an `if-shell` whose
    /// condition greps `ps` for a vim-like process, whose true branch re-sends
    /// the key, and whose false branch selects a pane directionally.
    private func vimNavigator(sendKey: String, selectPane: String) -> String {
        let condition = #"ps -o state= -o comm= -t '#{pane_tty}' | grep -iqE '^[^TXZ ]+ +(\S+/)?g?\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'"#
        return "if-shell \"\(condition)\" \"send-keys '\(sendKey)'\" \"select-pane \(selectPane)\""
    }

    @Test("split-window -h is a horizontal layout split (side-by-side panes)")
    func splitWindowAxes() {
        #expect(map(##"split-window -h -c "#{pane_current_path}""##)
            == .action(.splitPane(axis: .horizontal, followPaneCwd: true)))
        #expect(map(##"split-window -v -c "#{pane_current_path}""##)
            == .action(.splitPane(axis: .vertical, followPaneCwd: true)))
        // tmux default without -h/-v is a vertical (stacked) split
        #expect(map(##"split-window -c "#{pane_current_path}""##)
            == .action(.splitPane(axis: .vertical, followPaneCwd: true)))
        #expect(map("split-window -h") == .action(.splitPane(axis: .horizontal, followPaneCwd: false)))
        #expect(map("splitw -h") == .action(.splitPane(axis: .horizontal, followPaneCwd: false)))
    }

    @Test("new-window honors -c '#{pane_current_path}' as followPaneCwd")
    func newWindowFollowsCwd() {
        #expect(map(##"new-window -c "#{pane_current_path}""##) == .action(.newWindow(followPaneCwd: true)))
        #expect(map("new-window") == .action(.newWindow(followPaneCwd: false)))
        #expect(map("new-window -c /tmp") == .action(.newWindow(followPaneCwd: false)))
    }

    @Test("rename-window maps to the native rename prompt")
    func renameWindowMapsToPrompt() {
        #expect(map(#"command-prompt "rename-window %%""#) == .action(.renameWindowPrompt))
        #expect(map(##"command-prompt -I "#W" { rename-window "%%" }"##) == .action(.renameWindowPrompt))
        #expect(map("rename-window main") == .action(.renameWindowPrompt))
    }

    @Test("command-prompt without a rename template is unsupported")
    func otherCommandPromptsAreUnsupported() {
        guard case let .unsupported(reason) = map("command-prompt") else {
            Issue.record("Expected bare command-prompt to be unsupported")
            return
        }
        #expect(reason.contains("command-prompt"))
        #expect(map(##"command-prompt -I "#S" { rename-session "%%" }"##).isUnsupported)
        #expect(map(#"command-prompt -T window-target -p index { select-window -t ":%%" }"#).isUnsupported)
    }

    @Test("select-pane directions map to focusPane")
    func selectPaneDirections() {
        #expect(map("select-pane -L") == .action(.focusPane(.left)))
        #expect(map("select-pane -D") == .action(.focusPane(.down)))
        #expect(map("select-pane -U") == .action(.focusPane(.up)))
        #expect(map("select-pane -R") == .action(.focusPane(.right)))
        #expect(map("select-pane -t :.+") == .action(.focusPane(.next)))
        #expect(map("select-pane -t :.-") == .action(.focusPane(.previous)))
        #expect(map("last-pane") == .action(.focusPane(.previous)))
        #expect(map("select-pane -m").isUnsupported)
        #expect(map("select-pane -M").isUnsupported)
    }

    @Test("christoomey vim-tmux-navigator if-shell maps to navigatePaneVimAware")
    func vimNavigatorIfShellMapsToNavigate() {
        // Verbatim from the user's live keymap (tmux -S … list-keys -T root):
        //   if-shell "<is_vim ps check>" "send-keys C-h" "select-pane -L"
        // The condition + true branch are irrelevant to the native mapping;
        // only the false-branch select-pane direction is extracted.
        #expect(map(vimNavigator(sendKey: "C-h", selectPane: "-L"))
            == .action(.navigatePaneVimAware(direction: .left)))
        #expect(map(vimNavigator(sendKey: "C-j", selectPane: "-D"))
            == .action(.navigatePaneVimAware(direction: .down)))
        #expect(map(vimNavigator(sendKey: "C-k", selectPane: "-U"))
            == .action(.navigatePaneVimAware(direction: .up)))
        #expect(map(vimNavigator(sendKey: "C-l", selectPane: "-R"))
            == .action(.navigatePaneVimAware(direction: .right)))
        // The braced-branch spelling some configs emit is recognized too.
        #expect(map(##"if-shell -F "#{is_vim}" { send-keys C-h } { select-pane -L }"##)
            == .action(.navigatePaneVimAware(direction: .left)))
    }

    @Test("Each vim-navigator direction carries the matching passthrough control byte")
    func vimNavigatorControlBytes() {
        #expect(Keybinding.PaneNavigationDirection.left.vimNavigationControlByte == 0x08) // C-h
        #expect(Keybinding.PaneNavigationDirection.down.vimNavigationControlByte == 0x0A) // C-j
        #expect(Keybinding.PaneNavigationDirection.up.vimNavigationControlByte == 0x0B) // C-k
        #expect(Keybinding.PaneNavigationDirection.right.vimNavigationControlByte == 0x0C) // C-l
        #expect(Keybinding.PaneNavigationDirection.next.vimNavigationControlByte == nil)
        #expect(Keybinding.PaneNavigationDirection.previous.vimNavigationControlByte == nil)
    }

    @Test("A plain root-table select-pane still maps to focusPane, not navigate")
    func plainSelectPaneStaysFocusPane() {
        #expect(map("select-pane -L") == .action(.focusPane(.left)))
        #expect(map("select-pane -D") == .action(.focusPane(.down)))
        #expect(map("select-pane -U") == .action(.focusPane(.up)))
        #expect(map("select-pane -R") == .action(.focusPane(.right)))
    }

    @Test("if-shell whose false branch is not a directional select-pane stays D-028 forbidden")
    func nonNavigatorIfShellForbidden() {
        // C-\ selects the LAST pane (select-pane -l), not a spatial neighbor:
        // no control byte, so it is not a vim-navigator binding.
        #expect(map(vimNavigator(sendKey: "C-\\", selectPane: "-l")).isUnsupported)
        // Mouse/copy-mode if-shells keep their forbidden-passthrough reason.
        guard case let .unsupported(reason) =
            map(##"if-shell -F "#{pane_in_mode}" { send-keys -X page-up } { copy-mode -u }"##)
        else {
            Issue.record("Expected non-navigator if-shell to be unsupported")
            return
        }
        #expect(reason.contains("D-028"))
        // A two-positional if-shell (no false branch) is not the navigator shape.
        #expect(map(#"if-shell "test -d /tmp" "select-pane -L""#).isUnsupported)
    }

    @Test("resize-pane maps direction, amount, and zoom")
    func resizePaneMapping() {
        #expect(map("resize-pane -L 5") == .action(.resizePane(direction: .left, amount: 5)))
        #expect(map("resize-pane -D 5") == .action(.resizePane(direction: .down, amount: 5)))
        #expect(map("resize-pane -R 5") == .action(.resizePane(direction: .right, amount: 5)))
        #expect(map("resize-pane -U 5") == .action(.resizePane(direction: .up, amount: 5)))
        // tmux default adjustment is one cell
        #expect(map("resize-pane -U") == .action(.resizePane(direction: .up, amount: 1)))
        #expect(map("resize-pane -Z") == .action(.zoomPane))
        #expect(map("resize-pane -M").isUnsupported)
    }

    @Test("select-window passes the raw tmux index through for base-index alignment")
    func selectWindowIndexPassthrough() {
        #expect(map("select-window -t :=0") == .action(.switchWindow(.index(0))))
        #expect(map("select-window -t :=9") == .action(.switchWindow(.index(9))))
        #expect(map("select-window -t 1") == .action(.switchWindow(.index(1))))
        #expect(map("select-window -t dev") == .action(.switchWindow(.named("dev"))))
        #expect(map("next-window") == .action(.switchWindow(.next)))
        #expect(map("next-window -a") == .action(.switchWindow(.next)))
        #expect(map("previous-window") == .action(.switchWindow(.previous)))
        #expect(map("last-window") == .action(.switchWindow(.last)))
    }

    @Test("kill-pane and kill-window keep a confirmation flag from confirm-before")
    func killCommandsKeepConfirmationFlag() {
        #expect(map("kill-pane") == .action(.closePane(needsConfirmation: false)))
        #expect(map("kill-window") == .action(.closeWindow(needsConfirmation: false)))
        #expect(map(#"confirm-before -p "kill-pane #P? (y/n)" kill-pane"#)
            == .action(.closePane(needsConfirmation: true)))
        #expect(map(#"confirm-before -p "kill-window #W? (y/n)" kill-window"#)
            == .action(.closeWindow(needsConfirmation: true)))
        #expect(map("confirm-before { kill-window }") == .action(.closeWindow(needsConfirmation: true)))
    }

    @Test("send-prefix and switch-client key tables map to typed actions")
    func sendPrefixAndKeyTables() {
        #expect(map("send-prefix") == .action(.sendTmuxPrefix))
        #expect(map("switch-client -T copy-mode-vi") == .action(.activateTmuxKeyTable(.custom("copy-mode-vi"))))
        #expect(map("switch-client -n") == .action(.switchSession(.next)))
        #expect(map("switch-client -p") == .action(.switchSession(.previous)))
        #expect(map("switch-client -l") == .action(.switchSession(.last)))
        #expect(map("switch-client -t 3") == .action(.switchSession(.named("3"))))
    }

    @Test("copy-mode is unsupported with a copy-mode-specific reason")
    func copyModeIsUnsupportedWithSpecificReason() {
        guard case let .unsupported(reason) = map("copy-mode") else {
            Issue.record("Expected copy-mode to be unsupported")
            return
        }
        #expect(reason.contains("copy-mode"))
        #expect(reason.contains("native"))
        #expect(map("copy-mode -u").isUnsupported)
    }

    @Test("D-028 forbids raw command passthrough for shell and chooser commands")
    func passthroughCommandsAreForbidden(
    ) {
        for command in [
            "list-sessions",
            "choose-tree -Zw",
            ##"display-menu -T "#[align=centre]#{window_index}" -x W -y W Kill X { kill-window }"##,
            "run-shell /Users/adriangonzalez/.config/tmux/plugins/tmux-sessionx/scripts/sessionx.sh",
            "run-shell screenshot",
            // if-shell that is NOT the vim-navigator shape (false branch is a
            // chooser, not a directional select-pane) stays forbidden.
            #"if-shell "test -d /tmp" "display-menu Foo" "choose-tree""#
        ] {
            guard case let .unsupported(reason) = map(command) else {
                Issue.record("Expected unsupported mapping for: \(command)")
                continue
            }
            #expect(reason.contains("D-028"))
            #expect(reason.contains(String(command.prefix(12))))
        }
    }

    @Test("Unknown commands keep the generic unsupported reason with the raw string")
    func unknownCommandsAreUnsupported() {
        #expect(map("display-popup -E top")
            == .unsupported(reason: "Unsupported tmux command for native action routing: display-popup -E top"))
        #expect(map("next-layout").isUnsupported)
        #expect(map("detach-client").isUnsupported)
        #expect(map("send-keys C-l").isUnsupported)
    }

    @Test("Multi-command bindings are refused, never partially executed")
    func multiCommandBindingsAreRefused() {
        guard case let .unsupported(reason) = map(#"select-pane -t = \; send-keys -M"#) else {
            Issue.record("Expected multi-command binding to be unsupported")
            return
        }
        #expect(reason.contains("Multi-command"))
    }

    @Test("Tokenizer handles quotes, braces, and escapes from list-keys output")
    func tokenizerHandlesQuotesBracesEscapes() {
        #expect(Keybinding.TmuxCommandMapper.tokenize(##"split-window -h -c "#{pane_current_path}""##)
            == ["split-window", "-h", "-c", "#{pane_current_path}"])
        #expect(Keybinding.TmuxCommandMapper.tokenize(#"confirm-before -p "kill-window #W? (y/n)" kill-window"#)
            == ["confirm-before", "-p", "kill-window #W? (y/n)", "kill-window"])
        #expect(Keybinding.TmuxCommandMapper.tokenize("confirm-before { kill-window }")
            == ["confirm-before", "{ kill-window }"])
        #expect(Keybinding.TmuxCommandMapper.tokenize(#"select-pane -t = \; send-keys -M"#)
            == ["select-pane", "-t", "=", ";", "send-keys", "-M"])
        #expect(Keybinding.TmuxCommandMapper.tokenize(##"command-prompt -I "#W" { rename-window "%%" }"##)
            == ["command-prompt", "-I", "#W", #"{ rename-window "%%" }"#])
    }
}

private extension Keybinding.TmuxCommandMapping {
    var isUnsupported: Bool {
        if case .unsupported = self {
            return true
        }
        return false
    }
}
