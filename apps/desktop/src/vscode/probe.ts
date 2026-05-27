import * as ChildProcess from "node:child_process";

import type { VSCodeProbeResult, VSCodeWebServerKind } from "@fenrir/contracts";

interface Candidate {
  readonly command: string;
  readonly serverKind: VSCodeWebServerKind;
}

const CANDIDATES: readonly Candidate[] = [
  { command: "code-server", serverKind: "code-server" },
  { command: "openvscode-server", serverKind: "openvscode-server" },
];

let cached: VSCodeProbeResult | null = null;

function firstOutputLine(stdout: string, stderr: string): string | null {
  return (
    stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ??
    stderr
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ??
    null
  );
}

async function probeCandidate(candidate: Candidate): Promise<VSCodeProbeResult> {
  return new Promise<VSCodeProbeResult>((resolve) => {
    let resolved = false;
    const settle = (result: VSCodeProbeResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    let proc: ChildProcess.ChildProcess;
    try {
      proc = ChildProcess.spawn(candidate.command, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      settle({
        available: false,
        serverKind: null,
        command: null,
        version: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      settle({
        available: false,
        serverKind: null,
        command: null,
        version: null,
        error: error.message,
      });
    });

    proc.on("exit", (code) => {
      if (code !== 0) {
        settle({
          available: false,
          serverKind: null,
          command: null,
          version: null,
          error: `${candidate.command} --version exited with code ${code}`,
        });
        return;
      }

      settle({
        available: true,
        serverKind: candidate.serverKind,
        command: candidate.command,
        version: firstOutputLine(stdout, stderr),
        error: null,
      });
    });

    setTimeout(
      () =>
        settle({
          available: false,
          serverKind: null,
          command: null,
          version: null,
          error: `${candidate.command} --version timed out`,
        }),
      3000,
    );
  });
}

export async function probeVSCodeWeb(): Promise<VSCodeProbeResult> {
  if (cached) return cached;

  const errors: string[] = [];
  for (const candidate of CANDIDATES) {
    const result = await probeCandidate(candidate);
    if (result.available) {
      cached = result;
      return result;
    }
    if (result.error) {
      errors.push(`${candidate.command}: ${result.error}`);
    }
  }

  cached = {
    available: false,
    serverKind: null,
    command: null,
    version: null,
    error:
      errors.length > 0
        ? errors.join("; ")
        : "Install code-server or openvscode-server to use Embedded VS Code.",
  };
  return cached;
}

export function getCachedVSCodeProbeResult(): VSCodeProbeResult | null {
  return cached;
}

export function _resetCachedVSCodeProbeResult(): void {
  cached = null;
}
