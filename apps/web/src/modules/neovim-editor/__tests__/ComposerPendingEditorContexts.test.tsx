import { ThreadId } from "@fenrir/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerPendingEditorContextChip } from "../components/ComposerPendingEditorContexts";

describe("ComposerPendingEditorContextChip", () => {
  it("renders with file:line label", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingEditorContextChip
        context={{
          id: "ctx-1",
          threadId: ThreadId.make("thread-1"),
          file: "/src/components/App.tsx",
          lineStart: 10,
          lineEnd: 15,
          text: "function App() {}",
          createdAt: "2026-05-07T12:00:00.000Z",
        }}
        onRemove={() => {}}
      />,
    );

    expect(markup).toContain("App.tsx lines 10-15");
  });

  it("renders expired editor contexts with error styling", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingEditorContextChip
        context={{
          id: "ctx-expired",
          threadId: ThreadId.make("thread-1"),
          file: "/src/utils.ts",
          lineStart: 2,
          lineEnd: 4,
          text: "",
          createdAt: "2026-05-07T12:00:00.000Z",
        }}
        onRemove={() => {}}
      />,
    );

    expect(markup).toContain('data-editor-context-expired="true"');
    expect(markup).toContain("border-destructive/35");
    expect(markup).toContain("utils.ts lines 2-4");
  });

  it("renders remove button", () => {
    const onRemove = vi.fn();
    const markup = renderToStaticMarkup(
      <ComposerPendingEditorContextChip
        context={{
          id: "ctx-1",
          threadId: ThreadId.make("thread-1"),
          file: "/src/main.ts",
          lineStart: 1,
          lineEnd: 1,
          text: "const x = 1;",
          createdAt: "2026-05-07T12:00:00.000Z",
        }}
        onRemove={onRemove}
      />,
    );

    expect(markup).toContain("Remove main.ts line 1");
  });
});
