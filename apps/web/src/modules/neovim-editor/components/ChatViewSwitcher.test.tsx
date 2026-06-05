import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatViewSwitcher } from "./ChatViewSwitcher";

function getTabPosition(html: string, tab: string): number {
  return html.indexOf(`data-tab="${tab}"`);
}

describe("ChatViewSwitcher", () => {
  it("renders views in thread, git diff, editor, terminal order", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher
        activeTab="thread"
        editorAvailable
        gitDiffAvailable
        onTabSelect={vi.fn()}
      />,
    );

    const threadIndex = getTabPosition(html, "thread");
    const gitDiffIndex = getTabPosition(html, "gitdiff");
    const editorIndex = getTabPosition(html, "editor");
    const terminalIndex = getTabPosition(html, "terminal");

    expect(threadIndex).toBeGreaterThanOrEqual(0);
    expect(gitDiffIndex).toBeGreaterThanOrEqual(0);
    expect(editorIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain('data-tab="review"');
    expect(threadIndex).toBeLessThan(gitDiffIndex);
    expect(gitDiffIndex).toBeLessThan(editorIndex);
    expect(editorIndex).toBeLessThan(terminalIndex);
  });

  it("keeps git diff and terminal visible when the editor view is unavailable", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher
        activeTab="thread"
        editorAvailable={false}
        gitDiffAvailable
        onTabSelect={vi.fn()}
      />,
    );

    const threadIndex = getTabPosition(html, "thread");
    const gitDiffIndex = getTabPosition(html, "gitdiff");
    const terminalIndex = getTabPosition(html, "terminal");

    expect(threadIndex).toBeGreaterThanOrEqual(0);
    expect(gitDiffIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain('data-tab="editor"');
    expect(html).not.toContain('data-tab="review"');
    expect(threadIndex).toBeLessThan(gitDiffIndex);
    expect(gitDiffIndex).toBeLessThan(terminalIndex);
  });

  it("marks the active view as selected", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher
        activeTab="terminal"
        editorAvailable
        gitDiffAvailable
        onTabSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-tab="terminal"');
    expect(html).toContain('aria-selected="true"');
  });

  it("falls back to thread selection while editor availability catches up", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher
        activeTab="editor"
        editorAvailable={false}
        gitDiffAvailable
        onTabSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-tab="thread"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('data-tab="editor"');
  });

  it("falls back to thread selection when git diff is unavailable", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher
        activeTab="gitdiff"
        editorAvailable
        gitDiffAvailable={false}
        onTabSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-tab="thread"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('data-tab="gitdiff"');
  });
});
