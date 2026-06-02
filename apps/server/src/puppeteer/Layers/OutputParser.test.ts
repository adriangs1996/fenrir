import { describe, expect, it } from "vitest";

import { parseBase64FileReadEnvelope, parsePosixFindDirectoryListing } from "./OutputParser";

describe("OutputParser", () => {
  describe("parsePosixFindDirectoryListing", () => {
    it("parses NUL-delimited find records into UI-ready directory entries", () => {
      const stdout = [
        "d\t4096\t1710000000.2500000000\t/var/www",
        "f\t12\t1710000001.0000000000\t/var/www/index.php",
        "d\t4096\t1710000002.5000000000\t/var/www/uploads",
        "l\t9\t1710000003\t/var/www/current",
        "p\t0\t1710000004\t/var/www/socket",
      ].join("\0");

      const result = parsePosixFindDirectoryListing({
        directoryPath: "/var/www",
        stdout: `${stdout}\0`,
      });

      expect(result).toEqual({
        ok: true,
        entries: [
          {
            name: "index.php",
            path: "/var/www/index.php",
            kind: "file",
            sizeBytes: 12,
            modifiedAtMs: 1_710_000_001_000,
          },
          {
            name: "uploads",
            path: "/var/www/uploads",
            kind: "directory",
            sizeBytes: 4096,
            modifiedAtMs: 1_710_000_002_500,
          },
          {
            name: "current",
            path: "/var/www/current",
            kind: "symlink",
            sizeBytes: 9,
            modifiedAtMs: 1_710_000_003_000,
          },
          {
            name: "socket",
            path: "/var/www/socket",
            kind: "other",
            sizeBytes: 0,
            modifiedAtMs: 1_710_000_004_000,
          },
        ],
      });
    });

    it("preserves names with spaces, quotes, and unicode characters", () => {
      const result = parsePosixFindDirectoryListing({
        directoryPath: "/tmp/target",
        stdout: [
          "f\t5\t1710000001\t/tmp/target/a file.txt",
          "f\t7\t1710000002\t/tmp/target/quote'\".txt",
          "f\t9\t1710000003\t/tmp/target/unicode-ñ.txt",
        ].join("\0"),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entries.map((entry) => entry.name)).toEqual([
          "a file.txt",
          "quote'\".txt",
          "unicode-ñ.txt",
        ]);
      }
    });

    it("returns a parse error with partial entries for malformed records", () => {
      const result = parsePosixFindDirectoryListing({
        directoryPath: "/opt/app",
        stdout: [
          "f\t4\t1710000001\t/opt/app/good.txt",
          "malformed",
          "d\t4096\t1710000002\t/opt/app/assets",
        ].join("\0"),
      });

      expect(result).toEqual({
        ok: false,
        message: "Malformed directory listing record at index 1.",
        entries: [
          {
            name: "good.txt",
            path: "/opt/app/good.txt",
            kind: "file",
            sizeBytes: 4,
            modifiedAtMs: 1_710_000_001_000,
          },
          {
            name: "assets",
            path: "/opt/app/assets",
            kind: "directory",
            sizeBytes: 4096,
            modifiedAtMs: 1_710_000_002_000,
          },
        ],
      });
    });
  });

  describe("parseBase64FileReadEnvelope", () => {
    it("parses a base64 file-read envelope into bytes and UTF-8 text", () => {
      const result = parseBase64FileReadEnvelope({
        path: "/var/www/config.php",
        stdout: ["__FENRIR_FILE_READ_BEGIN__", "c2VjcmV0PXRydWUK", "__FENRIR_FILE_READ_END__"].join(
          "\n",
        ),
      });

      expect(result).toEqual({
        ok: true,
        file: {
          path: "/var/www/config.php",
          bytes: new Uint8Array(Buffer.from("secret=true\n")),
          text: "secret=true\n",
          truncated: false,
        },
      });
    });

    it("marks file reads as truncated when the envelope says so", () => {
      const result = parseBase64FileReadEnvelope({
        path: "/var/log/app.log",
        stdout: [
          "__FENRIR_FILE_READ_BEGIN truncated=1__",
          "bGluZSAxCmxpbmUgMgo=",
          "__FENRIR_FILE_READ_END__",
        ].join("\n"),
      });

      expect(result).toEqual({
        ok: true,
        file: {
          path: "/var/log/app.log",
          bytes: new Uint8Array(Buffer.from("line 1\nline 2\n")),
          text: "line 1\nline 2\n",
          truncated: true,
        },
      });
    });

    it("returns a parse error when file-read markers are missing", () => {
      const result = parseBase64FileReadEnvelope({
        path: "/etc/passwd",
        stdout: "root:x:0:0:root:/root:/bin/bash\n",
      });

      expect(result).toEqual({
        ok: false,
        message: "Missing file-read envelope markers.",
      });
    });
  });
});
