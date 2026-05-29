import { Buffer } from "node:buffer";

import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@fenrir/contracts";
import { Effect, FileSystem, Path } from "effect";

import { createAttachmentId, resolveAttachmentPath } from "./attachmentStore.ts";
import { ServerConfig } from "./config.ts";

export class ImageAttachmentMaterializationError extends Error {
  readonly _tag = "ImageAttachmentMaterializationError";
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
    .join("");
}

function normalizeImageAttachmentName(name: string, fallbackName: string): string {
  const trimmed = name.split("").map(replaceControlCharacters).join("").replace(/\s+/g, " ").trim();
  const normalized = trimmed.length > 0 ? trimmed : fallbackName;
  return normalized.slice(0, 255).replace(/[.\s]+$/g, "") || fallbackName;
}

export const persistImageAttachment = Effect.fn("persistImageAttachment")(function* (input: {
  readonly threadId: ThreadId;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array | Buffer;
  readonly fallbackName?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  const mimeType = input.mimeType.trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    return yield* Effect.fail(
      new ImageAttachmentMaterializationError(`Unsupported image MIME type '${input.mimeType}'.`),
    );
  }

  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
  if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return yield* Effect.fail(
      new ImageAttachmentMaterializationError("Image attachment is empty or too large."),
    );
  }

  const attachmentId = createAttachmentId(input.threadId);
  if (!attachmentId) {
    return yield* Effect.fail(
      new ImageAttachmentMaterializationError("Failed to create a safe attachment id."),
    );
  }

  const attachment: ChatAttachment = {
    type: "image",
    id: attachmentId,
    name: normalizeImageAttachmentName(input.name, input.fallbackName ?? "image"),
    mimeType,
    sizeBytes: bytes.byteLength,
  };

  const attachmentPath = resolveAttachmentPath({
    attachmentsDir: serverConfig.attachmentsDir,
    attachment,
  });
  if (!attachmentPath) {
    return yield* Effect.fail(
      new ImageAttachmentMaterializationError(`Failed to resolve path for '${attachment.name}'.`),
    );
  }

  yield* fileSystem
    .makeDirectory(path.dirname(attachmentPath), { recursive: true })
    .pipe(
      Effect.mapError(
        () =>
          new ImageAttachmentMaterializationError(
            `Failed to create attachment directory for '${attachment.name}'.`,
          ),
      ),
    );
  yield* fileSystem
    .writeFile(attachmentPath, bytes)
    .pipe(
      Effect.mapError(
        () =>
          new ImageAttachmentMaterializationError(
            `Failed to persist attachment '${attachment.name}'.`,
          ),
      ),
    );

  return attachment;
});
