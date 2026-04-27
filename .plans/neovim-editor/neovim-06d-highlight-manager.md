---
depends_on:
  - neovim-05b-redraw-types
---

# Plan 06d: HighlightManager

## Goal

Resolve highlight IDs into concrete CSS-ready styles. Caches resolved values, invalidates on definition change.

## Scope

- New file: `apps/web/src/modules/neovim-editor/renderer/HighlightManager.ts`

## Steps

### Step 1. Imports + type

```typescript
import type { HlAttr } from "../protocol/RedrawParser";

export interface ResolvedHighlight {
  fg: string;       // "#RRGGBB"
  bg: string;
  sp: string;       // special color (underline)
  bold: boolean;
  italic: boolean;
  underline: boolean;
  undercurl: boolean;
  underdouble: boolean;
  underdotted: boolean;
  underdashed: boolean;
  strikethrough: boolean;
  reverse: boolean;
  blend: number;    // 0..100
}
```

### Step 2. Class

```typescript
export class HighlightManager {
  private attrs = new Map<number, HlAttr>();
  private defaultFg = 0xffffff;
  private defaultBg = 0x000000;
  private defaultSp = 0xff0000;
  private resolvedCache = new Map<number, ResolvedHighlight>();

  setDefaultColors(fg: number, bg: number, sp: number): void {
    this.defaultFg = fg;
    this.defaultBg = bg;
    this.defaultSp = sp;
    this.resolvedCache.clear();
  }

  defineAttr(id: number, attr: HlAttr): void {
    this.attrs.set(id, attr);
    this.resolvedCache.delete(id);
  }

  resolve(hlId: number): ResolvedHighlight {
    const cached = this.resolvedCache.get(hlId);
    if (cached) return cached;

    const attr = this.attrs.get(hlId);
    let fg = attr?.foreground ?? this.defaultFg;
    let bg = attr?.background ?? this.defaultBg;
    const sp = attr?.special ?? this.defaultSp;

    if (attr?.reverse) {
      [fg, bg] = [bg, fg];
    }

    const resolved: ResolvedHighlight = {
      fg: rgbIntToCss(fg),
      bg: rgbIntToCss(bg),
      sp: rgbIntToCss(sp),
      bold: attr?.bold ?? false,
      italic: attr?.italic ?? false,
      underline: attr?.underline ?? false,
      undercurl: attr?.undercurl ?? false,
      underdouble: attr?.underdouble ?? false,
      underdotted: attr?.underdotted ?? false,
      underdashed: attr?.underdashed ?? false,
      strikethrough: attr?.strikethrough ?? false,
      reverse: false,
      blend: attr?.blend ?? 0,
    };

    this.resolvedCache.set(hlId, resolved);
    return resolved;
  }

  reset(): void {
    this.attrs.clear();
    this.resolvedCache.clear();
  }
}

function rgbIntToCss(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
```

### Step 3. Tests (HighlightManager.test.ts in 06e)

Defer to 06e.

## Validation

- `bun typecheck`

## Done Criteria

- `HighlightManager` class with `setDefaultColors`, `defineAttr`, `resolve`, `reset`
- `ResolvedHighlight` type exported
- Cache invalidates on default-color change (full clear)
- Cache invalidates on per-id redefine (single delete)
- `rgbIntToCss` zero-pads hex (`0xff0000` → `"#ff0000"`)
- `reverse` swaps fg/bg in resolved output and clears the flag
