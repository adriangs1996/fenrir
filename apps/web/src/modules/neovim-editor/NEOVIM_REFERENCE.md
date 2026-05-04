_api-ui-events.txt_ Nvim

          NVIM REFERENCE MANUAL

Nvim UI protocol _UI_ _ui_ _api-ui-events_

This document describes the UI protocol. See |gui| and |tui| for user-facing
UI components and features.

                                      Type |gO| to see the table of contents.

==============================================================================
UI Events _ui-protocol_ _ui-events_

UIs can be implemented as external client processes communicating with Nvim
over the RPC API. The default UI model is a terminal-like grid with a single,
monospace font. The UI can opt-in to have windows drawn on separate grids, and
have some elements ("widgets") presented by the UI itself rather than by Nvim
("externalized").

          *ui-option*

Call |nvim_ui_attach()| to tell Nvim that your program wants to draw the Nvim
screen grid with a size of width × height cells. This is typically done by an
embedder at startup (see |ui-startup|), but UIs can also connect to a running
Nvim instance and invoke nvim_ui_attach(). The `options` parameter is a map
with these (optional) keys:

          *ui-rgb*

- `rgb` Decides the color format. - true: (default) 24-bit RGB colors - false: Terminal colors (8-bit, max 256)

           *ui-override*

- `override` Decides how UI capabilities are resolved. - true: Enable requested UI capabilities, even if not
  supported by all connected UIs (including |TUI|). - false: (default) Disable UI capabilities not
  supported by all connected UIs (including TUI).

           *ui-ext-options*

- `ext_cmdline` Externalize the cmdline. |ui-cmdline|
- `ext_hlstate` Detailed highlight state. |ui-hlstate|
  Sets `ext_linegrid` implicitly.
- `ext_linegrid` Line-based grid events. |ui-linegrid|
  Deactivates |ui-grid-old| implicitly.
- `ext_messages` Externalize messages. |ui-messages|
  Sets `ext_linegrid` and `ext_cmdline` implicitly.
- `ext_multigrid` Per-window grid events. |ui-multigrid|
  Sets `ext_linegrid` implicitly.
- `ext_popupmenu` Externalize |popupmenu-completion| and
  'wildmenu'. |ui-popupmenu|
- `ext_tabline` Externalize the tabline. |ui-tabline|
- `ext_termcolors` Use external default colors.
- `term_name` Sets the name of the terminal 'term'.
- `term_colors` Sets the number of supported colors 't_Co'.
- `stdin_fd` Treat this fd as if it were stdin when using |--|.
  Only from |--embed| UI on startup. |ui-startup-stdin|
- `stdin_tty` Tells if `stdin` is a `tty` or not.
- `stdout_tty` Tells if `stdout` is a `tty` or not.

Specifying an unknown option is an error; UIs can check the |api-metadata|
`ui_options` key for supported options.

By default Nvim requires all connected UIs to support the same capabilities,
thus the active capabilities are the intersection of those requested. UIs may
specify |ui-override| to invert this behavior (useful for debugging). The
"option_set" event announces which capabilities are active.

Nvim sends RPC notifications to all attached UIs, with method name "redraw"
and a single argument: an array (batch) of screen "update events". Each update
event is itself an array whose first element is the event name and remaining
elements are event-parameter tuples. Thus multiple events of the same kind can
be sent contiguously without repeating the event name.

Example of a typical "redraw" batch in a single RPC notification: >

    ['notification', 'redraw',
      [
    ['grid_resize', [2, 77, 36]],
    ['grid_line',
      [2, 0, 0, [[' ' , 0, 77]], false],
      [2, 1, 0, [['~', 7], [' ', 7, 76]], false],
      [2, 9, 0, [['~', 7], [' ', 7, 76]], false],
      ...
      [2, 35, 0, [['~', 7], [' ', 7, 76]], false],
      [1, 36, 0, [['[', 9], ['N'], ['o'], [' '], ['N'], ['a'], ['m'], ['e'], [']']], false],
      [1, 36, 9, [[' ', 9, 50]], false],
      [1, 36, 59, [['0', 9], [','], ['0'], ['-' ], ['1'], [' ', 9, 10], ['A'], ['l', 9, 2]], false]
    ],
    ['msg_showmode', [[]]],
    ['win_pos', [2, 1000, 0, 0, 77, 36]],
    ['grid_cursor_goto', [2, 0, 0]],
    ['flush', []]
      ]
    ]

Events must be handled in-order. Nvim sends a "flush" event when it has
completed a redraw of the entire screen (so all windows have a consistent view
of buffer state, options, etc.). Multiple "redraw" batches may be sent before
the entire screen has been redrawn, with "flush" following only the last
batch. The user should only see the final state (when "flush" is sent), not
any intermediate state while processing part of the batch array, nor after
a batch not ending with "flush".

By default, Nvim sends |ui-global| and |ui-grid-old| events (for backwards
compatibility); these suffice to implement a terminal-like interface. However
the new |ui-linegrid| represents text more efficiently (especially highlighted
text), and allows UI capabilities requiring multiple grids. New UIs should
implement |ui-linegrid| instead of |ui-grid-old|.

Nvim optionally sends various screen elements "semantically" as structured
events instead of raw grid-lines, as specified by |ui-ext-options|. The UI
must present such elements itself, Nvim will not draw them on the grid.

Future versions of Nvim may add new update kinds and may append new parameters
to existing update kinds. Clients must be prepared to ignore such extensions,
for forward-compatibility. |api-contract|

==============================================================================
UI startup _ui-startup_

UI embedders (clients that start Nvim with |--embed| and later call
|nvim_ui_attach()|) must start Nvim without |--headless|: >bash
nvim --embed
Nvim will pause before loading startup files and reading buffers, so the UI
has a chance to invoke requests and do early initialization. Startup will
continue when the UI invokes |nvim_ui_attach()|.

A simple UI only needs to do a single |nvim_ui_attach()| request and then
prepare to handle any UI event. A more featureful UI, which might need
additional configuration of the Nvim process, should use the following startup
procedure:

1. Invoke |nvim_get_api_info()|, if needed to setup the client library and/or
    to get the list of supported UI extensions.
2. Do any configuration that should be happen before user config is loaded.
    Buffers and windows are not available at this point, but this could be used
    to set |g:| variables visible to init.vim
3. If the UI wants to do additional setup after user config is loaded,
    register a VimEnter autocmd: >lua
    nvim_command("autocmd VimEnter \* call rpcrequest(1, 'vimenter')")
4. Now invoke |nvim_ui_attach()|. The UI must handle user input by now:
    sourcing init.vim and loading buffers might lead to blocking prompts.
5. If step 3 was used, Nvim will send a blocking "vimenter" request to the UI.
    Inside this request handler, the UI can safely do any initialization before
    entering normal mode, for example reading variables set by init.vim.

                 *ui-startup-stdin*

    UIs can support reading from stdin (like `command | nvim -`, see |--|) as follows:

6. The embedding process detects that the stdin fd is not a terminal.
7. It then needs to forward this fd to Nvim. Because fd=0 is already is used
    to send RPC data from embedder to Nvim, it must use some other file
    descriptor, like fd=3 or higher.
8. Then pass the fd as the `stdin_fd` parameter of `nvim_ui_attach`. Nvim will
    read it as text into buffer 1.

==============================================================================
Global Events _ui-global_

The following UI events are always emitted, and describe global state of
the editor.

["set_title", title] ~
["set_icon", icon] ~
Set the window title, and icon (minimized) window title, respectively.
In windowing systems not distinguishing between the two, "set_icon"
can be ignored.

["mode_info_set", cursor_style_enabled, mode_info] ~
`cursor_style_enabled` is a boolean indicating if the UI should set
the cursor style. `mode_info` is a list of mode property maps. The
current mode is given by the `mode_idx` field of the `mode_change`
event.

    Each mode property map may contain these keys:

    KEY  DESCRIPTION ~
    `cursor_shape`: "block", "horizontal", "vertical"
    `cell_percentage`: Cell % occupied by the cursor.
    `blinkwait`, `blinkon`, `blinkoff`: See |cursor-blinking|.
    `attr_id`: Cursor attribute id (defined by `hl_attr_define`).
      When attr_id is 0, the background and foreground
      colors should be swapped.
    `attr_id_lm`: Cursor attribute id for when |:lmap| is on.
    `short_name`: Mode code name, see 'guicursor'.
    `name`:  Mode descriptive name.
    `mouse_shape`: (To be implemented.)

    Some keys are missing in some modes.

    The following keys are deprecated:

    `hl_id`: Use `attr_id` instead.
    `id_lm`: Use `attr_id_lm` instead.

["option_set", name, value] ~
UI-related option changed, where `name` is one of:

    - 'arabicshape'
    - 'ambiwidth'
    - 'emoji'
    - 'guifont'
    - 'guifontwide'
    - 'linespace'
    - 'mousefocus'
    - 'mousehide'
    - 'mousemoveevent'
    - 'pumblend'
    - 'showtabline'
    - 'termguicolors'
    - "ext_*" (all |ui-ext-options|)

    Triggered when the UI first connects to Nvim, and whenever an option
    is changed by the user or a plugin.

    Options are not represented here if their effects are communicated in
    other UI events. For example, instead of forwarding the 'mouse' option
    value, the "mouse_on" and "mouse_off" UI events directly indicate if
    mouse support is active. Some options like 'ambiwidth' have already
    taken effect on the grid, where appropriate empty cells are added,
    however a UI might still use such options when rendering raw text
    sent from Nvim, like for |ui-cmdline|.

["chdir", path] ~
The |current-directory| changed to `path`.

["mode_change", mode, mode_idx] ~
Editor mode changed. The `mode` parameter is a string representing
the current mode. `mode_idx` is an index into the array emitted in
the `mode_info_set` event. UIs should change the cursor style
according to the properties specified in the corresponding item. The
set of modes reported will change in new versions of Nvim, for
instance more submodes and temporary states might be represented as
separate modes.

["mouse_on"] ~
["mouse_off"] ~
'mouse' was enabled/disabled in the current editor mode. Useful for
a terminal UI, or embedding into an application where Nvim mouse would
conflict with other usages of the mouse. Other UI:s may ignore this event.

["busy_start"] ~
["busy_stop"] ~
Indicates to the UI that it must stop rendering the cursor. This event
is misnamed and does not actually have anything to do with busyness.

["connect", server_addr] ~
User invoked the |:connect| command. Nvim detached the current UI.

    UI is expected to:
    1. Attach to the server at `server_addr`.

["restart", listen_addr] ~
User invoked the |:restart| command. Nvim started a new server. The
old server is about to exit and close its channel.

    UI is expected to:
    1. Wait for the channel to be closed, to confirm that the old server
       actually exited.
    2. Attach to the new server at `listen_addr`.

["suspend"] ~
|:suspend| command or |CTRL-Z| mapping is used. A terminal client (or
another client where it makes sense) could suspend itself. Other
clients can safely ignore it.

["update_menu"] ~
The menu mappings changed.

["bell"] ~
["visual_bell"] ~
Notify the user with an audible or visual bell, respectively.

["flush"] ~
Nvim is done redrawing the screen. For an implementation that renders
to an internal buffer, this is the time to display the redrawn parts
to the user.

["ui_send", content] ~
Write {content} to the connected TTY. Only UIs that have the
"stdout_tty" |ui-option| set will receive this event.

==============================================================================
Grid Events (line-based) _ui-linegrid_

Activated by the `ext_linegrid` |ui-option|. Recommended for all new UIs.
Deactivates |ui-grid-old| implicitly.

Unlike |ui-grid-old|, this UI extension emits a single `grid_line` event to
update a screen-line (whereas the old protocol emitted separate cursor,
highlight and text events per screen-line).

Most of these events take a `grid` index as first parameter. Grid 1 is the
global grid used by default for the entire editor screen state. The
`ext_linegrid` capability by itself will never cause any additional grids to
be created; to enable per-window grids, activate |ui-multigrid|.

Highlight attribute groups are predefined. UIs should maintain a table to map
numerical highlight ids to the actual attributes.

["grid_resize", grid, width, height] ~
Resize a `grid`. If `grid` wasn't seen by the client before, a new grid is
being created with this size.

["default_colors_set", rgb_fg, rgb_bg, rgb_sp, cterm_fg, cterm_bg] ~
The first three arguments set the default foreground, background and
special colors respectively. `cterm_fg` and `cterm_bg` specifies the
default color codes to use in a 256-color terminal.

    The RGB values will always be valid colors, by default. If no
    colors have been set, they will default to black and white, depending
    on 'background'. By setting the `ext_termcolors` option, instead
    -1 will be used for unset colors. This is mostly useful for a TUI
    implementation, where using the terminal builtin ("ANSI") defaults
    are expected.

    Note: Unlike the corresponding |ui-grid-old| events, the screen is not
    always cleared after sending this event. The UI must repaint the
    screen with changed background color itself.

          *ui-event-hl_attr_define*

["hl_attr_define", id, rgb_attr, cterm_attr, info] ~
Add a highlight with `id` to the highlight table, with the
attributes specified by the `rgb_attr` and `cterm_attr` dicts, with the
following (all optional) keys.

    `foreground`:  foreground color.
    `background`:  background color.
    `special`:  color to use for various underlines, when
       present.
    `reverse`:  reverse video. Foreground and background colors
       are switched.
    `italic`:  italic text.
    `bold`:   bold text.
    `strikethrough`: struckthrough text.
    `underline`:  underlined text. The line has `special` color.
    `undercurl`:  undercurled text. The curl has `special` color.
    `underdouble`:  double underlined text. The lines have `special` color.
    `underdotted`:  underdotted text. The dots have `special` color.
    `underdashed`:  underdashed text. The dashes have `special` color.
    `altfont`:  alternative font.
    `dim`:   half-bright/faint text.
    `blink`:  blinking text.
    `conceal`:  concealed/hidden text.
    `overline`:  overlined text.
    `blend`:  blend level (0-100). Could be used by UIs to
       support blending floating windows to the
       background or to signal a transparent cursor.
    `url`:   URL associated with this highlight. UIs should
       present the region as a clickable hyperlink.

    For absent color keys the default color should be used. Don't store
    the default value in the table, rather a sentinel value, so that
    a changed default color will take effect.
    All boolean keys default to false, and will only be sent when they
    are true.

    Highlights are always transmitted both for both the RGB format and as
    terminal 256-color codes, as the `rgb_attr` and `cterm_attr` parameters
    respectively. The |ui-rgb| option has no effect anymore.
    Most external UIs will only need to store and use the `rgb_attr`
    attributes.

    `id` 0 will always be used for the default highlight with colors defined
    by `default_colors_set` and no styles applied.

    Note: Nvim may reuse `id` values if its internal highlight table is full.
    In that case Nvim will always issue redraws of screen cells that are
    affected by redefined ids, so UIs do not need to keep track of this
    themselves.

    `info` is an empty array unless |ui-hlstate| is enabled.

["hl_group_set", name, hl_id] ~
The built-in highlight group `name` was set to use the attributes `hl_id`
defined by a previous `hl_attr_define` call. This event is not needed
to render the grids which use attribute ids directly, but is useful
for a UI who want to render its own elements with consistent
highlighting. For instance a UI using |ui-popupmenu| events, might
use the |hl-Pmenu| family of builtin highlights.

              *ui-event-grid_line*

["grid_line", grid, row, col_start, cells, wrap] ~
Redraw a continuous part of a `row` on a `grid`, starting at the column
`col_start`. `cells` is an array of arrays each with 1 to 3 items:
`[text(, hl_id, repeat)]` . `text` is the UTF-8 text that should be put in
a cell, with the highlight `hl_id` defined by a previous `hl_attr_define`
call. If `hl_id` is not present the most recently seen `hl_id` in
the same call should be used (it is always sent for the first
cell in the event). If `repeat` is present, the cell should be
repeated `repeat` times (including the first time), otherwise just
once.

    The right cell of a double-width char will be represented as the empty
    string. Double-width chars never use `repeat`.

    If the array of cell changes doesn't reach to the end of the line, the
    rest should remain unchanged. A whitespace char, repeated
    enough to cover the remaining line, will be sent when the rest of the
    line should be cleared.

    `wrap` is a boolean indicating that this line wraps to the next row.
    When redrawing a line which wraps to the next row, Nvim will emit a
    `grid_line` event covering the last column of the line with `wrap` set
    to true, followed immediately by a `grid_line` event starting at the
    first column of the next row.

["grid_clear", grid] ~
Clear a `grid`.

["grid_destroy", grid] ~
`grid` will not be used anymore and the UI can free any data associated
with it.

["grid_cursor_goto", grid, row, col] ~
Makes `grid` the current grid and `row, col` the cursor position on this
grid. This event will be sent at most once in a `redraw` batch and
indicates the visible cursor position.

["grid_scroll", grid, top, bot, left, right, rows, cols] ~
Scroll a region of `grid`. This is semantically unrelated to editor
|scrolling|, rather this is an optimized way to say "copy these screen
cells".

    The following diagrams show what happens per scroll direction.
    "===" represents the SR (scroll region) boundaries.
    "---" represents the moved rectangles.
    Note that dst and src share a common region.

    If `rows` is bigger than 0, move a rectangle in the SR up, this can
    happen while scrolling down.

>

     +-------------------------+
     | (clipped above SR)      |            ^
     |=========================| dst_top    |
     | dst (still in SR)       |            |
     +-------------------------+ src_top    |
     | src (moved up) and dst  |            |
     |-------------------------| dst_bot    |
     | src (invalid)           |            |
     +=========================+ src_bot

<
If `rows` is less than zero, move a rectangle in the SR down, this can
happen while scrolling up.

>

     +=========================+ src_top
     | src (invalid)           |            |
     |------------------------ | dst_top    |
     | src (moved down) and dst|            |
     +-------------------------+ src_bot    |
     | dst (still in SR)       |            |
     |=========================| dst_bot    |
     | (clipped below SR)      |            v
     +-------------------------+

<
`cols` is always zero in this version of Nvim, and reserved for future
use.

    Note when updating code from |ui-grid-old| events: ranges are
    end-exclusive, which is consistent with API conventions, but different
    from `set_scroll_region` which was end-inclusive.

    The scrolled-in area will be filled using |ui-event-grid_line| directly
    after the scroll event. The UI thus doesn't need to clear this area as
    part of handling the scroll event.

==============================================================================
Grid Events (cell-based) _ui-grid-old_

This is the legacy representation of the screen grid, emitted if |ui-linegrid|
is not active. New UIs should implement |ui-linegrid| instead.

["resize", width, height] ~
The grid is resized to `width` and `height` cells.

["clear"] ~
Clear the grid.

["eol_clear"] ~
Clear from the cursor position to the end of the current line.

["cursor_goto", row, col] ~
Move the cursor to position (row, col). Currently, the same cursor is
used to define the position for text insertion and the visible cursor.
However, only the last cursor position, after processing the entire
array in the "redraw" event, is intended to be a visible cursor
position.

["update_fg", color] ~
["update_bg", color] ~
["update_sp", color] ~
Set the default foreground, background and special colors
respectively.

          *ui-event-highlight_set*

["highlight_set", attrs] ~
Set the attributes that the next text put on the grid will have.
`attrs` is a dict with the keys below. Any absent key is reset
to its default value. Color defaults are set by the `update_fg` etc
updates. All boolean keys default to false.

    `foreground`: foreground color.
    `background`: background color.
    `special`: color to use for various underlines, when present.
    `reverse`: reverse video. Foreground and background colors are
      switched.
    `italic`: italic text.
    `bold`:  bold text.
    `strikethrough`:  struckthrough text.
    `underline`: underlined text. The line has `special` color.
    `undercurl`: undercurled text. The curl has `special` color.
    `underdouble`: double underlined text. The lines have `special` color.
    `underdotted`: underdotted text. The dots have `special` color.
    `underdashed`: underdashed text. The dashes have `special` color.
    `dim`:  half-bright/faint text.
    `blink`: blinking text.
    `conceal`: concealed/hidden text.
    `overline`: overlined text.

["put", text] ~
The (utf-8 encoded) string `text` is put at the cursor position
(and the cursor is advanced), with the highlights as set by the
last `highlight_set` update.

["set_scroll_region", top, bot, left, right] ~
Define the scroll region used by `scroll` below.

    Note: ranges are end-inclusive, which is inconsistent with API
    conventions.

["scroll", count] ~
Scroll the text in the scroll region. The diagrams below illustrate
what will happen, depending on the scroll direction. "=" is used to
represent the SR(scroll region) boundaries and "-" the moved rectangles.
Note that dst and src share a common region.

    If count is bigger than 0, move a rectangle in the SR up, this can
    happen while scrolling down.

>

     +-------------------------+
     | (clipped above SR)      |            ^
     |=========================| dst_top    |
     | dst (still in SR)       |            |
     +-------------------------+ src_top    |
     | src (moved up) and dst  |            |
     |-------------------------| dst_bot    |
     | src (cleared)           |            |
     +=========================+ src_bot

<
If count is less than zero, move a rectangle in the SR down, this can
happen while scrolling up.

>

     +=========================+ src_top
     | src (cleared)           |            |
     |------------------------ | dst_top    |
     | src (moved down) and dst|            |
     +-------------------------+ src_bot    |
     | dst (still in SR)       |            |
     |=========================| dst_bot    |
     | (clipped below SR)      |            v
     +-------------------------+

# <

Highlight Events _ui-hlstate_

Activated by the `ext_hlstate` |ui-option|.
Activates |ui-linegrid| implicitly.

If `ext_hlstate` is enabled, Nvim will emit detailed highlight state in
|ui-linegrid| events. Otherwise (by default) Nvim only describes grid cells
using the final calculated highlight attributes described at
|ui-event-highlight_set|.

`ext_hlstate` provides a semantic description of active highlights for each
grid cell. Highlights are predefined in a table, see |ui-event-hl_attr_define|
and |ui-event-grid_line|.

The `info` parameter in `hl_attr_define` contains a semantic description of
the highlights. Because highlight groups can be combined, this is an array
where the highest-priority item is last. Each item is a dict with these keys:

    `kind`: always present. One of the following values:
    "ui":       Builtin UI highlight. |highlight-groups|
    "syntax":   Highlight applied to a buffer by a syntax declaration or
         other runtime/plugin functionality such as
         |nvim_buf_set_extmark()|
    "terminal": highlight from a process running in a |terminal-emulator|.
         Contains no further semantic information.
    `ui_name`: Highlight name from |highlight-groups|. Only for "ui" kind.
    `hi_name`: Name of the final |:highlight| group where the used
     attributes are defined.
    `id`: Unique numeric id representing this item.

Note: "ui" items will have both `ui_name` and `hi_name` present. These can
differ, because the builtin group was linked to another group |:hi-link| , or
because 'winhighlight' was used. UI items will be transmitted, even if the
highlight group is cleared, so `ui_name` can always be used to reliably identify
screen elements, even if no attributes have been applied.

==============================================================================
Multigrid Events _ui-multigrid_

Activated by the `ext_multigrid` |ui-option|.
Activates |ui-linegrid| implicitly.

See |ui-linegrid| for grid events.
See |nvim_ui_try_resize_grid()| to request changing the grid size.
See |nvim_input_mouse()| for sending mouse events to Nvim.

The multigrid extension gives UIs more control over how windows are displayed:

- UIs receive updates on a separate grid for each window.
- UIs can set the grid size independently of how much space the window
  occupies on the global layout. So the UI could use a different font size
  per-window. Or reserve space around the border of the window for its own
  elements, such as scrollbars from the UI toolkit.
- A dedicated grid is used for messages, which may scroll over the window
  area. (Alternatively |ui-messages| can be used).

By default, the grid size is handled by Nvim and set to the outer grid size
(i.e. the size of the window frame in Nvim) whenever the split is created.
Once a UI sets a grid size, Nvim does not handle the size for that grid and
the UI must change the grid size whenever the outer size is changed. To
delegate grid-size handling back to Nvim, request the size (0, 0).

A window can be hidden and redisplayed without its grid being deallocated.
This can happen multiple times for the same window, for instance when switching
tabs.

["win_pos", grid, win, start_row, start_col, width, height] ~
Set the position and size of the grid in Nvim (i.e. the outer grid
size). If the window was previously hidden, it should now be shown
again.

["win_float_pos", grid, win, anchor, anchor_grid, anchor_row, anchor_col, mouse_enabled, zindex, compindex, screen_row, screen_col] ~
Display or reconfigure floating window `win`.

    There are two alternative ways of positioning the window
      -  Manually - The window should be displayed above another grid
         `anchor_grid` at the specified position `anchor_row` and
         `anchor_col`. For the meaning of `anchor` and more details of
         positioning, see |nvim_open_win()|. NOTE: you have to manually
         ensure that the window fits the screen, possibly by further
         reposition it. Ignore `screen_row` and `screen_col` in this case.
      - Let nvim take care of the positioning - You can ignore `anchor`
        and display the window at `screen_row` and `screen_col`.

    `mouse_enabled` is true if the window can receive mouse events.

    `zindex` is the configured zindex, while `compindex` is the exact
    rendering order of the windows determined by nvim. To render exactly
    like the TUI, first render all the non-floating windows, then render
    in the `compindex` order, overwriting any floating window cells.
    Finally, blend the floating window cells against the non-floating
    background. To add more blending, you can group the windows by zindex,
    and blend between the layers. But note that windows inside the same
    zindex should still overwrite previous cells inside the same layer
    without blending. This ensures that plugins that render multiple
    windows, to add borders for example, work as expected.

["win_external_pos", grid, win] ~
Display or reconfigure external window `win`. The window should be
displayed as a separate top-level window in the desktop environment,
or something similar.

["win_hide", grid] ~
Stop displaying the window. The window can be shown again later.

["win_close", grid] ~
Close the window.

["msg_set_pos", grid, row, scrolled, sep_char, zindex, compindex] ~
Display messages on `grid`. The grid will be displayed at `row` on
the default grid (grid=1), covering the full column width. `scrolled`
indicates whether the message area has been scrolled to cover other
grids. It can be useful to draw a separator then |msgsep|. The Builtin
TUI draws a full line filled with `sep_char` ('fillchars' msgsep
field) and |hl-MsgSeparator| highlight.

    When |ui-messages| is active, no message grid is used, and this event
    will not be sent.

    `zindex` and `compindex` have the same meaning as for `win_float_pos`.
    The `zindex` always has a fixed value of 200 and included for
    completeness.

["win_viewport", grid, win, topline, botline, curline, curcol, line_count, scroll_delta] ~
Indicates the range of buffer text displayed in the window, as well
as the cursor position in the buffer. All positions are zero-based.
`botline` is set to one more than the line count of the buffer, if
there are filler lines past the end. `scroll_delta` contains how much
the top line of a window moved since `win_viewport` was last emitted.
It is intended to be used to implement smooth scrolling. For this
purpose it only counts "virtual" or "displayed" lines, so folds
only count as one line. When scrolling more than a full screen it is
an approximate value.

    All updates, such as `grid_line`, in a batch affects the new viewport,
    despite the fact that `win_viewport` is received after the updates.
    Applications implementing, for example, smooth scrolling should take
    this into account and keep the grid separated from what's displayed on
    the screen and copy it to the viewport destination once `win_viewport`
    is received.

["win_viewport_margins", grid, win, top, bottom, left, right] ~
Indicates the margins of a window grid which are _not_ part of the
viewport as indicated by the `win_viewport` event. This happens
e.g. in the presence of 'winbar' and floating window borders.

["win_extmark", grid, win, ns_id, mark_id, row, col] ~
Updates the position of an extmark which is currently visible in a
window. Only emitted if the mark has the `ui_watched` attribute.

==============================================================================
Popupmenu Events _ui-popupmenu_

Activated by the `ext_popupmenu` |ui-option|.

This UI extension delegates presentation of the |popupmenu-completion| and
command-line 'wildmenu'.

The UI decides how to present the menu. For example, depending on the last
`mode_change` event, command-line wildmenu may be presented horizontally,
while insert-mode completion would show a vertical popupmenu.

["popupmenu_show", items, selected, row, col, grid] ~
Show |popupmenu-completion|. `items` is an array of completion items
to show; each item is an array of the form [word, kind, menu, info] as
defined at |complete-items|, except that `word` is replaced by `abbr`
if present. `selected` is the initially-selected item, a zero-based
index into the array of items (-1 if no item is selected). `row` and
`col` give the anchor position, where the first character of the
completed word will be. When |ui-multigrid| is used, `grid` is the
grid for the anchor position. When `ext_cmdline` is active, `grid` is
set to -1 to indicate the popupmenu should be anchored to the external
cmdline. Then `col` will be a byte position in the cmdline text.

["popupmenu_select", selected] ~
Select an item in the current popupmenu. `selected` is a zero-based
index into the array of items from the last popupmenu_show event, or
-1 if no item is selected.

["popupmenu_hide"] ~
Hide the popupmenu.

==============================================================================
Tabline Events _ui-tabline_

Activated by the `ext_tabline` |ui-option|.

["tabline_update", curtab, tabs, curbuf, buffers] ~
Tabline was updated. UIs should present this data in a custom tabline
widget. Note: options `curbuf` + `buffers` were added in API7.
curtab: Current Tabpage
tabs: List of Dicts [{ "tab": Tabpage, "name": String }, ...]
curbuf: Current buffer handle.
buffers: List of Dicts [{ "buffer": buffer handle, "name": String}, ...]

==============================================================================
Cmdline Events _ui-cmdline_

Activated by the `ext_cmdline` |ui-option|.

This UI extension delegates presentation of the |cmdline| (except 'wildmenu').
For command-line 'wildmenu' UI events, activate |ui-popupmenu|.

["cmdline_show", content, pos, firstc, prompt, indent, level, hl_id] ~
content: List of [attrs, string, hl_id]
[[{}, "t", hl_id], [attrs, "est", hl_id], ...]

    Triggered when the cmdline is displayed or changed.
    The `content` is the full content that should be displayed in the
    cmdline, and the `pos` is the position of the cursor that in the
    cmdline. The content is divided into chunks with different highlight
    attributes represented as a dict (see |ui-event-highlight_set|).

    `firstc` and `prompt` are text, that if non-empty should be
    displayed in front of the command line. `firstc` always indicates
    built-in command lines such as `:` (ex command) and `/` `?` (search),
    while `prompt` is an |input()| prompt, highlighted with `hl_id`.
    `indent` tells how many spaces the content should be indented.

    The Nvim command line can be invoked recursively, for instance by
    typing `<c-r>=` at the command line prompt. The `level` field is used
    to distinguish different command lines active at the same time. The
    first invoked command line has level 1, the next recursively-invoked
    prompt has level 2. A command line invoked from the |cmdline-window|
    has a higher level than the edited command line.

["cmdline_pos", pos, level] ~
Change the cursor position in the cmdline.

["cmdline_special_char", c, shift, level] ~
Display a special char in the cmdline at the cursor position. This is
typically used to indicate a pending state, e.g. after |c_CTRL-V|. If
`shift` is true the text after the cursor should be shifted, otherwise
it should overwrite the char at the cursor.

    Should be hidden at next cmdline_show.

["cmdline_hide", level, abort] ~
Hide the cmdline. `level` is the nesting level of the cmdline being hidden.
`abort` is true if the cmdline is hidden after an aborting condition
(|c_Esc| or |c_CTRL-C|).

["cmdline_block_show", lines] ~
Show a block of context to the current command line. For example if
the user defines a |:function| interactively: >vim
:function Foo()
: echo "foo"
:
<
`lines` is a list of lines of highlighted chunks, in the same form as
the "cmdline_show" `contents` parameter.

["cmdline_block_append", line] ~
Append a line at the end of the currently shown block.

["cmdline_block_hide"] ~
Hide the block.

==============================================================================
Message/Dialog Events _ui-messages_

Activated by the `ext_messages` |ui-option|.
Activates |ui-linegrid| and |ui-cmdline| implicitly.

This UI extension delegates presentation of messages and dialogs. Messages
that would otherwise render in the message/cmdline screen space, are emitted
as UI events.

Nvim will not allocate screen space for the cmdline or messages. 'cmdheight'
will be set to zero, but can be changed and used for the replacing cmdline or
message window. Cmdline state is emitted as |ui-cmdline| events, which the UI
must handle.

["msg_show", kind, content, replace_last, history, append, id, trigger] ~
Display a message to the user. Update (replace) any existing message
matching `id`.

    kind
        Name indicating the message kind:
     "" (empty) Unknown (consider a |feature-request|)
     "empty"  Empty message (`:echo ""`), with empty `content`.
       Should clear messages sharing the 'cmdheight'
       area if it is the only message in a batch.
     "bufwrite" |:write| message
     "confirm" Message preceding a prompt (|:confirm|,
       |confirm()|, |inputlist()|, |z=|, …)
     "emsg"  Error (|errors|, internal error, |:throw|, …)
     "echo"  |:echo| message
     "echomsg" |:echomsg| message
     "echoerr" |:echoerr| message
     "completion"    |ins-completion-menu| message
     "list_cmd" List output for various commands (|:ls|, |:set|, …)
     "lua_error" Error in |:lua| code
     "lua_print" |print()| from |:lua| code
     "progress" Progress message emitted by |nvim_echo()|
     "rpc_error" Error response from |rpcrequest()|
     "quickfix" Quickfix navigation message
     "search_cmd" Entered search command
     "search_count" Search count message ("S" flag of 'shortmess')
     "shell_cmd" |:!cmd| executed command
     "shell_err" |:!cmd| shell stderr output
     "shell_out" |:!cmd| shell stdout output
     "shell_ret" |:!cmd| shell return code
     "undo"  |:undo| and |:redo| message
     "verbose" 'verbose' message
     "wildlist" 'wildmode' "list" message
     "wmsg"  Warning ("search hit BOTTOM", |W10|, …)
        New kinds may be added in the future; clients should treat unknown
        kinds as the empty kind.

    content
        Array of `[attr_id, text_chunk, hl_id]` tuples, building up the
        message text of chunks of different highlights. No extra spacing
        should be added between chunks, the `text_chunk` by itself
        contains any necessary whitespace. Messages can contain line
        breaks "\n".

    replace_last
        Decides how multiple messages should be displayed:
        false: Display the message together with all previous messages
        that are still visible.
        true:  Replace the message in the most-recent `msg_show` call,
        but any other visible message should still remain.

    history
        True if the message was added to the |:messages| history.

    append
        True if the message should be appended to the previous message,
        rather than started on a new line. Is set for |:echon|.

    id
        Unique identifier for the message. It can either be an integer or
        string. A (visible) message with the same id should be replaced.

    trigger
        Type of action that triggered the message:
     "" (empty)      Unknown (consider a |feature-request|)
     "typed_cmd"     Interactively typed command on the |cmdline|

["msg_clear"] ~
Clear all messages currently displayed by "msg*show", emitted after
clearing the screen (messages sent by other "msg*" events below should
not be affected).

    Guidance: The "clear messages" behavior is UI-specific. If the UI
    presents messages in a new window, it may choose to clear messages
    after a few seconds. If the UI presents messages in a persistent area
    (e.g. cmdline), it should clear messages at the start of the next
    batch (typically, the next event-loop cycle).

["msg_showmode", content] ~
Shows 'showmode' and |recording| messages. `content` has the same
format as in "msg_show". This event is sent with empty `content` to
hide the last message.

["msg_showcmd", content] ~
Shows 'showcmd' messages. `content` has the same format as in "msg_show".
This event is sent with empty `content` to hide the last message.

["msg_ruler", content] ~
Used to display 'ruler' when there is no space for the ruler in a
statusline. `content` has the same format as in "msg_show". This event is
sent with empty `content` to hide the last message.

["msg_history_show", entries, prev_cmd] ~
Sent when |:messages| or |g<| command is invoked. History is sent as a
list of entries, where each entry is a `[kind, content, append]` tuple.

    prev_cmd
        True when sent with |g<| command, false with |:messages|.

_gui.txt_ Nvim

                  VIM REFERENCE MANUAL    by Bram Moolenaar

Nvim Graphical User Interface _gui_ _GUI_

Any client that supports the Nvim |ui-protocol| can be used as a UI for Nvim.
And multiple UIs can connect to the same Nvim instance! The terms "UI" and
"GUI" are often used interchangeably because all Nvim UI clients have the same
potential capabilities; the "TUI" refers to a UI client that outputs to your
terminal, whereas a "GUI" outputs directly to the OS graphics system.

Except where noted, this document describes UI capabilities available to both
TUI and GUI (assuming the UI supports the given feature). See |TUI| for notes
specific to the terminal UI. Help tags with the "gui-" prefix refer to UI
features, whereas help tags with the "ui-" prefix refer to the |ui-protocol|.

                                      Type |gO| to see the table of contents.

==============================================================================
Third-party GUIs _third-party-guis_ _vscode_

Nvim provides a builtin "terminal UI" (|TUI|), but also works with many
(third-party) GUIs which may provide a fresh look or extra features on top of
Nvim. For example, "vscode-neovim" essentially allows you to use VSCode as
a Nvim GUI.

- vscode-neovim (Nvim in VSCode!) <https://github.com/vscode-neovim/vscode-neovim>
- Firenvim (Nvim in your web browser!) <https://github.com/glacambre/firenvim>
- Neovide <https://neovide.dev/>
- Goneovim <https://github.com/akiyosi/goneovim>
- Nvy <https://github.com/RMichelsen/Nvy>
- Neovim-Qt (Qt5) <https://github.com/equalsraf/neovim-qt>
- VimR (macOS) <https://github.com/qvacua/vimr>
- Others <https://github.com/neovim/neovim/wiki/Related-projects#gui>

==============================================================================
Starting the GUI _gui-config_ _gui-start_

                                *ginit.vim* *gui-init* *gvimrc* *$MYGVIMRC*

For GUI-specific configuration Nvim provides the |UIEnter| event. This
happens after other |initialization|s, or whenever a UI attaches (multiple UIs
can connect to any Nvim instance).

Example: this sets "g:gui" to the value of the UI's "rgb" field: >
:autocmd UIEnter \* let g:gui = filter(nvim_list_uis(),{k,v-> v.chan==v:event.chan})[0].rgb
<

---

Stop or detach the current UI

                                                *:detach*

:detach
Detaches the current UI. Other UIs (if any) remain attached.
The server (typically `nvim --embed`) continues running as
a background process, and you can reattach to it later.
Before detaching, you may want to note the server address: >vim
:echo v:servername
<
Note: The server closes the UI RPC channel, so :detach
inherently "works" for all UIs. But if a UI isn't expecting
the channel to be closed, it may be (incorrectly) reported as
an error.

---

Restart Nvim

                                                *:restart*

:restart [+cmd] [command]
Restarts Nvim. See also |ZR|.

                1. Stops Nvim using `:qall` (or |+cmd|, if given).
                2. Starts a new Nvim server using the same |v:argv| (except
                   `-- [file…]` files).
                3. Attaches all UIs to the new Nvim server and runs `[command]`
                   on it.

                Example: discard changes and stop with `:qall!`, then restart: >
                    :restart +qall!

< Example: restart and restore the current session: >
:mksession! Session.vim | restart source Session.vim
< Example: restart and update plugins: >
:restart lua vim.pack.update()
<
Note: Only works if the UI and server are on the same system.
Note: If no attached UI implements the "restart" UI event,
this command will lead to a dangling server process.

---

Connect UI to a different server

                                                *:connect*

:connect {address}
Detaches the UI from the server it is currently attached to
and attaches it to the server at {address} instead.

                Note: If the current UI hasn't implemented the "connect" UI
                event, this command is equivalent to |:detach|.

:connect! {address}
Same as |:connect| but it also stops the detached server if
no other UI is currently attached to it.

---

GUI commands

                                                *:winp* *:winpos* *E188*

:winp[os]
Display current position of the top left corner of the GUI vim
window in pixels. Does not work in all versions.
Also see |getwinpos()|, |getwinposx()| and |getwinposy()|.

:winp[os] {X} {Y} _E466_
Put the GUI vim window at the given {X} and {Y} coordinates.
The coordinates should specify the position in pixels of the
top left corner of the window.
When the GUI window has not been opened yet, the values are
remembered until the window is opened. The position is
adjusted to make the window fit on the screen (if possible).

                                            *:wi* *:win* *:winsize* *E465*

:win[size] {width} {height}
Set the window height to {width} by {height} characters.
Obsolete, use ":set lines=11 columns=22".

==============================================================================
Using the mouse _mouse-using_

                                        *mouse-mode-table* *mouse-overview*

Overview of what the mouse buttons do, when 'mousemodel' is "extend":

               *<S-LeftMouse>* *<A-RightMouse>* *<S-RightMouse>* *<RightDrag>*
                                                 *<RightRelease>* *<LeftDrag>*

Normal Mode: >
event position selection change action
cursor window

---

<LeftMouse> yes end yes
<C-LeftMouse> yes end yes "CTRL-]" (2)
<S-LeftMouse> yes no change yes "\*" (2)
<LeftDrag> yes start or extend (1) no
<LeftRelease> yes start or extend (1) no
<MiddleMouse> yes if not active no put
<MiddleMouse> yes if active no yank and put
<RightMouse> yes start or extend yes
<A-RightMouse> yes start or extend blockw. yes
<S-RightMouse> yes no change yes "#" (2)
<C-RightMouse> no no change no "CTRL-T"
<RightDrag> yes extend no
<RightRelease> yes extend no

Insert or Replace Mode: >
event position selection change action
cursor window

---

<LeftMouse> yes (cannot be active) yes
<C-LeftMouse> yes (cannot be active) yes "CTRL-O^]" (2)
<S-LeftMouse> yes (cannot be active) yes "CTRL-O\*" (2)
<LeftDrag> yes start or extend (1) no like CTRL-O (1)
<LeftRelease> yes start or extend (1) no like CTRL-O (1)
<MiddleMouse> no (cannot be active) no put register
<RightMouse> yes start or extend yes like CTRL-O
<A-RightMouse> yes start or extend blockw. yes
<S-RightMouse> yes (cannot be active) yes "CTRL-O#" (2)
<C-RightMouse> no (cannot be active) no "CTRL-O CTRL-T"

In a help window: >
event position selection change action
cursor window

---

<2-LeftMouse> yes (cannot be active) no "^]" (jump to help tag)

When 'mousemodel' is "popup", these are different:

                                                               *<A-LeftMouse>*

Normal Mode: >
event position selection change action
cursor window

---

<S-LeftMouse> yes start or extend (1) no
<A-LeftMouse> yes start/extend blockw no
<RightMouse> no popup menu no

Insert or Replace Mode: >
event position selection change action
cursor window

---

<S-LeftMouse> yes start or extend (1) no like CTRL-O (1)
<A-LeftMouse> yes start/extend blockw no
<RightMouse> no popup menu no

(1) only if mouse pointer moved since press
(2) only if click is in same buffer

Clicking the left mouse button causes the cursor to be positioned. If the
click is in another window that window is made the active window. When
editing the command-line the cursor can only be positioned on the
command-line. When in Insert mode Vim remains in Insert mode. If 'scrolloff'
is set, and the cursor is positioned within 'scrolloff' lines from the window
border, the text is scrolled.

A selection can be started by pressing the left mouse button on the first
character, moving the mouse to the last character, then releasing the mouse
button. You will not always see the selection until you release the button,
only in some versions (GUI, Win32) will the dragging be shown immediately.
Note that you can make the text scroll by moving the mouse at least one
character in the first/last line in the window when 'scrolloff' is non-zero.

In Normal, Visual and Select mode clicking the right mouse button causes the
Visual area to be extended. When 'mousemodel' is "popup", the left button has
to be used while keeping the shift key pressed. When clicking in a window
which is editing another buffer, the Visual or Select mode is stopped.

In Normal, Visual and Select mode clicking the right mouse button with the alt
key pressed causes the Visual area to become blockwise. When 'mousemodel' is
"popup" the left button has to be used with the alt key. Note that this won't
work on systems where the window manager consumes the mouse events when the
alt key is pressed (it may move the window).

                *double-click* *<2-LeftMouse>* *<3-LeftMouse>* *<4-LeftMouse>*

Double, triple and quadruple clicks are supported. For selecting text, extra
clicks extend the selection: >

        click           select
        ---------------------------------
        double          word or % match
        triple          line
        quadruple       rectangular block

Exception: In a :help window, double-click jumps to help for the word that is
clicked on.

Double-click on a word selects that word. 'iskeyword' is used to specify
which characters are included in a word. Double-click on a character that has
a match selects until that match (like using "v%"). If the match is an
# if/#else/#endif block, the selection becomes linewise. The time for
double-clicking can be set with the 'mousetime' option.

Example: configure double-click to jump to the tag under the cursor: >vim
:map <2-LeftMouse> :exe "tag " .. expand("<cword>")<CR>

Dragging the mouse with a double-click (button-down, button-up, button-down
and then drag) will result in whole words to be selected. This continues
until the button is released, at which point the selection is per character
again.

For scrolling with the mouse see |scroll-mouse-wheel|.

In Insert mode, when a selection is started, Vim goes into Normal mode
temporarily. When Visual or Select mode ends, it returns to Insert mode.
This is like using CTRL-O in Insert mode. Select mode is used when the
'selectmode' option contains "mouse".

                                                *X1Mouse* *X1Drag* *X1Release*
                                                *X2Mouse* *X2Drag* *X2Release*
                                              *<MiddleRelease>* *<MiddleDrag>*

Mouse clicks can be mapped using these |keycodes|: >
code mouse button normal action

---

<LeftMouse> left pressed set cursor position
<LeftDrag> left moved while pressed extend selection
<LeftRelease> left released set selection end
<MiddleMouse> middle pressed paste text at cursor position
<MiddleDrag> middle moved while pressed -
<MiddleRelease> middle released -
<RightMouse> right pressed extend selection
<RightDrag> right moved while pressed extend selection
<RightRelease> right released set selection end
<X1Mouse> X1 button pressed -
<X1Drag> X1 moved while pressed -
<X1Release> X1 button release -
<X2Mouse> X2 button pressed -
<X2Drag> X2 moved while pressed -
<X2Release> X2 button release -

The X1 and X2 buttons refer to the extra buttons found on some mice (e.g. the
right thumb).

Examples: >vim
:noremap <MiddleMouse> <LeftMouse><MiddleMouse>
Paste at the position of the middle mouse button click (otherwise the paste
would be done at the cursor position). >vim

        :noremap <LeftRelease> <LeftRelease>y

Immediately yank the selection, when using Visual mode.

Note the use of ":noremap" instead of "map" to avoid a recursive mapping.

> vim

        :map <X1Mouse> <C-O>
        :map <X2Mouse> <C-I>

Map the X1 and X2 buttons to go forwards and backwards in the jump list, see
|CTRL-O| and |CTRL-I|.

                                       *mouse-swap-buttons* *pi_swapmouse*

To swap the meaning of the left and right mouse buttons: >vim
:noremap <LeftMouse> <RightMouse>
:noremap <LeftDrag> <RightDrag>
:noremap <LeftRelease> <RightRelease>
:noremap <RightMouse> <LeftMouse>
:noremap <RightDrag> <LeftDrag>
:noremap <RightRelease> <LeftRelease>
:noremap g<LeftMouse> <C-RightMouse>
:noremap g<RightMouse> <C-LeftMouse>
:noremap! <LeftMouse> <RightMouse>
:noremap! <LeftDrag> <RightDrag>
:noremap! <LeftRelease> <RightRelease>
:noremap! <RightMouse> <LeftMouse>
:noremap! <RightDrag> <LeftDrag>
:noremap! <RightRelease> <LeftRelease>
<

The `swapmouse` plugin does exactly this. Use |pack-add| to load it: >vim
:packadd! swapmouse
<

==============================================================================
Scrollbars _gui-scrollbars_

There are vertical scrollbars and a horizontal scrollbar. You may
configure which ones appear with the 'guioptions' option.

The interface looks like this (with `:set guioptions=mlrb`):

>

                       +------------------------------+
                       | File  Edit              Help | <- Menu bar (m)
                       +-+--------------------------+-+
                       |^|                          |^|
                       |#| Text area.               |#|
                       | |                          | |
                       |v|__________________________|v|

Normal status line -> |-+ File.c 5,2 +-|
between Vim windows |^|""""""""""""""""""""""""""|^|
| | | |
| | Another file buffer. | |
| | | |
|#| |#|
Left scrollbar (l) -> |#| |#| <- Right
|#| |#| scrollbar (r)
| | | |
|v| |v|
+-+--------------------------+-+
| |< #### >| | <- Bottom
+-+--------------------------+-+ scrollbar (b)
<
Any of the scrollbar or menu components may be turned off by not putting the
appropriate letter in the 'guioptions' string. The bottom scrollbar is
only useful when 'nowrap' is set.

VERTICAL SCROLLBARS _gui-vert-scroll_

Each Vim window has a scrollbar next to it which may be scrolled up and down
to move through the text in that buffer. The size of the scrollbar-thumb
indicates the fraction of the buffer which can be seen in the window.
When the scrollbar is dragged all the way down, the last line of the file
will appear in the top of the window.

If a window is shrunk to zero height (by the growth of another window) its
scrollbar disappears. It reappears when the window is restored.

If a window is vertically split, it will get a scrollbar when it is the
current window and when, taking the middle of the current window and drawing a
vertical line, this line goes through the window.
When there are scrollbars on both sides, and the middle of the current window
is on the left half, the right scrollbar column will contain scrollbars for
the rightmost windows. The same happens on the other side.

HORIZONTAL SCROLLBARS _gui-horiz-scroll_

The horizontal scrollbar (at the bottom of the Vim GUI) may be used to
scroll text sideways when the 'wrap' option is turned off. The
scrollbar-thumb size is such that the text of the longest visible line may be
scrolled as far as possible left and right. The cursor is moved when
necessary, it must remain on a visible character (unless 'virtualedit' is
set).

Computing the length of the longest visible line takes quite a bit of
computation, and it has to be done every time something changes. If this
takes too much time or you don't like the cursor jumping to another line,
include the 'h' flag in 'guioptions'. Then the scrolling is limited by the
text of the current cursor line.

==============================================================================
Drag and drop _drag-n-drop_

You can drag and drop one or more files into the Vim window, where they will
be opened as if a |:drop| command was used.

If you hold down Shift while doing this, Vim changes to the first dropped
file's directory. If you hold Ctrl Vim will always split a new window for the
file. Otherwise it's only done if the current buffer has been changed.

You can also drop a directory on Vim. This starts the explorer plugin for
that directory (assuming it was enabled, otherwise you'll get an error
message). Keep Shift pressed to change to the directory instead.

If Vim happens to be editing a command line, the names of the dropped files
and directories will be inserted at the cursor. This allows you to use these
names with any Ex command. Special characters (space, tab, double quote and
"|"; backslash on non-MS-Windows systems) will be escaped.

==============================================================================
Menus _menus_

For an introduction see |usr_42.txt| in the user manual.

Using Menus _using-menus_

Basically, menus can be used just like mappings. You can define your own
menus, as many as you like.
Long-time Vim users won't use menus much. But the power is in adding your own
menus and menu items. They are most useful for things that you can't remember
what the key sequence was.

For creating menus in a different language, see |:menutrans|.

                                                        *menu.vim*

The default menus are read from the file "$VIMRUNTIME/menu.vim".  See
|$VIMRUNTIME| for where the path comes from. You can set up your own menus.
Starting off with the default set is a good idea. You can add more items, or,
if you don't like the defaults at all, start with removing all menus
|:unmenu-all|. You can also avoid the default menus being loaded by adding
this line to your vimrc file (NOT your gvimrc file!): >
:let did_install_default_menus = 1
If you also want to avoid the Syntax menu: >
:let did_install_syntax_menu = 1
The first item in the Syntax menu can be used to show all available filetypes
in the menu (which can take a bit of time to load). If you want to have all
filetypes already present at startup, add: >
:let do_syntax_sel_menu = 1

Note that the menu.vim is sourced when `:syntax on` or `:filetype on` is
executed or after your .vimrc file is sourced. This means that the 'encoding'
option and the language of messages (`:language messages`) must be set before
that (if you want to change them).

                                                        *console-menus*

Although this documentation is in the GUI section, you can actually use menus
in console mode too. You will have to load |menu.vim| explicitly then, it is
not done by default. You can use the |:emenu| command and command-line
completion with 'wildmenu' to access the menu entries almost like a real menu
system. To do this, put these commands in your vimrc file: >
:source $VIMRUNTIME/menu.vim
:set wildmenu
:set cpo-=<
:set wcm=<C-Z>
:map <F4> :emenu <C-Z>
Pressing <F4> will start the menu. You can now use the cursor keys to select
a menu entry. Hit <Enter> to execute it. Hit <Esc> if you want to cancel.

Creating New Menus _creating-menus_

                                *:me*  *:menu*  *:noreme*  *:noremenu*
                                *E330* *E327* *E331* *E336* *E333*
                                *E328* *E329* *E337* *E792* *E1310*

To create a new menu item, use the ":menu" commands. They are mostly like
the ":map" set of commands (see |map-modes|), but the first argument is a menu
item name, given as a path of menus and submenus with a '.' between them,
e.g.: >

:menu File.Save :w<CR>
:inoremenu File.Save <C-O>:w<CR>
:menu Edit.Big\ Changes.Delete\ All\ Spaces :%s/[ ^I]//g<CR>

This last one will create a new item in the menu bar called "Edit", holding
the mouse button down on this will pop up a menu containing the item
"Big Changes", which is a sub-menu containing the item "Delete All Spaces",
which when selected, performs the operation.

To create a menu for terminal mode, use |:tlmenu| instead of |:tmenu| unlike
key mapping (|:tmap|). This is because |:tmenu| is already used for defining
tooltips for menus. See |terminal-input|.

Special characters in a menu name:

                                                        *menu-shortcut*

- & The next character is the shortcut key. Make sure each shortcut key is
  only used once in a (sub)menu. If you want to insert a literal "&" in the
  menu name use "&&".
  _menu-text_
- <Tab> Separates the menu name from right-aligned text. This can be used to
  show the equivalent typed command. The text "<Tab>" can be used here for
  convenience. If you are using a real tab, don't forget to put a backslash
  before it!

Example: >

:amenu &File.&Open<Tab>:e :browse e<CR>

[typed literally]
With the shortcut "F" (while keeping the <Alt> key pressed), and then "O",
this menu can be used. The second part is shown as "Open :e". The ":e"
is right aligned, and the "O" is underlined, to indicate it is the shortcut.

                                        *:am*  *:amenu*  *:an*      *:anoremenu*

The ":amenu" command can be used to define menu entries for all modes at once,
except for Terminal mode. To make the command work correctly, a character is
automatically inserted for some modes: >
mode inserted appended
Normal nothing nothing
Visual <C-C> <C-\><C-G>
Insert <C-\><C-O>
Cmdline <C-C> <C-\><C-G>
Op-pending <C-C> <C-\><C-G>
<
Example: >

    :amenu File.Next     :next^M

is equal to: >

    :nmenu File.Next     :next^M
    :vmenu File.Next     ^C:next^M^\^G
    :imenu File.Next     ^\^O:next^M
    :cmenu File.Next     ^C:next^M^\^G
    :omenu File.Next     ^C:next^M^\^G

Careful: In Insert mode this only works for a SINGLE Normal mode command,
because of the CTRL-O. If you have two or more commands, you will need to use
the ":imenu" command. For inserting text in any mode, you can use the
expression register: >

    :amenu Insert.foobar   "='foobar'<CR>P

The special text <Cmd> begins a "command menu", it executes the command
directly without changing modes. Where you might use ":...<CR>" you can
instead use "<Cmd>...<CR>". See |<Cmd>| for more info. Example: >
anoremenu File.Next <Cmd>next<CR>

Note that <Esc> in Cmdline mode executes the command, like in a mapping. This
is Vi compatible. Use CTRL-C to quit Cmdline mode.

                *:nme* *:nmenu*  *:nnoreme* *:nnoremenu* *:nunme* *:nunmenu*

Menu commands starting with "n" work in Normal mode. |mapmode-n|

                *:ome* *:omenu*  *:onoreme* *:onoremenu* *:ounme* *:ounmenu*

Menu commands starting with "o" work in Operator-pending mode. |mapmode-o|

                *:vme* *:vmenu*  *:vnoreme* *:vnoremenu* *:vunme* *:vunmenu*

Menu commands starting with "v" work in Visual mode. |mapmode-v|

                *:xme* *:xmenu*  *:xnoreme* *:xnoremenu* *:xunme* *:xunmenu*

Menu commands starting with "x" work in Visual and Select mode. |mapmode-x|

                *:sme* *:smenu*  *:snoreme* *:snoremenu* *:sunme* *:sunmenu*

Menu commands starting with "s" work in Select mode. |mapmode-s|

                *:ime* *:imenu*  *:inoreme* *:inoremenu* *:iunme* *:iunmenu*

Menu commands starting with "i" work in Insert mode. |mapmode-i|

                *:cme* *:cmenu*  *:cnoreme* *:cnoremenu* *:cunme* *:cunmenu*

Menu commands starting with "c" work in Cmdline mode. |mapmode-c|

                *:tlm* *:tlmenu* *:tln*     *:tlnoremenu* *:tlu*   *:tlunmenu*

Menu commands starting with "tl" work in Terminal mode. |mapmode-t|

                                                *:menu-<silent>* *:menu-silent*

To define a menu which will not be echoed on the command line, add
"<silent>" as the first argument. Example: >
:menu <silent> Settings.Ignore\ case :set ic<CR>
The ":set ic" will not be echoed when using this menu. Messages from the
executed command are still given though. To shut them up too, add a ":silent"
in the executed command: >
:menu <silent> Search.Header :exe ":silent normal /Header\r"<CR>
"<silent>" may also appear just after "<script>".

                                                *:menu-<script>* *:menu-script*

The "to" part of the menu will be inspected for mappings. If you don't want
this, use the ":noremenu" command (or the similar one for a specific mode).
If you do want to use script-local mappings, add "<script>" as the very first
argument to the ":menu" command or just after "<silent>".

                                                        *menu-priority*

You can give a priority to a menu. Menus with a higher priority go more to
the right. The priority is given as a number before the ":menu" command.
Example: >
:80menu Buffer.next :bn<CR>

The default menus have these priorities: >
File 10
Edit 20
Tools 40
Syntax 50
Buffers 60
Window 70
Help 9999
<
When no or zero priority is given, 500 is used.
The priority for the PopUp menu is not used.

You can use a priority higher than 9999, to make it go after the Help menu,
but that is non-standard and is discouraged. The highest possible priority is
about 32000. The lowest is 1.

                                                        *sub-menu-priority*

The same mechanism can be used to position a sub-menu. The priority is then
given as a dot-separated list of priorities, before the menu name: >
:menu 80.500 Buffer.next :bn<CR>
Giving the sub-menu priority is only needed when the item is not to be put
in a normal position. For example, to put a sub-menu before the other items: >
:menu 80.100 Buffer.first :brew<CR>
Or to put a sub-menu after the other items, and further items with default
priority will be put before it: >
:menu 80.900 Buffer.last :blast<CR>
When a number is missing, the default value 500 will be used: >
:menu .900 myMenu.test :echo "text"<CR>
The menu priority is only used when creating a new menu. When it already
existed, e.g., in another mode, the priority will not change. Thus, the
priority only needs to be given the first time a menu is used.
An exception is the PopUp menu. There is a separate menu for each mode
(Normal, Op-pending, Visual, Insert, Cmdline). The order in each of these
menus can be different. This is different from menu-bar menus, which have
the same order for all modes.
NOTE: sub-menu priorities currently don't work for all versions of the GUI.

                                                        *menu-separator* *E332*

Menu items can be separated by a special item that inserts some space between
items. Depending on the system this is displayed as a line or a dotted line.
These items must start with a '-' and end in a '-'. The part in between is
used to give it a unique name. Priorities can be used as with normal items.
Example: >
:menu Example.item1 :do something
:menu Example.-Sep- :
:menu Example.item2 :do something different
Note that the separator also requires a rhs. It doesn't matter what it is,
because the item will never be selected. Use a single colon to keep it
simple.

                                                        *gui-toolbar*

The default toolbar is setup in menu.vim. The display of the toolbar is
controlled by the 'guioptions' letter 'T'. You can thus have menu & toolbar
together, or either on its own, or neither. The appearance is controlled by
the 'toolbar' option. You can choose between an image, text or both.

                                                        *toolbar-icon*

The toolbar is defined as a special menu called ToolBar, which only has one
level. Vim interprets the items in this menu as follows:

- 1 If an "icon=" argument was specified, the file with this name is used.
  The file can either be specified with the full path or with the base name.
  In the last case it is searched for in the "bitmaps" directory in
  'runtimepath', like in point 3. Examples: >
  :amenu icon=/usr/local/pixmaps/foo*icon.xpm ToolBar.Foo :echo "Foo"<CR>
  :amenu icon=FooIcon ToolBar.Foo :echo "Foo"<CR>
  < Note that in the first case the extension is included, while in the second
  case it is omitted.
  If the file cannot be opened the next points are tried.
  A space in the file name must be escaped with a backslash.
  A menu priority must come \_after* the icon argument: >
  :amenu icon=foo 1.42 ToolBar.Foo :echo "42!"<CR>
- 2 An item called 'BuiltIn##', where ## is a number, is taken as number ## of
  the built-in bitmaps available in Vim. Currently there are 31 numbered
  from 0 to 30 which cover most common editing operations |builtin-tools|. >
  :amenu ToolBar.BuiltIn22 :call SearchNext("back")<CR>
- 3 An item with another name is first searched for in the directory
  "bitmaps" in 'runtimepath'. If found, the bitmap file is used as the
  toolbar button image. Note that the exact filename is OS-specific: For
  example, under Win32 the command >
  :amenu ToolBar.Hello :echo "hello"<CR>
  < would find the file 'hello.bmp'. Under X11 it is 'Hello.xpm'.
  For MS-Windows and the bitmap is scaled to fit the button. For
  MS-Windows a size of 18 by 18 pixels works best.
  For MS-Windows the bitmap should have 16 colors with the standard palette.
  The light grey pixels will be changed to the Window frame color and the
  dark grey pixels to the window shadow color. More colors might also work,
  depending on your system.
- 4 If the bitmap is still not found, Vim checks for a match against its list
  of built-in names. Each built-in button image has a name.
  So the command >
  :amenu ToolBar.Open :e
  < will show the built-in "open a file" button image if no open.bmp exists.
  All the built-in names can be seen used in menu.vim.
- 5 If all else fails, a blank, but functioning, button is displayed.

                                                          *builtin-tools*

  >

      nr  Name                Normal action
      00  New                 open new window
      01  Open                browse for file to open in current window
      02  Save                write buffer to file
      03  Undo                undo last change
      04  Redo                redo last undone change
      05  Cut                 delete selected text to clipboard
      06  Copy                copy selected text to clipboard
      07  Paste               paste text from clipboard
      08  Print               print current buffer
      09  Help                open a buffer on Vim's builtin help
      10  Find                start a search command
      11  SaveAll             write all modified buffers to file
      12  SaveSesn            write session file for current situation
      13  NewSesn             write new session file
      14  LoadSesn            load session file
      15  RunScript           browse for file to run as a Vim script
      16  Replace             prompt for substitute command
      17  WinClose            close current window
      18  WinMax              make current window use many lines
      19  WinMin              make current window use few lines
      20  WinSplit            split current window
      21  Shell               start a shell
      22  FindPrev            search again, backward
      23  FindNext            search again, forward
      24  FindHelp            prompt for word to search help for
      25  Make                run make and jump to first error
      26  TagJump             jump to tag under the cursor
      27  RunCtags            build tags for files in current directory
      28  WinVSplit           split current window vertically
      29  WinMaxWidth         make current window use many columns
      30  WinMinWidth         make current window use few columns

  <
  _hidden-menus_ _win32-hidden-menus_
  In the Win32 GUI, starting a menu name with ']' excludes that menu from the
  main menu bar. You must then use the |:popup| command to display it.

When splitting the window the window toolbar is not copied to the new window.

                                                        *popup-menu*

You can define the special menu "PopUp". This is the menu that is displayed
when the right mouse button is pressed, if 'mousemodel' is set to popup or
popup_setpos.

The default "PopUp" menu is: >vim
amenu PopUp.Open\ in\ web\ browser gx
anoremenu PopUp.Inspect <Cmd>Inspect<CR>
anoremenu PopUp.Go\ to\ definition <Cmd>lua vim.lsp.buf.definition()<CR>
anoremenu PopUp.Show\ Diagnostics <Cmd>lua vim.diagnostic.open_float()<CR>
anoremenu PopUp.Show\ All\ Diagnostics <Cmd>lua vim.diagnostic.setqflist()<CR>
anoremenu PopUp.Configure\ Diagnostics <Cmd>help vim.diagnostic.config()<CR>
anoremenu PopUp.-1- <Nop>
vnoremenu PopUp.Cut "+x
vnoremenu PopUp.Copy "+y
anoremenu PopUp.Paste "+gP
vnoremenu PopUp.Paste "+P
vnoremenu PopUp.Delete "\_x
nnoremenu PopUp.Select\ All ggVG
vnoremenu PopUp.Select\ All gg0oG$
inoremenu PopUp.Select\ All <C-Home><C-O>VG
anoremenu PopUp.-2- <Nop>
anoremenu PopUp.How-to\ disable\ mouse <Cmd>help disable-mouse<CR>
<

Showing What Menus Are Mapped To _showing-menus_

To see what an existing menu is mapped to, use just one argument after the
menu commands (just like you would with the ":map" commands). If the menu
specified is a submenu, then all menus under that hierarchy will be shown.
If no argument is given after :menu at all, then ALL menu items are shown
for the appropriate mode (e.g., Command-line mode for :cmenu).

Special characters in the list, just before the rhs:
• \* Menu was defined with "nore" to disallow remapping.
• & Menu was defined with "<script>" to allow remapping script-local mappings.
• s Menu was defined with "<silent>" to avoid showing what it is mapped to
when triggered.
• - Menu was disabled.

Note that hitting <Tab> while entering a menu name after a menu command may
be used to complete the name of the menu item.

Executing Menus _execute-menus_

                                                *:em*  *:emenu* *E334* *E335*

:[range]em[enu] {menu} Execute {menu} from the command line.
The default is to execute the Normal mode
menu. If a range is specified, it executes
the Visual mode menu.
If used from <c-o>, it executes the
insert-mode menu Eg: >
:emenu File.Exit

:[range]em[enu] {mode} {menu} Like above, but execute the menu for {mode}: - 'n': |:nmenu| Normal mode - 'v': |:vmenu| Visual mode - 's': |:smenu| Select mode - 'o': |:omenu| Operator-pending mode - 't': |:tlmenu| Terminal mode - 'i': |:imenu| Insert mode - 'c': |:cmenu| Cmdline mode

You can use :emenu to access useful menu items you may have got used to from
GUI mode. See 'wildmenu' for an option that works well with this. See
|console-menus| for an example.

When using a range, if the lines match with '<,'>, then the menu is executed
using the last visual selection.

Deleting Menus _delete-menus_

                                                *:unme*  *:unmenu*
                                                *:aun*   *:aunmenu*

To delete a menu item or a whole submenu, use the unmenu commands, which are
analogous to the unmap commands. Eg: >
:unmenu! Edit.Paste

This will remove the Paste item from the Edit menu for Insert and
Command-line modes.

Note that hitting <Tab> while entering a menu name after an umenu command
may be used to complete the name of the menu item for the appropriate mode.

To remove all menus use: _:unmenu-all_ >
:unmenu _" remove all menus in Normal and visual mode
:unmenu!_ " remove all menus in Insert and Command-line mode
:aunmenu _" remove all menus in all modes, except for Terminal
" mode
:tlunmenu_ " remove all menus in Terminal mode

If you want to get rid of the menu bar: >
:set guioptions-=m

Disabling Menus _disable-menus_

                                                *:menu-disable* *:menu-enable*

If you do not want to remove a menu, but disable it for a moment, this can be
done by adding the "enable" or "disable" keyword to a ":menu" command.
Examples: >
:menu disable &File.&Open\.\.\.
:amenu enable _
:amenu disable &Tools._

The command applies to the modes as used with all menu commands. Note that
characters like "&" need to be included for translated names to be found.
When the argument is "\*", all menus are affected. Otherwise the given menu
name and all existing submenus below it are affected.

Examples for Menus _menu-examples_

Here is an example on how to add menu items with menus! You can add a menu
item for the keyword under the cursor. The register "z" is used. >

:nmenu Words.Add\ Var wb"zye:menu! Words.<C-R>z <C-R>z<CR>
:nmenu Words.Remove\ Var wb"zye:unmenu! Words.<C-R>z<CR>
:vmenu Words.Add\ Var "zy:menu! Words.<C-R>z <C-R>z <CR>
:vmenu Words.Remove\ Var "zy:unmenu! Words.<C-R>z<CR>
:imenu Words.Add\ Var <Esc>wb"zye:menu! Words.<C-R>z <C-R>z<CR>a
:imenu Words.Remove\ Var <Esc>wb"zye:unmenu! Words.<C-R>z<CR>a

(the rhs is in <> notation, you can copy/paste this text to try out the
mappings, or put these lines in your gvimrc; "<C-R>" is CTRL-R, "<CR>" is
the <CR> key. |<>|)

                                                        *tooltips* *menu-tips*

Tooltips & Menu tips

See section |42.4| in the user manual.

                                                        *:tmenu*

:tm[enu] {menupath} {rhs} Define a tip for a menu or tool. (only in
X11 and Win32 GUI)

:tm[enu] [menupath] List menu tips. (only in X11 and Win32 GUI)

                                                        *:tunmenu*

:tu[nmenu] {menupath} Remove a tip for a menu or tool.
(only in X11 and Win32 GUI)

Note: To create menus for terminal mode, use |:tlmenu| instead.

When a tip is defined for a menu item, it appears in the command-line area
when the mouse is over that item, much like a standard Windows menu hint in
the status bar. (Except when Vim is in Command-line mode, when of course
nothing is displayed.)
When a tip is defined for a ToolBar item, it appears as a tooltip when the
mouse pauses over that button, in the usual fashion. Use the |hl-Tooltip|
highlight group to change its colors.

A "tip" can be defined for each menu item. For example, when defining a menu
item like this: >
:amenu MyMenu.Hello :echo "Hello"<CR>
The tip is defined like this: >
:tmenu MyMenu.Hello Displays a greeting.
And delete it with: >
:tunmenu MyMenu.Hello

Tooltips are currently only supported for the X11 and Win32 GUI. However,
they should appear for the other gui platforms in the not too distant future.

The ":tmenu" command works just like other menu commands, it uses the same
arguments. ":tunmenu" deletes an existing menu tip, in the same way as the
other unmenu commands.

If a menu item becomes invalid (i.e. its actions in all modes are deleted) Vim
deletes the menu tip (and the item) for you. This means that :aunmenu deletes
a menu item - you don't need to do a :tunmenu as well.

5.9 Popup Menus

You can cause a menu to popup at the cursor. This behaves similarly to the
PopUp menus except that any menu tree can be popped up.

                                                        *:popup* *:popu*

:popu[p] {name} Popup the menu {name}. The menu named must
have at least one subentry, but need not
appear on the menu-bar (see |hidden-menus|).

:popu[p]! {name} Like above, but use the position of the mouse
pointer instead of the cursor.

Example: >
:popup File
will make the "File" menu (if there is one) appear at the text cursor (mouse
pointer if ! was used). >

        :amenu ]Toolbar.Make    :make<CR>
        :popup ]Toolbar

This creates a popup menu that doesn't exist on the main menu-bar.

Note that a menu that starts with ']' will not be displayed.
