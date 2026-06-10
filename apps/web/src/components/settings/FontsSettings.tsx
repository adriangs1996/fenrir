import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@fenrir/contracts/settings";
import { FontPicker } from "./FontPicker";
import { useFonts } from "../../hooks/useFonts";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

export function FontsSettingsSection(props: {
  settings: UnifiedSettings;
  updateSettings: (patch: Partial<UnifiedSettings>) => void;
}) {
  const { settings, updateSettings } = props;
  const {
    fonts,
    isLoading: fontsLoading,
    isRefreshing: fontsRefreshing,
    refreshFonts,
  } = useFonts();

  return (
    <SettingsSection title="Fonts">
      <SettingsRow
        title="UI Font"
        description="Font family used across the application interface."
        resetAction={
          settings.uiFontFamily !== DEFAULT_UNIFIED_SETTINGS.uiFontFamily ? (
            <SettingResetButton
              label="UI font"
              onClick={() =>
                updateSettings({
                  uiFontFamily: DEFAULT_UNIFIED_SETTINGS.uiFontFamily,
                })
              }
            />
          ) : null
        }
        control={
          <FontPicker
            value={settings.uiFontFamily}
            onChange={(value) => updateSettings({ uiFontFamily: value })}
            fonts={fonts}
            isLoading={fontsLoading}
            isRefreshing={fontsRefreshing}
            onRefresh={refreshFonts}
          />
        }
      />

      <SettingsRow
        title="UI Font Size"
        description="Base font size for the application interface (10–24px)."
        resetAction={
          settings.uiFontSize !== DEFAULT_UNIFIED_SETTINGS.uiFontSize ? (
            <SettingResetButton
              label="UI font size"
              onClick={() =>
                updateSettings({
                  uiFontSize: DEFAULT_UNIFIED_SETTINGS.uiFontSize,
                })
              }
            />
          ) : null
        }
        control={
          <input
            type="number"
            min={10}
            max={24}
            step={1}
            value={settings.uiFontSize}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                updateSettings({ uiFontSize: Math.min(Math.max(val, 10), 24) });
              }
            }}
            className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
            aria-label="UI font size"
          />
        }
      />

      <SettingsRow
        title="Terminal Font"
        description="Font family used in the terminal emulator. Monospace fonts recommended."
        resetAction={
          settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily ? (
            <SettingResetButton
              label="terminal font"
              onClick={() =>
                updateSettings({
                  terminalFontFamily: DEFAULT_UNIFIED_SETTINGS.terminalFontFamily,
                })
              }
            />
          ) : null
        }
        control={
          <FontPicker
            value={settings.terminalFontFamily}
            onChange={(value) => updateSettings({ terminalFontFamily: value })}
            fonts={fonts}
            filterMonospace
            isLoading={fontsLoading}
            isRefreshing={fontsRefreshing}
            onRefresh={refreshFonts}
          />
        }
      />

      <SettingsRow
        title="Terminal Font Size"
        description="Font size for the terminal emulator (8–24px)."
        resetAction={
          settings.terminalFontSize !== DEFAULT_UNIFIED_SETTINGS.terminalFontSize ? (
            <SettingResetButton
              label="terminal font size"
              onClick={() =>
                updateSettings({
                  terminalFontSize: DEFAULT_UNIFIED_SETTINGS.terminalFontSize,
                })
              }
            />
          ) : null
        }
        control={
          <input
            type="number"
            min={8}
            max={24}
            step={1}
            value={settings.terminalFontSize}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                updateSettings({
                  terminalFontSize: Math.min(Math.max(val, 8), 24),
                });
              }
            }}
            className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
            aria-label="Terminal font size"
          />
        }
      />

      <SettingsRow
        title="Terminal Line Height"
        description="Line spacing multiplier for the terminal (1.0–2.0)."
        resetAction={
          settings.terminalLineHeight !== DEFAULT_UNIFIED_SETTINGS.terminalLineHeight ? (
            <SettingResetButton
              label="terminal line height"
              onClick={() =>
                updateSettings({
                  terminalLineHeight: DEFAULT_UNIFIED_SETTINGS.terminalLineHeight,
                })
              }
            />
          ) : null
        }
        control={
          <input
            type="number"
            min={1.0}
            max={2.0}
            step={0.1}
            value={settings.terminalLineHeight}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value);
              if (!Number.isNaN(val)) {
                updateSettings({
                  terminalLineHeight: Math.min(Math.max(val, 1.0), 2.0),
                });
              }
            }}
            className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
            aria-label="Terminal line height"
          />
        }
      />

      <SettingsRow
        title="Editor Font"
        description="Font family for the embedded editor. Nerd Font icons fall back automatically."
        resetAction={
          settings.editorFontFamily !== DEFAULT_UNIFIED_SETTINGS.editorFontFamily ? (
            <SettingResetButton
              label="editor font"
              onClick={() =>
                updateSettings({
                  editorFontFamily: DEFAULT_UNIFIED_SETTINGS.editorFontFamily,
                })
              }
            />
          ) : null
        }
        control={
          <FontPicker
            value={settings.editorFontFamily}
            onChange={(value) => updateSettings({ editorFontFamily: value })}
            fonts={fonts}
            filterMonospace
            isLoading={fontsLoading}
            isRefreshing={fontsRefreshing}
            onRefresh={refreshFonts}
          />
        }
      />

      <SettingsRow
        title="Editor Font Size"
        description="Font size for the embedded editor (8–32px)."
        resetAction={
          settings.editorFontSize !== DEFAULT_UNIFIED_SETTINGS.editorFontSize ? (
            <SettingResetButton
              label="editor font size"
              onClick={() =>
                updateSettings({
                  editorFontSize: DEFAULT_UNIFIED_SETTINGS.editorFontSize,
                })
              }
            />
          ) : null
        }
        control={
          <input
            type="number"
            min={8}
            max={32}
            step={1}
            value={settings.editorFontSize}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                updateSettings({
                  editorFontSize: Math.min(Math.max(val, 8), 32),
                });
              }
            }}
            className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
            aria-label="Editor font size"
          />
        }
      />

      <SettingsRow
        title="Editor Line Height"
        description="Line spacing multiplier for the editor (1.0–2.0)."
        resetAction={
          settings.editorLineHeight !== DEFAULT_UNIFIED_SETTINGS.editorLineHeight ? (
            <SettingResetButton
              label="editor line height"
              onClick={() =>
                updateSettings({
                  editorLineHeight: DEFAULT_UNIFIED_SETTINGS.editorLineHeight,
                })
              }
            />
          ) : null
        }
        control={
          <input
            type="number"
            min={1.0}
            max={2.0}
            step={0.1}
            value={settings.editorLineHeight}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value);
              if (!Number.isNaN(val)) {
                updateSettings({
                  editorLineHeight: Math.min(Math.max(val, 1.0), 2.0),
                });
              }
            }}
            className="w-20 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
            aria-label="Editor line height"
          />
        }
      />

      <SettingsRow
        title="Editor Font Weight"
        description="Font weight for the editor (100–900, in steps of 100)."
        resetAction={
          settings.editorFontWeight !== DEFAULT_UNIFIED_SETTINGS.editorFontWeight ? (
            <SettingResetButton
              label="editor font weight"
              onClick={() =>
                updateSettings({
                  editorFontWeight: DEFAULT_UNIFIED_SETTINGS.editorFontWeight,
                })
              }
            />
          ) : null
        }
        control={
          <select
            value={settings.editorFontWeight}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (!Number.isNaN(val)) {
                updateSettings({ editorFontWeight: val });
              }
            }}
            className="w-28 rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
            aria-label="Editor font weight"
          >
            {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        }
      />

      <SettingsRow
        title="Editor Ligatures"
        description="Render programming ligatures (e.g. =>, !=). Disable for fastest paint."
        resetAction={
          settings.editorLigatures !== DEFAULT_UNIFIED_SETTINGS.editorLigatures ? (
            <SettingResetButton
              label="editor ligatures"
              onClick={() =>
                updateSettings({
                  editorLigatures: DEFAULT_UNIFIED_SETTINGS.editorLigatures,
                })
              }
            />
          ) : null
        }
        control={
          <input
            type="checkbox"
            checked={settings.editorLigatures}
            onChange={(e) => updateSettings({ editorLigatures: e.target.checked })}
            aria-label="Editor ligatures"
          />
        }
      />
    </SettingsSection>
  );
}
