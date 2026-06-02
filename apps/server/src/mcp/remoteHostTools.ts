import { z } from "zod";
import type * as z4 from "zod/v4/core";

type RemoteHostInputSchema = Record<string, z4.$ZodType>;
type RemoteHostToolContent = { type: "text"; text: string };

interface RemoteHostToolCallResult {
  [key: string]: unknown;
  content: RemoteHostToolContent[];
}

interface RemoteHostMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: RemoteHostInputSchema;
}

const emptyInputSchema = {};
const remoteHostId = z.string().min(1).describe("Remote host id.");
const remoteConnectionId = z.string().min(1).describe("Remote connection id.");
const remoteRunConnectionId = remoteConnectionId.optional();
const commandTemplateTransport = z.object({
  type: z.literal("command-template").describe("Remote transport kind."),
  command: z
    .string()
    .min(1)
    .describe("Runner command, for example ssh, sh, python, or a CTF exploit wrapper."),
  args: z
    .array(z.string())
    .describe(
      "Runner args. Include {command} where the remote command should be inserted, for example ['user@host', 'sh -lc {command}'] or ['-lc', '{command}'].",
    )
    .optional(),
  commandPlaceholder: z
    .string()
    .min(1)
    .describe("Placeholder token to replace in args. Defaults to {command}.")
    .optional(),
  cwd: z.string().min(1).describe("Local working directory for the runner process.").optional(),
  env: z
    .record(z.string(), z.string())
    .describe("Environment variables for the runner process.")
    .optional(),
});
const hostInputSchema = {
  hostId: remoteHostId
    .describe("Optional stable host id. Omit to let Fenrir generate one.")
    .optional(),
  label: z.string().min(1).describe("Human-readable remote host label."),
  description: z.string().describe("Optional notes about this host.").optional(),
  transport: commandTemplateTransport.describe(
    "Command template transport. Fenrir runs this local command and substitutes the requested remote command into the template.",
  ),
};
const updateHostInputSchema = {
  hostId: remoteHostId,
  label: z.string().min(1).describe("New host label.").optional(),
  description: z.string().describe("New host notes.").optional(),
  transport: commandTemplateTransport
    .describe("Replacement command template transport.")
    .optional(),
};
const startConnectionInputSchema = {
  hostId: remoteHostId
    .describe("Host id to start. Omit when supplying an explicit transport.")
    .optional(),
  connectionId: remoteConnectionId
    .describe("Optional stable connection id. Omit to let Fenrir generate one.")
    .optional(),
  label: z.string().min(1).describe("Connection label. Defaults to the host label.").optional(),
  transport: commandTemplateTransport
    .describe("Explicit command template transport for an ad hoc connection.")
    .optional(),
  path: z.string().min(1).describe("Initial remote working directory. Defaults to '.'").optional(),
};

export const REMOTE_HOST_MCP_TOOLS = [
  {
    name: "remote_host_list_hosts",
    description: "List configured Fenrir remote hosts.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "remote_host_create_host",
    description:
      "Create a Fenrir remote host backed by a command template such as ssh -lc {command}, a local shell, or a CTF/RCE wrapper.",
    inputSchema: hostInputSchema,
  },
  {
    name: "remote_host_update_host",
    description: "Update a Fenrir remote host label, notes, or command template transport.",
    inputSchema: updateHostInputSchema,
  },
  {
    name: "remote_host_delete_host",
    description: "Delete a Fenrir remote host and stop any active connections for it.",
    inputSchema: { hostId: remoteHostId },
  },
  {
    name: "remote_host_start_connection",
    description:
      "Start a remote connection from an existing host or explicit command template transport.",
    inputSchema: startConnectionInputSchema,
  },
  {
    name: "remote_host_stop_connection",
    description: "Stop a remote connection.",
    inputSchema: { connectionId: remoteConnectionId },
  },
  {
    name: "remote_host_list_connections",
    description: "List remote host connections and their current path state.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "remote_host_send_command",
    description:
      "Run a command through a remote connection. The remote controller preserves path state for cd commands.",
    inputSchema: {
      connectionId: remoteConnectionId,
      command: z.string().describe("Command to run on the remote host."),
    },
  },
  {
    name: "remote_host_set_path",
    description: "Set the remote connection path state after validating it on the remote host.",
    inputSchema: {
      connectionId: remoteConnectionId,
      path: z.string().min(1).describe("Remote directory to use as the connection path."),
    },
  },
  {
    name: "remote_host_list_command_runs",
    description: "List remote command runs, optionally scoped to one connection.",
    inputSchema: { connectionId: remoteRunConnectionId },
  },
  {
    name: "remote_host_list_directory",
    description: "List files and directories through the remote connection.",
    inputSchema: {
      connectionId: remoteConnectionId,
      path: z.string().min(1).describe("Remote directory path to list."),
      limit: z.number().int().positive().max(500).describe("Maximum entries to return.").optional(),
    },
  },
] satisfies ReadonlyArray<RemoteHostMcpTool>;

export function truncateRemoteHostToolResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  const maxLength = 120_000;
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... truncated ${text.length - maxLength} characters`;
}

export function formatRemoteHostToolResult(result: unknown): RemoteHostToolCallResult {
  return {
    content: [{ type: "text", text: truncateRemoteHostToolResult(result) }],
  };
}
