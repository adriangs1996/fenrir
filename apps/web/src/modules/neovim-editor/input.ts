/**
 * DOM `KeyboardEvent` → Neovim `nvim_input` notation.
 *
 * Modelled on neovide's `window/keyboard_manager.rs`. Differences from a naive
 * mapping that matter:
 *
 *   - All four modifiers are tracked: `<C-…>`, `<S-…>`, `<M-…>`, `<D-…>`
 *     (Super / Cmd). macOS Option is treated as Meta.
 *   - `<S-…>` is only emitted when (a) the key is "special" (Esc, F1, Tab…)
 *     or (b) the combination is `Ctrl + ASCII letter` — otherwise the
 *     shifted glyph is already in `e.key` (e.g. `!` for Shift-1) and adding
 *     `S-` would double-shift in Neovim's keymap normaliser.
 *   - `<` is escaped as `<lt>` so Neovim doesn't parse it as a key sequence.
 *   - Space is `<Space>` when special so `<C-Space>` etc. round-trips.
 *
 * Pure function, no React. Easier to unit test that way.
 */

const NAMED_KEY_MAP: Record<string, string> = {
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "BS",
  Delete: "Del",
  Tab: "Tab",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  " ": "Space",
};

// F1..F35
for (let i = 1; i <= 35; i++) NAMED_KEY_MAP[`F${i}`] = `F${i}`;

interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface TranslateOptions {
  /**
   * On macOS, the Option (⌥) key serves as both Meta and as a "compose another
   * glyph" modifier. When true, treat Option/Alt as `<M-…>`. Consumers that
   * want the system "type ¥ for Option-Y" behaviour pass false and let the
   * browser's `e.key` carry the composed glyph.
   */
  altIsMeta: boolean;
}

const DEFAULTS: TranslateOptions = { altIsMeta: true };

export function translateKey(e: KeyEventLike, opts: TranslateOptions = DEFAULTS): string {
  // No-op modifier presses
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") {
    return "";
  }

  const named = NAMED_KEY_MAP[e.key];
  const isSpecial = named !== undefined;

  // Resolve the body of the sequence. For special keys we use the canonical
  // name; for "<" we always use "lt"; otherwise we use e.key as-is so shift
  // is naturally encoded by the browser (e.g. "A" not "a" with shift held).
  let body: string;
  let shouldShift: boolean;
  if (isSpecial) {
    body = named;
    shouldShift = e.shiftKey;
  } else if (e.key === "<") {
    body = "lt";
    shouldShift = e.shiftKey;
  } else if (e.key.length === 1) {
    body = e.key;
    // Shift is implicit in the shifted glyph EXCEPT when combined with Ctrl
    // and an ASCII letter. Neovim normalises <C-A> == <C-a>, but <C-S-A>
    // is distinct from <C-A>, so we surface S- in that one case.
    const ctrlAlpha = e.ctrlKey && /^[a-zA-Z]$/.test(body);
    shouldShift = e.shiftKey && ctrlAlpha;
    if (ctrlAlpha) body = body.toUpperCase();
  } else {
    // Unrecognised key with multi-char name we don't know about. Drop.
    return "";
  }

  const haveMeta = e.altKey && opts.altIsMeta;
  const haveSuper = e.metaKey;

  // No modifiers and not special → just the literal char.
  if (!shouldShift && !e.ctrlKey && !haveMeta && !haveSuper && !isSpecial && body.length === 1) {
    return body;
  }

  let mods = "";
  if (shouldShift) mods += "S-";
  if (e.ctrlKey) mods += "C-";
  if (haveMeta) mods += "M-";
  if (haveSuper) mods += "D-";

  return `<${mods}${body}>`;
}
