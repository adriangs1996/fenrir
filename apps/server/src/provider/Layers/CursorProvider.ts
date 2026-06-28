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
import * as Option from "effect/Option";

import {
  DEFAULT_TIMEOUT_MS,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  type CommandResult,
} from "../providerSnapshot.ts";
import { runProcess } from "../../processRunner.ts";
import { createModelCapabilitiesFromDescriptors } from "../modelCapabilities.ts";

const DRIVER = ProviderDriverKind.make("cursor");
export const CURSOR_CLI_INSTALLATION_DOCS_URL = "https://cursor.com/docs/cli/installation";

class CursorProbeCommandError extends Data.TaggedError("CursorProbeCommandError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

const DEFAULT_CURSOR_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilitiesFromDescriptors(
  [],
);

function cursorGlobalArgs(cursorSettings: Pick<CursorSettings, "apiEndpoint">): Array<string> {
  const endpoint = cursorSettings.apiEndpoint.trim();
  return endpoint.length > 0 ? ["--endpoint", endpoint] : [];
}

function formatCursorAuthMessage(detail: string): string {
  return `${detail} Run \`agent login\` or set \`CURSOR_API_KEY\` and try again.`;
}

export function formatCursorCliCommandMissingMessage(binaryPath: string): string {
  return [
    `Cursor CLI command \`${binaryPath}\` was not found.`,
    `Install or enable the Cursor CLI, make sure \`${binaryPath}\` is on PATH, then restart Fenrir.`,
    `See ${CURSOR_CLI_INSTALLATION_DOCS_URL}.`,
  ].join(" ");
}

export function formatCursorCliHealthCheckFailure(input: {
  readonly timedOut?: boolean;
  readonly code?: number | null;
}): string {
  const detail =
    input.timedOut === true
      ? "Timed out while running `agent --version`."
      : typeof input.code === "number"
        ? `\`agent --version\` exited with code ${input.code}.`
        : "The health check could not be executed.";
  return [
    "Cursor CLI is installed but failed the health check.",
    detail,
    "Check your Cursor CLI setup and restart Fenrir.",
    `See ${CURSOR_CLI_INSTALLATION_DOCS_URL}.`,
  ].join(" ");
}

export function formatCursorAcpSetupFailureMessage(): string {
  return [
    "Cursor ACP setup failed.",
    "Cursor CLI setup may be incomplete; install or enable the Cursor CLI, restart Fenrir, and try again.",
    `See ${CURSOR_CLI_INSTALLATION_DOCS_URL}.`,
    "Check server logs for ACP details.",
  ].join(" ");
}

function isCursorCommandMissingCause(cause: unknown): boolean {
  if (isCommandMissingCause(cause)) {
    return true;
  }
  if (cause instanceof CursorProbeCommandError) {
    return (
      isCommandMissingCause(cause.cause) || cause.detail.toLowerCase().includes("command not found")
    );
  }
  return false;
}

export function parseCursorAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    combined.includes("not authenticated") ||
    combined.includes("run `agent login`") ||
    combined.includes("run agent login") ||
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

  return {
    status: "warning",
    auth: { status: "unknown" },
    message:
      result.code !== 0
        ? `Could not verify Cursor authentication status. \`agent status\` exited with code ${result.code}.`
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
      timedOut: result.timedOut,
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
    runCursorCommand(cursorSettings, ["--version"], cwd, environment).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    ),
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
        installed: !isCursorCommandMissingCause(cause),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCursorCommandMissingCause(cause)
          ? formatCursorCliCommandMissingMessage(cursorSettings.binaryPath)
          : formatCursorCliHealthCheckFailure({}),
      },
    });
  }

  if (Option.isNone(versionExit.value)) {
    return buildServerProvider({
      driver: DRIVER,
      displayName: "Cursor",
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: formatCursorCliHealthCheckFailure({ timedOut: true }),
      },
    });
  }

  const versionResult = versionExit.value.value;
  const version = parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.timedOut || versionResult.code !== 0) {
    return buildServerProvider({
      driver: DRIVER,
      displayName: "Cursor",
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: formatCursorCliHealthCheckFailure({
          timedOut: versionResult.timedOut,
          code: versionResult.code,
        }),
      },
    });
  }

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
