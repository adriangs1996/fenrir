import type { RemoteDirectoryEntry } from "@fenrir/contracts";
import { describe, expect, it } from "vitest";

import { basenameFromRemotePath, sortRemoteDirectoryEntries } from "./RemoteFileTree.logic";

const entry = (
  name: string,
  kind: RemoteDirectoryEntry["kind"],
  path = `./${name}`,
): RemoteDirectoryEntry => ({
  name,
  path,
  kind,
  sizeBytes: null,
  modifiedAtMs: null,
});

describe("RemoteFileTree logic", () => {
  it("sorts directories before symlinks, files, and other entries", () => {
    expect(
      sortRemoteDirectoryEntries([
        entry("z.txt", "file"),
        entry("socket", "other"),
        entry("app", "directory"),
        entry("current", "symlink"),
        entry("a.txt", "file"),
      ]).map((item) => `${item.kind}:${item.name}`),
    ).toEqual(["directory:app", "symlink:current", "file:a.txt", "file:z.txt", "other:socket"]);
  });

  it("extracts labels from posix and windows-style remote paths", () => {
    expect(basenameFromRemotePath("/var/www/index.php")).toBe("index.php");
    expect(basenameFromRemotePath("C:\\inetpub\\wwwroot\\web.config")).toBe("web.config");
    expect(basenameFromRemotePath(".")).toBe(".");
  });
});
