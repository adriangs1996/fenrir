import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  defaultInstanceIdForDriver,
  OpenCodeSettings,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerSettings,
} from "@fenrir/contracts";
import { deepMerge } from "@fenrir/shared/Struct";
import { Effect, Schema } from "effect";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getDefaultInstanceEntry(
  settings: ServerSettings,
  provider: ProviderKind,
  providerInstanceId?: ProviderInstanceId,
): ProviderInstanceConfig | undefined {
  const entry =
    settings.providerInstances[providerInstanceId ?? defaultInstanceIdForDriver(provider)];
  return entry?.driver === provider ? entry : undefined;
}

function resolveMergedSettings<T extends Record<string, unknown>>(input: {
  readonly provider: ProviderKind | string;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly base: T;
  readonly schema: Schema.Schema<T>;
  readonly entry: ProviderInstanceConfig | undefined;
}): Effect.Effect<T> {
  const overridePayload = input.entry?.config;
  const decode = Schema.decodeUnknownSync(input.schema as never) as (input: unknown) => T;
  const merged = deepMerge(input.base as Record<string, unknown>, {
    ...(typeof input.entry?.enabled === "boolean" ? { enabled: input.entry.enabled } : {}),
    ...(isRecord(overridePayload) ? overridePayload : {}),
  });

  return Effect.sync(() => {
    try {
      return { ok: true as const, value: decode(merged) };
    } catch (cause) {
      return { ok: false as const, cause };
    }
  }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.succeed(result.value)
        : Effect.logWarning("Ignoring invalid default provider instance config override", {
            provider: input.provider,
            driver: ProviderDriverKind.makeUnsafe(input.provider),
            instanceId: input.providerInstanceId ?? defaultInstanceIdForDriver(input.provider),
            cause: result.cause,
          }).pipe(Effect.as(input.base)),
    ),
  );
}

export const resolveEffectiveCodexSettings = (
  settings: ServerSettings,
  providerInstanceId?: ProviderInstanceId,
): Effect.Effect<CodexSettings> =>
  resolveMergedSettings({
    provider: "codex",
    ...(providerInstanceId !== undefined ? { providerInstanceId } : {}),
    base: settings.providers.codex,
    schema: CodexSettings,
    entry: getDefaultInstanceEntry(settings, "codex", providerInstanceId),
  });

export const resolveEffectiveClaudeSettings = (
  settings: ServerSettings,
  providerInstanceId?: ProviderInstanceId,
): Effect.Effect<ClaudeSettings> =>
  resolveMergedSettings({
    provider: "claudeAgent",
    ...(providerInstanceId !== undefined ? { providerInstanceId } : {}),
    base: settings.providers.claudeAgent,
    schema: ClaudeSettings,
    entry: getDefaultInstanceEntry(settings, "claudeAgent", providerInstanceId),
  });

function getExactInstanceEntry(
  settings: ServerSettings,
  providerInstanceId: ProviderInstanceId,
  driver: string,
): ProviderInstanceConfig | undefined {
  const entry = settings.providerInstances[providerInstanceId];
  return entry?.driver === driver ? entry : undefined;
}

export const resolveOpenCodeInstanceSettings = (
  settings: ServerSettings,
  providerInstanceId: ProviderInstanceId = defaultInstanceIdForDriver("opencode"),
): Effect.Effect<OpenCodeSettings> =>
  resolveMergedSettings({
    provider: "opencode",
    providerInstanceId,
    base: Schema.decodeSync(OpenCodeSettings)({}),
    schema: OpenCodeSettings,
    entry: getExactInstanceEntry(settings, providerInstanceId, "opencode"),
  });

export const resolveCursorInstanceSettings = (
  settings: ServerSettings,
  providerInstanceId: ProviderInstanceId = defaultInstanceIdForDriver("cursor"),
): Effect.Effect<CursorSettings> =>
  resolveMergedSettings({
    provider: "cursor",
    providerInstanceId,
    base: Schema.decodeSync(CursorSettings)({}),
    schema: CursorSettings,
    entry: getExactInstanceEntry(settings, providerInstanceId, "cursor"),
  });
