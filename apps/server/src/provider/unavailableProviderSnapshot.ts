import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@fenrir/contracts";
import { Effect } from "effect";

import { buildServerProvider } from "./providerSnapshot.ts";

export interface UnavailableProviderSnapshotInput {
  readonly driverKind: string;
  readonly instanceId: ProviderInstanceId;
  readonly displayName?: string;
  readonly accentColor?: string;
  readonly reason: string;
  readonly checkedAt: string;
}

export const buildUnavailableProviderSnapshot = (
  input: UnavailableProviderSnapshotInput,
): Effect.Effect<ServerProvider> =>
  Effect.succeed({
    ...buildServerProvider({
      instanceId: input.instanceId,
      driver: ProviderDriverKind.makeUnsafe(input.driverKind),
      displayName: input.displayName?.trim() || input.driverKind,
      enabled: false,
      checkedAt: input.checkedAt,
      availability: "unavailable",
      unavailableReason: input.reason,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: input.reason,
      },
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    }),
    status: "error",
    availability: "unavailable",
    unavailableReason: input.reason,
  });
