import { describe, expect, it } from "vitest";

import * as RpcModule from "./rpc";
import { WsRpcGroup } from "./rpc";

function getWsRpcGroupMethods(): string[] {
  const requests = Reflect.get(WsRpcGroup, "requests");
  if (!(requests instanceof Map)) {
    throw new Error("WsRpcGroup requests map is unavailable.");
  }
  return [...requests.keys()].toSorted();
}

function getDeclaredWsRpcMethods(): string[] {
  return Object.entries(RpcModule)
    .filter(([name, value]) => name !== "WsRpcGroup" && name.endsWith("Rpc") && value !== undefined)
    .map(([, value]) => {
      const method = Reflect.get(value as object, "_tag");
      if (typeof method !== "string") {
        throw new Error("Encountered an RPC export without a string method tag.");
      }
      return method;
    })
    .toSorted();
}

describe("WsRpcGroup", () => {
  it("registers every declared websocket rpc descriptor", () => {
    expect(getWsRpcGroupMethods()).toEqual(getDeclaredWsRpcMethods());
  });

  it("does not expose legacy local git operation RPC names", () => {
    const methods = new Set(getWsRpcGroupMethods());
    const legacyMethods = [
      ["subscribe", "Git", "Status"],
      ["git", "refreshStatus"],
      ["git", "pull"],
      ["git", "listBranches"],
      ["git", "createWorktree"],
      ["git", "removeWorktree"],
      ["git", "createBranch"],
      ["git", "checkout"],
      ["git", "init"],
    ].map((parts) => (parts[0] === "git" ? parts.join(".") : parts.join("")));

    for (const method of legacyMethods) {
      expect(methods).not.toContain(method);
    }
  });
});
