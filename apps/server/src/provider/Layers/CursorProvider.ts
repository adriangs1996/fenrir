import type {
  CursorSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
} from "@fenrir/contracts";
import { ProviderDriverKind } from "@fenrir/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  type CommandResult,
} from "../providerSnapshot.ts";
import { runProcess } from "../../processRunner.ts";

const DRIVER = ProviderDriverKind.makeUnsafe("cursor");

class CursorProbeCommandError extends Data.TaggedError("CursorProbeCommandError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

const DEFAULT_CURSOR_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

function cursorGlobalArgs(cursorSettings: Pick<CursorSettings, "apiEndpoint">): Array<string> {
  const endpoint = cursorSettings.apiEndpoint.trim();
  return endpoint.length > 0 ? ["--endpoint", endpoint] : [];
}

function formatCursorAuthMessage(detail: string): string {
  return `${detail} Run \`cursor-agent login\` or set \`CURSOR_API_KEY\` and try again.`;
}

export function parseCursorAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    combined.includes("not authenticated") ||
    combined.includes("run `cursor-agent login`") ||
    combined.includes("run cursor-agent login") ||
    combined.includes("missing api key") ||
    combined.includes("cursor_api_key")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: formatCursorAuthMessage("Cursor CLI is not authenticated."),
    };
  }

  if (result.code === 0) {
    return {
      status: "ready",
      auth: { status: "authenticated" },
    };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Cursor authentication status. ${detail}`
      : "Could not verify Cursor authentication status.",
  };
}

const runCursorCommand = (
  cursorSettings: CursorSettings,
  args: ReadonlyArray<string>,
  cwd: string,
  environment: NodeJS.ProcessEnv,
) =>
  Effect.tryPromise({
    try: () =>
      runProcess(cursorSettings.binaryPath, [...cursorGlobalArgs(cursorSettings), ...args], {
        cwd,
        env: environment,
        allowNonZeroExit: true,
      }),
    catch: (cause) =>
      new CursorProbeCommandError({
        cause,
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  }).pipe(
    Effect.map((result) => ({
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code ?? 1,
    })),
  );

function baseCursorModels(
  cursorSettings: Pick<CursorSettings, "customModels">,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const models: Array<ServerProviderModel> = [];
  for (const candidate of cursorSettings.customModels) {
    const slug = candidate.trim();
    if (slug.length === 0 || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    models.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: DEFAULT_CURSOR_MODEL_CAPABILITIES,
    });
  }
  return models;
}

export const makePendingCursorProvider = (
  cursorSettings: CursorSettings,
): Effect.Effect<ServerProvider> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = baseCursorModels(cursorSettings);

    if (!cursorSettings.enabled) {
      return buildServerProvider({
        driver: DRIVER,
        displayName: "Cursor",
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Cursor is disabled in Fenrir settings.",
        },
      });
    }

    return buildServerProvider({
      driver: DRIVER,
      displayName: "Cursor",
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Cursor provider status has not been checked in this session yet.",
      },
    });
  });

export const checkCursorProviderStatus = Effect.fn("checkCursorProviderStatus")(function* (
  cursorSettings: CursorSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = baseCursorModels(cursorSettings);

  if (!cursorSettings.enabled) {
    return buildServerProvider({
      driver: DRIVER,
      displayName: "Cursor",
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Cursor is disabled in Fenrir settings.",
      },
    });
  }

  const versionExit = yield* Effect.exit(
    runCursorCommand(cursorSettings, ["--version"], cwd, environment),
  );
  if (versionExit._tag === "Failure") {
    const cause = Cause.squash(versionExit.cause);
    return buildServerProvider({
      driver: DRIVER,
      displayName: "Cursor",
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(cause),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(cause)
          ? "Cursor CLI (`cursor-agent`) is not installed or not on PATH."
          : `Failed to execute Cursor CLI health check: ${cause instanceof Error ? cause.message : "unknown error"}`,
      },
    });
  }

  const versionResult = versionExit.value;
  const version = parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);

  const statusResult = yield* runCursorCommand(cursorSettings, ["status"], cwd, environment).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        stdout: "",
        stderr: error instanceof CursorProbeCommandError ? error.detail : String(error),
        code: 1,
      } satisfies CommandResult),
    ),
  );
  const authStatus = parseCursorAuthStatusFromOutput(statusResult);

  return buildServerProvider({
    driver: DRIVER,
    displayName: "Cursor",
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: authStatus.status,
      auth: authStatus.auth,
      ...(authStatus.message ? { message: authStatus.message } : {}),
    },
  });
});
