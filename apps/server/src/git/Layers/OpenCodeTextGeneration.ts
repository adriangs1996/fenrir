import { Effect, Exit, Fiber, Layer, Schema, Scope } from "effect";
import * as Semaphore from "effect/Semaphore";

import {
  defaultInstanceIdForDriver,
  TextGenerationError,
  type ChatAttachment,
  type ModelSelection,
} from "@fenrir/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@fenrir/shared/git";
import { getModelSelectionStringOptionValue } from "@fenrir/shared/model";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail,
  parseOpenCodeModelSlug,
  toOpenCodeFileParts,
  type OpenCodeServerConnection,
  type OpenCodeServerProcess,
} from "../../provider/opencodeRuntime.ts";
import { resolveOpenCodeInstanceSettings } from "../../provider/providerSettings.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDependencyExtractionPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import {
  extractJsonObject,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "../Utils.ts";

const OPENCODE_TEXT_GENERATION_IDLE_TTL = "30 seconds";
const openCodeJsonDecoderBySchema = new WeakMap<
  Schema.Top,
  (input: string) => Effect.Effect<unknown, Schema.SchemaError, never>
>();

function decodeOpenCodeJsonOutput<S extends Schema.Top>(
  schema: S,
  rawOutput: string,
): Effect.Effect<S["Type"], Schema.SchemaError, S["DecodingServices"]> {
  let decode = openCodeJsonDecoderBySchema.get(schema);
  if (!decode) {
    decode = Schema.decodeEffect(Schema.fromJsonString(schema)) as unknown as (
      input: string,
    ) => Effect.Effect<unknown, Schema.SchemaError, never>;
    openCodeJsonDecoderBySchema.set(schema, decode);
  }
  return decode(extractJsonObject(rawOutput)) as Effect.Effect<
    S["Type"],
    Schema.SchemaError,
    S["DecodingServices"]
  >;
}

function getOpenCodePromptErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const message =
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
      ? error.data.message.trim()
      : "";
  if (message.length > 0) {
    return message;
  }

  if ("name" in error && typeof error.name === "string") {
    const name = error.name.trim();
    return name.length > 0 ? name : null;
  }

  return null;
}

function getOpenCodeTextResponse(parts: ReadonlyArray<unknown> | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      if (!("type" in part) || part.type !== "text") {
        return [];
      }
      if (!("text" in part) || typeof part.text !== "string") {
        return [];
      }
      return [part.text];
    })
    .join("")
    .trim();
}

interface SharedOpenCodeTextGenerationServerState {
  server: OpenCodeServerProcess | null;
  serverScope: Scope.Closeable | null;
  binaryPath: string | null;
  activeRequests: number;
  idleCloseFiber: Fiber.Fiber<void, never> | null;
}

const makeOpenCodeTextGeneration = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const openCodeRuntime = yield* OpenCodeRuntime;
  const serverSettingsService = yield* Effect.service(ServerSettingsService);
  const idleFiberScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const sharedServerMutex = yield* Semaphore.make(1);
  const sharedServerState: SharedOpenCodeTextGenerationServerState = {
    server: null,
    serverScope: null,
    binaryPath: null,
    activeRequests: 0,
    idleCloseFiber: null,
  };

  const closeSharedServer = Effect.fn("closeSharedServer")(function* () {
    const scope = sharedServerState.serverScope;
    sharedServerState.server = null;
    sharedServerState.serverScope = null;
    sharedServerState.binaryPath = null;
    if (scope !== null) {
      yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
    }
  });

  const cancelIdleCloseFiber = Effect.fn("cancelIdleCloseFiber")(function* () {
    const idleCloseFiber = sharedServerState.idleCloseFiber;
    sharedServerState.idleCloseFiber = null;
    if (idleCloseFiber !== null) {
      yield* Fiber.interrupt(idleCloseFiber).pipe(Effect.ignore);
    }
  });

  const scheduleIdleClose = Effect.fn("scheduleIdleClose")(function* (
    server: OpenCodeServerProcess,
  ) {
    yield* cancelIdleCloseFiber();
    const fiber = yield* Effect.sleep(OPENCODE_TEXT_GENERATION_IDLE_TTL).pipe(
      Effect.andThen(
        sharedServerMutex.withPermit(
          Effect.gen(function* () {
            if (sharedServerState.server !== server || sharedServerState.activeRequests > 0) {
              return;
            }
            sharedServerState.idleCloseFiber = null;
            yield* closeSharedServer();
          }),
        ),
      ),
      Effect.forkIn(idleFiberScope),
    );
    sharedServerState.idleCloseFiber = fiber;
  });

  const acquireSharedServer = (input: {
    readonly binaryPath: string;
    readonly operation: TextGenerationOperation;
  }) =>
    sharedServerMutex.withPermit(
      Effect.gen(function* () {
        yield* cancelIdleCloseFiber();

        const existingServer = sharedServerState.server;
        if (existingServer !== null) {
          if (
            sharedServerState.binaryPath !== input.binaryPath &&
            sharedServerState.activeRequests === 0
          ) {
            yield* closeSharedServer();
          } else {
            if (sharedServerState.binaryPath !== input.binaryPath) {
              yield* Effect.logWarning(
                "OpenCode shared server binary path mismatch: requested " +
                  input.binaryPath +
                  " but active server uses " +
                  sharedServerState.binaryPath +
                  "; reusing existing server because there are active requests",
              );
            }
            sharedServerState.activeRequests += 1;
            return existingServer;
          }
        }

        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const serverScope = yield* Scope.make();
            const startedExit = yield* Effect.exit(
              restore(
                openCodeRuntime
                  .startOpenCodeServerProcess({
                    binaryPath: input.binaryPath,
                  })
                  .pipe(
                    Effect.provideService(Scope.Scope, serverScope),
                    Effect.mapError(
                      (cause) =>
                        new TextGenerationError({
                          operation: input.operation,
                          detail: openCodeRuntimeErrorDetail(cause),
                          cause,
                        }),
                    ),
                  ),
              ),
            );
            if (startedExit._tag === "Failure") {
              yield* Scope.close(serverScope, Exit.void).pipe(Effect.ignore);
              return yield* Effect.failCause(startedExit.cause);
            }

            const server = startedExit.value;
            sharedServerState.server = server;
            sharedServerState.serverScope = serverScope;
            sharedServerState.binaryPath = input.binaryPath;
            sharedServerState.activeRequests = 1;
            return server;
          }),
        );
      }),
    );

  const releaseSharedServer = (server: OpenCodeServerProcess) =>
    sharedServerMutex.withPermit(
      Effect.gen(function* () {
        if (sharedServerState.server !== server) {
          return;
        }
        sharedServerState.activeRequests = Math.max(0, sharedServerState.activeRequests - 1);
        if (sharedServerState.activeRequests === 0) {
          yield* scheduleIdleClose(server);
        }
      }),
    );

  yield* Effect.addFinalizer(() =>
    sharedServerMutex.withPermit(
      Effect.gen(function* () {
        yield* cancelIdleCloseFiber();
        sharedServerState.activeRequests = 0;
        yield* closeSharedServer();
      }),
    ),
  );

  const runOpenCodeJson = Effect.fn("runOpenCodeJson")(function* <S extends Schema.Top>(input: {
    readonly operation: TextGenerationOperation;
    readonly cwd?: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly modelSelection: ModelSelection;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    if (
      input.modelSelection.provider !== "opencode" &&
      input.modelSelection.instanceId === undefined
    ) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "Invalid model selection.",
      });
    }

    const parsedModel = parseOpenCodeModelSlug(input.modelSelection.model);
    if (!parsedModel) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenCode model selection must use the 'provider/model' format.",
      });
    }

    const openCodeSettings = yield* serverSettingsService.getSettings.pipe(
      Effect.flatMap((settings) =>
        resolveOpenCodeInstanceSettings(
          settings,
          input.modelSelection.instanceId ?? defaultInstanceIdForDriver("opencode"),
        ),
      ),
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Failed to resolve OpenCode settings.",
            cause,
          }),
      ),
    );

    const fileParts = toOpenCodeFileParts({
      attachments: input.attachments,
      resolveAttachmentPath: (attachment) =>
        resolveAttachmentPath({ attachmentsDir: serverConfig.attachmentsDir, attachment }),
    });

    const runAgainstServer = (server: Pick<OpenCodeServerConnection, "url">) =>
      Effect.tryPromise({
        try: async () => {
          const client = openCodeRuntime.createOpenCodeSdkClient({
            baseUrl: server.url,
            directory: input.cwd ?? serverConfig.cwd,
            ...(openCodeSettings.serverUrl.length > 0 && openCodeSettings.serverPassword
              ? { serverPassword: openCodeSettings.serverPassword }
              : {}),
          });
          const session = await client.session.create({
            title: `Fenrir ${input.operation}`,
            permission: [{ permission: "*", pattern: "*", action: "deny" }],
          });
          if (!session.data) {
            throw new Error("OpenCode session.create returned no session payload.");
          }

          const selectedAgent = getModelSelectionStringOptionValue(input.modelSelection, "agent");
          const selectedVariant = getModelSelectionStringOptionValue(
            input.modelSelection,
            "variant",
          );
          const result = await client.session.prompt({
            sessionID: session.data.id,
            model: parsedModel,
            ...(selectedAgent ? { agent: selectedAgent } : {}),
            ...(selectedVariant ? { variant: selectedVariant } : {}),
            parts: [{ type: "text", text: input.prompt }, ...fileParts],
          });
          const errorMessage = getOpenCodePromptErrorMessage(result.data?.info?.error);
          if (errorMessage) {
            throw new Error(errorMessage);
          }
          const rawText = getOpenCodeTextResponse(result.data?.parts);
          if (rawText.length === 0) {
            throw new Error("OpenCode returned empty output.");
          }
          return rawText;
        },
        catch: (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: openCodeRuntimeErrorDetail(cause),
            cause,
          }),
      });

    const rawOutput =
      openCodeSettings.serverUrl.length > 0
        ? yield* runAgainstServer({ url: openCodeSettings.serverUrl })
        : yield* Effect.acquireUseRelease(
            acquireSharedServer({
              binaryPath: openCodeSettings.binaryPath,
              operation: input.operation,
            }),
            runAgainstServer,
            releaseSharedServer,
          );

    return yield* decodeOpenCodeJsonOutput(input.outputSchemaJson, rawOutput).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation: input.operation,
            detail: "OpenCode returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "OpenCodeTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "OpenCodeTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "OpenCodeTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "OpenCodeTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  const extractDependencies: TextGenerationShape["extractDependencies"] = Effect.fn(
    "OpenCodeTextGeneration.extractDependencies",
  )(function* (input) {
    const { prompt, outputSchema } = buildDependencyExtractionPrompt({
      planIds: input.planIds,
      planContents: input.planContents,
    });
    const generated = yield* runOpenCodeJson({
      operation: "extractDependencies",
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return { dependencies: generated.dependencies as Record<string, string[]> };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
    extractDependencies,
  } satisfies TextGenerationShape;
});

type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "extractDependencies";

export const OpenCodeTextGenerationLive = Layer.effect(TextGeneration, makeOpenCodeTextGeneration);
