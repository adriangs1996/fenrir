import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { parseDocument, stringify as yamlStringify } from "yaml";

import { CreateSkillInput, ServerProviderSkill } from "@fenrir/contracts";

import { writeFileStringAtomically } from "../atomicWrite.ts";

// ─── Raw Skill File ────────────────────────────────────────────
/**
 * Represents the on-disk format before validation.
 */
export interface RawSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
  mtime?: Date | undefined;
}

// ─── Errors ────────────────────────────────────────────────────

export class SkillParseError extends Schema.TaggedErrorClass<SkillParseError>()("SkillParseError", {
  filePath: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Failed to parse skill file ${this.filePath}: ${this.reason}`;
  }
}

export class SkillValidationError extends Schema.TaggedErrorClass<SkillValidationError>()(
  "SkillValidationError",
  { filePath: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `Invalid skill file ${this.filePath}: ${this.reason}`;
  }
}

export class SkillWriteError extends Schema.TaggedErrorClass<SkillWriteError>()("SkillWriteError", {
  filePath: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Failed to write skill file ${this.filePath}: ${this.reason}`;
  }
}

export class SkillScanError extends Schema.TaggedErrorClass<SkillScanError>()("SkillScanError", {
  basePath: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Failed to scan skill directory ${this.basePath}: ${this.reason}`;
  }
}

// ─── Internal helpers ──────────────────────────────────────────

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

type ParsedContent =
  | { ok: true; frontmatter: Record<string, unknown>; body: string }
  | { ok: false; reason: string };

function parseContent(content: string): ParsedContent {
  const hasFrontmatterFence = content.startsWith("---\n") || content.startsWith("---\r\n");
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    if (hasFrontmatterFence) {
      return { ok: false, reason: "missing closing fence or malformed frontmatter block" };
    }
    // No frontmatter — treat entire file as body
    return { ok: true, frontmatter: {}, body: content };
  }

  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";

  const doc = parseDocument(rawFrontmatter, { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    const reasons = doc.errors.map((e) => e.message.trim()).join("; ");
    return { ok: false, reason: `invalid YAML frontmatter: ${reasons}` };
  }

  const parsed = doc.toJS() as unknown;
  if (
    parsed !== null &&
    parsed !== undefined &&
    (typeof parsed !== "object" || Array.isArray(parsed))
  ) {
    return { ok: false, reason: "frontmatter top-level value must be a mapping" };
  }

  return {
    ok: true,
    frontmatter: (parsed ?? {}) as Record<string, unknown>,
    body,
  };
}

// ─── Parse ─────────────────────────────────────────────────────

/**
 * Parse a skill.md file from disk.
 * Returns raw frontmatter + body without schema validation.
 */
export const parseSkillFile = (
  filePath: string,
): Effect.Effect<RawSkillFile, SkillParseError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const content = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new SkillParseError({
            filePath,
            reason: `could not read file: ${cause.message}`,
          }),
      ),
    );

    const statOption = yield* fs.stat(filePath).pipe(Effect.option);
    const mtime =
      Option.isSome(statOption) && Option.isSome(statOption.value.mtime)
        ? statOption.value.mtime.value
        : undefined;

    const result = parseContent(content);
    if (!result.ok) {
      return yield* new SkillParseError({ filePath, reason: result.reason });
    }

    return {
      frontmatter: result.frontmatter,
      body: result.body,
      filePath,
      ...(mtime !== undefined ? { mtime } : {}),
    };
  });

// ─── Validate ──────────────────────────────────────────────────

/**
 * Convert a RawSkillFile to a validated ServerProviderSkill.
 * Fills in defaults for optional fields.
 * createdAt/updatedAt are set from file mtime when available.
 */
export const validateSkillFile = (
  raw: RawSkillFile,
): Effect.Effect<ServerProviderSkill, SkillValidationError> =>
  Effect.gen(function* () {
    // Merge frontmatter + body so CreateSkillInput can decode the full shape
    const input = { ...raw.frontmatter, body: raw.body };

    const decoded = yield* Schema.decodeUnknownEffect(CreateSkillInput)(input).pipe(
      Effect.mapError(
        (cause) =>
          new SkillValidationError({
            filePath: raw.filePath,
            reason: cause.message,
          }),
      ),
    );

    const now = raw.mtime ? raw.mtime.toISOString() : new Date().toISOString();

    return {
      ...decoded,
      syncStatus: [],
      createdAt: now,
      updatedAt: now,
    } satisfies ServerProviderSkill;
  });

// ─── Serialize ─────────────────────────────────────────────────

/**
 * Serialize a skill to the on-disk format.
 * Body goes in the markdown section; all other fields go in YAML frontmatter.
 */
export const serializeSkillFile = (skill: CreateSkillInput): string => {
  const { body, ...frontmatterFields } = skill;
  // yaml.stringify always ends with a newline; trim it so the fence looks clean
  const frontmatterYaml = yamlStringify(frontmatterFields, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatterYaml}\n---\n\n${body}\n`;
};

// ─── Write ─────────────────────────────────────────────────────

/**
 * Write a skill to disk atomically.
 * Creates {basePath}/{skill.name}/skill.md, making the directory if needed.
 */
export const writeSkillFile = (
  basePath: string,
  skill: CreateSkillInput,
): Effect.Effect<void, SkillWriteError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const filePath = path.join(basePath, skill.name, "skill.md");
    const contents = serializeSkillFile(skill);

    yield* writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.mapError(
        (cause) =>
          new SkillWriteError({
            filePath,
            reason: String(cause),
          }),
      ),
    );
  });

// ─── Scan ──────────────────────────────────────────────────────

/**
 * Scan a directory for all skill.md files.
 * Tolerates parse failures — bad files are logged as warnings, good files returned.
 * Missing or empty directory returns an empty array.
 */
export const scanSkillDirectory = (
  basePath: string,
): Effect.Effect<RawSkillFile[], SkillScanError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const entries = yield* fs
      .readDirectory(basePath)
      .pipe(Effect.catch(() => Effect.succeed([] as string[])));

    if (entries.length === 0) return [];

    const results: RawSkillFile[] = [];

    for (const entry of entries) {
      const entryPath = path.join(basePath, entry);

      const statOption = yield* fs.stat(entryPath).pipe(Effect.option);
      if (!Option.isSome(statOption) || statOption.value.type !== "Directory") continue;

      const skillFilePath = path.join(entryPath, "skill.md");
      const exists = yield* fs
        .exists(skillFilePath)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!exists) continue;

      const parsed = yield* parseSkillFile(skillFilePath).pipe(
        Effect.catch((error) =>
          Effect.andThen(
            Effect.logWarning(`Skipping unparseable skill file: ${error.message}`),
            Effect.succeed(null as RawSkillFile | null),
          ),
        ),
      );

      if (parsed !== null) {
        results.push(parsed);
      }
    }

    return results;
  });
