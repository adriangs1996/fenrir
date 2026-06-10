/**
 * Tiny IPC input validators with a single error type and a consistent
 * message format (`Invalid <name>.`).
 *
 * These helpers always THROW on invalid input. Handlers that intentionally
 * return silently on bad input (e.g. `confirm`, `set-theme`) must keep their
 * own inline checks — do not route those through these helpers.
 */
export class ValidationError extends Error {
  constructor(name: string) {
    super(`Invalid ${name}.`);
    this.name = "ValidationError";
  }
}

export function requireString(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError(name);
  }
  return value;
}

export function requireNonEmptyString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(name);
  }
  return value;
}

export function requireNonBlankString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(name);
  }
  return value;
}

export function requireNumber(name: string, value: unknown): number {
  if (typeof value !== "number") {
    throw new ValidationError(name);
  }
  return value;
}

export function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(name);
  }
  return value;
}

export function requireObject(name: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(name);
  }
  return value as Record<string, unknown>;
}

export function requireArray(name: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(name);
  }
  return value;
}

/** Optional string: non-strings silently coerce to `undefined`. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
