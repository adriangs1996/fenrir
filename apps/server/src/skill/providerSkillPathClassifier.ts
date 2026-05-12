import type { ProviderKind, SkillFileScope } from "@fenrir/contracts";

export const normalizeRelativePath = (relativePath: string): string =>
  relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

const WINDOWS_DRIVE_LETTER_RE = /^[A-Za-z]:($|\/)/;

export const isSafeSkillRelativePath = (relativePath: string): boolean => {
  if (!relativePath.trim()) {
    return false;
  }

  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized === "..") {
    return false;
  }

  if (
    normalized.startsWith("/") ||
    WINDOWS_DRIVE_LETTER_RE.test(normalized) ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return false;
  }

  return true;
};

export const isHiddenName = (name: string): boolean => name.startsWith(".");

export const isHiddenRelativePath = (relativePath: string): boolean =>
  normalizeRelativePath(relativePath)
    .split("/")
    .some((segment) => segment.length > 0 && isHiddenName(segment));

export const makeProviderPathClassifier = (
  provider: ProviderKind,
  providerSpecificPrefixes: readonly string[],
): ((relativePath: string) => SkillFileScope) => {
  const normalizedPrefixes = providerSpecificPrefixes.map((prefix) =>
    normalizeRelativePath(prefix),
  );

  return (relativePath: string): SkillFileScope => {
    const normalized = normalizeRelativePath(relativePath);
    const isProviderSpecific = normalizedPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    );

    return isProviderSpecific ? { kind: "providerSpecific", provider } : { kind: "general" };
  };
};
