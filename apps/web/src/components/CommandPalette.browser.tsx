import "../index.css";

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  getCommandPaletteItemValue,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { Command, CommandInput, CommandPanel } from "./ui/command";

function createItem(value: string, title = value): CommandPaletteActionItem {
  return {
    kind: "action",
    value,
    searchTerms: [title],
    title,
    icon: <span aria-hidden="true" className="size-4 shrink-0" />,
    run: async () => undefined,
  };
}

function TestCommandPalette(props: { groups: ReadonlyArray<CommandPaletteGroup> }) {
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);

  return (
    <div className="w-96 rounded-xl border bg-popover p-2">
      <Command
        autoHighlight="always"
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(getCommandPaletteItemValue(value));
        }}
        onValueChange={setQuery}
        value={query}
      >
        <div className="flex h-40 min-h-0 flex-col">
          <CommandInput placeholder="Search palette..." />
          <CommandPanel className="flex min-h-0 flex-1">
            <CommandPaletteResults
              groups={props.groups}
              highlightedItemValue={highlightedItemValue}
              isActionsOnly={false}
              keybindings={[]}
              onExecuteItem={() => undefined}
            />
          </CommandPanel>
        </div>
      </Command>
    </div>
  );
}

async function pressPaletteKey(key: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Search palette..."]');
  expect(input).toBeTruthy();
  input!.focus();
  input!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function getActivePaletteItem(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-command-palette-active="true"]');
}

function getInactivePaletteItem(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-command-palette-item-value]:not([data-command-palette-active="true"])',
  );
}

describe("CommandPalette", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("highlights the active item and moves it with arrow keys", async () => {
    await render(
      <TestCommandPalette
        groups={[
          {
            value: "actions",
            label: "Actions",
            items: [createItem("first"), createItem("second"), createItem("third")],
          },
        ]}
      />,
    );

    await vi.waitFor(() => {
      const activeItem = getActivePaletteItem();
      const inactiveItem = getInactivePaletteItem();
      expect(activeItem?.getAttribute("data-command-palette-item-value")).toBe("first");
      expect(inactiveItem).toBeTruthy();
      expect(getComputedStyle(activeItem!).backgroundColor).not.toBe(
        getComputedStyle(inactiveItem!).backgroundColor,
      );
    });

    await pressPaletteKey("ArrowDown");

    await vi.waitFor(() => {
      const activeItem = getActivePaletteItem();
      const inactiveItem = getInactivePaletteItem();
      expect(activeItem?.getAttribute("data-command-palette-item-value")).toBe("second");
      expect(inactiveItem).toBeTruthy();
      expect(getComputedStyle(activeItem!).backgroundColor).not.toBe(
        getComputedStyle(inactiveItem!).backgroundColor,
      );
    });

    await pressPaletteKey("ArrowUp");

    await vi.waitFor(() => {
      const activeItem = getActivePaletteItem();
      const inactiveItem = getInactivePaletteItem();
      expect(activeItem?.getAttribute("data-command-palette-item-value")).toBe("first");
      expect(inactiveItem).toBeTruthy();
      expect(getComputedStyle(activeItem!).backgroundColor).not.toBe(
        getComputedStyle(inactiveItem!).backgroundColor,
      );
    });
  });

  it("scrolls the active item into view during keyboard navigation", async () => {
    const groups: CommandPaletteGroup[] = [
      {
        value: "threads",
        label: "Threads",
        items: Array.from({ length: 24 }, (_, index) =>
          createItem(`thread-${index + 1}`, `Thread ${index + 1}`),
        ),
      },
    ];

    await render(<TestCommandPalette groups={groups} />);

    for (let index = 0; index < 18; index += 1) {
      await pressPaletteKey("ArrowDown");
    }

    await vi.waitFor(() => {
      const viewport = document.querySelector<HTMLElement>(
        '[data-command-palette-results="true"] [data-slot="scroll-area-viewport"]',
      );
      expect(viewport).toBeTruthy();
      expect(viewport?.scrollTop ?? 0).toBeGreaterThan(0);
      expect(getActivePaletteItem()?.getAttribute("data-command-palette-item-value")).toBe(
        "thread-19",
      );
    });
  });
});
