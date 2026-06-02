import {
  CreateRemoteHostInput,
  DeleteRemoteHostInput,
  ListRemoteCommandRunsInput,
  ListRemoteDirectoryInput,
  SendRemoteCommandInput,
  SetRemoteConnectionPathInput,
  StartRemoteConnectionInput,
  StopRemoteConnectionInput,
  UpdateRemoteHostInput,
} from "@fenrir/contracts";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import {
  RemoteControllerError,
  RemoteControllerService,
  type RemoteControllerServiceShape,
} from "../puppeteer/Services/RemoteControllerService.ts";
import { getRemoteHostMcpToken } from "./remoteHostMcpRuntime.ts";

const RemoteHostMcpCall = Schema.Struct({
  toolName: Schema.String,
  input: Schema.optional(Schema.Unknown),
});

const decodeCreateHostInput = Schema.decodeUnknownSync(CreateRemoteHostInput);
const decodeUpdateHostInput = Schema.decodeUnknownSync(UpdateRemoteHostInput);
const decodeDeleteHostInput = Schema.decodeUnknownSync(DeleteRemoteHostInput);
const decodeStartConnectionInput = Schema.decodeUnknownSync(StartRemoteConnectionInput);
const decodeStopConnectionInput = Schema.decodeUnknownSync(StopRemoteConnectionInput);
const decodeSetConnectionPathInput = Schema.decodeUnknownSync(SetRemoteConnectionPathInput);
const decodeSendCommandInput = Schema.decodeUnknownSync(SendRemoteCommandInput);
const decodeListCommandRunsInput = Schema.decodeUnknownSync(ListRemoteCommandRunsInput);
const decodeListDirectoryInput = Schema.decodeUnknownSync(ListRemoteDirectoryInput);
const isRemoteControllerError = Schema.is(RemoteControllerError);

function bearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const authorization = request.headers["authorization"];
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function jsonResponse(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status });
}

const unknownRemoteHostTool = (toolName: string) =>
  new RemoteControllerError({ message: `Unknown Remote Host MCP tool ${toolName}` });

export function callRemoteHostMcpTool(
  controller: RemoteControllerServiceShape,
  toolName: string,
  input: unknown = {},
): Effect.Effect<unknown, RemoteControllerError> {
  switch (toolName) {
    case "remote_host_list_hosts":
      return controller.listHosts();
    case "remote_host_create_host":
      return controller.createHost(decodeCreateHostInput(input));
    case "remote_host_update_host":
      return controller.updateHost(decodeUpdateHostInput(input));
    case "remote_host_delete_host":
      return controller.deleteHost(decodeDeleteHostInput(input)).pipe(Effect.as({ deleted: true }));
    case "remote_host_start_connection":
      return controller.startConnection(decodeStartConnectionInput(input));
    case "remote_host_stop_connection":
      return controller.stopConnection(decodeStopConnectionInput(input));
    case "remote_host_list_connections":
      return controller.listConnections();
    case "remote_host_send_command":
      return controller.sendCommand(decodeSendCommandInput(input));
    case "remote_host_set_path":
      return controller.setConnectionPath(decodeSetConnectionPathInput(input));
    case "remote_host_list_command_runs":
      return controller.listCommandRuns(decodeListCommandRunsInput(input));
    case "remote_host_list_directory":
      return controller.listDirectory(decodeListDirectoryInput(input));
    default:
      return Effect.fail(unknownRemoteHostTool(toolName));
  }
}

export const remoteHostMcpCallRouteLayer = HttpRouter.add(
  "POST",
  "/api/internal/mcp/remote-host/call",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (bearerToken(request) !== getRemoteHostMcpToken()) {
      return HttpServerResponse.text("Unauthorized", { status: 401 });
    }
    const payload = yield* HttpServerRequest.schemaBodyJson(RemoteHostMcpCall);
    const controller = yield* RemoteControllerService;
    const result = yield* callRemoteHostMcpTool(controller, payload.toolName, payload.input ?? {});
    return jsonResponse({ ok: true, result });
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Remote Host MCP call failed.",
          },
          {
            status:
              isRemoteControllerError(error) &&
              error.message.startsWith("Unknown Remote Host MCP tool")
                ? 404
                : 500,
          },
        ),
      ),
    ),
  ),
);

export const RemoteHostMcpHttpLive = Layer.mergeAll(remoteHostMcpCallRouteLayer);
