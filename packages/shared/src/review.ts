import { createHash } from "node:crypto";
import path from "node:path";

import type { ReviewAnchorProvenance, ReviewStableAnchor } from "../../contracts/src/review.ts";

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function normalizeReviewPath(value: string): string {
  return path.posix.normalize(toPosixPath(value.trim())).replace(/^\.\/+/g, "");
}

export function normalizeReviewExcerpt(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

export function hashReviewText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function anchorHashPayload(input: {
  readonly normalizedPath: string;
  readonly provenance: ReviewAnchorProvenance;
  readonly excerpt: string;
  readonly excerptHash?: string | undefined;
  readonly patchFingerprint?: string | undefined;
}) {
  return {
    normalizedPath: normalizeReviewPath(input.normalizedPath),
    provenance: input.provenance,
    excerpt: normalizeReviewExcerpt(input.excerpt),
    excerptHash: input.excerptHash?.trim() || undefined,
    patchFingerprint: input.patchFingerprint?.trim() || undefined,
  };
}

export function hashReviewAnchor(input: {
  readonly normalizedPath: string;
  readonly provenance: ReviewAnchorProvenance;
  readonly excerpt: string;
  readonly excerptHash?: string | undefined;
  readonly patchFingerprint?: string | undefined;
}): string {
  return hashReviewText(JSON.stringify(anchorHashPayload(input)));
}

const rangeCenter = (range: { readonly startLine: number; readonly endLine: number } | undefined) =>
  range ? (range.startLine + range.endLine) / 2 : null;

export interface ReviewReanchorConfidenceInputs {
  readonly sameNormalizedPath: boolean;
  readonly sameScope: boolean;
  readonly sameLane: boolean;
  readonly excerptHashMatches: boolean;
  readonly patchFingerprintMatches: boolean;
  readonly oldRangeDelta: number | null;
  readonly newRangeDelta: number | null;
}

export function deriveReanchorConfidenceInputs(
  anchor: ReviewStableAnchor,
  candidate: ReviewStableAnchor,
): ReviewReanchorConfidenceInputs {
  const anchorOldCenter = rangeCenter(anchor.oldRange);
  const candidateOldCenter = rangeCenter(candidate.oldRange);
  const anchorNewCenter = rangeCenter(anchor.newRange);
  const candidateNewCenter = rangeCenter(candidate.newRange);

  return {
    sameNormalizedPath:
      normalizeReviewPath(anchor.normalizedPath) === normalizeReviewPath(candidate.normalizedPath),
    sameScope: anchor.provenance.scope === candidate.provenance.scope,
    sameLane: anchor.provenance.lane === candidate.provenance.lane,
    excerptHashMatches:
      (anchor.excerptHash?.trim() ?? "") !== "" && anchor.excerptHash === candidate.excerptHash,
    patchFingerprintMatches:
      (anchor.patchFingerprint?.trim() ?? "") !== "" &&
      anchor.patchFingerprint === candidate.patchFingerprint,
    oldRangeDelta:
      anchorOldCenter === null || candidateOldCenter === null
        ? null
        : Math.abs(anchorOldCenter - candidateOldCenter),
    newRangeDelta:
      anchorNewCenter === null || candidateNewCenter === null
        ? null
        : Math.abs(anchorNewCenter - candidateNewCenter),
  };
}
