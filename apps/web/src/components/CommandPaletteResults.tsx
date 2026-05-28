import { type ResolvedKeybindingsConfig } from "@fenrir/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import { cn } from "~/lib/utils";

interface CommandPaletteResultsProps {
  shortcutContext?: {
    readonly reviewFocus?: boolean;
    readonly terminalFocus?: boolean;
    readonly terminalOpen?: boolean;
  };
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  const resultsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!props.highlightedItemValue || !resultsRef.current) {
      return;
    }

    const highlightedItem = resultsRef.current.querySelector<HTMLElement>(
      `[data-command-palette-item-value="${CSS.escape(props.highlightedItemValue)}"]`,
    );
    highlightedItem?.scrollIntoView({ block: "nearest" });
  }, [props.highlightedItemValue]);

  if (props.groups.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {props.emptyStateMessage ??
          (props.isActionsOnly
            ? "No matching actions."
            : "No matching commands, projects, or threads.")}
      </div>
    );
  }

  return (
    <div ref={resultsRef} className="min-h-0 flex-1" data-command-palette-results="true">
      <CommandList>
        {props.groups.map((group) => (
          <CommandGroup items={group.items} key={group.value}>
            <CommandGroupLabel>{group.label}</CommandGroupLabel>
            <CommandCollection>
              {(item) =>
                item.disabled ? (
                  <DisabledCommandPaletteResultRow item={item} key={item.value} />
                ) : (
                  <CommandPaletteResultRow
                    item={item}
                    isActive={props.highlightedItemValue === item.value}
                    key={item.value}
                    keybindings={props.keybindings}
                    shortcutContext={props.shortcutContext}
                    onExecuteItem={props.onExecuteItem}
                  />
                )
              }
            </CommandCollection>
          </CommandGroup>
        ))}
      </CommandList>
    </div>
  );
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div className="flex min-h-8 select-none items-center gap-2 rounded-sm px-2 py-1.5 text-base opacity-64 sm:min-h-7 sm:text-sm">
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          <span className="truncate text-muted-foreground/70 text-xs">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  shortcutContext?: CommandPaletteResultsProps["shortcutContext"];
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(
        props.keybindings,
        props.item.shortcutCommand,
        props.shortcutContext ? { context: props.shortcutContext } : undefined,
      )
    : null;

  return (
    <CommandItem
      value={props.item.value}
      data-command-palette-active={props.isActive ? "true" : undefined}
      data-command-palette-item-value={props.item.value}
      className={cn(
        "cursor-pointer gap-2 transition-colors",
        props.isActive && "bg-foreground/8 ring-1 ring-foreground/10",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-sm text-foreground",
              props.isActive && "text-accent-foreground",
            )}
          >
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          <span
            className={cn(
              "truncate text-muted-foreground/70 text-xs",
              props.isActive && "text-accent-foreground/75",
            )}
          >
            {props.item.description}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm text-foreground",
            props.isActive && "text-accent-foreground",
          )}
        >
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
      {props.item.timestamp ? (
        <span
          className={cn(
            "min-w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70",
            props.isActive && "text-accent-foreground/70",
          )}
        >
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground/50" />
      ) : null}
    </CommandItem>
  );
}
