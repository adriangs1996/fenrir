import { describe, expect, it } from "vitest";
import {
  classifyFontByName,
  isSystemFontsCacheFresh,
  parseFcListOutput,
  parsePowerShellOutput,
  parseSystemProfilerOutput,
  SYSTEM_FONTS_COMMAND_MAX_BUFFER_BYTES,
} from "./fonts";

describe("parseFcListOutput", () => {
  it("parses fc-list colon-separated output", () => {
    const output = ["Fira Code:Regular:100", "Helvetica:Bold:0", "Times New Roman:Regular:0"].join(
      "\n",
    );

    const result = parseFcListOutput(output);
    expect(result).toContainEqual({ family: "Fira Code", category: "monospace" });
    expect(result).toContainEqual({ family: "Helvetica", category: "sans-serif" });
    expect(result).toContainEqual({ family: "Times New Roman", category: "serif" });
  });

  it("deduplicates font families", () => {
    const output = ["Arial:Regular:0", "Arial:Bold:0", "Arial:Italic:0"].join("\n");

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

describe("parsePowerShellOutput", () => {
  it("parses distinct family names from powershell output", () => {
    const output = ["Consolas", "Arial", "Consolas", "", "Times New Roman"].join("\n");

    expect(parsePowerShellOutput(output)).toEqual([
      { family: "Arial", category: "sans-serif" },
      { family: "Consolas", category: "monospace" },
      { family: "Times New Roman", category: "serif" },
    ]);
  });
});

describe("parseSystemProfilerOutput", () => {
  it("prefers canonical typeface family names over file names", () => {
    const output = JSON.stringify({
      SPFontsDataType: [
        {
          _name: "CommitMonodev-500-Regular.otf",
          typefaces: [
            {
              _name: "CommitMonodev-Regular",
              family: "CommitMonodev",
            },
          ],
        },
      ],
    });

    expect(parseSystemProfilerOutput(output)).toEqual([
      { family: "CommitMonodev", category: "monospace" },
    ]);
  });

  it("deduplicates repeated families across multiple font files", () => {
    const output = JSON.stringify({
      SPFontsDataType: [
        {
          _name: "CommitMonodev-500-Regular.otf",
          typefaces: [
            {
              family: "CommitMonodev",
            },
          ],
        },
        {
          _name: "CommitMonodev-700-Regular.otf",
          typefaces: [
            {
              family: "CommitMonodev",
            },
          ],
        },
      ],
    });

    expect(parseSystemProfilerOutput(output)).toEqual([
      { family: "CommitMonodev", category: "monospace" },
    ]);
  });
});

describe("font command execution", () => {
  it("allows native macOS font profiler output larger than Node's exec default", () => {
    expect(SYSTEM_FONTS_COMMAND_MAX_BUFFER_BYTES).toBeGreaterThan(1024 * 1024);
  });
});

describe("isSystemFontsCacheFresh", () => {
  it("treats recent cache entries as fresh", () => {
    expect(
      isSystemFontsCacheFresh(
        {
          fonts: [],
          fetchedAt: 1_000,
        },
        10_999,
      ),
    ).toBe(true);
  });

  it("expires cache entries once they reach the ttl boundary", () => {
    expect(
      isSystemFontsCacheFresh(
        {
          fonts: [],
          fetchedAt: 1_000,
        },
        11_000,
      ),
    ).toBe(false);
  });

  it("treats a missing cache entry as stale", () => {
    expect(isSystemFontsCacheFresh(null, 5_000)).toBe(false);
  });
});
