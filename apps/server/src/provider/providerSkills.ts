import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ServerListProviderSkillsInput,
  ServerListProviderSkillsResult,
  ServerProviderSkill,
} from "@fenrir/contracts";
import { Cause, Effect, Option } from "effect";
import { parseDocument } from "yaml";

import { ServerSettingsService } from "../serverSettings.ts";
import { listCodexSkillsForCwd } from "./Layers/CodexProvider.ts";
import {
  resolveEffectiveClaudeSettings,
  resolveEffectiveCodexSettings,
} from "./providerSettings.ts";

const CODEX_SKILL_LIST_TIMEOUT_MS = 8_000;
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
const EMPTY_PROVIDER_SKILLS: ReadonlyArray<ServerProviderSkill> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function titleCaseName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseSkillFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {};
  }

  const document = parseDocument(match[1] ?? "", {
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return {};
  }

  const parsed = document.toJS() as unknown;
  return isRecord(parsed) ? parsed : {};
}

function readShortDescription(frontmatter: Record<string, unknown>): string | undefined {
  const interfaceMetadata = frontmatter.interface;
  return (
    optionalString(frontmatter.shortDescription) ??
    optionalString(frontmatter.short_description) ??
    (isRecord(interfaceMetadata)
      ? (optionalString(interfaceMetadata.shortDescription) ??
        optionalString(interfaceMetadata.short_description))
      : undefined)
  );
}

function toServerProviderSkill(input: {
  readonly filePath: string;
  readonly folderName: string;
  readonly scope: string;
  readonly content: string;
}): ServerProviderSkill {
  const frontmatter = parseSkillFrontmatter(input.content);
  const name = optionalString(frontmatter.name) ?? input.folderName;
  const displayName =
    optionalString(frontmatter.displayName) ??
    optionalString(frontmatter.display_name) ??
    titleCaseName(name);
  const description = optionalString(frontmatter.description);
  const shortDescription = readShortDescription(frontmatter);
  const enabled = typeof frontmatter.enabled === "boolean" ? frontmatter.enabled : true;

  return {
    name,
    path: input.filePath,
    enabled,
    scope: input.scope,
    ...(description ? { description } : {}),
    ...(displayName ? { displayName } : {}),
    ...(shortDescription ? { shortDescription } : {}),
  };
}

async function readSkillEntryFile(skillDir: string): Promise<{
  readonly filePath: string;
  readonly content: string;
} | null> {
  for (const filename of ["SKILL.md", "skill.md"]) {
    const filePath = path.join(skillDir, filename);
    try {
      return {
        filePath,
        content: await fs.readFile(filePath, "utf8"),
      };
    } catch {
      // Try the next supported spelling.
    }
  }
  return null;
}

async function listSkillDirectory(
  skillsDir: string,
  scope: string,
): Promise<ReadonlyArray<ServerProviderSkill>> {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  const skills: ServerProviderSkill[] = [];

  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) {
      continue;
    }

    const skillDir = path.join(skillsDir, entry.name);
    const entryFile = await readSkillEntryFile(skillDir);
    if (!entryFile) {
      continue;
    }

    skills.push(
      toServerProviderSkill({
        filePath: entryFile.filePath,
        folderName: entry.name,
        scope,
        content: entryFile.content,
      }),
    );
  }

  return skills;
}

const listClaudeSkillsForCwd = (cwd: string): Effect.Effect<ReadonlyArray<ServerProviderSkill>> =>
  Effect.promise(async () => {
    const [personalSkills, projectSkills] = await Promise.all([
      listSkillDirectory(path.join(homedir(), ".claude", "skills"), "personal"),
      listSkillDirectory(path.join(cwd, ".claude", "skills"), "project"),
    ]);
    return [...projectSkills, ...personalSkills];
  });

export const listProviderSkills = Effect.fn("listProviderSkills")(function* (
  input: ServerListProviderSkillsInput,
) {
  const skills = yield* Effect.gen(function* () {
    const settingsService = yield* ServerSettingsService;
    const settings = yield* settingsService.getSettings;

    if (input.provider === "codex") {
      const codexSettings = yield* resolveEffectiveCodexSettings(
        settings,
        input.providerInstanceId,
      );
      if (!codexSettings.enabled) {
        return EMPTY_PROVIDER_SKILLS;
      }

      const result = yield* listCodexSkillsForCwd({
        binaryPath: codexSettings.binaryPath,
        cwd: input.cwd,
        ...(codexSettings.homePath ? { homePath: codexSettings.homePath } : {}),
      }).pipe(Effect.timeoutOption(CODEX_SKILL_LIST_TIMEOUT_MS));

      return Option.getOrElse(result, () => EMPTY_PROVIDER_SKILLS);
    }

    if (input.provider === "claudeAgent") {
      const claudeSettings = yield* resolveEffectiveClaudeSettings(
        settings,
        input.providerInstanceId,
      );
      if (!claudeSettings.enabled) {
        return EMPTY_PROVIDER_SKILLS;
      }
      return yield* listClaudeSkillsForCwd(input.cwd);
    }

    return EMPTY_PROVIDER_SKILLS;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to list provider skills", {
        provider: input.provider,
        providerInstanceId: input.providerInstanceId,
        cwd: input.cwd,
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(EMPTY_PROVIDER_SKILLS)),
    ),
  );

  return { skills } satisfies ServerListProviderSkillsResult;
});
