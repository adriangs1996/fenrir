import { describe, expect, it } from "vitest";
import { DRACULA_PRO_SHIKI_THEMES } from "./draculaProShikiThemes";

function foregroundForScope(scopeName: string): string | undefined {
  const theme = DRACULA_PRO_SHIKI_THEMES["dracula-pro-van-helsing"];
  const tokenColor = theme.tokenColors.find((token) => {
    if (token.scope == null) return false;
    return Array.isArray(token.scope) ? token.scope.includes(scopeName) : token.scope === scopeName;
  });

  return tokenColor?.settings.foreground;
}

describe("Dracula Pro Shiki themes", () => {
  it("maps core TypeScript scopes to the Neovim Dracula Pro syntax roles", () => {
    expect(foregroundForScope("keyword")).toBe("#FF80BF");
    expect(foregroundForScope("entity.name.function")).toBe("#8AFF80");
    expect(foregroundForScope("entity.name.type.interface")).toBe("#AA99FF");
    expect(foregroundForScope("support.type")).toBe("#80FFEA");
    expect(foregroundForScope("string")).toBe("#FFFF80");
    expect(foregroundForScope("variable.object.property")).toBe("#FFCA80");
  });
});
