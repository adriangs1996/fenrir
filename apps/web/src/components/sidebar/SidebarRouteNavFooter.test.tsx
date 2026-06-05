import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "../ui/sidebar";
import { SidebarRouteNavFooter } from "./SidebarRouteNavFooter";

const routerMock = vi.hoisted(() => ({
  pathname: "/remote-host/host-1",
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: routerMock.pathname }),
  useNavigate: () => vi.fn(),
}));

vi.mock("./SidebarProviderUpdatePill", () => ({
  SidebarProviderUpdatePill: () => null,
}));

vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
}));

describe("SidebarRouteNavFooter", () => {
  it("renders a chat workspace escape while inside the remote host route", () => {
    routerMock.pathname = "/remote-host/host-1";
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarRouteNavFooter />
      </SidebarProvider>,
    );

    expect(markup).toContain("Agents Workspace");
    expect(markup).not.toContain("Remote Host");
    expect(markup).toContain("Browser Lab");
    expect(markup).toContain("Global Terminal");
    expect(markup).toContain("Settings");
  });

  it("renders the remote host route link outside the remote host route", () => {
    routerMock.pathname = "/";
    const markup = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarRouteNavFooter />
      </SidebarProvider>,
    );

    expect(markup).toContain("Remote Host");
    expect(markup).not.toContain("Agents Workspace");
  });
});
