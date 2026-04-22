import { describe, expect, it } from "vitest";
import { parseFcListOutput, classifyFontByName } from "./fonts";

describe("parseFcListOutput", () => {
  it("parses fc-list colon-separated output", () => {
    const output = [
      "Fira Code:Regular:100",
      "Helvetica:Bold:0",
      "Times New Roman:Regular:0",
    ].join("\n");

    const result = parseFcListOutput(output);
    expect(result).toContainEqual({ family: "Fira Code", category: "monospace" });
    expect(result).toContainEqual({ family: "Helvetica", category: "sans-serif" });
    expect(result).toContainEqual({ family: "Times New Roman", category: "serif" });
  });

  it("deduplicates font families", () => {
    const output = [
      "Arial:Regular:0",
      "Arial:Bold:0",
      "Arial:Italic:0",
    ].join("\n");

    const result = parseFcListOutput(output);
    const arialEntries = result.filter((f) => f.family === "Arial");
    expect(arialEntries).toHaveLength(1);
  });

  it("sorts alphabetically by family name", () => {
    const output = ["Zebra:Regular:0", "Apple:Regular:100", "Mango:Regular:0"].join("\n");
    const result = parseFcListOutput(output);
    expect(result.map((f) => f.family)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("extracts first name from comma-separated fc-list family aliases", () => {
    const output = [
      "MonaspiceNe Nerd Font Mono,MonaspiceNe NFM:Regular:100",
      "MonaspiceNe Nerd Font,MonaspiceNe NF,MonaspiceNe NF Medium:Medium:100",
    ].join("\n");

    const result = parseFcListOutput(output);
    expect(result).toContainEqual({ family: "MonaspiceNe Nerd Font Mono", category: "monospace" });
    expect(result).toContainEqual({ family: "MonaspiceNe Nerd Font", category: "monospace" });
    // Alias names should NOT appear as separate entries
    expect(result.find((f) => f.family === "MonaspiceNe NFM")).toBeUndefined();
    expect(result.find((f) => f.family === "MonaspiceNe NF")).toBeUndefined();
  });

  it("handles empty output", () => {
    expect(parseFcListOutput("")).toEqual([]);
    expect(parseFcListOutput("\n\n")).toEqual([]);
  });
});

describe("classifyFontByName", () => {
  it("classifies known monospace font names", () => {
    expect(classifyFontByName("Courier New")).toBe("monospace");
    expect(classifyFontByName("Consolas")).toBe("monospace");
    expect(classifyFontByName("SF Mono")).toBe("monospace");
    expect(classifyFontByName("Fira Code")).toBe("monospace");
    expect(classifyFontByName("JetBrains Mono")).toBe("monospace");
  });

  it("classifies fonts with 'mono' in the name", () => {
    expect(classifyFontByName("SomethingMono")).toBe("monospace");
    expect(classifyFontByName("My Mono Font")).toBe("monospace");
  });

  it("classifies known serif font names", () => {
    expect(classifyFontByName("Times New Roman")).toBe("serif");
    expect(classifyFontByName("Georgia")).toBe("serif");
  });

  it("classifies known sans-serif font names", () => {
    expect(classifyFontByName("Arial")).toBe("sans-serif");
    expect(classifyFontByName("Helvetica")).toBe("sans-serif");
  });

  it("returns 'other' for unknown fonts", () => {
    expect(classifyFontByName("MyCustomFont")).toBe("other");
  });
});
