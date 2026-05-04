import { describe, expect, it } from "vitest";
import { translateKey } from "./input";

function ev(
  key: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: mods.meta ?? false,
  };
}

describe("translateKey", () => {
  it("passes printable characters through verbatim", () => {
    expect(translateKey(ev("a"))).toBe("a");
    expect(translateKey(ev("A", { shift: true }))).toBe("A");
    expect(translateKey(ev("!", { shift: true }))).toBe("!");
  });

  it("maps named keys to angle-bracket notation", () => {
    expect(translateKey(ev("Escape"))).toBe("<Esc>");
    expect(translateKey(ev("Enter"))).toBe("<Enter>");
    expect(translateKey(ev("Backspace"))).toBe("<BS>");
    expect(translateKey(ev("Delete"))).toBe("<Del>");
    expect(translateKey(ev("Tab"))).toBe("<Tab>");
    expect(translateKey(ev("ArrowUp"))).toBe("<Up>");
  });

  it("encodes Space canonically so chord notation round-trips", () => {
    expect(translateKey(ev(" "))).toBe("<Space>");
    expect(translateKey(ev(" ", { ctrl: true }))).toBe("<C-Space>");
    expect(translateKey(ev(" ", { shift: true }))).toBe("<S-Space>");
  });

  it("encodes Ctrl + ASCII letter and uppercases the body", () => {
    expect(translateKey(ev("a", { ctrl: true }))).toBe("<C-A>");
    expect(translateKey(ev("c", { ctrl: true }))).toBe("<C-C>");
  });

  it("includes S- only when both ctrl and shift are held with a letter", () => {
    expect(translateKey(ev("A", { ctrl: true, shift: true }))).toBe("<S-C-A>");
  });

  it("encodes <lt> for the literal '<' key", () => {
    expect(translateKey(ev("<"))).toBe("<lt>");
    expect(translateKey(ev("<", { ctrl: true }))).toBe("<C-lt>");
  });

  it("encodes Alt as <M-…> by default", () => {
    expect(translateKey(ev("h", { alt: true }))).toBe("<M-h>");
    expect(translateKey(ev("Tab", { alt: true }))).toBe("<M-Tab>");
  });

  it("encodes Meta (Cmd) as <D-…>", () => {
    expect(translateKey(ev("s", { meta: true }))).toBe("<D-s>");
  });

  it("emits <S-Tab> for Shift+Tab (special key keeps shift)", () => {
    expect(translateKey(ev("Tab", { shift: true }))).toBe("<S-Tab>");
  });

  it("returns empty string for bare modifier presses", () => {
    expect(translateKey(ev("Shift"))).toBe("");
    expect(translateKey(ev("Control"))).toBe("");
    expect(translateKey(ev("Alt"))).toBe("");
    expect(translateKey(ev("Meta"))).toBe("");
  });

  it("returns empty string for unknown multi-char keys", () => {
    expect(translateKey(ev("Unidentified"))).toBe("");
  });

  it("respects altIsMeta=false (Option-as-glyph mode)", () => {
    // With altIsMeta false the modifier is dropped; the browser's e.key
    // already carries the composed glyph, so we just emit it.
    expect(translateKey(ev("¥", { alt: true }), { altIsMeta: false })).toBe("¥");
  });
});
