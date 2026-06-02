export type RemoteDirectoryEntryKind = "directory" | "file" | "symlink" | "other";

export interface RemoteDirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: RemoteDirectoryEntryKind;
  readonly sizeBytes: number | null;
  readonly modifiedAtMs: number | null;
}

export type RemoteDirectoryListingParseResult =
  | {
      readonly ok: true;
      readonly entries: ReadonlyArray<RemoteDirectoryEntry>;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly entries: ReadonlyArray<RemoteDirectoryEntry>;
    };

export interface ParseRemoteDirectoryListingInput {
  readonly directoryPath: string;
  readonly stdout: string;
}

export interface RemoteFileReadResult {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly text: string | null;
  readonly truncated: boolean;
}

export type RemoteFileReadParseResult =
  | {
      readonly ok: true;
      readonly file: RemoteFileReadResult;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export interface ParseRemoteFileReadInput {
  readonly path: string;
  readonly stdout: string;
}

export function parsePosixFindDirectoryListing(
  input: ParseRemoteDirectoryListingInput,
): RemoteDirectoryListingParseResult {
  const entries: RemoteDirectoryEntry[] = [];
  const records = input.stdout.split("\0").filter((record) => record.length > 0);
  let parseError: string | null = null;

  records.forEach((record, index) => {
    const fields = splitRecordFields(record);
    if (!fields) {
      parseError ??= `Malformed directory listing record at index ${index}.`;
      return;
    }

    const [type, sizeRaw, modifiedRaw, path] = fields;
    if (normalizePath(path) === normalizePath(input.directoryPath)) {
      return;
    }

    const name = basenameFromPath(path);
    if (!name) {
      parseError ??= `Malformed directory listing record at index ${index}.`;
      return;
    }

    entries.push({
      name,
      path,
      kind: entryKindFromFindType(type),
      sizeBytes: parseNullableNumber(sizeRaw),
      modifiedAtMs: parseModifiedAtMs(modifiedRaw),
    });
  });

  return parseError ? { ok: false, message: parseError, entries } : { ok: true, entries };
}

export function parseBase64FileReadEnvelope(
  input: ParseRemoteFileReadInput,
): RemoteFileReadParseResult {
  const beginMatch = input.stdout.match(/^__FENRIR_FILE_READ_BEGIN__(?:\r?\n)?/m);
  const truncatedBeginMatch = input.stdout.match(
    /^__FENRIR_FILE_READ_BEGIN truncated=1__(?:\r?\n)?/m,
  );
  const begin = truncatedBeginMatch ?? beginMatch;
  const end = input.stdout.match(/\r?\n?__FENRIR_FILE_READ_END__$/m);

  if (!begin || !end || begin.index === undefined || end.index === undefined) {
    return { ok: false, message: "Missing file-read envelope markers." };
  }

  const payloadStart = begin.index + begin[0].length;
  const payload = input.stdout.slice(payloadStart, end.index).replace(/\s+/g, "");
  const bytes = new Uint8Array(Buffer.from(payload, "base64"));
  const decoded = Buffer.from(bytes).toString("utf8");

  return {
    ok: true,
    file: {
      path: input.path,
      bytes,
      text: decoded.includes("\uFFFD") ? null : decoded,
      truncated: Boolean(truncatedBeginMatch),
    },
  };
}

function splitRecordFields(record: string): [string, string, string, string] | null {
  const first = record.indexOf("\t");
  if (first < 0) return null;
  const second = record.indexOf("\t", first + 1);
  if (second < 0) return null;
  const third = record.indexOf("\t", second + 1);
  if (third < 0) return null;

  return [
    record.slice(0, first),
    record.slice(first + 1, second),
    record.slice(second + 1, third),
    record.slice(third + 1),
  ];
}

function entryKindFromFindType(type: string): RemoteDirectoryEntryKind {
  switch (type) {
    case "d":
      return "directory";
    case "f":
      return "file";
    case "l":
      return "symlink";
    default:
      return "other";
  }
}

function parseNullableNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseModifiedAtMs(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000) : null;
}

function basenameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/g, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function normalizePath(path: string): string {
  const normalized = path.replace(/[\\/]+$/g, "");
  return normalized === "" ? path : normalized;
}
