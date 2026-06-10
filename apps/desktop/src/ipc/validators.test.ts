import { describe, expect, it } from "vitest";

import {
  ValidationError,
  optionalString,
  requireArray,
  requireBoolean,
  requireNonBlankString,
  requireNonEmptyString,
  requireNumber,
  requireObject,
  requireString,
} from "./validators";

describe("ValidationError", () => {
  it("formats the message as 'Invalid <name>.'", () => {
    const error = new ValidationError("threadId");
    expect(error.message).toBe("Invalid threadId.");
    expect(error.name).toBe("ValidationError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("requireString", () => {
  it("returns string values (including empty)", () => {
    expect(requireString("value", "hello")).toBe("hello");
    expect(requireString("value", "")).toBe("");
  });

  it("throws ValidationError for non-strings", () => {
    for (const value of [42, true, null, undefined, {}, []]) {
      expect(() => requireString("value", value)).toThrow(new ValidationError("value"));
    }
  });
});

describe("requireNonEmptyString", () => {
  it("returns non-empty strings (blank-but-non-empty allowed)", () => {
    expect(requireNonEmptyString("path", "/tmp")).toBe("/tmp");
    expect(requireNonEmptyString("path", " ")).toBe(" ");
  });

  it("throws for empty strings and non-strings", () => {
    expect(() => requireNonEmptyString("path", "")).toThrow("Invalid path.");
    expect(() => requireNonEmptyString("path", 7)).toThrow("Invalid path.");
    expect(() => requireNonEmptyString("path", undefined)).toThrow("Invalid path.");
  });
});

describe("requireNonBlankString", () => {
  it("returns strings with non-whitespace content", () => {
    expect(requireNonBlankString("title", " ok ")).toBe(" ok ");
  });

  it("throws for blank strings and non-strings", () => {
    expect(() => requireNonBlankString("title", "")).toThrow("Invalid title.");
    expect(() => requireNonBlankString("title", "   \t\n")).toThrow("Invalid title.");
    expect(() => requireNonBlankString("title", 0)).toThrow("Invalid title.");
  });
});

describe("requireNumber", () => {
  it("returns numbers (including NaN, which is typeof number)", () => {
    expect(requireNumber("port", 8080)).toBe(8080);
    expect(requireNumber("port", 0)).toBe(0);
    expect(Number.isNaN(requireNumber("port", Number.NaN))).toBe(true);
  });

  it("throws for non-numbers", () => {
    expect(() => requireNumber("port", "8080")).toThrow("Invalid port.");
    expect(() => requireNumber("port", null)).toThrow("Invalid port.");
    expect(() => requireNumber("port", true)).toThrow("Invalid port.");
  });
});

describe("requireBoolean", () => {
  it("returns booleans", () => {
    expect(requireBoolean("flag", true)).toBe(true);
    expect(requireBoolean("flag", false)).toBe(false);
  });

  it("throws for non-booleans", () => {
    expect(() => requireBoolean("flag", "true")).toThrow("Invalid flag.");
    expect(() => requireBoolean("flag", 1)).toThrow("Invalid flag.");
    expect(() => requireBoolean("flag", undefined)).toThrow("Invalid flag.");
  });
});

describe("requireObject", () => {
  it("returns objects (arrays are objects too)", () => {
    const value = { a: 1 };
    expect(requireObject("options", value)).toBe(value);
    const list = [1, 2];
    expect(requireObject("options", list)).toBe(list);
  });

  it("throws for null and non-objects", () => {
    expect(() => requireObject("options", null)).toThrow("Invalid options.");
    expect(() => requireObject("options", "obj")).toThrow("Invalid options.");
    expect(() => requireObject("options", 3)).toThrow("Invalid options.");
  });
});

describe("requireArray", () => {
  it("returns arrays", () => {
    const value = ["a", 1];
    expect(requireArray("items", value)).toBe(value);
    expect(requireArray("items", [])).toEqual([]);
  });

  it("throws for non-arrays (including array-likes and objects)", () => {
    expect(() => requireArray("items", { length: 0 })).toThrow("Invalid items.");
    expect(() => requireArray("items", "abc")).toThrow("Invalid items.");
    expect(() => requireArray("items", null)).toThrow("Invalid items.");
  });
});

describe("optionalString", () => {
  it("returns strings as-is", () => {
    expect(optionalString("value")).toBe("value");
    expect(optionalString("")).toBe("");
  });

  it("coerces non-strings to undefined instead of throwing", () => {
    expect(optionalString(42)).toBeUndefined();
    expect(optionalString(null)).toBeUndefined();
    expect(optionalString(undefined)).toBeUndefined();
    expect(optionalString({})).toBeUndefined();
  });
});
