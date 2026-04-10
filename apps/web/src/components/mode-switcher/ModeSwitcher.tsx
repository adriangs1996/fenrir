import { MonitorIcon, ShieldIcon } from "lucide-react";
import { memo, useCallback } from "react";
import type { AppMode } from "@t3tools/contracts";

import { useModeStore } from "../../modeStore";

const MODES: ReadonlyArray<{ value: AppMode; label: string; Icon: typeof MonitorIcon }> = [
  { value: "code", label: "Code", Icon: MonitorIcon },
  { value: "pentest", label: "Pentest", Icon: ShieldIcon },
];

/**
 * Top-bar tab switcher for toggling between Code and Pentest modes.
 *
 * Integration point: add this component inside the sidebar header or the
 * main top bar, adjacent to existing navigation controls. Suggested location
 * is inside `AppSidebarLayout` or the `ThreadSidebar` header area in
 * `apps/web/src/components/Sidebar.tsx`.
 */
export const ModeSwitcher = memo(function ModeSwitcher() {
  const activeMode = useModeStore((state) => state.activeMode);
  const switchMode = useModeStore((state) => state.switchMode);

  const handleClick = useCallback(
    (mode: AppMode) => {
      switchMode(mode);
    },
    [switchMode],
  );

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
      {MODES.map(({ value, label, Icon }) => {
        const isActive = activeMode === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Switch to ${label} mode`}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleClick(value)}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
});
