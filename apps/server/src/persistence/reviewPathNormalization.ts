import path from "node:path";

import type { ReviewIgnoreRuleKind } from "../../../../packages/contracts/src/review.ts";

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function trimTrailingSeparators(value: string): string {
  if (value === "/" || /^[A-Za-z]:[/\\]?$/.test(value)) {
    return value;
  }
  return value.replace(/[\\/]+$/g, "");
}

function normalizeAbsolutePath(value: string): string {
  const resolved = path.resolve(value.trim());
  const normalized = trimTrailingSeparators(toPosixPath(path.normalize(resolved)));
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `${normalized[0]!.toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

function normalizeRelativePath(value: string): string {
  return toPosixPath(path.posix.normalize(value)).replace(/^\.\/+/g, "");
}

export function normalizeStoredReviewRelativePath(value: string): string {
  return normalizeRelativePath(value).replace(/\/+$/g, "");
}

export function normalizeReviewCheckoutPath(checkoutPath: string): string {
  return normalizeAbsolutePath(checkoutPath);
}

export function normalizeReviewIgnoreRulePath(input: {
  readonly checkoutPath: string;
  readonly rulePath: string;
  readonly ruleKind: ReviewIgnoreRuleKind;
}): {
  readonly normalizedCheckoutPath: string;
  readonly normalizedPath: string;
  readonly matchPath: string;
} {
  const normalizedCheckoutPath = normalizeReviewCheckoutPath(input.checkoutPath);
  const trimmedRulePath = input.rulePath.trim();

  const absoluteRulePath = path.isAbsolute(trimmedRulePath)
    ? normalizeAbsolutePath(trimmedRulePath)
    : normalizeAbsolutePath(path.resolve(normalizedCheckoutPath, trimmedRulePath));
  const relativePath = normalizeStoredReviewRelativePath(
    path.posix.relative(normalizedCheckoutPath, absoluteRulePath),
  );

  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new Error("Ignore rule path must resolve to a location within the checkout root.");
  }

  const normalizedPath =
    input.ruleKind === "directory" ? relativePath.replace(/\/+$/g, "") : relativePath;
  const matchPath =
    input.ruleKind === "directory" ? `${normalizedPath.replace(/\/+$/g, "")}/` : normalizedPath;

  if (normalizedPath.length === 0) {
    throw new Error("Ignore rule path must not resolve to the checkout root.");
  }

  return {
    normalizedCheckoutPath,
    normalizedPath,
    matchPath,
  };
}
