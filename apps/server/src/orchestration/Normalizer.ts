import { Effect } from "effect";
import {
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@fenrir/contracts";

import { persistImageAttachment } from "../imageAttachmentMaterialization";
import { parseBase64DataUrl } from "../imageMime";
import { WorkspacePaths } from "../workspace/Services/WorkspacePaths";

export const normalizeDispatchCommand = (command: ClientOrchestrationCommand) =>
  Effect.gen(function* () {
    const workspacePaths = yield* WorkspacePaths;

    const normalizeProjectWorkspaceRoot = (
      workspaceRoot: string,
      options?: {
        createIfMissing?: boolean;
      },
    ) =>
      workspacePaths.normalizeWorkspaceRoot(workspaceRoot, options).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationDispatchCommandError({
              message: cause.message,
            }),
        ),
      );

    if (command.type === "project.create") {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot, {
          createIfMissing: command.createWorkspaceRootIfMissing === true,
        }),
      } satisfies OrchestrationCommand;
    }

    if (command.type === "project.meta.update" && command.workspaceRoot !== undefined) {
      return {
        ...command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (command.type !== "thread.turn.start") {
      return command as OrchestrationCommand;
    }

    const normalizedAttachments = yield* Effect.forEach(
      command.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed || !parsed.mimeType.startsWith("image/")) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Image attachment '${attachment.name}' is empty or too large.`,
            });
          }

          return yield* persistImageAttachment({
            threadId: command.threadId,
            name: attachment.name,
            mimeType: parsed.mimeType,
            bytes,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: cause.message,
                }),
            ),
          );
        }),
      { concurrency: 1 },
    );

    return {
      ...command,
      message: {
        ...command.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });
