import { Schema, Context } from "effect";
import type { Effect } from "effect";
import type * as Socket from "effect/unstable/socket/Socket";

export class BrowserLabControlError extends Schema.TaggedErrorClass<BrowserLabControlError>()(
  "BrowserLabControlError",
  {
    message: Schema.String,
  },
) {}

export interface BrowserLabControlServiceShape {
  readonly isConnected: Effect.Effect<boolean>;
  readonly registerSocket: (socket: Socket.Socket) => Effect.Effect<void>;
  readonly call: (
    method: string,
    params: unknown,
  ) => Effect.Effect<unknown, BrowserLabControlError>;
}

export class BrowserLabControlService extends Context.Service<
  BrowserLabControlService,
  BrowserLabControlServiceShape
>()("fenrir/browserLab/BrowserLabControlService") {}
