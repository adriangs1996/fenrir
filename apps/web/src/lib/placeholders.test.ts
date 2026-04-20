import { describe, expect, test } from "vitest";
import { parsePlaceholders, substitutePlaceholders } from "./placeholders";

describe("parsePlaceholders", () => {
  test("extracts unique placeholder names", () => {
    expect(parsePlaceholders("nmap {{target}} -p {{ports}}")).toEqual(["target", "ports"]);
  });

  test("deduplicates repeated placeholders", () => {
    expect(parsePlaceholders("nmap {{target}} -oN {{target}}.txt")).toEqual(["target"]);
  });

  test("returns empty array when no placeholders", () => {
    expect(parsePlaceholders("ls -la")).toEqual([]);
  });

  test("handles adjacent placeholders", () => {
    expect(parsePlaceholders("{{a}}{{b}}")).toEqual(["a", "b"]);
  });

  test("only matches word characters in placeholder names", () => {
    expect(parsePlaceholders("{{valid}} {{in valid}} {{also_valid}}")).toEqual([
      "valid",
      "also_valid",
    ]);
  });
});

describe("substitutePlaceholders", () => {
  test("replaces all occurrences", () => {
    expect(
      substitutePlaceholders("nmap {{target}} -oN {{target}}.txt", { target: "10.10.11.42" }),
    ).toBe("nmap 10.10.11.42 -oN 10.10.11.42.txt");
  });

  test("replaces multiple different placeholders", () => {
    expect(
      substitutePlaceholders("nmap {{target}} -p {{ports}}", {
        target: "10.10.11.42",
        ports: "1-1000",
      }),
    ).toBe("nmap 10.10.11.42 -p 1-1000");
  });

  test("leaves unmatched placeholders untouched", () => {
    expect(substitutePlaceholders("nmap {{target}} -p {{ports}}", { target: "10.10.11.42" })).toBe(
      "nmap 10.10.11.42 -p {{ports}}",
    );
  });

  test("returns original when no placeholders", () => {
    expect(substitutePlaceholders("ls -la", {})).toBe("ls -la");
  });
});
