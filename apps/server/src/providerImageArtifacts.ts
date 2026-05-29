import { Buffer } from "node:buffer";

import { type ProviderRuntimeEvent, type ThreadId, type TurnId } from "@fenrir/contracts";
import { Effect, Option } from "effect";

import { fenrirImageUri, parseFenrirImageArtifactId } from "./assistantImageMaterialization.ts";
import { persistImageAttachment } from "./imageAttachmentMaterialization.ts";
import { inferImageExtension, parseBase64DataUrl } from "./imageMime.ts";
import { ProjectionThreadImageArtifactRepository } from "./persistence/Services/ProjectionThreadImageArtifacts.ts";

const FENRIR_IMAGE_URI_PATTERN = /fenrir-image:\/\/([a-z0-9_-]{1,128})/gi;

interface FenrirImageHandleEntry {
  readonly artifactId: string;
  readonly uri: string;
  readonly name?: string;
  readonly mimeType?: string;
}

interface ProviderImageContent {
  readonly data: string;
  readonly mimeType: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function resultRecordFromProviderData(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  const item = asRecord(root?.item);
  return asRecord(item?.result) ?? asRecord(root?.result) ?? root;
}

function normalizeBase64ImageData(value: string): string | null {
  const data = value.trim().replace(/\s+/g, "");
  if (data.startsWith("data:")) {
    return parseBase64DataUrl(data)?.base64 ?? null;
  }
  return /^[a-z0-9+/]+={0,2}$/i.test(data) ? data : null;
}

function extractProviderImageContent(result: Record<string, unknown>): ProviderImageContent[] {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.flatMap((entry) => {
    const record = asRecord(entry);
    const type = asString(record?.type)?.toLowerCase();
    const data = asString(record?.data);
    const mimeType = asString(record?.mimeType)?.toLowerCase();
    if (type !== "image" || !data || !mimeType?.startsWith("image/")) {
      return [];
    }
    const normalizedData = normalizeBase64ImageData(data);
    return normalizedData ? [{ data: normalizedData, mimeType }] : [];
  });
}

function extractHandleFromUnknown(value: unknown): FenrirImageHandleEntry | null {
  if (typeof value === "string") {
    const artifactId = parseFenrirImageArtifactId(value);
    return artifactId ? { artifactId, uri: fenrirImageUri(artifactId) } : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const rawHandle = asString(record.uri) ?? asString(record.handle) ?? asString(record.id);
  if (!rawHandle) {
    return null;
  }
  const artifactId = parseFenrirImageArtifactId(rawHandle);
  if (!artifactId) {
    return null;
  }

  const name = asString(record.name);
  const mimeType = asString(record.mimeType)?.toLowerCase();
  return {
    artifactId,
    uri: fenrirImageUri(artifactId),
    ...(name ? { name } : {}),
    ...(mimeType?.startsWith("image/") ? { mimeType } : {}),
  };
}

function extractStructuredFenrirImageHandles(
  result: Record<string, unknown>,
): FenrirImageHandleEntry[] {
  const structuredContent = asRecord(result.structuredContent);
  const rawHandles = structuredContent?.fenrirImageHandles;
  if (!Array.isArray(rawHandles)) {
    return [];
  }
  return rawHandles.flatMap((entry) => {
    const handle = extractHandleFromUnknown(entry);
    return handle ? [handle] : [];
  });
}

function extractTextFenrirImageHandles(result: Record<string, unknown>): FenrirImageHandleEntry[] {
  const content = Array.isArray(result.content) ? result.content : [];
  const handles: FenrirImageHandleEntry[] = [];
  for (const entry of content) {
    const record = asRecord(entry);
    if (asString(record?.type)?.toLowerCase() !== "text") {
      continue;
    }
    const text = asString(record?.text);
    if (!text) {
      continue;
    }
    for (const match of text.matchAll(FENRIR_IMAGE_URI_PATTERN)) {
      const artifactId = parseFenrirImageArtifactId(match[1] ?? "");
      if (artifactId) {
        handles.push({ artifactId, uri: fenrirImageUri(artifactId) });
      }
    }
  }
  return handles;
}

function dedupeFenrirImageHandles(
  handles: ReadonlyArray<FenrirImageHandleEntry>,
): FenrirImageHandleEntry[] {
  const seen = new Set<string>();
  const deduped: FenrirImageHandleEntry[] = [];
  for (const handle of handles) {
    if (seen.has(handle.artifactId)) {
      continue;
    }
    seen.add(handle.artifactId);
    deduped.push(handle);
  }
  return deduped;
}

function fallbackImageName(input: { readonly index: number; readonly mimeType: string }): string {
  const extension = inferImageExtension({
    mimeType: input.mimeType,
    fileName: `tool-image-${input.index + 1}`,
  });
  return `tool-image-${input.index + 1}${extension}`;
}

export const materializeProviderRuntimeImageArtifacts = Effect.fn(
  "materializeProviderRuntimeImageArtifacts",
)(function* (input: {
  readonly event: ProviderRuntimeEvent;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
}) {
  if (input.event.type !== "item.completed" && input.event.type !== "item.updated") {
    return;
  }

  const result = resultRecordFromProviderData(input.event.payload.data);
  if (!result) {
    return;
  }

  const images = extractProviderImageContent(result);
  if (images.length === 0) {
    return;
  }

  const handles = dedupeFenrirImageHandles([
    ...extractStructuredFenrirImageHandles(result),
    ...extractTextFenrirImageHandles(result),
  ]);
  if (handles.length === 0) {
    return;
  }

  const imageArtifactRepository = yield* ProjectionThreadImageArtifactRepository;

  yield* Effect.forEach(
    images.slice(0, handles.length),
    (image, index) =>
      Effect.gen(function* () {
        const handle = handles[index];
        if (!handle) {
          return;
        }

        const existingArtifact = yield* imageArtifactRepository.getByThreadIdAndArtifactId({
          threadId: input.threadId,
          artifactId: handle.artifactId,
        });
        if (Option.isSome(existingArtifact)) {
          return;
        }

        const bytes = Buffer.from(image.data, "base64");
        const mimeType = handle.mimeType ?? image.mimeType;
        const attachment = yield* persistImageAttachment({
          threadId: input.threadId,
          name: handle.name ?? fallbackImageName({ index, mimeType }),
          mimeType,
          bytes,
          fallbackName: fallbackImageName({ index, mimeType }),
        });

        yield* imageArtifactRepository.upsert({
          artifactId: handle.artifactId,
          threadId: input.threadId,
          turnId: input.turnId ?? null,
          attachment,
          sourceKind: "provider-tool-image",
          sourceEventId: input.event.eventId,
          createdAt: input.event.createdAt,
        });
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to materialize provider image artifact", {
            eventId: input.event.eventId,
            cause,
          }),
        ),
      ),
    { concurrency: 1 },
  ).pipe(Effect.asVoid);
});

function redactImageContentEntry(entry: unknown): unknown {
  const record = asRecord(entry);
  if (!record || asString(record.type)?.toLowerCase() !== "image") {
    return entry;
  }

  const mimeType = asString(record.mimeType);
  const data = asString(record.data);
  return {
    ...record,
    ...(mimeType ? { mimeType } : {}),
    ...(data ? { data: `[redacted image data: ${data.length} chars]` } : {}),
  };
}

export function redactProviderRuntimeImageDataForActivity(data: unknown): unknown {
  const root = asRecord(data);
  if (!root) {
    return data;
  }

  const item = asRecord(root.item);
  const result = asRecord(item?.result) ?? asRecord(root.result) ?? null;
  if (!result || !Array.isArray(result.content)) {
    return data;
  }

  const nextResult = {
    ...result,
    content: result.content.map(redactImageContentEntry),
  };

  if (item?.result) {
    return {
      ...root,
      item: {
        ...item,
        result: nextResult,
      },
    };
  }

  if (root.result) {
    return {
      ...root,
      result: nextResult,
    };
  }

  return {
    ...root,
    content: nextResult.content,
  };
}
