import {
  McpServerId,
  type McpServerDefinition,
  type ProviderSelectionKind,
  type ServerProviderMcpCapabilities,
} from "@fenrir/contracts";

export function getProviderMcpCompatibility(input: {
  provider: ProviderSelectionKind;
  capabilities: ServerProviderMcpCapabilities | null | undefined;
  servers: ReadonlyArray<McpServerDefinition>;
  selectedIds: ReadonlyArray<McpServerId>;
}): string | null {
  if (input.selectedIds.length === 0) return null;
  const capabilities = input.capabilities;
  const selectedServers = input.selectedIds.flatMap((serverId) => {
    const server = input.servers.find((candidate) => candidate.id === serverId);
    return server ? [server] : [];
  });
  const names =
    selectedServers.length > 0
      ? selectedServers.map((server) => `"${server.name}"`).join(", ")
      : "selected MCP servers";

  if (!capabilities?.supported) {
    return `${names} require MCP support, but provider "${input.provider}" does not currently support MCP servers in Fenrir.`;
  }

  const incompatible = selectedServers.find(
    (server) => !capabilities.transports[server.transport.type],
  );
  if (!incompatible) return null;

  return `Selected MCP server "${incompatible.name}" requires MCP ${incompatible.transport.type} support, but provider "${input.provider}" does not currently support that MCP transport in Fenrir.`;
}
