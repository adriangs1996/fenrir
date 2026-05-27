import type { ResolvedMcpServerConfig } from "@fenrir/contracts";

export type CodexMcpConfig = {
  readonly mcp_servers: Record<string, unknown>;
};

function safeServerName(server: ResolvedMcpServerConfig): string {
  const safe = server.id
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || "fenrir_mcp_server";
}

export function toCodexMcpConfig(
  servers: ReadonlyArray<ResolvedMcpServerConfig> | undefined,
): CodexMcpConfig | undefined {
  if (!servers || servers.length === 0) {
    return undefined;
  }

  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const transport = server.transport;
    switch (transport.type) {
      case "stdio":
        mcpServers[safeServerName(server)] = {
          command: transport.command,
          args: transport.args,
          env: transport.env,
          ...(transport.cwd ? { cwd: transport.cwd } : {}),
        };
        break;
      case "http":
        mcpServers[safeServerName(server)] = {
          url: transport.url,
          http_headers: transport.headers,
        };
        break;
      case "sse":
        throw new Error(
          `Selected MCP server "${server.name}" uses SSE, but Codex MCP support in Fenrir only supports stdio and HTTP.`,
        );
    }
  }

  return { mcp_servers: mcpServers };
}
