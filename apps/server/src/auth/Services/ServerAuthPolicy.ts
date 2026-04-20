import type { ServerAuthDescriptor } from "@fenrir/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ServerAuthPolicyShape {
  readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
}

export class ServerAuthPolicy extends ServiceMap.Service<ServerAuthPolicy, ServerAuthPolicyShape>()(
  "t3/auth/Services/ServerAuthPolicy",
) {}
