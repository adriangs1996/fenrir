import type { LocalServersSnapshot } from "@fenrir/contracts";
import type { Effect } from "effect";
import { Context } from "effect";

export interface LocalServerDiscoveryShape {
  readonly scan: Effect.Effect<LocalServersSnapshot>;
  readonly subscribe: (
    listener: (snapshot: LocalServersSnapshot) => void,
  ) => Effect.Effect<() => void>;
  readonly registerTerminalProcesses: (input: {
    readonly threadId: string;
    readonly terminalId: string;
    readonly processIds: ReadonlyArray<number>;
  }) => Effect.Effect<void>;
  readonly unregisterTerminal: (input: {
    readonly threadId: string;
    readonly terminalId: string;
  }) => Effect.Effect<void>;
  readonly unregisterThread: (input: { readonly threadId: string }) => Effect.Effect<void>;
}

export class LocalServerDiscovery extends Context.Service<
  LocalServerDiscovery,
  LocalServerDiscoveryShape
>()("fenrir/localServers/LocalServerDiscovery") {}
