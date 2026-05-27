import * as OS from "node:os";
import type {
  ModelCapabilities,
  CodexSettings,
  ServerProvider,
  ServerProviderModel,
  ServerProviderAuth,
  ServerProviderState,
} from "@fenrir/contracts";
import {
  Cache,
  Duration,
  Effect,
  Equal,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Stream,
} from "effect";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { normalizeModelSlug } from "@fenrir/shared/model";

import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "../codexCliVersion";
import {
  adjustCodexModelsForAccount,
  codexAuthSubLabel,
  codexAuthSubType,
  readCodexAccountSnapshot,
  type CodexAccountSnapshot,
} from "../codexAccount";
import { buildCodexInitializeParams } from "../codexAppServer";
import { resolveEffectiveCodexSettings } from "../providerSettings";
import { CodexProvider } from "../Services/CodexProvider";
import { expandHomePath } from "../../pathExpansion.ts";
import { ServerSettingsService } from "../../serverSettings";
import { ServerSettingsError } from "@fenrir/contracts";
import {
  booleanModelOptionDescriptor,
  createModelCapabilitiesFromDescriptors,
  selectModelOptionDescriptor,
} from "../modelCapabilities";

const CODEX_REASONING_EFFORT_OPTIONS = [
  { value: "xhigh", label: "Extra High" },
  { value: "high", label: "High", isDefault: true },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

const DEFAULT_CODEX_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilitiesFromDescriptors([
  selectModelOptionDescriptor({
    id: "reasoningEffort",
    label: "Effort",
    options: CODEX_REASONING_EFFORT_OPTIONS,
  }),
  booleanModelOptionDescriptor({
    id: "fastMode",
    label: "Fast Mode",
    currentValue: false,
  }),
]);

const REASONING_EFFORT_LABELS: Record<CodexSchema.V2ModelListResponse__ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

const PROVIDER = "codex" as const;
const OPENAI_AUTH_PROVIDERS = new Set(["openai"]);

function createBuiltInCodexModel(slug: string, name: string): ServerProviderModel {
  return {
    slug,
    name,
    isCustom: false,
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  };
}

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  createBuiltInCodexModel("gpt-5.4", "GPT-5.4"),
  createBuiltInCodexModel("gpt-5.5", "GPT-5.5"),
  createBuiltInCodexModel("gpt-5.4-mini", "GPT-5.4 Mini"),
  createBuiltInCodexModel("gpt-5.3-codex", "GPT-5.3 Codex"),
  createBuiltInCodexModel("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark"),
  createBuiltInCodexModel("gpt-5.2-codex", "GPT-5.2 Codex"),
  createBuiltInCodexModel("gpt-5.2", "GPT-5.2"),
];

export function getCodexModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ??
    DEFAULT_CODEX_MODEL_CAPABILITIES
  );
}

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message: "Codex CLI authentication status command is unavailable in this Codex version.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: "ready", auth: { status: "authenticated" } };
  }
  if (parsedAuth.auth === false) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message:
        "Could not verify Codex authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    return { status: "ready", auth: { status: "authenticated" } };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : "Could not verify Codex authentication status.",
  };
}

export const readCodexConfigModelProvider = Effect.fn("readCodexConfigModelProvider")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsService = yield* ServerSettingsService;
  const codexHome = yield* settingsService.getSettings.pipe(
    Effect.flatMap(resolveEffectiveCodexSettings),
    Effect.map(
      (settings) =>
        settings.homePath || process.env.CODEX_HOME || path.join(OS.homedir(), ".codex"),
    ),
  );
  const configPath = path.join(codexHome, "config.toml");

  const content = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (content === undefined) {
    return undefined;
  }

  let inTopLevel = true;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;

    const match = trimmed.match(/^model_provider\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return undefined;
});

export const hasCustomModelProvider = readCodexConfigModelProvider().pipe(
  Effect.map((provider) => provider !== undefined && !OPENAI_AUTH_PROVIDERS.has(provider)),
  Effect.orElseSucceed(() => false),
);

const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;

interface CodexAppServerCapabilitiesSnapshot {
  readonly account?: CodexAccountSnapshot;
  readonly models?: ReadonlyArray<ServerProviderModel>;
}

function isCodexAppServerCapabilitiesSnapshot(
  value: CodexAccountSnapshot | CodexAppServerCapabilitiesSnapshot | undefined,
): value is CodexAppServerCapabilitiesSnapshot {
  return !!value && typeof value === "object" && ("account" in value || "models" in value);
}

function createCodexModelCapabilities(
  model: CodexSchema.V2ModelListResponse__Model,
): ModelCapabilities {
  const reasoningOptions = model.supportedReasoningEfforts.map(({ reasoningEffort }) => ({
    value: reasoningEffort,
    label: REASONING_EFFORT_LABELS[reasoningEffort],
    ...(reasoningEffort === model.defaultReasoningEffort ? { isDefault: true } : {}),
  }));
  const supportsFastMode = (model.additionalSpeedTiers ?? []).includes("fast");

  return createModelCapabilitiesFromDescriptors([
    ...(reasoningOptions.length > 0
      ? [
          selectModelOptionDescriptor({
            id: "reasoningEffort",
            label: "Effort",
            options: reasoningOptions,
          }),
        ]
      : []),
    ...(supportsFastMode
      ? [
          booleanModelOptionDescriptor({
            id: "fastMode",
            label: "Fast Mode",
            currentValue: false,
          }),
        ]
      : []),
  ]);
}

function formatCodexModelDisplayName(model: CodexSchema.V2ModelListResponse__Model): string {
  return model.displayName
    .replace(/^gpt/iu, "GPT")
    .replace(/-([a-z])/giu, (_, letter: string) => `-${letter.toUpperCase()}`);
}

function parseCodexModelListResponse(
  response: CodexSchema.V2ModelListResponse,
): ReadonlyArray<ServerProviderModel> {
  return response.data.map((model) => ({
    slug: model.model,
    name: formatCodexModelDisplayName(model),
    isCustom: false,
    capabilities: createCodexModelCapabilities(model),
  }));
}

function appendCustomCodexModels(
  models: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  if (customModels.length === 0) {
    return models;
  }

  const seen = new Set(models.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];

  for (const customModel of customModels) {
    const slug = normalizeModelSlug(customModel, PROVIDER);
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    customEntries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
    });
  }

  return customEntries.length > 0 ? [...models, ...customEntries] : models;
}

const requestAllCodexModels = Effect.fn("requestAllCodexModels")(function* (
  client: CodexClient.CodexAppServerClientShape,
) {
  const models: ServerProviderModel[] = [];
  let cursor: string | null | undefined;

  do {
    const response = yield* client.request("model/list", cursor ? { cursor } : {});
    models.push(...parseCodexModelListResponse(response));
    cursor = response.nextCursor;
  } while (cursor);

  return models;
});

function processEnvForChild(input: { readonly homePath?: string }): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => {
        const [, value] = entry;
        return typeof value === "string";
      }),
    ),
    ...(input.homePath ? { CODEX_HOME: expandHomePath(input.homePath) } : {}),
  };
}

const probeCodexAppServerCapabilities = Effect.fn("probeCodexAppServerCapabilities")(
  function* (input: { readonly binaryPath: string; readonly homePath?: string }) {
    const clientContext = yield* Layer.build(
      CodexClient.layerCommand({
        command: input.binaryPath,
        args: ["app-server"],
        env: processEnvForChild(input.homePath ? { homePath: input.homePath } : {}),
      }),
    );
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(clientContext),
    );

    yield* client.request("initialize", buildCodexInitializeParams());
    yield* client.notify("initialized", undefined);

    const accountResponse = yield* client.request("account/read", {});
    const account = readCodexAccountSnapshot(accountResponse);
    const models =
      accountResponse.account || !accountResponse.requiresOpenaiAuth
        ? yield* requestAllCodexModels(client)
        : undefined;

    return {
      account,
      ...(models ? { models } : {}),
    } satisfies CodexAppServerCapabilitiesSnapshot;
  },
);

const probeCodexCapabilities = (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
}) =>
  probeCodexAppServerCapabilities(input).pipe(
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.catchCause(() => Effect.succeed(Option.none<CodexAppServerCapabilitiesSnapshot>())),
    Effect.map((snapshot) => (Option.isSome(snapshot) ? snapshot.value : undefined)),
  );

const runCodexCommand = Effect.fn("runCodexCommand")(function* (args: ReadonlyArray<string>) {
  const settingsService = yield* ServerSettingsService;
  const codexSettings = yield* settingsService.getSettings.pipe(
    Effect.flatMap(resolveEffectiveCodexSettings),
  );
  const command = ChildProcess.make(codexSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(codexSettings.homePath ? { CODEX_HOME: expandHomePath(codexSettings.homePath) } : {}),
    },
  });
  return yield* spawnAndCollect(codexSettings.binaryPath, command);
});

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  resolveCapabilities?: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
  }) => Effect.Effect<CodexAccountSnapshot | CodexAppServerCapabilitiesSnapshot | undefined>,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService
> {
  const codexSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.flatMap(resolveEffectiveCodexSettings),
  );
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    codexSettings.customModels,
    DEFAULT_CODEX_MODEL_CAPABILITIES,
  );

  if (!codexSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in Fenrir settings.",
      },
    });
  }

  const versionProbe = yield* runCodexCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Codex CLI (`codex`) is not installed or not on PATH."
          : `Failed to execute Codex CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Codex CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion =
    parseCodexCliVersion(`${version.stdout}\n${version.stderr}`) ??
    parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Codex CLI is installed but failed to run. ${detail}`
          : "Codex CLI is installed but failed to run.",
      },
    });
  }

  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: formatCodexCliUpgradeMessage(parsedVersion),
      },
    });
  }

  if (yield* hasCustomModelProvider) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "ready",
        auth: { status: "unknown" },
        message: "Using a custom Codex model provider; OpenAI login check skipped.",
      },
    });
  }

  const authProbe = yield* runCodexCommand(["login", "status"]).pipe(
    Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  const capabilitiesResult = resolveCapabilities
    ? yield* resolveCapabilities({
        binaryPath: codexSettings.binaryPath,
        homePath: codexSettings.homePath,
      })
    : undefined;
  const capabilities: CodexAppServerCapabilitiesSnapshot | undefined =
    isCodexAppServerCapabilitiesSnapshot(capabilitiesResult)
      ? capabilitiesResult
      : capabilitiesResult
        ? { account: capabilitiesResult }
        : undefined;
  const resolvedModels = adjustCodexModelsForAccount(
    capabilities?.models
      ? appendCustomCodexModels(capabilities.models, codexSettings.customModels)
      : models,
    capabilities?.account,
  );

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models: resolvedModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message:
          error instanceof Error
            ? `Could not verify Codex authentication status: ${error.message}.`
            : "Could not verify Codex authentication status.",
      },
    });
  }

  if (Option.isNone(authProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models: resolvedModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Codex authentication status. Timed out while running command.",
      },
    });
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value);
  const authType = codexAuthSubType(capabilities?.account);
  const authLabel = codexAuthSubLabel(capabilities?.account);
  return buildServerProvider({
    provider: PROVIDER,
    enabled: codexSettings.enabled,
    checkedAt,
    models: resolvedModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: parsed.status,
      auth: {
        ...parsed.auth,
        ...(authType ? { type: authType } : {}),
        ...(authLabel ? { label: authLabel } : {}),
      },
      ...(parsed.message ? { message: parsed.message } : {}),
    },
  });
});

export const CodexProviderLive = Layer.effect(
  CodexProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const accountProbeCache = yield* Cache.make({
      capacity: 4,
      timeToLive: Duration.minutes(5),
      lookup: (key: string) => {
        const [binaryPath, homePath] = JSON.parse(key) as [string, string | undefined];
        return probeCodexCapabilities({
          binaryPath,
          ...(homePath ? { homePath } : {}),
        });
      },
    });

    const checkProvider = checkCodexProviderStatus((input) =>
      Cache.get(accountProbeCache, JSON.stringify([input.binaryPath, input.homePath])),
    ).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CodexSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.flatMap((settings) => resolveEffectiveCodexSettings(settings)),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.mapEffect((settings) => resolveEffectiveCodexSettings(settings)),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  }),
);
