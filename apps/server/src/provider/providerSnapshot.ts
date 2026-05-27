import {
  ModelCapabilities,
  type ProviderKind,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderAuth,
  type ServerProviderMcpCapabilities,
  ServerProviderModel,
  ServerProviderState,
} from "@fenrir/contracts";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { normalizeModelSlug } from "@fenrir/shared/model";
import { isWindowsCommandNotFound } from "../processRunner";

export const DEFAULT_TIMEOUT_MS = 4_000;
// Auth status checks involve disk/network lookups and can be slow on first run (especially Windows)
export const AUTH_PROBE_TIMEOUT_MS = 10_000;

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface ProviderProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
}

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isCommandMissingCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return lower.includes("enoent") || lower.includes("notfound");
}

export const spawnAndCollect = (binaryPath: string, command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    const result: CommandResult = { stdout, stderr, code: exitCode };
    if (isWindowsCommandNotFound(exitCode, stderr)) {
      return yield* Effect.fail(new Error(`spawn ${binaryPath} ENOENT`));
    }
    return result;
  }).pipe(Effect.scoped);

export function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return "Timed out while running command.";
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

export function extractAuthBoolean(value: unknown): boolean | undefined {
  if (globalThis.Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function parseGenericCliVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

export function providerModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  provider: ProviderKind,
  customModels: ReadonlyArray<string>,
  customModelCapabilities: ModelCapabilities,
): ReadonlyArray<ServerProviderModel> {
  const resolvedBuiltInModels = [...builtInModels];
  const seen = new Set(resolvedBuiltInModels.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];

  for (const candidate of customModels) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    customEntries.push({
      slug: normalized,
      name: normalized,
      isCustom: true,
      capabilities: customModelCapabilities,
    });
  }

  return [...resolvedBuiltInModels, ...customEntries];
}

export function buildServerProvider(input: {
  provider?: ProviderKind;
  instanceId?: ProviderInstanceId;
  driver?: ProviderDriverKind;
  displayName?: string;
  accentColor?: string;
  availability?: ServerProvider["availability"];
  unavailableReason?: string;
  enabled: boolean;
  checkedAt: string;
  models: ReadonlyArray<ServerProviderModel>;
  probe: ProviderProbeResult;
  mcpCapabilities?: ServerProviderMcpCapabilities;
}): ServerProvider {
  const fallbackProvider = input.provider;
  const fallbackDriver =
    input.driver ??
    (fallbackProvider ? ProviderDriverKind.makeUnsafe(fallbackProvider) : undefined);
  const fallbackInstanceId =
    input.instanceId ??
    (fallbackProvider ? ProviderInstanceId.makeUnsafe(fallbackProvider) : undefined);
  const mcpCapabilities = input.mcpCapabilities ?? defaultMcpCapabilities(input);
  return {
    ...(fallbackProvider ? { provider: fallbackProvider } : {}),
    ...(fallbackInstanceId ? { instanceId: fallbackInstanceId } : {}),
    ...(fallbackDriver ? { driver: fallbackDriver } : {}),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    enabled: input.enabled,
    installed: input.probe.installed,
    version: input.probe.version,
    status: input.enabled ? input.probe.status : "disabled",
    auth: input.probe.auth,
    checkedAt: input.checkedAt,
    ...(input.probe.message ? { message: input.probe.message } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
    ...(input.unavailableReason ? { unavailableReason: input.unavailableReason } : {}),
    models: input.models,
    ...(mcpCapabilities ? { mcpCapabilities } : {}),
  };
}

function defaultMcpCapabilities(input: {
  readonly provider?: ProviderKind;
  readonly driver?: ProviderDriverKind;
}): ServerProviderMcpCapabilities | undefined {
  const kind = input.driver ?? input.provider;
  if (kind === "codex") {
    return { supported: true, transports: { stdio: true, http: true, sse: false } };
  }
  if (kind === "claudeAgent" || kind === "cursor") {
    return { supported: true, transports: { stdio: true, http: true, sse: true } };
  }
  if (kind === "opencode") {
    return { supported: false, transports: { stdio: false, http: false, sse: false } };
  }
  return undefined;
}

export const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );
