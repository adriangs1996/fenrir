import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatViewSwitcher } from "./ChatViewSwitcher";

function getTabPosition(html: string, tab: string): number {
  return html.indexOf(`data-tab="${tab}"`);
}

describe("ChatViewSwitcher", () => {
  it("renders views in thread, editor, terminal order", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher activeTab="thread" editorAvailable onTabSelect={vi.fn()} />,
    );

    const threadIndex = getTabPosition(html, "thread");
    const editorIndex = getTabPosition(html, "editor");
    const terminalIndex = getTabPosition(html, "terminal");

    expect(threadIndex).toBeGreaterThanOrEqual(0);
    expect(editorIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain('data-tab="review"');
    expect(threadIndex).toBeLessThan(editorIndex);
    expect(editorIndex).toBeLessThan(terminalIndex);
  });

  it("keeps terminal visible when the editor view is unavailable", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher activeTab="thread" editorAvailable={false} onTabSelect={vi.fn()} />,
    );

    const threadIndex = getTabPosition(html, "thread");
    const terminalIndex = getTabPosition(html, "terminal");

    expect(threadIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain('data-tab="editor"');
    expect(html).not.toContain('data-tab="review"');
    expect(threadIndex).toBeLessThan(terminalIndex);
  });

  it("marks the active view as selected", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher activeTab="terminal" editorAvailable onTabSelect={vi.fn()} />,
    );

    expect(html).toContain('data-tab="terminal"');
    expect(html).toContain('aria-selected="true"');
  });

  it("falls back to thread selection while editor availability catches up", () => {
    const html = renderToStaticMarkup(
      <ChatViewSwitcher activeTab="editor" editorAvailable={false} onTabSelect={vi.fn()} />,
    );

    expect(html).toContain('data-tab="thread"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('data-tab="editor"');
  });
});
