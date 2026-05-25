import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppSidebarLayout } from "./AppSidebarLayout";

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: "/" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("./Sidebar", () => ({
  default: () => <div>Threads</div>,
}));

vi.mock("./hack/HackSidebar", () => ({
  HackSidebar: () => <div>Hack</div>,
}));

vi.mock("../commandPaletteStore", () => ({
  useCommandPaletteStore: (selector: (state: { open: boolean }) => unknown) =>
    selector({ open: false }),
}));

vi.mock("../rpc/serverState", () => ({
  useServerKeybindings: () => [],
}));

vi.mock("../keybindings", () => ({
  isSidebarToggleShortcut: () => false,
}));

vi.mock("../modules/terminal", () => ({
  isTerminalFocused: () => false,
}));

describe("AppSidebarLayout", () => {
  it("mounts a resize rail for the projects sidebar", () => {
    const html = renderToStaticMarkup(
      <AppSidebarLayout>
        <div>Main content</div>
      </AppSidebarLayout>,
    );

    expect(html).toContain('data-slot="sidebar-rail"');
    expect(html).toContain('aria-label="Resize Sidebar"');
    expect(html).toContain('title="Drag to resize sidebar"');
  });
});
