import { EditorId, type ResolvedKeybindingsConfig } from "@fenrir/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import {
  openInEmbeddedEditor,
  openInEmbeddedVSCode,
  usePreferredEditor,
} from "../../editorPreferences";
import { ChevronDownIcon, FolderClosedIcon, SquareTerminalIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  IntelliJIdeaIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import {
  useDesktopBridgeAvailable,
  useIsMainWindow,
  useNvimAvailable,
  useVSCodeWebAvailable,
} from "~/hooks/useDesktopBridge";

const resolveOptions = (
  platform: string,
  availableEditors: ReadonlyArray<EditorId>,
  bridgeAvailable: boolean,
  isMainWindow: boolean,
  nvimReady: boolean,
  vscodeReady: boolean,
) => {
  const baseOptions: ReadonlyArray<{ label: string; Icon: Icon; value: EditorId }> = [
    {
      label: "Cursor",
      Icon: CursorIcon,
      value: "cursor",
    },
    {
      label: "Trae",
      Icon: TraeIcon,
      value: "trae",
    },
    {
      label: "Kiro",
      Icon: KiroIcon,
      value: "kiro",
    },
    {
      label: "VS Code",
      Icon: VisualStudioCode,
      value: "vscode",
    },
    {
      label: "VS Code Insiders",
      Icon: VisualStudioCodeInsiders,
      value: "vscode-insiders",
    },
    {
      label: "VSCodium",
      Icon: VSCodium,
      value: "vscodium",
    },
    {
      label: "Zed",
      Icon: Zed,
      value: "zed",
    },
    {
      label: "Antigravity",
      Icon: AntigravityIcon,
      value: "antigravity",
    },
    {
      label: "IntelliJ IDEA",
      Icon: IntelliJIdeaIcon,
      value: "idea",
    },
    {
      label: isMacPlatform(platform)
        ? "Finder"
        : isWindowsPlatform(platform)
          ? "Explorer"
          : "Files",
      Icon: FolderClosedIcon,
      value: "file-manager",
    },
    {
      label: "Embedded Neovim",
      Icon: SquareTerminalIcon,
      value: "fenrir-embedded",
    },
    {
      label: "Embedded VS Code",
      Icon: VisualStudioCode,
      value: "fenrir-embedded-vscode",
    },
  ];
  return baseOptions.filter(
    (option) =>
      availableEditors.includes(option.value) &&
      (option.value !== "fenrir-embedded" || (bridgeAvailable && isMainWindow && nvimReady)) &&
      (option.value !== "fenrir-embedded-vscode" ||
        (bridgeAvailable && isMainWindow && vscodeReady)),
  );
};

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const bridgeAvailable = useDesktopBridgeAvailable();
  const isMain = useIsMainWindow();
  const nvimReady = useNvimAvailable();
  const vscodeReady = useVSCodeWebAvailable();
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const options = useMemo(
    () =>
      resolveOptions(
        navigator.platform,
        availableEditors,
        bridgeAvailable,
        isMain,
        nvimReady,
        vscodeReady,
      ),
    [availableEditors, bridgeAvailable, isMain, nvimReady, vscodeReady],
  );
  const primaryOption =
    options.find(({ value }) => value === preferredEditor) ?? options[0] ?? null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const editor = editorId ?? primaryOption?.value ?? null;
      if (!editor || !openInCwd) return;
      if (!options.some((option) => option.value === editor)) return;

      if (editor === "fenrir-embedded") {
        void openInEmbeddedEditor(openInCwd);
      } else if (editor === "fenrir-embedded-vscode") {
        void openInEmbeddedVSCode(openInCwd);
      } else {
        const api = readLocalApi();
        if (!api) return;
        void api.shell.openInEditor(openInCwd, editor);
      }
      setPreferredEditor(editor);
    },
    [openInCwd, options, primaryOption?.value, setPreferredEditor],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      const favoriteEditor =
        options.find(({ value }) => value === preferredEditor)?.value ??
        primaryOption?.value ??
        null;
      if (!openInCwd || !favoriteEditor) return;

      e.preventDefault();

      if (favoriteEditor === "fenrir-embedded") {
        void openInEmbeddedEditor(openInCwd);
        return;
      }

      if (favoriteEditor === "fenrir-embedded-vscode") {
        void openInEmbeddedVSCode(openInCwd);
        return;
      }

      const api = readLocalApi();
      if (!api) return;
      void api.shell.openInEditor(openInCwd, favoriteEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [keybindings, openInCwd, options, preferredEditor, primaryOption?.value]);

  return (
    <Group aria-label="Subscription actions">
      <Button
        size="xs"
        variant="outline"
        disabled={!primaryOption || !openInCwd}
        onClick={() => openInEditor(primaryOption?.value ?? null)}
      >
        {primaryOption?.Icon && <primaryOption.Icon aria-hidden="true" className="size-3.5" />}
        <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
          Open
        </span>
      </Button>
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu>
        <MenuTrigger render={<Button aria-label="Copy options" size="icon-xs" variant="outline" />}>
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {options.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
          {options.map(({ label, Icon, value }) => (
            <MenuItem key={value} onClick={() => openInEditor(value)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
              {value === preferredEditor && openFavoriteEditorShortcutLabel && (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              )}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
