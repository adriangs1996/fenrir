import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SystemFont } from "@fenrir/contracts";

const execAsync = promisify(exec);

// In-memory cache — fonts don't change during session
let cachedFonts: SystemFont[] | null = null;

const MONOSPACE_KEYWORDS = [
  "mono",
  "consolas",
  "courier",
  "menlo",
  "code",
  "terminal",
  "fixed",
  "nerd font",
  "nfm",
  "hack",
  "iosevka",
  "inconsolata",
  "source code",
  "droid sans mono",
  "liberation mono",
  "dejavu sans mono",
  "ubuntu mono",
  "roboto mono",
  "jetbrains",
  "sf mono",
  "cascadia",
  "anonymous pro",
  "pragmata",
];

const SERIF_KEYWORDS = [
  "times",
  "georgia",
  "garamond",
  "baskerville",
  "bodoni",
  "didot",
  "palatino",
  "cambria",
  "bookman",
  "century",
  "charter",
  "cochin",
  "hoefler",
  "caslon",
  "minion",
  "sabon",
  "serif",
];

const SANS_SERIF_KEYWORDS = [
  "arial",
  "helvetica",
  "verdana",
  "tahoma",
  "trebuchet",
  "segoe ui",
  "roboto",
  "open sans",
  "lato",
  "noto sans",
  "inter",
  "poppins",
  "montserrat",
  "raleway",
  "ubuntu",
  "nunito",
  "work sans",
  "source sans",
  "fira sans",
  "pt sans",
  "gill sans",
  "franklin gothic",
  "futura",
  "avenir",
  "proxima",
  "sf pro",
  "san francisco",
  "system-ui",
  "geist",
  "sans",
];

export function classifyFontByName(
  name: string,
): "monospace" | "sans-serif" | "serif" | "other" {
  const lower = name.toLowerCase();
  if (MONOSPACE_KEYWORDS.some((kw) => lower.includes(kw))) return "monospace";
  if (SERIF_KEYWORDS.some((kw) => lower.includes(kw))) return "serif";
  if (SANS_SERIF_KEYWORDS.some((kw) => lower.includes(kw))) return "sans-serif";
  return "other";
}

export function parseFcListOutput(output: string): SystemFont[] {
  const familyMap = new Map<string, SystemFont>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(":");
    // fc-list %{family} can return comma-separated aliases
    // e.g. "MonaspiceNe Nerd Font Mono,MonaspiceNe NFM"
    // Use only the first (canonical) name.
    const family = parts[0]?.split(",")[0]?.trim();
    if (!family) continue;

    if (familyMap.has(family)) continue;

    // fc-list spacing field: 100 = monospace, 0/90 = proportional
    const spacing = parts[2]?.trim();
    let category: SystemFont["category"];
    if (spacing === "100") {
      category = "monospace";
    } else {
      category = classifyFontByName(family);
    }

    familyMap.set(family, { family, category });
  }

  return Array.from(familyMap.values()).sort((a, b) =>
    a.family.localeCompare(b.family),
  );
}

function parsePowerShellOutput(output: string): SystemFont[] {
  const familyMap = new Map<string, SystemFont>();

  for (const line of output.split("\n")) {
    const family = line.trim();
    if (!family) continue;
    if (familyMap.has(family)) continue;
    familyMap.set(family, { family, category: classifyFontByName(family) });
  }

  return Array.from(familyMap.values()).sort((a, b) =>
    a.family.localeCompare(b.family),
  );
}

async function discoverFonts(): Promise<SystemFont[]> {
  const platform = process.platform;

  try {
    if (platform === "darwin" || platform === "linux") {
      try {
        const { stdout } = await execAsync(
          'fc-list --format="%{family}:%{style}:%{spacing}\\n"',
          { timeout: 10_000 },
        );
        return parseFcListOutput(stdout);
      } catch {
        if (platform === "darwin") {
          // Fallback: use system_profiler (slower but always available on macOS)
          const { stdout } = await execAsync(
            "system_profiler SPFontsDataType -json",
            { timeout: 15_000 },
          );
          const data = JSON.parse(stdout);
          const fonts = data?.SPFontsDataType ?? [];
          const familyMap = new Map<string, SystemFont>();
          for (const font of fonts) {
            const family = font._name ?? font.family;
            if (!family || familyMap.has(family)) continue;
            familyMap.set(family, {
              family,
              category: classifyFontByName(family),
            });
          }
          return Array.from(familyMap.values()).sort((a, b) =>
            a.family.localeCompare(b.family),
          );
        }
        return [];
      }
    }

    if (platform === "win32") {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }"',
        { timeout: 15_000 },
      );
      return parsePowerShellOutput(stdout);
    }

    return [];
  } catch {
    console.error("[fonts] Failed to enumerate system fonts");
    return [];
  }
}

export async function getSystemFonts(): Promise<SystemFont[]> {
  if (cachedFonts) return cachedFonts;
  cachedFonts = await discoverFonts();
  return cachedFonts;
}
