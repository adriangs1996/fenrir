import { parseDocument } from "yaml";

export interface ParsedPlanFrontmatter {
  id: string;
  depends_on: string[];
  max_retries: number;
  body: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

function formatYamlErrors(errors: ReadonlyArray<{ message: string }>): string {
  return errors.map((error) => error.message.trim()).join("; ");
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`frontmatter field "${field}" must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`frontmatter field "${field}" must not be empty`);
  }
  return trimmed;
}

function ensureStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`frontmatter field "${field}" must be an array of strings`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`frontmatter field "${field}" entry ${index + 1} must be a string`);
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new Error(`frontmatter field "${field}" entry ${index + 1} must not be empty`);
    }
    return trimmed;
  });
}

function ensureNonNegativeInt(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`frontmatter field "${field}" must be a non-negative integer`);
  }
  return value as number;
}

export function parsePlanFrontmatter(content: string, fallbackId: string): ParsedPlanFrontmatter {
  const hasFrontmatterFence = content.startsWith("---\n") || content.startsWith("---\r\n");
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    if (hasFrontmatterFence) {
      throw new Error("invalid YAML frontmatter: missing closing fence or malformed block");
    }
    return { id: fallbackId, depends_on: [], max_retries: 2, body: content };
  }

  const rawFrontmatter = match[1] ?? "";
  const body = match[2] ?? "";

  const document = parseDocument(rawFrontmatter, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new Error(`invalid YAML frontmatter: ${formatYamlErrors(document.errors)}`);
  }

  const parsed = document.toJS();
  if (parsed === null || parsed === undefined) {
    return { id: fallbackId, depends_on: [], max_retries: 2, body };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid YAML frontmatter: top-level value must be a mapping");
  }

  const metadata = parsed as Record<string, unknown>;

  const id = metadata.id === undefined ? fallbackId : ensureString(metadata.id, "id");
  const depends_on =
    metadata.depends_on === undefined ? [] : ensureStringArray(metadata.depends_on, "depends_on");
  const max_retries =
    metadata.max_retries === undefined
      ? 2
      : ensureNonNegativeInt(metadata.max_retries, "max_retries");

  return { id, depends_on, max_retries, body };
}
