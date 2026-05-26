import type {
  ModelCapabilities,
  OpenCodeSettings,
  ServerProvider,
  ServerProviderModel,
} from "@fenrir/contracts";
import { ProviderDriverKind } from "@fenrir/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { compareCliVersions } from "../cliVersion.ts";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  parseGenericCliVersion,
} from "../providerSnapshot.ts";
import {
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail,
  type OpenCodeInventory,
} from "../opencodeRuntime.ts";
import { scopedSafeTeardown } from "./scopedSafeTeardown.ts";

const DRIVER = ProviderDriverKind.makeUnsafe("opencode");
const MINIMUM_OPENCODE_VERSION = "1.14.19";
const DEFAULT_OPENCODE_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

class OpenCodeProbeError extends Data.TaggedError("OpenCodeProbeError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

function normalizeProbeMessage(message: string): string | undefined {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (
    trimmed === "An error occurred in Effect.tryPromise" ||
    trimmed === "An error occurred in Effect.try"
  ) {
    return undefined;
  }
  return trimmed;
}

function normalizedErrorMessage(cause: unknown): string | undefined {
  if (cause instanceof OpenCodeProbeError) {
    return normalizeProbeMessage(cause.detail);
  }
  if (!(cause instanceof Error)) {
    return undefined;
  }
  return normalizeProbeMessage(cause.message);
}

function customModelEntries(
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const entries: ServerProviderModel[] = [];
  for (const candidate of customModels) {
    const slug = nonEmptyTrimmed(candidate);
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    entries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
    });
  }
  return entries;
}

function mergeOpenCodeModels(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set(builtInModels.map((model) => model.slug));
  const merged = [...builtInModels];
  for (const model of customModelEntries(customModels)) {
    if (seen.has(model.slug)) {
      continue;
    }
    seen.add(model.slug);
    merged.push(model);
  }
  return merged;
}

function formatOpenCodeProbeError(input: {
  readonly cause: unknown;
  readonly isExternalServer: boolean;
  readonly serverUrl: string;
}): { readonly installed: boolean; readonly message: string } {
  const detail = normalizedErrorMessage(input.cause);
  const lower = detail?.toLowerCase() ?? "";

  if (input.isExternalServer) {
    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return {
        installed: true,
        message: "OpenCode server rejected authentication. Check the server URL and password.",
      };
    }

    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror") ||
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("socket hang up")
    ) {
      return {
        installed: true,
        message: `Couldn't reach the configured OpenCode server at ${input.serverUrl}. Check that the server is running and the URL is correct.`,
      };
    }

    return {
      installed: true,
      message: detail ?? "Failed to connect to the configured OpenCode server.",
    };
  }

  if (lower.includes("enoent") || lower.includes("notfound")) {
    return {
      installed: false,
      message: "OpenCode CLI (`opencode`) is not installed or not on PATH.",
    };
  }

  if (lower.includes("quarantine")) {
    return {
      installed: true,
      message:
        "macOS is blocking the OpenCode binary (quarantine). Run `xattr -d com.apple.quarantine $(which opencode)` to fix this.",
    };
  }

  if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
    return {
      installed: true,
      message:
        "macOS killed the OpenCode process due to an invalid code signature. The binary may be corrupted — try reinstalling OpenCode.",
    };
  }

  return {
    installed: true,
    message: detail
      ? `Failed to execute OpenCode CLI health check: ${detail}`
      : "Failed to execute OpenCode CLI health check.",
  };
}

function flattenOpenCodeModels(input: OpenCodeInventory): ReadonlyArray<ServerProviderModel> {
  const connected = new Set(input.providerList.connected);
  const models: Array<ServerProviderModel> = [];

  for (const provider of input.providerList.all) {
    if (!connected.has(provider.id)) {
      continue;
    }

    for (const model of Object.values(provider.models)) {
      const name = nonEmptyTrimmed(model.name);
      if (!name) {
        continue;
      }
      models.push({
        slug: `${provider.id}/${model.id}`,
        name,
        isCustom: false,
        capabilities: DEFAULT_OPENCODE_MODEL_CAPABILITIES,
      });
    }
  }

  return models.toSorted((left, right) => left.name.localeCompare(right.name));
}

export const makePendingOpenCodeProvider = (
  openCodeSettings: OpenCodeSettings,
): Effect.Effect<ServerProvider> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = mergeOpenCodeModels([], openCodeSettings.customModels);

    if (!openCodeSettings.enabled) {
      return buildServerProvider({
        driver: DRIVER,
        displayName: "OpenCode",
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message:
            openCodeSettings.serverUrl.trim().length > 0
              ? "OpenCode is disabled in Fenrir settings. A server URL is configured."
              : "OpenCode is disabled in Fenrir settings.",
        },
      });
    }

    return buildServerProvider({
      driver: DRIVER,
      displayName: "OpenCode",
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "OpenCode provider status has not been checked in this session yet.",
      },
    });
  });

export const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(function* (
  openCodeSettings: OpenCodeSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const openCodeRuntime = yield* OpenCodeRuntime;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const isExternalServer = openCodeSettings.serverUrl.trim().length > 0;

  const fallback = (cause: unknown, version: string | null = null) => {
    const failure = formatOpenCodeProbeError({
      cause,
      isExternalServer,
      serverUrl: openCodeSettings.serverUrl,
    });
    return buildServerProvider({
      driver: DRIVER,
      displayName: "OpenCode",
      enabled: openCodeSettings.enabled,
      checkedAt,
      models: mergeOpenCodeModels([], openCodeSettings.customModels),
      probe: {
        installed: failure.installed,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: failure.message,
      },
    });
  };

  if (!openCodeSettings.enabled) {
    return yield* makePendingOpenCodeProvider(openCodeSettings);
  }

  let version: string | null = null;
  if (!isExternalServer) {
    const versionExit = yield* Effect.exit(
      openCodeRuntime
        .runOpenCodeCommand({
          binaryPath: openCodeSettings.binaryPath,
          args: ["--version"],
          environment,
        })
        .pipe(
          Effect.mapError(
            (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
          ),
        ),
    );
    if (versionExit._tag === "Failure") {
      return fallback(Cause.squash(versionExit.cause));
    }
    const versionResult = versionExit.value as { stdout: string };
    version = parseGenericCliVersion(versionResult.stdout) ?? null;

    if (!version) {
      return fallback(
        new Error(
          `Unable to determine OpenCode version from \`opencode --version\` output. Fenrir requires OpenCode v${MINIMUM_OPENCODE_VERSION} or newer.`,
        ),
      );
    }
    if (compareCliVersions(version, MINIMUM_OPENCODE_VERSION) < 0) {
      return buildServerProvider({
        driver: DRIVER,
        displayName: "OpenCode",
        enabled: true,
        checkedAt,
        models: mergeOpenCodeModels([], openCodeSettings.customModels),
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: `OpenCode v${version} is too old. Upgrade to v${MINIMUM_OPENCODE_VERSION} or newer.`,
        },
      });
    }
  }

  const inventoryExit = yield* Effect.exit(
    Effect.gen(function* () {
      const server = yield* openCodeRuntime
        .connectToOpenCodeServer({
          binaryPath: openCodeSettings.binaryPath,
          serverUrl: openCodeSettings.serverUrl,
          environment,
        })
        .pipe(
          Effect.mapError(
            (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
          ),
        );
      return yield* openCodeRuntime
        .loadOpenCodeInventory(
          openCodeRuntime.createOpenCodeSdkClient({
            baseUrl: server.url,
            directory: cwd,
            ...(isExternalServer && openCodeSettings.serverPassword
              ? { serverPassword: openCodeSettings.serverPassword }
              : {}),
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
          ),
        );
    }).pipe(scopedSafeTeardown("opencode-provider-probe")),
  );
  if (inventoryExit._tag === "Failure") {
    return fallback(Cause.squash(inventoryExit.cause), version);
  }

  const models = mergeOpenCodeModels(
    flattenOpenCodeModels(inventoryExit.value),
    openCodeSettings.customModels,
  );
  const connectedCount = inventoryExit.value.providerList.connected.length;
  return buildServerProvider({
    driver: DRIVER,
    displayName: "OpenCode",
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: connectedCount > 0 ? "ready" : "warning",
      auth: {
        status: connectedCount > 0 ? "authenticated" : "unknown",
        type: "opencode",
      },
      message:
        connectedCount > 0
          ? `${connectedCount} upstream provider${connectedCount === 1 ? "" : "s"} connected through ${isExternalServer ? "the configured OpenCode server" : "OpenCode"}.`
          : isExternalServer
            ? "Connected to the configured OpenCode server, but it did not report any connected upstream providers."
            : "OpenCode is available, but it did not report any connected upstream providers.",
    },
  });
});
