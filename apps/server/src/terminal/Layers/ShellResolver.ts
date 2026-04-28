/**
 * TerminalShellResolver Layer - Shell candidate resolution and env filtering.
 *
 * Pure/near-pure functions for determining which shell to spawn and
 * creating a sanitized environment for PTY processes.
 *
 * @module TerminalShellResolverLayer
 */
import path from "node:path";

import { Layer } from "effect";

import {
  PtySpawnError,
  type ShellCandidate,
  TerminalShellResolver,
  type TerminalShellResolverShape,
} from "../Services/ShellResolver";

const TERMINAL_ENV_BLOCKLIST = new Set(["PORT", "ELECTRON_RENDERER_PORT", "ELECTRON_RUN_AS_NODE"]);

function defaultShellResolver(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec ?? "cmd.exe";
  }
  return process.env.SHELL ?? "bash";
}

function normalizeShellCommand(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (process.platform === "win32") {
    return trimmed;
  }

  const firstToken = trimmed.split(/\s+/g)[0]?.trim();
  if (!firstToken) return null;
  return firstToken.replace(/^['"]|['"]$/g, "");
}

function shellCandidateFromCommand(command: string | null): ShellCandidate | null {
  if (!command || command.length === 0) return null;
  const shellName = path.basename(command).toLowerCase();
  if (process.platform !== "win32" && shellName === "zsh") {
    return { shell: command, args: ["-o", "nopromptsp"] };
  }
  return { shell: command };
}

function formatShellCandidate(candidate: ShellCandidate): string {
  if (!candidate.args || candidate.args.length === 0) return candidate.shell;
  return `${candidate.shell} ${candidate.args.join(" ")}`;
}

function uniqueShellCandidates(candidates: Array<ShellCandidate | null>): ShellCandidate[] {
  const seen = new Set<string>();
  const ordered: ShellCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = formatShellCandidate(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

function shouldExcludeTerminalEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  if (normalizedKey.startsWith("FENRIR_")) {
    return true;
  }
  if (normalizedKey.startsWith("VITE_")) {
    return true;
  }
  return TERMINAL_ENV_BLOCKLIST.has(normalizedKey);
}

function isRetryableShellSpawnError(error: PtySpawnError): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  const messages: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (typeof current === "string") {
      messages.push(current);
      continue;
    }

    if (current instanceof Error) {
      messages.push(current.message);
      const cause = (current as { cause?: unknown }).cause;
      if (cause) {
        queue.push(cause);
      }
      continue;
    }

    if (typeof current === "object") {
      const value = current as { message?: unknown; cause?: unknown };
      if (typeof value.message === "string") {
        messages.push(value.message);
      }
      if (value.cause) {
        queue.push(value.cause);
      }
    }
  }

  const message = messages.join(" ").toLowerCase();
  return (
    message.includes("posix_spawnp failed") ||
    message.includes("enoent") ||
    message.includes("not found") ||
    message.includes("file not found") ||
    message.includes("no such file")
  );
}

export interface ShellResolverOptions {
  shellResolver?: () => string;
}

export function makeShellResolver(options?: ShellResolverOptions): TerminalShellResolverShape {
  const shellResolver = options?.shellResolver ?? defaultShellResolver;

  return {
    resolve: () => {
      const requested = shellCandidateFromCommand(normalizeShellCommand(shellResolver()));

      if (process.platform === "win32") {
        return uniqueShellCandidates([
          requested,
          shellCandidateFromCommand(process.env.ComSpec ?? null),
          shellCandidateFromCommand("powershell.exe"),
          shellCandidateFromCommand("cmd.exe"),
        ]);
      }

      return uniqueShellCandidates([
        requested,
        shellCandidateFromCommand(normalizeShellCommand(process.env.SHELL)),
        shellCandidateFromCommand("/bin/zsh"),
        shellCandidateFromCommand("/bin/bash"),
        shellCandidateFromCommand("/bin/sh"),
        shellCandidateFromCommand("zsh"),
        shellCandidateFromCommand("bash"),
        shellCandidateFromCommand("sh"),
      ]);
    },

    createSpawnEnv: (
      baseEnv: NodeJS.ProcessEnv,
      runtimeEnv?: Record<string, string> | null,
    ): NodeJS.ProcessEnv => {
      const spawnEnv: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(baseEnv)) {
        if (value === undefined) continue;
        if (shouldExcludeTerminalEnvKey(key)) continue;
        spawnEnv[key] = value;
      }
      if (runtimeEnv) {
        for (const [key, value] of Object.entries(runtimeEnv)) {
          spawnEnv[key] = value;
        }
      }
      return spawnEnv;
    },

    formatCandidate: formatShellCandidate,

    isRetryableSpawnError: isRetryableShellSpawnError,

    normalizeRuntimeEnv: (
      env: Record<string, string> | undefined,
    ): Record<string, string> | null => {
      if (!env) return null;
      const entries = Object.entries(env);
      if (entries.length === 0) return null;
      return Object.fromEntries(entries.toSorted(([left], [right]) => left.localeCompare(right)));
    },
  };
}

export const TerminalShellResolverLive = Layer.succeed(TerminalShellResolver, makeShellResolver());
