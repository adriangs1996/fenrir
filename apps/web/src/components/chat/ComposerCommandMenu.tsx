import { type ProjectEntry, type ProviderSelectionKind, type SkillIcon } from "@fenrir/contracts";
import { memo, useLayoutEffect, useRef } from "react";
import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import {
  BotIcon,
  BugIcon,
  Code2Icon,
  FileTextIcon,
  FlameIcon,
  FlaskConicalIcon,
  MessageCircleIcon,
  PenToolIcon,
  RocketIcon,
  SearchIcon,
  ShieldIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../ui/command";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

const SKILL_ICON_MAP: Record<SkillIcon, React.ComponentType<{ className?: string }>> = {
  default: BotIcon,
  flame: FlameIcon,
  search: SearchIcon,
  code: Code2Icon,
  bug: BugIcon,
  test: FlaskConicalIcon,
  docs: FileTextIcon,
  security: ShieldIcon,
  deploy: RocketIcon,
  design: PenToolIcon,
  chat: MessageCircleIcon,
};

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderSelectionKind;
      model: string;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      name: string;
      displayName: string;
      description: string;
      icon?: SkillIcon;
    };

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  const builtInItems = props.items.filter(
    (i) => i.type === "slash-command" || i.type === "model" || i.type === "path",
  );
  const skillItems = props.items.filter((i) => i.type === "skill");
  const hasSkills = skillItems.length > 0;
  const hasBuiltIns = builtInItems.length > 0;

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div
        ref={listRef}
        className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs"
      >
        <CommandList className="max-h-64">
          {hasBuiltIns && (
            <CommandGroup>
              {builtInItems.map((item) => (
                <ComposerCommandMenuItem
                  key={item.id}
                  item={item}
                  resolvedTheme={props.resolvedTheme}
                  isActive={props.activeItemId === item.id}
                  onHighlight={props.onHighlightedItemChange}
                  onSelect={props.onSelect}
                />
              ))}
            </CommandGroup>
          )}
          {hasSkills && (
            <>
              {hasBuiltIns && <CommandSeparator />}
              <CommandGroup>
                <CommandGroupLabel className="px-3 py-1 text-muted-foreground/60 text-xs font-medium">
                  Skills
                </CommandGroupLabel>
                {skillItems.map((item) => (
                  <ComposerCommandMenuItem
                    key={item.id}
                    item={item}
                    resolvedTheme={props.resolvedTheme}
                    isActive={props.activeItemId === item.id}
                    onHighlight={props.onHighlightedItemChange}
                    onSelect={props.onSelect}
                  />
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground/70 text-xs">
            {props.isLoading
              ? "Searching workspace files..."
              : props.triggerKind === "path"
                ? "No matching files or folders."
                : props.triggerKind === "skill"
                  ? "No matching skills."
                  : "No matching command."}
          </p>
        )}
      </div>
    </Command>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      className={cn(
        "cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
        props.isActive && "bg-accent! text-accent-foreground!",
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <BotIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "model" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          model
        </Badge>
      ) : null}
      {props.item.type === "skill"
        ? (() => {
            const SkillIconComponent = SKILL_ICON_MAP[props.item.icon ?? "default"];
            return <SkillIconComponent className="size-4 shrink-0 text-muted-foreground/80" />;
          })()
        : null}
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">
          {props.item.type === "skill" ? props.item.displayName : props.item.label}
        </span>
      </span>
      <span className="truncate text-muted-foreground/70 text-xs">{props.item.description}</span>
    </CommandItem>
  );
});
