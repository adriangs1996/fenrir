import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ManagedProcessProjectControl } from "./ManagedProcessProjectControl";

vi.mock("./ManagedProcessSettingsEditor", () => ({
  ManagedProcessSettingsEditor: () => null,
}));

describe("ManagedProcessProjectControl", () => {
  it("renders a project-scoped processes trigger with the definition count", () => {
    const markup = renderToStaticMarkup(
      <ManagedProcessProjectControl
        projectId={"project-1" as never}
        environmentId={"environment-1" as never}
        projectName="Fenrir"
        definitionCount={3}
      />,
    );

    expect(markup).toContain("Manage processes for Fenrir");
    expect(markup).toContain("Processes");
    expect(markup).toContain(">3<");
  });
});
