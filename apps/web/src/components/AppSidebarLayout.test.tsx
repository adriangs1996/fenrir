import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AppSidebarLayout } from "./AppSidebarLayout";

vi.mock("@tanstack/react-router", () => ({
  useLocation: (options?: {
    select?: (location: { href: string; pathname: string }) => string;
  }) => {
    const location = { href: "/", pathname: "/" };
    return options?.select ? options.select(location) : location;
  },
  useNavigate: () => vi.fn(),
}));

vi.mock("./Sidebar", () => ({
  default: () => <div>Threads</div>,
}));

vi.mock("./remote-host/RemoteHostSidebar", () => ({
  RemoteHostSidebar: () => <div>Remote Host</div>,
}));

vi.mock("../commandPaletteStore", () => ({
  useCommandPaletteStore: (selector: (state: { open: boolean }) => unknown) =>
    selector({ open: false }),
}));

vi.mock("../rpc/serverState", () => ({
  useServerKeybindings: () => [],
}));

vi.mock("../keybindings", () => ({
  isGlobalTerminalOpenShortcut: () => false,
  isSidebarToggleShortcut: () => false,
}));

vi.mock("../modules/terminal", () => ({
  GLOBAL_TERMINAL_ROUTE: "/global-terminal",
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
