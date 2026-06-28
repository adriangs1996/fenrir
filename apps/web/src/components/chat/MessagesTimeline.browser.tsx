import "../../index.css";

import { EnvironmentId } from "@fenrir/contracts";
import { createRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const scrollToEndSpy = vi.fn();
const getStateSpy = vi.fn(() => ({ isAtEnd: true }));

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  function LegendList(props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    getItemType?: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    onItemSizeChanged?: (info: {
      itemData: { id: string };
      itemKey: string;
      index: number;
      previous: number;
      size: number;
    }) => void;
    maintainScrollAtEnd?: boolean;
    maintainVisibleContentPosition?: boolean | { data?: boolean; size?: boolean };
    ref?: React.Ref<LegendListRef>;
  }) {
    React.useImperativeHandle(
      props.ref,
      () =>
        ({
          scrollToEnd: scrollToEndSpy,
          scrollToIndex: vi.fn(),
          scrollToOffset: vi.fn(),
          getState: getStateSpy,
        }) as unknown as LegendListRef,
    );

    React.useEffect(() => {
      props.data.forEach((item, index) => {
        props.onItemSizeChanged?.({
          itemData: item,
          itemKey: props.keyExtractor(item),
          index,
          previous: 80,
          size: 120 + index,
        });
      });
    }, [props]);

    return (
      <div
        data-testid="legend-list"
        data-maintain-scroll-at-end={props.maintainScrollAtEnd}
        data-maintain-visible-content-position={
          typeof props.maintainVisibleContentPosition === "object"
            ? "object"
            : props.maintainVisibleContentPosition
        }
        data-maintain-visible-content-position-data={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.data
            : undefined
        }
        data-maintain-visible-content-position-size={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.size
            : undefined
        }
      >
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  }

  return { LegendList };
});

import { MessagesTimeline } from "./MessagesTimeline";

const MESSAGE_CREATED_AT = "2026-04-13T12:00:00.000Z";

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnId: null,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: vi.fn(),
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: vi.fn(),
    isRevertingCheckpoint: false,
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    timestampFormat: "24-hour" as const,
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: vi.fn(),
    onAnchorSizeChanged: vi.fn(),
    onTimelineContentChanged: vi.fn(),
    onIsAtEndChange: vi.fn(),
  };
}

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: "message-1" as never,
      role: "user" as const,
      text,
      createdAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

function buildAssistantTimelineEntry(text: string, streaming = true) {
  return {
    id: "entry-assistant",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: "message-assistant" as never,
      role: "assistant" as const,
      text,
      createdAt: MESSAGE_CREATED_AT,
      streaming,
    },
  };
}

describe("MessagesTimeline", () => {
  afterEach(() => {
    scrollToEndSpy.mockReset();
    getStateSpy.mockClear();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows instead of the empty placeholder when a thread has non-message timeline data", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Thinking")).toBeVisible();
      await expect.element(page.getByText("Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const props = buildProps();
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[]} />);

    try {
      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
        />,
      );

      expect(requestAnimationFrameSpy).toHaveBeenCalled();
      expect(scrollToEndSpy).toHaveBeenCalledWith({ animated: false });
      expect(props.onIsAtEndChange).toHaveBeenCalledWith(true);
    } finally {
      await screen.unmount();
    }
  });

  it("reports anchor readiness and measured size for an optimistic sent message", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const props = buildProps();
    const sentEntry = buildUserTimelineEntry("Newest prompt.");
    const screen = await render(
      <MessagesTimeline
        {...props}
        anchorMessageId={sentEntry.message.id}
        timelineEntries={[sentEntry]}
      />,
    );

    try {
      expect(requestAnimationFrameSpy).toHaveBeenCalled();
      expect(props.onAnchorReady).toHaveBeenCalledWith(sentEntry.message.id, 0);
      expect(props.onAnchorSizeChanged).toHaveBeenCalledWith(sentEntry.message.id, 120);
      expect(props.onTimelineContentChanged).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("reports streamed row growth as timeline content changes", async () => {
    const props = buildProps();
    const screen = await render(
      <MessagesTimeline {...props} timelineEntries={[buildAssistantTimelineEntry("Streaming")]} />,
    );

    try {
      const initialChangeCount = props.onTimelineContentChanged.mock.calls.length;
      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            buildAssistantTimelineEntry(`Streaming\n\n${"More markdown content. ".repeat(12)}`),
          ]}
        />,
      );

      expect(props.onTimelineContentChanged.mock.calls.length).toBeGreaterThan(initialChangeCount);
      expect(props.onAnchorSizeChanged).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("does not treat late sizing on non-anchor rows as anchor resizing", async () => {
    const props = buildProps();
    const userEntry = buildUserTimelineEntry("Prompt");
    const assistantEntry = buildAssistantTimelineEntry("Late image markdown", false);
    const screen = await render(
      <MessagesTimeline
        {...props}
        anchorMessageId={userEntry.message.id}
        timelineEntries={[userEntry, assistantEntry]}
      />,
    );

    try {
      expect(props.onAnchorSizeChanged).toHaveBeenCalledWith(userEntry.message.id, 120);
      expect(props.onAnchorSizeChanged).not.toHaveBeenCalledWith(assistantEntry.message.id, 121);
      expect(props.onTimelineContentChanged).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});
