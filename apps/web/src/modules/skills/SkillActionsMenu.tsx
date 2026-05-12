import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react";
import type { ServerProviderSkill } from "@fenrir/contracts";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";

interface SkillActionsMenuProps {
  skill: ServerProviderSkill;
  onInspect?: () => void;
  onEditMetadata?: () => void;
  onOpenCanonicalFile?: () => void;
  onToggleEnabled?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}

export function SkillActionsMenu({
  skill,
  onInspect,
  onEditMetadata,
  onOpenCanonicalFile,
  onToggleEnabled,
  onDelete,
  disabled = false,
}: SkillActionsMenuProps) {
  const hasPrimaryActions = onInspect || onEditMetadata || onOpenCanonicalFile || onToggleEnabled;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Actions for /${skill.name}`}
            disabled={disabled}
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {onInspect ? <MenuItem onClick={onInspect}>Inspect</MenuItem> : null}
        {onEditMetadata ? (
          <MenuItem onClick={onEditMetadata}>
            <PencilIcon className="size-3.5" />
            Edit metadata
          </MenuItem>
        ) : null}
        {onOpenCanonicalFile ? (
          <MenuItem onClick={onOpenCanonicalFile}>Open skill.md</MenuItem>
        ) : null}
        {onToggleEnabled ? (
          <MenuItem onClick={onToggleEnabled}>
            {skill.enabled ? "Disable skill" : "Enable skill"}
          </MenuItem>
        ) : null}
        {hasPrimaryActions && onDelete ? <MenuSeparator /> : null}
        {onDelete ? (
          <MenuItem onClick={onDelete} variant="destructive">
            <Trash2Icon className="size-3.5" />
            Delete
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
