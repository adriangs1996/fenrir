import {
  type CreateRemoteHostInput,
  type DeleteRemoteHostInput,
  type ListRemoteCommandRunsInput,
  type ListRemoteDirectoryInput,
  type ListRemoteDirectoryResult,
  type RemoteCommandRunSnapshot,
  type RemoteConnectionSnapshot,
  type RemoteControllerEvent,
  type RemoteHostSnapshot,
  RemoteControllerRpcError as RemoteControllerError,
  type SendRemoteCommandInput,
  type SetRemoteConnectionPathInput,
  type StartRemoteConnectionInput,
  type StopRemoteConnectionInput,
  type UpdateRemoteHostInput,
} from "@fenrir/contracts";
import { Context, Effect } from "effect";

export { RemoteControllerError };

export interface RemoteControllerServiceShape {
  readonly listHosts: () => Effect.Effect<readonly RemoteHostSnapshot[]>;
  readonly createHost: (
    input: CreateRemoteHostInput,
  ) => Effect.Effect<RemoteHostSnapshot, RemoteControllerError>;
  readonly updateHost: (
    input: UpdateRemoteHostInput,
  ) => Effect.Effect<RemoteHostSnapshot, RemoteControllerError>;
  readonly deleteHost: (input: DeleteRemoteHostInput) => Effect.Effect<void, RemoteControllerError>;
  readonly startConnection: (
    input: StartRemoteConnectionInput,
  ) => Effect.Effect<RemoteConnectionSnapshot, RemoteControllerError>;
  readonly stopConnection: (
    input: StopRemoteConnectionInput,
  ) => Effect.Effect<RemoteConnectionSnapshot, RemoteControllerError>;
  readonly setConnectionPath: (
    input: SetRemoteConnectionPathInput,
  ) => Effect.Effect<RemoteConnectionSnapshot, RemoteControllerError>;
  readonly listConnections: () => Effect.Effect<readonly RemoteConnectionSnapshot[]>;
  readonly sendCommand: (
    input: SendRemoteCommandInput,
  ) => Effect.Effect<RemoteCommandRunSnapshot, RemoteControllerError>;
  readonly listCommandRuns: (
    input: ListRemoteCommandRunsInput,
  ) => Effect.Effect<readonly RemoteCommandRunSnapshot[]>;
  readonly listDirectory: (
    input: ListRemoteDirectoryInput,
  ) => Effect.Effect<ListRemoteDirectoryResult, RemoteControllerError>;
  readonly subscribe: (
    callback: (event: RemoteControllerEvent) => void,
  ) => Effect.Effect<() => void>;
}

export type StartConnectionType = RemoteControllerServiceShape["startConnection"];
export type SendCommandType = RemoteControllerServiceShape["sendCommand"];

export class RemoteControllerService extends Context.Service<
  RemoteControllerService,
  RemoteControllerServiceShape
>()("fenrir/pupeteer/RemoteControllerService") {}
