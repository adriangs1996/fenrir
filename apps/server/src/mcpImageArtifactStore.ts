import { Buffer } from "node:buffer";

import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@fenrir/contracts";
import { Effect, FileSystem, Path } from "effect";

import { fenrirImageUri, parseFenrirImageArtifactId } from "./assistantImageMaterialization.ts";
import { resolveAttachmentRelativePath } from "./attachmentPaths.ts";
import { ServerConfig } from "./config.ts";
import { inferImageExtension, parseBase64DataUrl } from "./imageMime.ts";

const MCP_IMAGE_ARTIFACTS_DIR = "_mcp-image-artifacts";
const base64CharactersPattern = /^[a-z0-9+/]+={0,2}$/i;

export interface StoredMcpImageArtifact {
  readonly artifactId: string;
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly data: string;
  readonly sizeBytes: number;
}

interface StoredMcpImageArtifactMetadata {
  readonly artifactId: string;
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeBase64ImageData(value: string): string | null {
  const data = value.trim().replace(/\s+/g, "");
  if (data.startsWith("data:")) {
    return parseBase64DataUrl(data)?.base64 ?? null;
  }
  return base64CharactersPattern.test(data) ? data : null;
}

function decodeCanonicalBase64ImageData(base64: string): Buffer | null {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return null;
  }

  const canonicalInput = base64.replace(/=+$/g, "");
  const canonicalDecoded = bytes.toString("base64").replace(/=+$/g, "");
  return canonicalInput === canonicalDecoded ? bytes : null;
}

function normalizeImageMimeType(value: unknown): string | null {
  const mimeType = asString(value)?.toLowerCase();
  return mimeType?.startsWith("image/") ? mimeType : null;
}

function normalizeImageName(value: unknown, fallback: string): string {
  const trimmed = asString(value)
    ?.split("")
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255)
    .replace(/[.\s]+$/g, "");
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function metadataRelativePath(artifactId: string): string {
  return `${MCP_IMAGE_ARTIFACTS_DIR}/${artifactId}.json`;
}

function artifactRelativePath(input: { readonly artifactId: string; readonly mimeType: string }) {
  const extension = inferImageExtension({ mimeType: input.mimeType, fileName: input.artifactId });
  return `${MCP_IMAGE_ARTIFACTS_DIR}/${input.artifactId}${extension}`;
}

function resolveStorePath(input: {
  readonly attachmentsDir: string;
  readonly relativePath: string;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: input.relativePath,
  });
}

function parseStoredMetadata(value: unknown): StoredMcpImageArtifactMetadata | null {
  const record = asRecord(value);
  const artifactId = parseFenrirImageArtifactId(asString(record?.artifactId) ?? "");
  const name = asString(record?.name);
  const mimeType = normalizeImageMimeType(record?.mimeType);
  const relativePath = asString(record?.relativePath);
  const sizeBytes = typeof record?.sizeBytes === "number" ? record.sizeBytes : NaN;
  if (
    !artifactId ||
    !name ||
    !mimeType ||
    !relativePath ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return null;
  }
  return {
    artifactId,
    uri: fenrirImageUri(artifactId),
    name,
    mimeType,
    relativePath,
    sizeBytes,
  };
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export const persistMcpImageArtifact = Effect.fn("persistMcpImageArtifact")(function* (input: {
  readonly artifactId: string;
  readonly name?: string | undefined;
  readonly mimeType: string;
  readonly data: string;
}) {
  const artifactId = parseFenrirImageArtifactId(input.artifactId);
  const mimeType = normalizeImageMimeType(input.mimeType);
  const base64 = normalizeBase64ImageData(input.data);
  const bytes = base64 ? decodeCanonicalBase64ImageData(base64) : null;
  if (!artifactId || !mimeType || !base64 || !bytes) {
    return yield* Effect.fail(new Error("Invalid MCP image artifact."));
  }

  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relativePath = artifactRelativePath({ artifactId, mimeType });
  const filePath = resolveStorePath({ attachmentsDir: config.attachmentsDir, relativePath });
  const metadataPath = resolveStorePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: metadataRelativePath(artifactId),
  });
  if (!filePath || !metadataPath) {
    return yield* Effect.fail(new Error("Failed to resolve MCP image artifact path."));
  }

  const metadata: StoredMcpImageArtifactMetadata = {
    artifactId,
    uri: fenrirImageUri(artifactId),
    name: normalizeImageName(input.name, "browser-lab-screenshot.png"),
    mimeType,
    relativePath,
    sizeBytes: bytes.byteLength,
  };

  yield* fileSystem.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* fileSystem.writeFile(filePath, bytes);
  yield* fileSystem.writeFileString(metadataPath, `${JSON.stringify(metadata)}\n`);

  return {
    ...metadata,
    data: base64,
  } satisfies StoredMcpImageArtifact;
});

export const readMcpImageArtifact = Effect.fn("readMcpImageArtifact")(function* (input: {
  readonly artifactId: string;
}) {
  const artifactId = parseFenrirImageArtifactId(input.artifactId);
  if (!artifactId) {
    return null;
  }

  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const metadataPath = resolveStorePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: metadataRelativePath(artifactId),
  });
  if (!metadataPath) {
    return null;
  }

  const rawMetadata = yield* fileSystem
    .readFileString(metadataPath)
    .pipe(Effect.catch(() => Effect.succeed(null)));
  if (!rawMetadata) {
    return null;
  }

  const metadata = parseStoredMetadata(parseJson(rawMetadata));
  if (!metadata) {
    return null;
  }

  const filePath = resolveStorePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: metadata.relativePath,
  });
  if (!filePath) {
    return null;
  }

  const bytes = yield* fileSystem.readFile(filePath).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return null;
  }

  return {
    artifactId: metadata.artifactId,
    uri: metadata.uri,
    name: metadata.name,
    mimeType: metadata.mimeType,
    data: Buffer.from(bytes).toString("base64"),
    sizeBytes: bytes.byteLength,
  } satisfies StoredMcpImageArtifact;
});
