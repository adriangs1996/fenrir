import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@fenrir/contracts";
import { Effect, FileSystem, Option, Path } from "effect";

import {
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPathById,
  toSafeThreadAttachmentSegment,
} from "./attachmentStore.ts";
import { ServerConfig } from "./config.ts";
import { persistImageAttachment } from "./imageAttachmentMaterialization.ts";
import { inferImageExtension, inferImageMimeType, parseBase64DataUrl } from "./imageMime.ts";
import { ProjectionThreadImageArtifactRepository } from "./persistence/Services/ProjectionThreadImageArtifacts.ts";

export const FENRIR_IMAGE_URI_PREFIX = "fenrir-image://";
export const ASSISTANT_MESSAGE_IMAGE_LIMIT = 16;

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]\r\n]*)\]\(([^)\r\n]*)\)/g;
const FENRIR_IMAGE_ARTIFACT_ID_PATTERN = /^[a-z0-9_-]{1,128}$/i;

export function fenrirImageUri(artifactId: string): string {
  return `${FENRIR_IMAGE_URI_PREFIX}${artifactId}`;
}

export function parseFenrirImageArtifactId(value: string): string | null {
  const trimmed = value.trim();
  const id = trimmed.startsWith(FENRIR_IMAGE_URI_PREFIX)
    ? trimmed.slice(FENRIR_IMAGE_URI_PREFIX.length)
    : trimmed;
  if (!FENRIR_IMAGE_ARTIFACT_ID_PATTERN.test(id)) {
    return null;
  }
  return id;
}

function isRemoteImageSource(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function attachmentBelongsToThread(input: {
  readonly threadId: ThreadId;
  readonly attachmentId: string;
}): boolean {
  const expectedThreadSegment = toSafeThreadAttachmentSegment(input.threadId);
  if (!expectedThreadSegment) {
    return false;
  }
  return parseThreadSegmentFromAttachmentId(input.attachmentId) === expectedThreadSegment;
}

function parseMarkdownImageDestination(rawDestination: string): string | null {
  const destination = rawDestination.trim();
  if (destination.length === 0) {
    return null;
  }
  if (destination.startsWith("<")) {
    const closeIndex = destination.indexOf(">");
    return closeIndex > 1 ? destination.slice(1, closeIndex) : null;
  }
  return destination.split(/\s+/)[0] ?? null;
}

function replaceControlCharacters(value: string): string {
  return value
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
    .join("");
}

function attachmentNameFromAlt(input: {
  readonly alt: string;
  readonly fallbackBaseName: string;
  readonly mimeType: string;
}): string {
  const baseName =
    input.alt
      .split("")
      .map(replaceControlCharacters)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || input.fallbackBaseName;
  const extension = inferImageExtension({ mimeType: input.mimeType, fileName: baseName });
  return /\.[a-z0-9]{1,8}$/i.test(baseName) ? baseName : `${baseName}${extension}`;
}

function decodeLocalImageSource(input: {
  readonly source: string;
  readonly cwd: string | undefined;
  readonly path: Path.Path;
}): string | null {
  const source = input.source.trim();
  if (source.length === 0) {
    return null;
  }

  if (source.startsWith("file://")) {
    try {
      return fileURLToPath(new URL(source));
    } catch {
      return null;
    }
  }

  if (input.path.isAbsolute(source)) {
    return source;
  }

  if (!input.cwd) {
    return null;
  }

  return input.path.resolve(input.cwd, source);
}

const resolveExistingAttachment = Effect.fn("resolveExistingAttachment")(function* (input: {
  readonly threadId: ThreadId;
  readonly attachmentId: string;
  readonly existingAttachmentsById: ReadonlyMap<string, ChatAttachment>;
}) {
  const existing = input.existingAttachmentsById.get(input.attachmentId);
  if (
    existing &&
    attachmentBelongsToThread({ threadId: input.threadId, attachmentId: input.attachmentId })
  ) {
    return existing;
  }

  if (
    !FENRIR_IMAGE_ARTIFACT_ID_PATTERN.test(input.attachmentId) ||
    !attachmentBelongsToThread({ threadId: input.threadId, attachmentId: input.attachmentId })
  ) {
    return null;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const attachmentPath = resolveAttachmentPathById({
    attachmentsDir: serverConfig.attachmentsDir,
    attachmentId: input.attachmentId,
  });
  if (!attachmentPath) {
    return null;
  }

  const fileInfo = yield* fileSystem
    .stat(attachmentPath)
    .pipe(Effect.catch(() => Effect.succeed(null)));
  const sizeBytes = fileInfo ? Number(fileInfo.size) : 0;
  if (!fileInfo || fileInfo.type !== "File" || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return null;
  }

  const mimeType = inferImageMimeType({ fileName: attachmentPath });
  if (!mimeType) {
    return null;
  }

  return {
    type: "image" as const,
    id: input.attachmentId,
    name: path.basename(attachmentPath),
    mimeType,
    sizeBytes,
  };
});

const resolveFenrirImageAttachment = Effect.fn("resolveFenrirImageAttachment")(function* (input: {
  readonly threadId: ThreadId;
  readonly artifactId: string;
  readonly existingAttachmentsById: ReadonlyMap<string, ChatAttachment>;
}) {
  const directAttachment = yield* resolveExistingAttachment({
    threadId: input.threadId,
    attachmentId: input.artifactId,
    existingAttachmentsById: input.existingAttachmentsById,
  });
  if (directAttachment) {
    return directAttachment;
  }

  const imageArtifactRepository = yield* ProjectionThreadImageArtifactRepository;
  const artifact = yield* imageArtifactRepository.getByThreadIdAndArtifactId({
    threadId: input.threadId,
    artifactId: input.artifactId,
  });
  if (Option.isNone(artifact)) {
    return null;
  }

  return yield* resolveExistingAttachment({
    threadId: input.threadId,
    attachmentId: artifact.value.attachment.id,
    existingAttachmentsById: new Map([[artifact.value.attachment.id, artifact.value.attachment]]),
  });
});

const materializeLocalImagePath = Effect.fn("materializeLocalImagePath")(function* (input: {
  readonly threadId: ThreadId;
  readonly sourcePath: string;
  readonly alt: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const fileInfo = yield* fileSystem
    .stat(input.sourcePath)
    .pipe(Effect.catch(() => Effect.succeed(null)));
  const sizeBytes = fileInfo ? Number(fileInfo.size) : 0;
  if (!fileInfo || fileInfo.type !== "File" || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return null;
  }

  const mimeType = inferImageMimeType({ fileName: input.sourcePath });
  if (!mimeType) {
    return null;
  }

  const bytes = yield* fileSystem
    .readFile(input.sourcePath)
    .pipe(Effect.catch(() => Effect.succeed(null)));
  if (!bytes) {
    return null;
  }

  return yield* persistImageAttachment({
    threadId: input.threadId,
    name:
      input.alt.trim().length > 0
        ? attachmentNameFromAlt({
            alt: input.alt,
            fallbackBaseName: "image",
            mimeType,
          })
        : path.basename(input.sourcePath),
    mimeType,
    bytes,
    fallbackName: path.basename(input.sourcePath),
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to materialize assistant local image", {
        sourcePath: input.sourcePath,
        cause: cause.message,
      }).pipe(Effect.as(null)),
    ),
  );
});

const materializeDataUrlImage = Effect.fn("materializeDataUrlImage")(function* (input: {
  readonly threadId: ThreadId;
  readonly source: string;
  readonly alt: string;
}) {
  const parsed = parseBase64DataUrl(input.source);
  if (!parsed || !parsed.mimeType.startsWith("image/")) {
    return null;
  }

  const bytes = Buffer.from(parsed.base64, "base64");
  return yield* persistImageAttachment({
    threadId: input.threadId,
    name: attachmentNameFromAlt({
      alt: input.alt,
      fallbackBaseName: "inline-image",
      mimeType: parsed.mimeType,
    }),
    mimeType: parsed.mimeType,
    bytes,
    fallbackName: "inline-image",
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to materialize assistant data-url image", {
        cause: cause.message,
      }).pipe(Effect.as(null)),
    ),
  );
});

const resolveMarkdownImageSource = Effect.fn("resolveMarkdownImageSource")(function* (input: {
  readonly threadId: ThreadId;
  readonly cwd: string | undefined;
  readonly source: string;
  readonly alt: string;
  readonly existingAttachmentsById: ReadonlyMap<string, ChatAttachment>;
}) {
  const source = input.source.trim();
  if (source.length === 0 || isRemoteImageSource(source)) {
    return null;
  }

  if (source.startsWith(FENRIR_IMAGE_URI_PREFIX)) {
    const artifactId = parseFenrirImageArtifactId(source);
    return artifactId
      ? yield* resolveFenrirImageAttachment({
          threadId: input.threadId,
          artifactId,
          existingAttachmentsById: input.existingAttachmentsById,
        })
      : null;
  }

  if (source.startsWith("/attachments/")) {
    const rawId = source.slice("/attachments/".length).split(/[?#]/, 1)[0] ?? "";
    const decodedId = (() => {
      try {
        return decodeURIComponent(rawId);
      } catch {
        return "";
      }
    })();
    const attachmentId = parseFenrirImageArtifactId(decodedId);
    return attachmentId
      ? yield* resolveExistingAttachment({
          threadId: input.threadId,
          attachmentId,
          existingAttachmentsById: input.existingAttachmentsById,
        })
      : null;
  }

  if (source.startsWith("data:")) {
    return yield* materializeDataUrlImage({
      threadId: input.threadId,
      source,
      alt: input.alt,
    });
  }

  const path = yield* Path.Path;
  const localPath = decodeLocalImageSource({ source, cwd: input.cwd, path });
  if (!localPath) {
    return null;
  }

  return yield* materializeLocalImagePath({
    threadId: input.threadId,
    sourcePath: localPath,
    alt: input.alt,
  });
});

export const materializeAssistantMarkdownImages = Effect.fn("materializeAssistantMarkdownImages")(
  function* (input: {
    readonly threadId: ThreadId;
    readonly cwd: string | undefined;
    readonly text: string;
    readonly existingAttachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) {
    if (!input.text.includes("![")) {
      return {
        text: input.text,
        attachments: input.existingAttachments ?? [],
      };
    }

    const existingAttachmentsById = new Map<string, ChatAttachment>();
    for (const attachment of input.existingAttachments ?? []) {
      existingAttachmentsById.set(attachment.id, attachment);
    }

    const attachmentsById = new Map(existingAttachmentsById);
    let resolvedImageCount = 0;
    let cursor = 0;
    let rewrittenText = "";

    for (const match of input.text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
      const matchStart = match.index ?? 0;
      const rawMatch = match[0] ?? "";
      const alt = match[1] ?? "";
      const rawDestination = match[2] ?? "";
      rewrittenText += input.text.slice(cursor, matchStart);
      cursor = matchStart + rawMatch.length;

      const source = parseMarkdownImageDestination(rawDestination);
      if (!source || resolvedImageCount >= ASSISTANT_MESSAGE_IMAGE_LIMIT) {
        rewrittenText += rawMatch;
        continue;
      }

      const attachment = yield* resolveMarkdownImageSource({
        threadId: input.threadId,
        cwd: input.cwd,
        source,
        alt,
        existingAttachmentsById,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to resolve assistant markdown image", {
            source,
            cause,
          }).pipe(Effect.as(null)),
        ),
      );

      if (!attachment) {
        rewrittenText += rawMatch;
        continue;
      }

      attachmentsById.set(attachment.id, attachment);
      resolvedImageCount += 1;
      rewrittenText += `![${alt}](${fenrirImageUri(attachment.id)})`;
    }

    rewrittenText += input.text.slice(cursor);

    return {
      text: rewrittenText,
      attachments: [...attachmentsById.values()],
    };
  },
);
