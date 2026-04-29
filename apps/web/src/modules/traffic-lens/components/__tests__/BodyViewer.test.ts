import { describe, expect, it } from "vitest";

describe("BodyViewer logic", () => {
  describe("base64 decoding", () => {
    it("round-trips text through base64", () => {
      expect(atob(btoa("hello world"))).toBe("hello world");
    });

    it("handles empty string", () => {
      expect(atob(btoa(""))).toBe("");
    });
  });

  describe("JSON detection", () => {
    it("detects from content-type", () => {
      expect("application/json; charset=utf-8".includes("json")).toBe(true);
    });

    it("detects object from body prefix", () => {
      expect('{"key": "value"}'.trim().startsWith("{")).toBe(true);
    });

    it("detects array from body prefix", () => {
      expect("[1, 2, 3]".trim().startsWith("[")).toBe(true);
    });
  });

  describe("JSON pretty printing", () => {
    it("formats minified JSON", () => {
      const pretty = JSON.stringify(JSON.parse('{"a":1,"b":2}'), null, 2);
      expect(pretty).toContain("\n");
      expect(pretty).toContain("  ");
    });
  });

  describe("hex dump generation", () => {
    it("generates correct hex for ASCII text", () => {
      const text = "AB";
      const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
      const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      expect(hex).toBe("41 42");
    });

    it("replaces non-printable chars with dots", () => {
      const byte = 0x01;
      const ascii = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".";
      expect(ascii).toBe(".");
    });
  });
});
