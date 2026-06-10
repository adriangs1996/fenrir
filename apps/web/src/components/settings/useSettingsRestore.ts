import { useCallback, useMemo } from "react";
import { DEFAULT_UNIFIED_SETTINGS } from "@fenrir/contracts/settings";
import { Duration, Equal } from "effect";
import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { runLocalRpc } from "../../hooks/useRpc";

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { resetSettings } = useUpdateSettings();

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const areProviderSettingsDirty =
    !Equal.equals(settings.providers, DEFAULT_UNIFIED_SETTINGS.providers) ||
    !Equal.equals(settings.providerInstances, DEFAULT_UNIFIED_SETTINGS.providerInstances);
  const areMcpSettingsDirty =
    !Equal.equals(settings.mcpServers, DEFAULT_UNIFIED_SETTINGS.mcpServers) ||
    !Equal.equals(settings.defaultMcpServerIds, DEFAULT_UNIFIED_SETTINGS.defaultMcpServerIds) ||
    !Equal.equals(
      settings.disabledBuiltInMcpServerIds,
      DEFAULT_UNIFIED_SETTINGS.disabledBuiltInMcpServerIds,
    );

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.embeddedEditor !== DEFAULT_UNIFIED_SETTINGS.embeddedEditor
        ? ["Embedded editor"]
        : []),
      ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
        ? ["Visible threads"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Hide whitespace changes"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(Duration.toMillis(settings.automaticGitFetchInterval) !==
      Duration.toMillis(DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval)
        ? ["Automatic Git fetch interval"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add-project base directory"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(areProviderSettingsDirty ? ["Providers"] : []),
      ...(areMcpSettingsDirty ? ["MCP servers"] : []),
      ...(settings.uiFontFamily !== DEFAULT_UNIFIED_SETTINGS.uiFontFamily ? ["UI Font"] : []),
      ...(settings.uiFontSize !== DEFAULT_UNIFIED_SETTINGS.uiFontSize ? ["UI Font Size"] : []),
      ...(settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily
        ? ["Terminal Font"]
        : []),
      ...(settings.terminalFontSize !== DEFAULT_UNIFIED_SETTINGS.terminalFontSize
        ? ["Terminal Font Size"]
        : []),
      ...(settings.terminalLineHeight !== DEFAULT_UNIFIED_SETTINGS.terminalLineHeight
        ? ["Terminal Line Height"]
        : []),
    ],
    [
      areProviderSettingsDirty,
      areMcpSettingsDirty,
      isGitWritingModelDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.defaultThreadEnvMode,
      settings.diffIgnoreWhitespace,
      settings.diffWordWrap,
      settings.enableAssistantStreaming,
      settings.automaticGitFetchInterval,
      settings.addProjectBaseDirectory,
      settings.sidebarThreadPreviewCount,
      settings.timestampFormat,
      settings.embeddedEditor,
      settings.uiFontFamily,
      settings.uiFontSize,
      settings.terminalFontFamily,
      settings.terminalFontSize,
      settings.terminalLineHeight,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const confirmed = await runLocalRpc((api) =>
      api.dialogs.confirm(
        ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
          "\n",
        ),
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetSettings();
    onRestored?.();
  }, [changedSettingLabels, onRestored, resetSettings, setTheme]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}
