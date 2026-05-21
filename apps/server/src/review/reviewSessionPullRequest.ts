import type { ReviewSessionRecord } from "../persistence/Services/ReviewSessions.ts";
import type { ReviewProviderPullRequest } from "./Services/ReviewProvider.ts";

export function pullRequestForReviewSession(
  session: Pick<
    ReviewSessionRecord,
    "pullRequestProvider" | "pullRequestNumber" | "pullRequestUrl" | "target"
  >,
): ReviewProviderPullRequest | null {
  if (
    session.pullRequestProvider !== "github" ||
    session.pullRequestNumber === null ||
    session.pullRequestUrl === null
  ) {
    return null;
  }

  const baseRef = session.target.baseRef?.trim() ?? "";
  const headRef = session.target.headRef?.trim() ?? "";
  if (baseRef.length === 0 || headRef.length === 0) {
    return null;
  }

  return {
    provider: "github",
    number: session.pullRequestNumber,
    url: session.pullRequestUrl,
    baseRef,
    headRef,
  };
}
