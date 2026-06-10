import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ThreadId,
} from "@fenrir/contracts";
import { Effect, Layer, Option, Schema } from "effect";

import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { ProviderSessionDirectoryPersistenceError, ProviderValidationError } from "../Errors.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderSessionDirectoryShape,
} from "../Services/ProviderSessionDirectory.ts";

function toPersistenceError(operation: string) {
  return (cause: unknown) =>
    new ProviderSessionDirectoryPersistenceError({
      operation,
      detail: `Failed to execute ${operation}.`,
      cause,
    });
}

const isProviderDriverKind = Schema.is(ProviderDriverKind);
const isProviderInstanceId = Schema.is(ProviderInstanceId);

function decodeProviderDriverKind(
  providerName: string,
  operation: string,
): Effect.Effect<ProviderDriverKind, ProviderSessionDirectoryPersistenceError> {
  if (isProviderDriverKind(providerName)) {
    return Effect.succeed(ProviderDriverKind.make(providerName));
  }
  return Effect.fail(
    new ProviderSessionDirectoryPersistenceError({
      operation,
      detail: `Unknown persisted provider '${providerName}'.`,
    }),
  );
}

function resolvePersistedProviderInstanceId(
  provider: ProviderDriverKind,
  adapterKey: string | undefined,
): ProviderInstanceId {
  if (typeof adapterKey === "string" && isProviderInstanceId(adapterKey)) {
    return ProviderInstanceId.make(adapterKey);
  }
  return defaultInstanceIdForDriver(provider);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeRuntimePayload(
  existing: unknown | null,
  next: unknown | null | undefined,
): unknown | null {
  if (next === undefined) {
    return existing ?? null;
  }
  if (isRecord(existing) && isRecord(next)) {
    return { ...existing, ...next };
  }
  return next;
}

const makeProviderSessionDirectory = Effect.gen(function* () {
  const repository = yield* ProviderSessionRuntimeRepository;

  const getBinding = (threadId: ThreadId) =>
    repository.getByThreadId({ threadId }).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.getBinding:getByThreadId")),
      Effect.flatMap((runtime) =>
        Option.match(runtime, {
          onNone: () => Effect.succeed(Option.none<ProviderRuntimeBinding>()),
          onSome: (value) =>
            decodeProviderDriverKind(
              value.providerName,
              "ProviderSessionDirectory.getBinding",
            ).pipe(
              Effect.map((provider) =>
                Option.some({
                  threadId: value.threadId,
                  provider,
                  providerInstanceId: resolvePersistedProviderInstanceId(
                    provider,
                    value.adapterKey,
                  ),
                  adapterKey: value.adapterKey,
                  lastSeenAt: value.lastSeenAt,
                  runtimeMode: value.runtimeMode,
                  status: value.status,
                  resumeCursor: value.resumeCursor,
                  runtimePayload: value.runtimePayload,
                }),
              ),
            ),
        }),
      ),
    );

  const upsert: ProviderSessionDirectoryShape["upsert"] = Effect.fn(function* (binding) {
    const existing = yield* repository
      .getByThreadId({ threadId: binding.threadId })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:getByThreadId")));

    const existingRuntime = Option.getOrUndefined(existing);
    const resolvedThreadId = binding.threadId ?? existingRuntime?.threadId;
    if (!resolvedThreadId) {
      return yield* new ProviderValidationError({
        operation: "ProviderSessionDirectory.upsert",
        issue: "threadId must be a non-empty string.",
      });
    }

    const now = new Date().toISOString();
    const providerChanged =
      existingRuntime !== undefined && existingRuntime.providerName !== binding.provider;
    const existingProviderInstanceId =
      existingRuntime === undefined
        ? undefined
        : resolvePersistedProviderInstanceId(
            ProviderDriverKind.make(existingRuntime.providerName),
            existingRuntime.adapterKey,
          );
    const explicitProviderInstanceId =
      binding.providerInstanceId ??
      (typeof binding.adapterKey === "string" && isProviderInstanceId(binding.adapterKey)
        ? ProviderInstanceId.make(binding.adapterKey)
        : undefined);
    const resolvedProviderInstanceId =
      explicitProviderInstanceId ??
      (providerChanged
        ? defaultInstanceIdForDriver(binding.provider)
        : (existingProviderInstanceId ?? defaultInstanceIdForDriver(binding.provider)));
    yield* repository
      .upsert({
        threadId: resolvedThreadId,
        providerName: binding.provider,
        adapterKey: resolvedProviderInstanceId,
        runtimeMode: binding.runtimeMode ?? existingRuntime?.runtimeMode ?? "full-access",
        status: binding.status ?? existingRuntime?.status ?? "running",
        lastSeenAt: now,
        resumeCursor:
          binding.resumeCursor !== undefined
            ? binding.resumeCursor
            : (existingRuntime?.resumeCursor ?? null),
        runtimePayload: mergeRuntimePayload(
          existingRuntime?.runtimePayload ?? null,
          binding.runtimePayload,
        ),
      })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:upsert")));
  });

  const getProvider: ProviderSessionDirectoryShape["getProvider"] = (threadId) =>
    getBinding(threadId).pipe(
      Effect.flatMap((binding) =>
        Option.match(binding, {
          onSome: (value) => Effect.succeed(value.provider),
          onNone: () =>
            Effect.fail(
              new ProviderSessionDirectoryPersistenceError({
                operation: "ProviderSessionDirectory.getProvider",
                detail: `No persisted provider binding found for thread '${threadId}'.`,
              }),
            ),
        }),
      ),
    );

  const listThreadIds: ProviderSessionDirectoryShape["listThreadIds"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listThreadIds:list")),
      Effect.map((rows) => rows.map((row) => row.threadId)),
    );

  const listBindings: ProviderSessionDirectoryShape["listBindings"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listBindings:list")),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (value) =>
            decodeProviderDriverKind(
              value.providerName,
              "ProviderSessionDirectory.listBindings",
            ).pipe(
              Effect.map((provider) => ({
                threadId: value.threadId,
                provider,
                providerInstanceId: resolvePersistedProviderInstanceId(provider, value.adapterKey),
                adapterKey: value.adapterKey,
                lastSeenAt: value.lastSeenAt,
                runtimeMode: value.runtimeMode,
                status: value.status,
                resumeCursor: value.resumeCursor,
                runtimePayload: value.runtimePayload,
              })),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    );

  return {
    upsert,
    getProvider,
    getBinding,
    listBindings,
    listThreadIds,
  } satisfies ProviderSessionDirectoryShape;
});

export const ProviderSessionDirectoryLive = Layer.effect(
  ProviderSessionDirectory,
  makeProviderSessionDirectory,
);

export function makeProviderSessionDirectoryLive() {
  return Layer.effect(ProviderSessionDirectory, makeProviderSessionDirectory);
}
