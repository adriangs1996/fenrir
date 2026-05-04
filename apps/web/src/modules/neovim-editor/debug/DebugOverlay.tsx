import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { debugEnabled, getDebugStats, getSetterCount, moduleId } from "./debug";

const boxStyle: CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  zIndex: 9999,
  padding: 8,
  background: "rgba(20, 20, 30, 0.92)",
  color: "#cdd6f4",
  font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
  border: "1px solid #45475a",
  borderRadius: 4,
  maxWidth: 420,
  maxHeight: "85vh",
  overflow: "auto",
  pointerEvents: "auto",
  whiteSpace: "pre",
  lineHeight: 1.35,
};

const sectionStyle: CSSProperties = {
  marginTop: 6,
  paddingTop: 4,
  borderTop: "1px solid #313244",
  fontWeight: 700,
};

// Modes where keys go to the buffer/insert buffer as expected. Anything else
// is a "warning" mode that traps user input — cmdline_normal, cmdline_insert,
// terminal, op_pending, etc.
const SAFE_MODES = new Set(["normal", "insert", "visual", "visual_select", "replace", "vreplace"]);

export function DebugOverlay() {
  const [, setTick] = useState(0);
  const renderCountRef = useRef(0);
  const rafFiredRef = useRef(0);

  // rAF poll instead of subscribing — sidesteps any module-instance / strict-mode
  // listener churn. Overlay just re-reads live stats every frame while mounted.
  useEffect(() => {
    if (!debugEnabled()) return;
    console.log(`[nvim:overlay] mounted mod=${moduleId}`);
    let raf = 0;
    const tick = () => {
      rafFiredRef.current += 1;
      setTick((n) => (n + 1) & 0xffff);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      console.log(`[nvim:overlay] unmounted mod=${moduleId}`);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (!debugEnabled()) return null;
  renderCountRef.current += 1;
  const s = getDebugStats();

  const warnMode = s.modeName !== "" && !SAFE_MODES.has(s.modeName);
  // 750ms blink cadence, two-tone so it's always visible.
  const blinkOn = warnMode && Date.now() % 750 < 375;
  const headerStyle: CSSProperties = warnMode
    ? {
        fontWeight: 700,
        marginBottom: 4,
        background: blinkOn ? "#f38ba8" : "#fab387",
        color: "#11111b",
        padding: "4px 6px",
        borderRadius: 3,
      }
    : { fontWeight: 700, marginBottom: 4 };

  return (
    <div
      style={boxStyle}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div style={headerStyle}>
        {warnMode ? `⚠ MODE: ${s.modeName} — input not going to buffer!` : "nvim debug"}{" "}
        <span style={{ opacity: warnMode ? 0.85 : 0.6 }}>
          mod={moduleId} setters={getSetterCount()} renders={renderCountRef.current} raf=
          {rafFiredRef.current}
        </span>
      </div>
      <div>
        bridge={String(s.bridgePresent)} attached={String(s.attached)} focus=
        {String(s.containerFocused)}
      </div>
      {s.attachError ? <div style={{ color: "#f38ba8" }}>err: {s.attachError}</div> : null}
      <div>cwd: {s.cwd || "(none)"}</div>
      <div>
        dims {s.cols}×{s.rows} fg={s.defaultFg || "?"} bg={s.defaultBg || "?"}
      </div>
      <div>
        mode idx={s.activeModeIdx} name={s.modeName || "?"} shape={s.cursorShape || "?"} pct=
        {s.cellPercentage}
      </div>
      <div>
        cursor grid={s.cursorGrid} ({s.cursorRow}, {s.cursorCol})
      </div>
      {s.lastScroll ? (
        <div>
          scroll g={s.lastScroll.grid} top={s.lastScroll.top} bot={s.lastScroll.bot} L=
          {s.lastScroll.left} R={s.lastScroll.right} rows={s.lastScroll.rows}
        </div>
      ) : (
        <div>scroll: (none)</div>
      )}
      <div>
        canvas {s.canvasWidth}×{s.canvasHeight} resizes={s.canvasResizes} frames=
        {s.framesDrawn}
      </div>
      <div>
        last draw:{" "}
        {s.lastDrawAt ? `${((Date.now() - s.lastDrawAt) / 1000).toFixed(1)}s ago` : "(none)"}
      </div>

      <div style={sectionStyle}>grids ({s.grids.length})</div>
      {s.grids.length === 0 ? <div>(none)</div> : null}
      {s.grids.map((g) => (
        <div key={g.id}>
          #{g.id} {g.width}×{g.height} @({g.startRow},{g.startCol}) cur=
          {g.hasCursor ? "Y" : "N"} float={g.isFloat ? "Y" : "N"} hidden={g.hidden ? "Y" : "N"} zi=
          {g.zindex} ci={g.compindex}
        </div>
      ))}

      <div style={sectionStyle}>events (raw → parsed)</div>
      {(() => {
        const rawEvents = Object.entries(s.rawEventCounts);
        const allKeys = new Set<string>([
          ...Object.keys(s.eventCounts),
          ...Object.keys(s.rawEventCounts),
        ]);
        const rows = [...allKeys].toSorted((a, b) => a.localeCompare(b));
        if (rows.length === 0) return <div>(none)</div>;
        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              columnGap: 12,
            }}
          >
            <div style={{ display: "contents", opacity: 0.6 }}>
              <span>type</span>
              <span>raw</span>
              <span>parsed</span>
            </div>
            {rows.map((k) => {
              const raw = s.rawEventCounts[k] ?? 0;
              const parsed = s.eventCounts[k] ?? 0;
              const dropped = raw > 0 && parsed === 0;
              return (
                <div
                  key={k}
                  style={{ display: "contents", color: dropped ? "#f38ba8" : undefined }}
                >
                  <span>{k}</span>
                  <span>{raw}</span>
                  <span>{parsed}</span>
                </div>
              );
            })}
            {rawEvents.length === 0 ? <div style={{ gridColumn: "1/-1" }}>(no raw)</div> : null}
          </div>
        );
      })()}

      <div style={sectionStyle}>keys (newest first)</div>
      {s.keys.length === 0 ? <div>(none)</div> : null}
      {s.keys.map((k) => (
        <div
          key={`${k.ts}-${k.raw}-${k.translated}`}
          style={{ color: k.hadHandle ? "#a6e3a1" : "#f9e2af" }}
        >
          {JSON.stringify(k.raw)} → {JSON.stringify(k.translated)}
          {k.hadHandle ? "" : " (no handle!)"}
        </div>
      ))}

      <div style={sectionStyle}>tips</div>
      <div>set localStorage.nvimDebug=1 to persist</div>
      <div>
        last flush: {s.lastFlushAt ? new Date(s.lastFlushAt).toLocaleTimeString() : "(none)"}
      </div>
    </div>
  );
}
