import "../../index.css";

import type { LocalApi, ServerProviderSkill, ServerSkillDetails } from "@fenrir/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  currentSkills: [] as ServerProviderSkill[],
  detailBySkillName: {} as Record<string, ServerSkillDetails>,
  getDetailsMock: vi.fn<(name: string) => Promise<ServerSkillDetails>>(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  resolveConflictMock: vi.fn(),
  readLocalApiMock: vi.fn<() => LocalApi | undefined>(),
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  openCanonicalSkillFileInEditorMock: vi.fn(async () => "/tmp/skill.md"),
  toastAddMock: vi.fn(),
}));

vi.mock("~/hooks/useSkills", () => ({
  useSkills: () => mocks.currentSkills,
  useFilteredSkills: () => mocks.currentSkills,
  useSkillActions: () => ({
    getDetails: mocks.getDetailsMock,
    create: mocks.createMock,
    update: mocks.updateMock,
    delete: mocks.deleteMock,
    resolveConflict: mocks.resolveConflictMock,
  }),
}));

vi.mock("~/localApi", () => ({
  readLocalApi: mocks.readLocalApiMock,
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
}));

vi.mock("~/editorPreferences", () => ({
  openInPreferredEditor: mocks.openInPreferredEditorMock,
}));

vi.mock("./skillFiles", () => ({
  findCanonicalSkillFile: vi.fn(),
  openCanonicalSkillFileInEditor: mocks.openCanonicalSkillFileInEditorMock,
}));

vi.mock("~/components/ui/toast", () => ({
  toastManager: {
    add: mocks.toastAddMock,
  },
}));

import { useRightPanelStore } from "~/rightPanelStore";
import { SkillFileTree, SkillInspectView } from "./SkillInspectView";
import { SkillsPanel } from "./SkillsPanel";
import { useSkillPanelStore } from "./stores/skillPanelStore";

const BASE_SKILL: ServerProviderSkill = {
  name: "grill-me",
  displayName: "Grill Me",
  description: "Interview relentlessly",
  body: "Interview me relentlessly.",
  tags: ["planning"],
  enabled: true,
  syncStatus: [
    { provider: "codex", state: "synced", lastSyncedAt: null },
    { provider: "claudeAgent", state: "pending", lastSyncedAt: null },
  ],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const BASE_DETAILS: ServerSkillDetails = {
  skill: BASE_SKILL,
  files: [
    {
      relativePath: "skill.md",
      absolutePath: "/tmp/grill-me/skill.md",
      executable: false,
      scope: { kind: "general" },
    },
    {
      relativePath: "references/guide.md",
      absolutePath: "/tmp/grill-me/references/guide.md",
      executable: false,
      scope: { kind: "general" },
    },
    {
      relativePath: "agents/openai.yaml",
      absolutePath: "/tmp/grill-me/agents/openai.yaml",
      executable: false,
      scope: { kind: "providerSpecific", provider: "codex" },
    },
    {
      relativePath: "claude/notes.md",
      absolutePath: "/tmp/grill-me/claude/notes.md",
      executable: false,
      scope: { kind: "providerSpecific", provider: "claudeAgent" },
    },
    {
      relativePath: "mixed/readme.md",
      absolutePath: "/tmp/grill-me/mixed/readme.md",
      executable: false,
      scope: { kind: "general" },
    },
    {
      relativePath: "mixed/provider.md",
      absolutePath: "/tmp/grill-me/mixed/provider.md",
      executable: false,
      scope: { kind: "providerSpecific", provider: "codex" },
    },
  ],
};

const LOCAL_API = {
  dialogs: {
    pickFolder: vi.fn(async () => null),
    confirm: vi.fn(async () => true),
  },
  shell: {
    openInEditor: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  },
  contextMenu: {
    show: vi.fn(async () => null),
  },
  persistence: {
    getClientSettings: vi.fn(async () => null),
    setClientSettings: vi.fn(async () => undefined),
    getSavedEnvironmentRegistry: vi.fn(async () => []),
    setSavedEnvironmentRegistry: vi.fn(async () => undefined),
    getSavedEnvironmentSecret: vi.fn(async () => null),
    setSavedEnvironmentSecret: vi.fn(async () => undefined),
    removeSavedEnvironmentSecret: vi.fn(async () => undefined),
  },
  server: {
    getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })),
    refreshProviders: vi.fn(async () => undefined),
    upsertKeybinding: vi.fn(async () => undefined),
    removeKeybinding: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => {
      throw new Error("unused");
    }),
    updateSettings: vi.fn(async () => {
      throw new Error("unused");
    }),
    getGlobalActions: vi.fn(async () => []),
    createGlobalAction: vi.fn(async () => {
      throw new Error("unused");
    }),
    updateGlobalAction: vi.fn(async () => {
      throw new Error("unused");
    }),
    deleteGlobalAction: vi.fn(async () => {
      throw new Error("unused");
    }),
    listSkills: vi.fn(async () => []),
    getSkillDetails: vi.fn(async () => BASE_DETAILS),
    createSkill: vi.fn(async () => BASE_SKILL),
    updateSkill: vi.fn(async () => BASE_SKILL),
    deleteSkill: vi.fn(async () => undefined),
    resolveSkillConflict: vi.fn(async () => BASE_SKILL),
    setActiveSkillProject: vi.fn(async () => undefined),
  },
} as unknown as LocalApi;

function resetStores() {
  useSkillPanelStore.setState({
    view: { kind: "list" },
    searchQuery: "",
    activeTagFilter: null,
    detailStateBySkillName: {},
  });
  useRightPanelStore.setState({ activeTab: "skills" });
}

describe("skills module", () => {
  beforeEach(() => {
    resetStores();
    mocks.currentSkills = [BASE_SKILL];
    mocks.detailBySkillName = { "grill-me": BASE_DETAILS };
    mocks.getDetailsMock.mockReset();
    mocks.getDetailsMock.mockImplementation(async (name) => mocks.detailBySkillName[name]!);
    mocks.createMock.mockReset();
    mocks.updateMock.mockReset();
    mocks.deleteMock.mockReset();
    mocks.resolveConflictMock.mockReset();
    mocks.readLocalApiMock.mockReset();
    mocks.readLocalApiMock.mockReturnValue(LOCAL_API);
    mocks.openInPreferredEditorMock.mockClear();
    mocks.openCanonicalSkillFileInEditorMock.mockClear();
    mocks.toastAddMock.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    resetStores();
  });

  it("fetches inspect details lazily when the inspect view mounts", async () => {
    useSkillPanelStore.setState({ view: { kind: "inspect", skillName: "grill-me" } });
    const screen = await render(<SkillInspectView skillName="grill-me" onInsert={vi.fn()} />);

    try {
      await vi.waitFor(() => {
        expect(mocks.getDetailsMock).toHaveBeenCalledTimes(1);
      });
      await expect.element(page.getByText("guide.md")).toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("renders scope badges from the flat file inventory", async () => {
    const screen = await render(
      <SkillFileTree details={BASE_DETAILS} onOpenFile={vi.fn<(target: string) => void>()} />,
    );

    try {
      await expect.element(page.getByText("General").first()).toBeInTheDocument();
      await expect.element(page.getByText("Codex").first()).toBeInTheDocument();
      await expect.element(page.getByText("Claude").first()).toBeInTheDocument();
      await expect.element(page.getByText("Mixed").first()).toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("opens files through the preferred-editor flow", async () => {
    useSkillPanelStore.setState({
      detailStateBySkillName: {
        "grill-me": { status: "loaded", details: BASE_DETAILS },
      },
    });
    const screen = await render(<SkillInspectView skillName="grill-me" onInsert={vi.fn()} />);

    try {
      const fileButton = page.getByRole("button", { name: /guide\.md/i });
      await fileButton.click();

      await vi.waitFor(() => {
        expect(mocks.openInPreferredEditorMock).toHaveBeenCalledWith(
          LOCAL_API,
          "/tmp/grill-me/references/guide.md",
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("creates disabled placeholder skills and opens the new canonical skill.md", async () => {
    mocks.createMock.mockImplementation(async (input) => ({
      ...BASE_SKILL,
      ...input,
      name: "plan-review",
      displayName: "Plan Review",
      description: "Review the plan hard",
      enabled: input.enabled,
    }));
    const createdDetails: ServerSkillDetails = {
      skill: {
        ...BASE_SKILL,
        name: "plan-review",
        displayName: "Plan Review",
        description: "Review the plan hard",
        enabled: false,
      },
      files: [
        {
          relativePath: "skill.md",
          absolutePath: "/tmp/plan-review/skill.md",
          executable: false,
          scope: { kind: "general" },
        },
      ],
    };
    mocks.detailBySkillName["plan-review"] = createdDetails;

    useSkillPanelStore.setState({ view: { kind: "create" } });
    const screen = await render(<SkillsPanel onInsert={vi.fn()} />);

    try {
      await page.getByPlaceholder("Code Review").fill("Plan Review");
      await page
        .getByPlaceholder("Review code for correctness, risk, and missing tests.")
        .fill("Review the plan hard");
      await page.getByRole("button", { name: "Create and open skill.md" }).click();

      await vi.waitFor(() => {
        expect(mocks.createMock).toHaveBeenCalledTimes(1);
      });

      expect(mocks.createMock.mock.calls[0]?.[0]).toMatchObject({
        name: "plan-review",
        displayName: "Plan Review",
        description: "Review the plan hard",
        body: "TODO: Define the skill content",
        enabled: false,
      });
      expect(mocks.openCanonicalSkillFileInEditorMock).toHaveBeenCalledWith(
        LOCAL_API,
        createdDetails,
      );
      expect(useSkillPanelStore.getState().view).toEqual({
        kind: "inspect",
        skillName: "plan-review",
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps support files in the rendered detail model after metadata-only edits", async () => {
    mocks.updateMock.mockResolvedValue({
      ...BASE_SKILL,
      description: "Updated metadata only",
    });
    useSkillPanelStore.setState({
      view: { kind: "edit", skillName: "grill-me" },
      detailStateBySkillName: {
        "grill-me": { status: "loaded", details: BASE_DETAILS },
      },
    });
    const screen = await render(<SkillsPanel onInsert={vi.fn()} />);

    try {
      await page
        .getByPlaceholder("Review code for correctness, risk, and missing tests.")
        .fill("Updated metadata only");
      await page.getByRole("button", { name: "Save metadata" }).click();

      await vi.waitFor(() => {
        expect(mocks.updateMock).toHaveBeenCalledTimes(1);
      });
      expect(useSkillPanelStore.getState().view).toEqual({
        kind: "inspect",
        skillName: "grill-me",
      });
      await expect.element(page.getByText("guide.md")).toBeInTheDocument();
      await expect.element(page.getByText("openai.yaml")).toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });
});
