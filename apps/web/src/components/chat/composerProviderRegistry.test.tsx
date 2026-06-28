import { describe, expect, it } from "vitest";
import type { ServerProviderModel } from "@fenrir/contracts";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderRegistry";

function selections(record: Record<string, string | boolean>) {
  return Object.entries(record).map(([id, value]) => ({ id, value }));
}

const CODEX_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

const CLAUDE_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "max", label: "Max" },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: ["ultrathink"],
    },
  },
  {
    slug: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: ["ultrathink"],
    },
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

const CLAUDE_MODELS_WITH_CONTEXT_WINDOW: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "max", label: "Max" },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: "200k", label: "200k", isDefault: true },
        { value: "1m", label: "1M" },
      ],
      promptInjectedEffortLevels: ["ultrathink"],
    },
  },
  {
    slug: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

describe("getComposerProviderState", () => {
  it("derives a stable prompt injection state for ordinary prompt edits", () => {
    expect(getComposerPromptInjectionState("Investigate this failure")).toBe("none");
    expect(getComposerPromptInjectionState("Investigate this other failure")).toBe("none");
    expect(getComposerPromptInjectionState("Ultrathink:\nInvestigate this failure")).toBe(
      "ultrathink",
    );
  });

  it("returns codex defaults when no codex draft options exist", () => {
    const state = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: "codex",
      promptEffort: "high",
      modelOptionsForDispatch: selections({ reasoningEffort: "high" }),
    });
  });

  it("normalizes codex dispatch options while preserving the selected effort", () => {
    const state = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      modelOptions: {
        codex: {
          reasoningEffort: "low",
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "codex",
      promptEffort: "low",
      modelOptionsForDispatch: selections({ reasoningEffort: "low", fastMode: true }),
    });
  });

  it("preserves codex fast mode when it is the only active option", () => {
    const state = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      modelOptions: {
        codex: {
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "codex",
      promptEffort: "high",
      modelOptionsForDispatch: selections({ reasoningEffort: "high", fastMode: true }),
    });
  });

  it("preserves codex default effort explicitly in dispatch options", () => {
    const state = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      modelOptions: {
        codex: {
          reasoningEffort: "high",
          fastMode: false,
        },
      },
    });

    expect(state).toEqual({
      provider: "codex",
      promptEffort: "high",
      modelOptionsForDispatch: selections({ reasoningEffort: "high", fastMode: false }),
    });
  });

  it("returns Claude defaults for effort-capable models", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: "claudeAgent",
      promptEffort: "high",
      modelOptionsForDispatch: selections({ effort: "high" }),
    });
  });

  it("tracks Claude ultrathink from prompt injection state without changing dispatch effort", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: {
        claudeAgent: {
          effort: "medium",
        },
      },
    });

    expect(state).toEqual({
      provider: "claudeAgent",
      promptEffort: "medium",
      modelOptionsForDispatch: selections({ effort: "medium" }),
      composerFrameClassName: "ultrathink-frame",
      composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
      modelPickerIconClassName: "ultrathink-chroma",
    });
  });

  it("keeps dispatch options stable when only prompt injection styling changes", () => {
    const baseInput = {
      provider: "claudeAgent" as const,
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          effort: "medium",
        },
      },
    };

    const ordinaryState = getComposerProviderState({
      ...baseInput,
      promptInjectionState: getComposerPromptInjectionState("Investigate this failure"),
    });
    const ultrathinkState = getComposerProviderState({
      ...baseInput,
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
    });

    expect(ordinaryState.modelOptionsForDispatch).toEqual(ultrathinkState.modelOptionsForDispatch);
    expect(ordinaryState.promptEffort).toBe(ultrathinkState.promptEffort);
    expect(ordinaryState).not.toHaveProperty("composerFrameClassName");
    expect(ultrathinkState).toMatchObject({
      composerFrameClassName: "ultrathink-frame",
      composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
      modelPickerIconClassName: "ultrathink-chroma",
    });
  });

  it("ignores prompt injection state for providers without prompt-injected effort", () => {
    const ordinaryState = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      promptInjectionState: "none",
      modelOptions: {
        codex: {
          reasoningEffort: "low",
          fastMode: true,
        },
      },
    });
    const injectedState = getComposerProviderState({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      promptInjectionState: "ultrathink",
      modelOptions: {
        codex: {
          reasoningEffort: "low",
          fastMode: true,
        },
      },
    });

    expect(injectedState).toEqual(ordinaryState);
  });

  it("drops unsupported Claude effort options for models without effort controls", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-haiku-4-5",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          effort: "max",
          thinking: false,
        },
      },
    });

    expect(state).toEqual({
      provider: "claudeAgent",
      promptEffort: null,
      modelOptionsForDispatch: selections({ thinking: false }),
    });
  });

  it("preserves Claude fast mode when it is the only active option", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "claudeAgent",
      promptEffort: "high",
      modelOptionsForDispatch: selections({ effort: "high", fastMode: true }),
    });
  });

  it("preserves Claude default effort explicitly in dispatch options", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          effort: "high",
          fastMode: false,
        },
      },
    });

    expect(state).toEqual({
      provider: "claudeAgent",
      promptEffort: "high",
      modelOptionsForDispatch: selections({ effort: "high", fastMode: false }),
    });
  });

  it("preserves explicit fastMode: false so deepMerge can overwrite a prior true", () => {
    // Regression: normalizeClaudeModelOptionsWithCapabilities used to strip
    // fastMode: false, which meant deepMerge could never clear a previous true.
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          effort: "high",
          fastMode: false,
        },
      },
    });

    expect(state.modelOptionsForDispatch).toContainEqual({ id: "fastMode", value: false });
  });

  it("preserves explicit thinking: true so deepMerge can overwrite a prior false", () => {
    // Regression: thinking: true (the default) used to be stripped, which
    // meant deepMerge could never clear a previous thinking: false.
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-haiku-4-5",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          thinking: true,
        },
      },
    });

    expect(state.modelOptionsForDispatch).toContainEqual({ id: "thinking", value: true });
  });

  it("preserves Claude default context window explicitly in dispatch options", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      models: CLAUDE_MODELS_WITH_CONTEXT_WINDOW,
      modelOptions: {
        claudeAgent: {
          effort: "high",
          contextWindow: "200k",
        },
      },
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections({ effort: "high", contextWindow: "200k" }),
    );
  });

  it("preserves explicit contextWindow default so deepMerge can overwrite a prior 1m", () => {
    // Regression: the default contextWindow must survive normalization so
    // deepMerge can clear an older non-default 1m selection.
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      models: CLAUDE_MODELS_WITH_CONTEXT_WINDOW,
      modelOptions: {
        claudeAgent: {
          contextWindow: "200k",
        },
      },
    });

    expect(state.modelOptionsForDispatch).toContainEqual({
      id: "contextWindow",
      value: "200k",
    });
  });

  it("omits contextWindow when the model does not support it", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-haiku-4-5",
      models: CLAUDE_MODELS_WITH_CONTEXT_WINDOW,
      modelOptions: {
        claudeAgent: {
          contextWindow: "1m",
        },
      },
    });

    expect(state.modelOptionsForDispatch).toBeUndefined();
  });

  it("omits fastMode when the model does not support it", () => {
    const state = getComposerProviderState({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      modelOptions: {
        claudeAgent: {
          effort: "high",
          fastMode: true,
        },
      },
    });

    expect(state.modelOptionsForDispatch).not.toContainEqual({ id: "fastMode", value: true });
  });
});

describe("provider traits render guards", () => {
  it("returns null for codex traits picker when no thread target is provided", () => {
    const content = renderProviderTraitsPicker({
      provider: "codex",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    });

    expect(content).toBeNull();
  });

  it("returns null for claude traits menu content when no thread target is provided", () => {
    const content = renderProviderTraitsMenuContent({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      models: CLAUDE_MODELS,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    });

    expect(content).toBeNull();
  });
});
