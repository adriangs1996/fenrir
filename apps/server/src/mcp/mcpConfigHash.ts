import { createHash } from "node:crypto";
import type { ResolvedMcpServerConfig } from "@fenrir/contracts";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function redactedServer(server: ResolvedMcpServerConfig): unknown {
  if (server.transport.type === "stdio") {
    return {
      ...server,
      transport: {
        ...server.transport,
        env: Object.fromEntries(
          Object.keys(server.transport.env)
            .toSorted()
            .map((key) => [key, "<set>"]),
        ),
      },
    };
  }
  return {
    ...server,
    transport: {
      ...server.transport,
      headers: Object.fromEntries(
        Object.keys(server.transport.headers)
          .toSorted()
          .map((key) => [key, "<set>"]),
      ),
    },
  };
}

export function hashResolvedMcpServers(servers: ReadonlyArray<ResolvedMcpServerConfig>): string {
  const payload = servers.map(redactedServer).toSorted((left, right) => {
    const leftId = typeof left === "object" && left && "id" in left ? String(left.id) : "";
    const rightId = typeof right === "object" && right && "id" in right ? String(right.id) : "";
    return leftId.localeCompare(rightId);
  });
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}
