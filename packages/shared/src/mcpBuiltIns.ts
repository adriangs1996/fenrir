import { McpServerId, type McpServerDefinition, type ServerSettings } from "@fenrir/contracts";

const BUILT_IN_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const FENRIR_BROWSER_LAB_MCP_ID = McpServerId.make("fenrir-browser-lab");
export const FENRIR_REMOTE_HOST_MCP_ID = McpServerId.make("fenrir-remote-host");
export const FENRIR_WORKFLOWS_MCP_ID = McpServerId.make("fenrir-workflows");

export const FENRIR_BUILT_IN_MCP_SERVERS: ReadonlyArray<McpServerDefinition> = [
  {
    id: FENRIR_BROWSER_LAB_MCP_ID,
    name: "Browser Lab",
    description: "Fenrir Browser Lab and Traffic Lens tools for the current desktop browser lab.",
    enabled: true,
    source: "fenrir",
    transport: {
      type: "stdio",
      command: "<fenrir-browser-lab-mcp-runner>",
      args: [],
      env: {},
    },
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
  },
  {
    id: FENRIR_REMOTE_HOST_MCP_ID,
    name: "Remote Host",
    description:
      "Fenrir Remote Host tools for creating command-template hosts, starting connections, and running remote commands.",
    enabled: true,
    source: "fenrir",
    transport: {
      type: "stdio",
      command: "<fenrir-remote-host-mcp-runner>",
      args: [],
      env: {},
    },
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
  },
  {
    id: FENRIR_WORKFLOWS_MCP_ID,
    name: "Workflows",
    description:
      "Fenrir workflow tools for creating, listing, running, and stopping workflows scoped to the current chat thread.",
    enabled: true,
    source: "fenrir",
    transport: {
      type: "stdio",
      command: "<fenrir-workflows-mcp-runner>",
      args: [],
      env: {},
    },
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP,
  },
];

export function getFenrirBuiltInMcpServers(
  settings?: Pick<ServerSettings, "disabledBuiltInMcpServerIds">,
): ReadonlyArray<McpServerDefinition> {
  const disabled = new Set(settings?.disabledBuiltInMcpServerIds ?? []);
  return FENRIR_BUILT_IN_MCP_SERVERS.map((server) =>
    Object.assign({}, server, {
      enabled: server.enabled && !disabled.has(server.id),
    }),
  );
}

export function getSelectableMcpServers(
  settings: Pick<ServerSettings, "mcpServers" | "disabledBuiltInMcpServerIds">,
): ReadonlyArray<McpServerDefinition> {
  return [...getFenrirBuiltInMcpServers(settings), ...Object.values(settings.mcpServers)].filter(
    (server) => server.enabled,
  );
}
