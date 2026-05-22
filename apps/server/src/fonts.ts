import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SystemFont } from "@fenrir/contracts";

const execAsync = promisify(exec);

const SYSTEM_FONTS_CACHE_TTL_MS = 10_000;

type SystemFontsCacheEntry = {
  readonly fonts: SystemFont[];
  readonly fetchedAt: number;
};

type GetSystemFontsOptions = {
  readonly refresh?: boolean;
};

let cachedFonts: SystemFontsCacheEntry | null = null;
let inFlightFontsPromise: Promise<SystemFont[]> | null = null;

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

export function classifyFontByName(name: string): "monospace" | "sans-serif" | "serif" | "other" {
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

  return Array.from(familyMap.values()).toSorted((a, b) => a.family.localeCompare(b.family));
}

export function parsePowerShellOutput(output: string): SystemFont[] {
  const familyMap = new Map<string, SystemFont>();

  for (const line of output.split("\n")) {
    const family = line.trim();
    if (!family) continue;
    if (familyMap.has(family)) continue;
    familyMap.set(family, { family, category: classifyFontByName(family) });
  }

  return Array.from(familyMap.values()).toSorted((a, b) => a.family.localeCompare(b.family));
}

export function parseSystemProfilerOutput(output: string): SystemFont[] {
  const data = JSON.parse(output);
  const fonts = data?.SPFontsDataType ?? [];
  const familyMap = new Map<string, SystemFont>();

  for (const font of fonts) {
    const typefaces = Array.isArray(font?.typefaces) ? font.typefaces : [];

    for (const typeface of typefaces) {
      const family = typeof typeface?.family === "string" ? typeface.family.trim() : "";
      if (!family || familyMap.has(family)) continue;
      familyMap.set(family, {
        family,
        category: classifyFontByName(family),
      });
    }

    const fallbackFamily = typeof font?.family === "string" ? font.family.trim() : "";
    if (!fallbackFamily || familyMap.has(fallbackFamily)) continue;
    familyMap.set(fallbackFamily, {
      family: fallbackFamily,
      category: classifyFontByName(fallbackFamily),
    });
  }

  return Array.from(familyMap.values()).toSorted((a, b) => a.family.localeCompare(b.family));
}

export function isSystemFontsCacheFresh(
  cacheEntry: SystemFontsCacheEntry | null,
  now = Date.now(),
): boolean {
  return cacheEntry !== null && now - cacheEntry.fetchedAt < SYSTEM_FONTS_CACHE_TTL_MS;
}

async function discoverFonts(): Promise<SystemFont[]> {
  const platform = process.platform;

  try {
    if (platform === "darwin" || platform === "linux") {
      try {
        const { stdout } = await execAsync('fc-list --format="%{family}:%{style}:%{spacing}\\n"', {
          timeout: 10_000,
        });
        return parseFcListOutput(stdout);
      } catch {
        if (platform === "darwin") {
          // Fallback: use system_profiler (slower but always available on macOS)
          const { stdout } = await execAsync("system_profiler SPFontsDataType -json", {
            timeout: 15_000,
          });
          return parseSystemProfilerOutput(stdout);
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

export async function getSystemFonts(options?: GetSystemFontsOptions): Promise<SystemFont[]> {
  if (options?.refresh) {
    clearSystemFontsCache();
  }

  const cacheEntry = cachedFonts;
  if (cacheEntry !== null && isSystemFontsCacheFresh(cacheEntry)) {
    return cacheEntry.fonts;
  }

  if (inFlightFontsPromise) {
    return inFlightFontsPromise;
  }

  inFlightFontsPromise = discoverFonts()
    .then((fonts) => {
      cachedFonts = {
        fonts,
        fetchedAt: Date.now(),
      };
      return fonts;
    })
    .finally(() => {
      inFlightFontsPromise = null;
    });

  return inFlightFontsPromise;
}

export function clearSystemFontsCache(): void {
  cachedFonts = null;
  inFlightFontsPromise = null;
}

export const clearSystemFontsCacheForTests = clearSystemFontsCache;
