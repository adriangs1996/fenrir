# Deferred — Neovim UI Protocol Gaps

Features intentionally excluded from the `neovim-multigrid` planning scope.
Each item is a candidate for its own planning session.

---

## Mouse Support

**Events:** `mouse_on`, `mouse_off`, `nvim_input_mouse`
**What's needed:**

- Map canvas pixel coordinates to grid + local row/col (requires hit-testing grids
  in reverse `compindex` order to find topmost grid at click point).
- Handle left click (cursor move), right click (extend selection).
- Handle scroll wheel (`nvim_input_mouse("wheel", "up"/"down", ...)`).
- Optionally: drag for visual selection.

**Why deferred:** Multigrid hit-testing must exist first (needs `nvim-05`).
Mouse is a clean standalone feature once the compositor is in place.

---

## Blend / Opacity for Floating Windows

**Attribute:** `blend` (0–100) in `hl_attr_define`
**What's needed:**

- Per-cell background color lerp against whatever is rendered below the float.
- Either `canvas.globalAlpha` approximation or manual `getImageData` readback.

**Why deferred:** `getImageData` is expensive (GPU readback per frame). Approximation
via `globalAlpha` is lossy. Most real-world float UIs work fine at full opacity.

---

## IME / Composition Events

**Events:** `compositionstart`, `compositionupdate`, `compositionend`
**What's needed:**

- Invisible `<input>` or `<textarea>` overlay to capture browser composition.
- Forward final composed string to `nvim.input()`.
- Suppress raw `keydown` events during active composition.

**Why deferred:** Non-trivial, orthogonal to protocol gap work. Requires its own
design (overlay positioning, z-index, focus management).

---

## Clipboard Integration

**Neovim registers:** `+` (system clipboard), `*` (primary selection)
**What's needed:**

- Detect yank/paste to `+`/`*` registers via Neovim RPC or `g:clipboard` provider.
- Bridge to `navigator.clipboard.writeText()` / `readText()`.

**Why deferred:** Requires Neovim init config injection, not just UI protocol handling.
Separate planning session needed for the RPC bridge design.

---

## Busy State UI

**Events:** `busy_start`, `busy_stop`
**What's needed:**

- A loading indicator (spinner, progress bar, cursor change) shown during `busy_start`.
- Hidden on `busy_stop`.

**Why deferred:** No existing spinner component. Requires UI design decisions
(placement, style) outside the scope of protocol gap-filling.

---

## Server-Side Neovim Integration

**File:** `apps/server/src/neovim/MODULE.md`
**What's needed:**

- Migrate neovim process management from `apps/desktop/src/main.ts` to the Node.js server.
- Update `nvim_ui_attach` call in the server module to include `ext_multigrid`.

**Why deferred:** Planned migration, separate architectural effort. Current desktop
integration works and is the active code path.
