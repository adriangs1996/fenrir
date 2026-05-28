import { Effect, Layer, Schema, Context } from "effect";

import { GitCommandError } from "@fenrir/contracts";
import { runProcess } from "../processRunner.ts";

const OUTPUT_TRUNCATED_MARKER = "\n\n[truncated]";

export interface VcsProcessInput {
  readonly operation: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly stdin?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly appendTruncationMarker?: boolean;
}

export interface VcsProcessOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface VcsProcessShape {
  readonly run: (input: VcsProcessInput) => Effect.Effect<VcsProcessOutput, GitCommandError>;
}

export class VcsProcess extends Context.Service<VcsProcess, VcsProcessShape>()(
  "fenrir/vcs/Services/VcsProcess",
) {}

function commandLabel(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].join(" ");
}

function appendTruncationMarker(text: string, truncated: boolean, appendMarker: boolean): string {
  if (!truncated || !appendMarker) {
    return text;
  }
  return `${text}${OUTPUT_TRUNCATED_MARKER}`;
}

function vcsCommandError(
  input: Pick<VcsProcessInput, "operation" | "command" | "args" | "cwd">,
  detail: string,
  cause?: unknown,
): GitCommandError {
  return new GitCommandError({
    operation: input.operation,
    command: commandLabel(input.command, input.args),
    cwd: input.cwd,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const makeVcsProcess = Effect.sync(() =>
  VcsProcess.of({
    run: (input) =>
      Effect.tryPromise({
        try: async () => {
          const result = await runProcess(input.command, input.args, {
            cwd: input.cwd,
            env: input.env,
            stdin: input.stdin,
            allowNonZeroExit: true,
            timeoutMs: input.timeoutMs,
            maxBufferBytes: input.maxOutputBytes,
            outputMode: "truncate",
          });

          if (result.timedOut) {
            throw vcsCommandError(
              input,
              `${commandLabel(input.command, input.args)} timed out after ${input.timeoutMs ?? 60_000}ms.`,
            );
          }

          if (result.code === null) {
            throw vcsCommandError(
              input,
              `${commandLabel(input.command, input.args)} exited without a status code.`,
            );
          }

          if (!input.allowNonZeroExit && result.code !== 0) {
            throw vcsCommandError(
              input,
              result.stderr.trim() ||
                `${commandLabel(input.command, input.args)} exited with code ${result.code}.`,
            );
          }

          const appendMarker = input.appendTruncationMarker ?? false;
          return {
            exitCode: result.code,
            stdout: appendTruncationMarker(
              result.stdout,
              result.stdoutTruncated === true,
              appendMarker,
            ),
            stderr: appendTruncationMarker(
              result.stderr,
              result.stderrTruncated === true,
              appendMarker,
            ),
            stdoutTruncated: result.stdoutTruncated === true,
            stderrTruncated: result.stderrTruncated === true,
          } satisfies VcsProcessOutput;
        },
        catch: (cause) =>
          Schema.is(GitCommandError)(cause)
            ? cause
            : vcsCommandError(
                input,
                cause instanceof Error ? cause.message : "Failed to run VCS process.",
                cause,
              ),
      }),
  }),
);

export const VcsProcessLive = Layer.effect(VcsProcess, makeVcsProcess);
