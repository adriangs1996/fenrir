import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderKind,
  ProviderSessionRuntimeStatus,
  RuntimeMode,
  ThreadId,
} from "@fenrir/contracts";
import { Option, Context } from "effect";
import type { Effect } from "effect";

import type {
  ProviderSessionDirectoryPersistenceError,
  ProviderValidationError,
} from "../Errors.ts";

export interface ProviderRuntimeBinding {
  readonly threadId: ThreadId;
  readonly provider: ProviderKind | ProviderDriverKind;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly adapterKey?: string;
  readonly lastSeenAt?: string;
  readonly status?: ProviderSessionRuntimeStatus;
  readonly resumeCursor?: unknown | null;
  readonly runtimePayload?: unknown | null;
  readonly runtimeMode?: RuntimeMode;
}

export type ProviderSessionDirectoryReadError = ProviderSessionDirectoryPersistenceError;

export type ProviderSessionDirectoryWriteError =
  | ProviderValidationError
  | ProviderSessionDirectoryPersistenceError;

export interface ProviderSessionDirectoryShape {
  readonly upsert: (
    binding: ProviderRuntimeBinding,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;

  readonly getProvider: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderKind | ProviderDriverKind, ProviderSessionDirectoryReadError>;

  readonly getBinding: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProviderRuntimeBinding>, ProviderSessionDirectoryReadError>;

  readonly listBindings: () => Effect.Effect<
    ReadonlyArray<ProviderRuntimeBinding>,
    ProviderSessionDirectoryReadError
  >;

  readonly listThreadIds: () => Effect.Effect<
    ReadonlyArray<ThreadId>,
    ProviderSessionDirectoryPersistenceError
  >;
}

export class ProviderSessionDirectory extends Context.Service<
  ProviderSessionDirectory,
  ProviderSessionDirectoryShape
>()("t3/provider/Services/ProviderSessionDirectory") {}
