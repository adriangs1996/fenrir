import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChatTabBar } from "./ChatTabBar";

function getTabPosition(html: string, tab: string): number {
  return html.indexOf(`data-tab="${tab}"`);
}

describe("ChatTabBar", () => {
  it("renders tabs in thread, editor, terminal, review order", () => {
    const html = renderToStaticMarkup(
      <ChatTabBar activeTab="thread" editorAvailable onTabSelect={vi.fn()} />,
    );

    const threadIndex = getTabPosition(html, "thread");
    const editorIndex = getTabPosition(html, "editor");
    const terminalIndex = getTabPosition(html, "terminal");
    const reviewIndex = getTabPosition(html, "review");

    expect(threadIndex).toBeGreaterThanOrEqual(0);
    expect(editorIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(threadIndex).toBeLessThan(editorIndex);
    expect(editorIndex).toBeLessThan(terminalIndex);
    expect(terminalIndex).toBeLessThan(reviewIndex);
  });

  it("keeps terminal visible when the editor tab is unavailable", () => {
    const html = renderToStaticMarkup(
      <ChatTabBar activeTab="thread" editorAvailable={false} onTabSelect={vi.fn()} />,
    );

    const threadIndex = getTabPosition(html, "thread");
    const terminalIndex = getTabPosition(html, "terminal");
    const reviewIndex = getTabPosition(html, "review");

    expect(threadIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain('data-tab="editor"');
    expect(threadIndex).toBeLessThan(terminalIndex);
    expect(terminalIndex).toBeLessThan(reviewIndex);
  });
});
