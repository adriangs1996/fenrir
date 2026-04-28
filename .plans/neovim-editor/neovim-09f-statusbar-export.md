---
depends_on:
  - neovim-09a-zustand-store
---

# Plan 09f: NeovimEditorStatusBar Component

## Goal

Status bar UI component (mode badge, title, cursor position, connection LED). Pure presentational — depends only on the zustand store types from 09a, not on the parent `NeovimEditor` component.

> **Dep-graph note**: this plan was previously paired with the module barrel (`index.ts`).
> The barrel was extracted into `neovim-09g-module-barrel.md` to break the
> circular dep between 09e (consumes `NeovimEditorStatusBar`) and 09f (was
> re-exporting `NeovimEditor` via the barrel). 09f now produces only the
> StatusBar component and runs **before** 09e; 09g produces the barrel and
> runs **after** 09e.

## Scope

- New file: `apps/web/src/modules/neovim-editor/components/NeovimEditorStatusBar.tsx`

## Steps

### Step 1. NeovimEditorStatusBar.tsx

```typescript
import { cn } from "~/lib/cn"; // adjust to whatever cn util the project uses
import type { NeovimConnectionStatus } from "../stores/neovimState";

interface NeovimEditorStatusBarProps {
  sessionStatus: NeovimConnectionStatus;
  modeName: string;
  cursorPosition: { row: number; col: number };
  title: string;
}

const MODE_COLORS: Record<string, string> = {
  normal: "bg-blue-600",
  insert: "bg-green-600",
  visual: "bg-purple-600",
  replace: "bg-red-600",
  command: "bg-yellow-600",
};

const STATUS_COLOR: Record<NeovimConnectionStatus, string> = {
  attached: "text-green-400",
  connecting: "text-yellow-400",
  error: "text-red-400",
  disconnected: "text-gray-500",
};

export function NeovimEditorStatusBar({
  sessionStatus,
  modeName,
  cursorPosition,
  title,
}: NeovimEditorStatusBarProps) {
  const modeColor = MODE_COLORS[modeName] ?? "bg-gray-600";

  return (
    <div className="flex h-6 items-center border-t border-gray-700 bg-gray-900 px-2 text-xs text-gray-300">
      <span className={cn("rounded px-1.5 py-0.5 font-bold uppercase text-white", modeColor)}>
        {modeName}
      </span>
      <span className="ml-2 truncate">{title}</span>
      <div className="flex-1" />
      <span className="mr-3">
        Ln {cursorPosition.row + 1}, Col {cursorPosition.col + 1}
      </span>
      <span className={STATUS_COLOR[sessionStatus]}>●</span>
    </div>
  );
}
```

If the project uses a different className util, swap `cn` accordingly. If no util exists, use template literals.

### Step 2. Public surface check

`NeovimEditor` (built in 09e) imports this file by relative path:

```typescript
import { NeovimEditorStatusBar } from "./NeovimEditorStatusBar";
```

No barrel re-export here — that lives in 09g.

## Validation

- `bun typecheck`
- `bun lint`
- `bun fmt`

## Done Criteria

- `NeovimEditorStatusBar` renders mode badge with color per mode
- Cursor position displayed 1-indexed (`Ln {row+1}, Col {col+1}`)
- Connection LED color reflects status
- File is self-contained — no import of `NeovimEditor` or the module `index.ts`
- No additional named exports leaked
