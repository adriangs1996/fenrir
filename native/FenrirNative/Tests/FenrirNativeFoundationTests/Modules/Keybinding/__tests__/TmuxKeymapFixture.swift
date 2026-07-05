import Foundation
import FenrirNativeShared
import Keybinding

/// Ground-truth fixture: verbatim output captured from the user's live tmux
/// server (`tmux -S /private/tmp/tmux-501/default`) on 2026-07-04:
/// `list-keys -T prefix`, `list-keys -T root`, `show-options -g prefix`,
/// `show-options -g repeat-time`, `show-options -g base-index`.
///
/// `wirePayload()` mirrors the Task A server translation: each `bind-key`
/// line becomes one wire binding record; it never parses `.tmux.conf`.
enum TmuxKeymapFixture {
    static let prefixOption = "prefix C-s"
    static let repeatTimeOption = "repeat-time 500"
    static let baseIndexOption = "base-index 1"

    static let listKeysPrefix = ##"""
bind-key    -T prefix Space   next-layout
bind-key    -T prefix !       break-pane
bind-key    -T prefix \"      split-window -c "#{pane_current_path}"
bind-key    -T prefix \#      list-buffers
bind-key    -T prefix \$      command-prompt -I "#S" { rename-session "%%" }
bind-key    -T prefix \%      split-window -h -c "#{pane_current_path}"
bind-key    -T prefix &       confirm-before -p "kill-window #W? (y/n)" kill-window
bind-key    -T prefix \'      command-prompt -T window-target -p index { select-window -t ":%%" }
bind-key    -T prefix (       switch-client -p
bind-key    -T prefix )       switch-client -n
bind-key    -T prefix *       new-pane
bind-key    -T prefix ,       command-prompt -I "#W" { rename-window "%%" }
bind-key    -T prefix -       delete-buffer
bind-key    -T prefix .       command-prompt -T target { move-window -t "%%" }
bind-key    -T prefix /       command-prompt -k -p key { list-keys -1N "%%" }
bind-key    -T prefix 0       select-window -t :=0
bind-key    -T prefix 1       select-window -t :=1
bind-key    -T prefix 2       select-window -t :=2
bind-key    -T prefix 3       select-window -t :=3
bind-key    -T prefix 4       select-window -t :=4
bind-key    -T prefix 5       select-window -t :=5
bind-key    -T prefix 6       select-window -t :=6
bind-key    -T prefix 7       select-window -t :=7
bind-key    -T prefix 8       select-window -t :=8
bind-key    -T prefix 9       select-window -t :=9
bind-key    -T prefix :       command-prompt
bind-key    -T prefix \;      last-pane
bind-key    -T prefix <       display-menu -T "#[align=centre]#{window_index}:#{window_name}" -x W -y W "#{?#{>:#{session_windows},1},,-}Swap Left" l { swap-window -t :-1 } "#{?#{>:#{session_windows},1},,-}Swap Right" r { swap-window -t :+1 } "#{?pane_marked_set,,-}Swap Marked" s { swap-window } '' Kill X { kill-window } Respawn R { respawn-window -k } "#{?pane_marked,Unmark,Mark}" m { select-pane -m } Rename n { command-prompt -F -I "#W" { rename-window -t "#{window_id}" "%%" } } '' "New After" w { new-window -a } "New At End" W { new-window }
bind-key    -T prefix =       choose-buffer -Z
bind-key    -T prefix >       display-menu -T "#[align=centre]#{pane_index} (#{pane_id})" -x P -y P "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Top,}" < { send-keys -X history-top } "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Bottom,}" > { send-keys -X history-bottom } '' "#{?#{&&:#{buffer_size},#{!:#{pane_in_mode}}},Paste #[underscore]#{=/9/...:buffer_sample},}" p { paste-buffer } '' "#{?mouse_word,Search For #[underscore]#{=/9/...:mouse_word},}" C-r { if-shell -F "#{?#{m/r:(copy|view)-mode,#{pane_mode}},0,1}" "copy-mode -t=" ; send-keys -X -t = search-backward -- "#{q:mouse_word}" } "#{?mouse_word,Type #[underscore]#{=/9/...:mouse_word},}" C-y { copy-mode -q ; send-keys -l "#{q:mouse_word}" } "#{?mouse_word,Copy #[underscore]#{=/9/...:mouse_word},}" c { copy-mode -q ; set-buffer "#{q:mouse_word}" } "#{?mouse_line,Copy Line,}" l { copy-mode -q ; set-buffer "#{q:mouse_line}" } '' "#{?mouse_hyperlink,Type #[underscore]#{=/9/...:mouse_hyperlink},}" C-h { copy-mode -q ; send-keys -l "#{q:mouse_hyperlink}" } "#{?mouse_hyperlink,Copy #[underscore]#{=/9/...:mouse_hyperlink},}" h { copy-mode -q ; set-buffer "#{q:mouse_hyperlink}" } '' "#{?#{!:#{pane_floating_flag}},Horizontal Split,}" h { split-window -h } "#{?#{!:#{pane_floating_flag}},Vertical Split,}" v { split-window -v } '' "#{?#{&&:#{!:#{pane_floating_flag}},#{>:#{window_panes},1}},Swap Up,}" u { swap-pane -U } "#{?#{&&:#{!:#{pane_floating_flag}},#{>:#{window_panes},1}},Swap Down,}" d { swap-pane -D } "#{?pane_marked_set,,-}Swap Marked" s { swap-pane } '' Kill X { kill-pane } Respawn R { respawn-pane -k } "#{?pane_marked,Unmark,Mark}" m { select-pane -m } "#{?#{>:#{window_panes},1},,-}#{?window_zoomed_flag,Unzoom,Zoom}" z { resize-pane -Z }
bind-key    -T prefix ?       list-keys -N
bind-key    -T prefix C       customize-mode -Z
bind-key    -T prefix D       choose-client -Z
bind-key    -T prefix E       select-layout -E
bind-key    -T prefix I       run-shell /Users/adriangonzalez/.config/tmux/plugins/tpm/bindings/install_plugins
bind-key    -T prefix L       switch-client -l
bind-key    -T prefix M       select-pane -M
bind-key    -T prefix O       run-shell /Users/adriangonzalez/.config/tmux/plugins/tmux-sessionx/scripts/sessionx.sh
bind-key    -T prefix R       source-file /Users/adriangonzalez/.config/tmux/tmux.conf
bind-key    -T prefix U       run-shell /Users/adriangonzalez/.config/tmux/plugins/tpm/bindings/update_plugins
bind-key    -T prefix Y       run-shell -b /Users/adriangonzalez/.config/tmux/plugins/tmux-yank/scripts/copy_pane_pwd.sh
bind-key    -T prefix [       copy-mode
bind-key    -T prefix ]       paste-buffer -p
bind-key    -T prefix c       new-window -c "#{pane_current_path}"
bind-key    -T prefix d       detach-client
bind-key    -T prefix f       resize-pane -Z
bind-key    -T prefix h       select-pane -L
bind-key    -T prefix i       display-message
bind-key    -T prefix j       select-pane -D
bind-key    -T prefix k       select-pane -U
bind-key    -T prefix l       select-pane -R
bind-key    -T prefix m       select-pane -m
bind-key    -T prefix n       new-window -c "#{pane_current_path}"
bind-key    -T prefix o       select-pane -t :.+
bind-key    -T prefix p       run-shell /Users/adriangonzalez/.config/tmux/plugins/tmux-sessionx/scripts/sessionx.sh
bind-key    -T prefix q       display-panes
bind-key    -T prefix r       command-prompt "rename-window %%"
bind-key    -T prefix s       split-window -h -c "#{pane_current_path}"
bind-key    -T prefix t       split-window -v -c "#{pane_current_path}"
bind-key    -T prefix w       list-sessions
bind-key    -T prefix x       confirm-before -p "kill-pane #P? (y/n)" kill-pane
bind-key    -T prefix y       run-shell -b /Users/adriangonzalez/.config/tmux/plugins/tmux-yank/scripts/copy_line.sh
bind-key    -T prefix z       resize-pane -Z
bind-key    -T prefix \{      swap-pane -U
bind-key    -T prefix \}      swap-pane -D
bind-key    -T prefix \~      show-messages
bind-key -r -T prefix DC      refresh-client -c
bind-key    -T prefix PPage   copy-mode -u
bind-key -r -T prefix Up      select-pane -U
bind-key -r -T prefix Down    select-pane -D
bind-key -r -T prefix Left    select-pane -L
bind-key -r -T prefix Right   select-pane -R
bind-key    -T prefix M-1     select-layout even-horizontal
bind-key    -T prefix M-2     select-layout even-vertical
bind-key    -T prefix M-3     select-layout main-horizontal
bind-key    -T prefix M-4     select-layout main-vertical
bind-key    -T prefix M-5     select-layout tiled
bind-key    -T prefix M-6     select-layout main-horizontal-mirrored
bind-key    -T prefix M-7     select-layout main-vertical-mirrored
bind-key    -T prefix M-n     next-window -a
bind-key    -T prefix M-o     rotate-window -D
bind-key    -T prefix M-p     previous-window -a
bind-key    -T prefix M-u     run-shell /Users/adriangonzalez/.config/tmux/plugins/tpm/bindings/clean_plugins
bind-key -r -T prefix M-Up    resize-pane -U 5
bind-key -r -T prefix M-Down  resize-pane -D 5
bind-key -r -T prefix M-Left  resize-pane -L 5
bind-key -r -T prefix M-Right resize-pane -R 5
bind-key    -T prefix C-1     switch-client -t 1
bind-key    -T prefix C-2     switch-client -t 2
bind-key    -T prefix C-3     switch-client -t 3
bind-key    -T prefix C-4     switch-client -t 4
bind-key    -T prefix C-5     switch-client -t 5
bind-key    -T prefix C-6     switch-client -t 6
bind-key    -T prefix C-7     switch-client -t 7
bind-key    -T prefix C-8     switch-client -t 8
bind-key    -T prefix C-9     switch-client -t 9
bind-key -r -T prefix C-h     resize-pane -L 5
bind-key -r -T prefix C-j     resize-pane -D 5
bind-key -r -T prefix C-k     resize-pane -U 5
bind-key    -T prefix C-l     send-keys C-l
bind-key    -T prefix C-n     next-window
bind-key    -T prefix C-o     rotate-window
bind-key    -T prefix C-p     previous-window
bind-key -r -T prefix C-r     resize-pane -R 5
bind-key    -T prefix C-s     send-prefix
bind-key    -T prefix C-z     suspend-client
bind-key -r -T prefix C-Up    resize-pane -U
bind-key -r -T prefix C-Down  resize-pane -D
bind-key -r -T prefix C-Left  resize-pane -L
bind-key -r -T prefix C-Right resize-pane -R
bind-key -r -T prefix S-Up    refresh-client -U 10
bind-key -r -T prefix S-Down  refresh-client -D 10
bind-key -r -T prefix S-Left  refresh-client -L 10
bind-key -r -T prefix S-Right refresh-client -R 10
"""##

    static let listKeysRoot = ##"""
bind-key  -T root MouseDown1Pane            select-pane -t = \; send-keys -M
bind-key  -T root MouseDown1Status          switch-client -t =
bind-key  -T root MouseDown1Border          select-pane -M
bind-key  -T root MouseDown1ScrollbarUp     if-shell -F -t = "#{pane_in_mode}" { send-keys -X page-up } { copy-mode -u }
bind-key  -T root MouseDown1ScrollbarDown   if-shell -F -t = "#{pane_in_mode}" { send-keys -X page-down } { copy-mode -d }
bind-key  -T root MouseDown1Control8        resize-pane -Z
bind-key  -T root MouseDown1Control9        display-menu -O -T "Kill pane #{pane_index}?" -t = -x M -y M Yes y { kill-pane -t = } No n {  }
bind-key  -T root MouseDown2Pane            select-pane -t = \; if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { paste-buffer -p }
bind-key  -T root MouseDown3Pane            if-shell -F -t = "#{||:#{mouse_any_flag},#{&&:#{pane_in_mode},#{?#{m/r:(copy|view)-mode,#{pane_mode}},0,1}}}" { select-pane -t = ; send-keys -M } { display-menu -T "#[align=centre]#{pane_index} (#{pane_id})" -t = -x M -y M "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Top,}" < { send-keys -X history-top } "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Bottom,}" > { send-keys -X history-bottom } '' "#{?#{&&:#{buffer_size},#{!:#{pane_in_mode}}},Paste #[underscore]#{=/9/...:buffer_sample},}" p { paste-buffer } '' "#{?mouse_word,Search For #[underscore]#{=/9/...:mouse_word},}" C-r { if-shell -F "#{?#{m/r:(copy|view)-mode,#{pane_mode}},0,1}" "copy-mode -t=" ; send-keys -X -t = search-backward -- "#{q:mouse_word}" } "#{?mouse_word,Type #[underscore]#{=/9/...:mouse_word},}" C-y { copy-mode -q ; send-keys -l "#{q:mouse_word}" } "#{?mouse_word,Copy #[underscore]#{=/9/...:mouse_word},}" c { copy-mode -q ; set-buffer "#{q:mouse_word}" } "#{?mouse_line,Copy Line,}" l { copy-mode -q ; set-buffer "#{q:mouse_line}" } '' "#{?mouse_hyperlink,Type #[underscore]#{=/9/...:mouse_hyperlink},}" C-h { copy-mode -q ; send-keys -l "#{q:mouse_hyperlink}" } "#{?mouse_hyperlink,Copy #[underscore]#{=/9/...:mouse_hyperlink},}" h { copy-mode -q ; set-buffer "#{q:mouse_hyperlink}" } '' "#{?#{!:#{pane_floating_flag}},Horizontal Split,}" h { split-window -h } "#{?#{!:#{pane_floating_flag}},Vertical Split,}" v { split-window -v } '' "#{?#{&&:#{!:#{pane_floating_flag}},#{>:#{window_panes},1}},Swap Up,}" u { swap-pane -U } "#{?#{&&:#{!:#{pane_floating_flag}},#{>:#{window_panes},1}},Swap Down,}" d { swap-pane -D } "#{?pane_marked_set,,-}Swap Marked" s { swap-pane } '' Kill X { kill-pane } Respawn R { respawn-pane -k } "#{?pane_marked,Unmark,Mark}" m { select-pane -m } "#{?#{>:#{window_panes},1},,-}#{?window_zoomed_flag,Unzoom,Zoom}" z { resize-pane -Z } }
bind-key  -T root MouseDown3Status          display-menu -T "#[align=centre]#{window_index}:#{window_name}" -t = -x W -y W "#{?#{>:#{session_windows},1},,-}Swap Left" l { swap-window -t :-1 } "#{?#{>:#{session_windows},1},,-}Swap Right" r { swap-window -t :+1 } "#{?pane_marked_set,,-}Swap Marked" s { swap-window } '' Kill X { kill-window } Respawn R { respawn-window -k } "#{?pane_marked,Unmark,Mark}" m { select-pane -m } Rename n { command-prompt -F -I "#W" { rename-window -t "#{window_id}" "%%" } } '' "New After" w { new-window -a } "New At End" W { new-window }
bind-key  -T root MouseDown3StatusLeft      display-menu -T "#[align=centre]#{session_name}" -t = -x M -y W Next n { switch-client -n } Previous p { switch-client -p } '' Renumber N { move-window -r } Rename r { command-prompt -I "#S" { rename-session "%%" } } Detach d { detach-client } '' "New Session" s { new-session } "New Window" w { new-window }
bind-key  -T root MouseDrag1Pane            if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { copy-mode -M }
bind-key  -T root MouseDrag1Border          resize-pane -M
bind-key  -T root MouseDrag1ScrollbarSlider if-shell -F -t = "#{pane_in_mode}" { send-keys -X scroll-to-mouse } { copy-mode -S }
bind-key  -T root WheelDownStatus           next-window
bind-key  -T root WheelUpPane               if-shell -F "#{||:#{alternate_on},#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { copy-mode -e }
bind-key  -T root WheelUpStatus             previous-window
bind-key  -T root DoubleClick1Pane          select-pane -t = \; if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { copy-mode -H ; send-keys -X select-word ; run-shell -d 0.3 ; send-keys -X copy-pipe-and-cancel }
bind-key  -T root TripleClick1Pane          select-pane -t = \; if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" { send-keys -M } { copy-mode -H ; send-keys -X select-line ; run-shell -d 0.3 ; send-keys -X copy-pipe-and-cancel }
bind-key  -T root M-1                       select-window -t 1
bind-key  -T root M-2                       select-window -t 2
bind-key  -T root M-3                       select-window -t 3
bind-key  -T root M-4                       select-window -t 4
bind-key  -T root M-5                       select-window -t 5
bind-key  -T root M-6                       select-window -t 6
bind-key  -T root M-7                       select-window -t 7
bind-key  -T root M-8                       select-window -t 8
bind-key  -T root M-9                       select-window -t 9
bind-key  -T root M-MouseDown3Pane          display-menu -T "#[align=centre]#{pane_index} (#{pane_id})" -t = -x M -y M "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Top,}" < { send-keys -X history-top } "#{?#{m/r:(copy|view)-mode,#{pane_mode}},Go To Bottom,}" > { send-keys -X history-bottom } '' "#{?#{&&:#{buffer_size},#{!:#{pane_in_mode}}},Paste #[underscore]#{=/9/...:buffer_sample},}" p { paste-buffer } '' "#{?mouse_word,Search For #[underscore]#{=/9/...:mouse_word},}" C-r { if-shell -F "#{?#{m/r:(copy|view)-mode,#{pane_mode}},0,1}" "copy-mode -t=" ; send-keys -X -t = search-backward -- "#{q:mouse_word}" } "#{?mouse_word,Type #[underscore]#{=/9/...:mouse_word},}" C-y { copy-mode -q ; send-keys -l "#{q:mouse_word}" } "#{?mouse_word,Copy #[underscore]#{=/9/...:mouse_word},}" c { copy-mode -q ; set-buffer "#{q:mouse_word}" } "#{?mouse_line,Copy Line,}" l { copy-mode -q ; set-buffer "#{q:mouse_line}" } '' "#{?mouse_hyperlink,Type #[underscore]#{=/9/...:mouse_hyperlink},}" C-h { copy-mode -q ; send-keys -l "#{q:mouse_hyperlink}" } "#{?mouse_hyperlink,Copy #[underscore]#{=/9/...:mouse_hyperlink},}" h { copy-mode -q ; set-buffer "#{q:mouse_hyperlink}" } '' "#{?#{!:#{pane_floating_flag}},Horizontal Split,}" h { split-window -h } "#{?#{!:#{pane_floating_flag}},Vertical Split,}" v { split-window -v } '' "#{?#{&&:#{!:#{pane_floating_flag}},#{>:#{window_panes},1}},Swap Up,}" u { swap-pane -U } "#{?#{&&:#{!:#{pane_floating_flag}},#{>:#{window_panes},1}},Swap Down,}" d { swap-pane -D } "#{?pane_marked_set,,-}Swap Marked" s { swap-pane } '' Kill X { kill-pane } Respawn R { respawn-pane -k } "#{?pane_marked,Unmark,Mark}" m { select-pane -m } "#{?#{>:#{window_panes},1},,-}#{?window_zoomed_flag,Unzoom,Zoom}" z { resize-pane -Z }
bind-key  -T root M-MouseDown3Status        display-menu -T "#[align=centre]#{window_index}:#{window_name}" -t = -x W -y W "#{?#{>:#{session_windows},1},,-}Swap Left" l { swap-window -t :-1 } "#{?#{>:#{session_windows},1},,-}Swap Right" r { swap-window -t :+1 } "#{?pane_marked_set,,-}Swap Marked" s { swap-window } '' Kill X { kill-window } Respawn R { respawn-window -k } "#{?pane_marked,Unmark,Mark}" m { select-pane -m } Rename n { command-prompt -F -I "#W" { rename-window -t "#{window_id}" "%%" } } '' "New After" w { new-window -a } "New At End" W { new-window }
bind-key  -T root M-MouseDown3StatusLeft    display-menu -T "#[align=centre]#{session_name}" -t = -x M -y W Next n { switch-client -n } Previous p { switch-client -p } '' Renumber N { move-window -r } Rename r { command-prompt -I "#S" { rename-session "%%" } } Detach d { detach-client } '' "New Session" s { new-session } "New Window" w { new-window }
bind-key  -T root C-\\                      if-shell "ps -o state= -o comm= -t '#{pane_tty}'       | grep -iqE '^[^TXZ ]+ +(\\S+/)?g?\\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'" "send-keys 'C-\\'" "select-pane -l"
bind-key  -T root C-h                       if-shell "ps -o state= -o comm= -t '#{pane_tty}'       | grep -iqE '^[^TXZ ]+ +(\\S+/)?g?\\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'" "send-keys 'C-h'" "select-pane -L"
bind-key  -T root C-i                       run-shell screenshot
bind-key  -T root C-j                       if-shell "ps -o state= -o comm= -t '#{pane_tty}'       | grep -iqE '^[^TXZ ]+ +(\\S+/)?g?\\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'" "send-keys 'C-j'" "select-pane -D"
bind-key  -T root C-k                       if-shell "ps -o state= -o comm= -t '#{pane_tty}'       | grep -iqE '^[^TXZ ]+ +(\\S+/)?g?\\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'" "send-keys 'C-k'" "select-pane -U"
bind-key  -T root C-l                       if-shell "ps -o state= -o comm= -t '#{pane_tty}'       | grep -iqE '^[^TXZ ]+ +(\\S+/)?g?\\.?(view|l?n?vim?x?|fzf)(diff)?(-wrapped)?$'" "send-keys 'C-l'" "select-pane -R"
bind-key  -T root C-MouseDown1Pane          swap-pane -s @
bind-key  -T root C-MouseDown1Status        swap-window -t @
"""##

    /// Wire payload in the Task A contract shape, derived from the raw
    /// captures above.
    static func wirePayload() -> Keybinding.TmuxKeymapWirePayload {
        let lines = (listKeysPrefix + "\n" + listKeysRoot)
            .split(separator: "\n", omittingEmptySubsequences: true)
        return Keybinding.TmuxKeymapWirePayload(
            prefix: optionValue(from: prefixOption),
            prefix2: nil,
            repeatTimeMs: Int(optionValue(from: repeatTimeOption)),
            bindings: lines.compactMap { wireBinding(from: String($0)) }
        )
    }

    /// Effective keymap with every parseable key spec resolved, mirroring
    /// what `ImportServerTmuxKeymap` produces for the fixture payload.
    static func effectiveKeymap() -> Keybinding.EffectiveTmuxKeymap {
        let payload = wirePayload()
        let bindings: [Keybinding.TmuxKeyBinding] = payload.bindings.compactMap { wire in
            guard case let .success(key) = Keybinding.TmuxKeySpecParser.parse(wire.key) else {
                return nil
            }
            return Keybinding.TmuxKeyBinding(
                table: wire.table,
                key: key,
                command: wire.command,
                repeats: wire.repeats
            )
        }
        return Keybinding.EffectiveTmuxKeymap(
            prefix: .control("s"),
            prefix2: nil,
            repeatTimeMs: payload.repeatTimeMs ?? Keybinding.EffectiveTmuxKeymap.defaultRepeatTimeMs,
            bindings: bindings
        )
    }

    static func compiledKeymap() -> Keybinding.CompiledTmuxKeymap {
        Keybinding.TmuxCommandMapper.compile(effectiveKeymap())
    }

    // MARK: Task A translation mirror

    private static func optionValue(from optionLine: String) -> String {
        optionLine.split(separator: " ", maxSplits: 1).last.map(String.init) ?? ""
    }

    /// Parses one `bind-key [-r] -T <table> <key> <command…>` line into a
    /// wire binding, preserving the raw command spacing.
    private static func wireBinding(from line: String) -> Keybinding.TmuxKeymapWireBinding? {
        var rest = Substring(line)

        func nextToken() -> Substring? {
            while let first = rest.first, first == " " || first == "\t" {
                rest.removeFirst()
            }
            guard !rest.isEmpty else {
                return nil
            }
            let end = rest.firstIndex { $0 == " " || $0 == "\t" } ?? rest.endIndex
            let token = rest[rest.startIndex..<end]
            rest = rest[end...]
            return token
        }

        guard nextToken() == "bind-key" else {
            return nil
        }

        var repeats = false
        var table: String?
        var key: String?
        while let token = nextToken() {
            if token == "-r" {
                repeats = true
                continue
            }
            if token == "-T" {
                table = nextToken().map(String.init)
                continue
            }
            key = String(token)
            break
        }

        guard let table, let key else {
            return nil
        }
        let command = rest.trimmingCharacters(in: .whitespaces)
        guard !command.isEmpty else {
            return nil
        }
        return Keybinding.TmuxKeymapWireBinding(table: table, key: key, command: command, repeats: repeats)
    }
}
