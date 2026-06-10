/**
 * ClaudeTextGeneration – Text generation layer using the Claude CLI.
 *
 * Implements the same TextGenerationShape contract as CodexTextGeneration but
 * delegates to the `claude` CLI (`claude -p`) with structured JSON output
 * instead of the `codex exec` CLI.
 *
 * @module ClaudeTextGeneration
 */
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ClaudeModelSelection, isClaudeModelSelection } from "@fenrir/contracts";
import { resolveApiModelId } from "@fenrir/shared/model";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@fenrir/shared/git";

import { TextGenerationError } from "@fenrir/contracts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDependencyExtractionPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "../Utils.ts";
import {
  getProviderOptionBooleanSelectionValue,
  getProviderOptionStringSelectionValue,
  normalizeClaudeModelOptionsWithCapabilities,
} from "@fenrir/shared/model";
import { resolveEffectiveClaudeSettings } from "../../provider/providerSettings";
import { ServerSettingsService } from "../../serverSettings.ts";
import { getClaudeModelCapabilities } from "../../provider/Layers/ClaudeProvider.ts";

const CLAUDE_TIMEOUT_MS = 180_000;

/**
 * Schema for the wrapper JSON returned by `claude -p --output-format json`.
 * We only care about `structured_output`.
 */
const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});

const makeClaudeTextGeneration = Effect.gen(function* () {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverSettingsService = yield* Effect.service(ServerSettingsService);

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("claude", operation, cause, "Failed to collect process output"),
      ),
    );

  /**
   * Spawn the Claude CLI with structured JSON output and return the parsed,
   * schema-validated result.
   */
  const runClaudeJson = Effect.fn("runClaudeJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle"
      | "extractDependencies";
    cwd?: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ClaudeModelSelection;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const jsonSchemaStr = JSON.stringify(toJsonSchemaObject(outputSchemaJson));
    const normalizedOptions = normalizeClaudeModelOptionsWithCapabilities(
      getClaudeModelCapabilities(modelSelection.model),
      modelSelection.options,
    );
    const thinking = getProviderOptionBooleanSelectionValue(normalizedOptions, "thinking");
    const fastMode = getProviderOptionBooleanSelectionValue(normalizedOptions, "fastMode");
    const effort = getProviderOptionStringSelectionValue(normalizedOptions, "effort");
    const settings = {
      ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
      ...(fastMode ? { fastMode: true } : {}),
    };

    const claudeSettings = yield* serverSettingsService.getSettings.pipe(
      Effect.flatMap((settings) =>
        resolveEffectiveClaudeSettings(settings, modelSelection.instanceId),
      ),
      Effect.catch(() => Effect.undefined),
    );

    const runClaudeCommand = Effect.fn("runClaudeJson.runClaudeCommand")(function* () {
      const command = ChildProcess.make(
        claudeSettings?.binaryPath || "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          jsonSchemaStr,
          "--model",
          resolveApiModelId(modelSelection),
          ...(effort ? ["--effort", effort] : []),
          ...(Object.keys(settings).length > 0 ? ["--settings", JSON.stringify(settings)] : []),
          "--dangerously-skip-permissions",
        ],
        {
          cwd,
          shell: process.platform === "win32",
          stdin: {
            stream: Stream.encodeText(Stream.make(prompt)),
          },
        },
      );

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(operation, child.stdout),
          readStreamAsString(operation, child.stderr),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to read Claude CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
        return yield* new TextGenerationError({
          operation,
          detail:
            detail.length > 0
              ? `Claude CLI command failed: ${detail}`
              : `Claude CLI command failed with code ${exitCode}.`,
        });
      }

      return stdout;
    });

    const rawStdout = yield* runClaudeCommand().pipe(
      Effect.scoped,
      Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

    const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(ClaudeOutputEnvelope))(
      rawStdout,
    ).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail: "Claude CLI returned unexpected output format.",
            cause,
          }),
        ),
      ),
    );

    return yield* Schema.decodeEffect(outputSchemaJson)(envelope.structured_output).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation,
            detail: "Claude returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // TextGenerationShape methods
  // ---------------------------------------------------------------------------

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "ClaudeTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });

    if (!isClaudeModelSelection(input.modelSelection)) {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }
    const modelSelection = input.modelSelection;

    const generated = yield* runClaudeJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
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
    "ClaudeTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    if (!isClaudeModelSelection(input.modelSelection)) {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }
    const modelSelection = input.modelSelection;

    const generated = yield* runClaudeJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "ClaudeTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (!isClaudeModelSelection(input.modelSelection)) {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }
    const modelSelection = input.modelSelection;

    const generated = yield* runClaudeJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "ClaudeTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    if (!isClaudeModelSelection(input.modelSelection)) {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }
    const modelSelection = input.modelSelection;

    const generated = yield* runClaudeJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  const extractDependencies: TextGenerationShape["extractDependencies"] = Effect.fn(
    "ClaudeTextGeneration.extractDependencies",
  )(function* (input) {
    const { prompt, outputSchema } = buildDependencyExtractionPrompt({
      planIds: input.planIds,
      planContents: input.planContents,
    });

    if (!isClaudeModelSelection(input.modelSelection)) {
      return yield* new TextGenerationError({
        operation: "extractDependencies",
        detail: "Invalid model selection.",
      });
    }
    const modelSelection = input.modelSelection;

    const generated = yield* runClaudeJson({
      operation: "extractDependencies",
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection,
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

export const ClaudeTextGenerationLive = Layer.effect(TextGeneration, makeClaudeTextGeneration);
