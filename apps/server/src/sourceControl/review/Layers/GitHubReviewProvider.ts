import { Effect, Layer, Schema } from "effect";

import { GitHubCli } from "../../../git/Services/GitHubCli.ts";
import { normalizeStoredReviewRelativePath } from "../../../persistence/reviewPathNormalization.ts";
import {
  ReviewProvider,
  ReviewProviderError,
  type ReviewProviderPullRequest,
  type ReviewProviderReadResult,
  type ReviewProviderShape,
  type ReviewProviderSnapshot,
  type ReviewProviderUnavailableReason,
} from "../Services/ReviewProvider.ts";

const GRAPHQL_TIMEOUT_MS = 45_000;
const GRAPHQL_PAGE_SIZE = 100;

const RawActorSchema = Schema.NullOr(
  Schema.Struct({
    login: Schema.String,
    avatarUrl: Schema.NullOr(Schema.String),
  }),
);

const RawPullRequestReviewCommentSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.NullOr(Schema.String),
  body: Schema.String,
  path: Schema.String,
  diffHunk: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  originalLine: Schema.NullOr(Schema.Number),
  startLine: Schema.NullOr(Schema.Number),
  originalStartLine: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  author: RawActorSchema,
});

const RawPullRequestReviewThreadSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  diffSide: Schema.String,
  startDiffSide: Schema.optional(Schema.NullOr(Schema.String)),
  line: Schema.NullOr(Schema.Number),
  originalLine: Schema.NullOr(Schema.Number),
  startLine: Schema.NullOr(Schema.Number),
  originalStartLine: Schema.NullOr(Schema.Number),
  subjectType: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  isCollapsed: Schema.Boolean,
  comments: Schema.Struct({
    nodes: Schema.Array(RawPullRequestReviewCommentSchema),
  }),
});

const RawGeneralCommentSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  author: RawActorSchema,
});

const RawGraphqlResponseSchema = Schema.Struct({
  data: Schema.Struct({
    resource: Schema.NullOr(
      Schema.Struct({
        __typename: Schema.String,
        number: Schema.Number,
        url: Schema.String,
        title: Schema.String,
        state: Schema.String,
        isDraft: Schema.Boolean,
        body: Schema.String,
        createdAt: Schema.String,
        updatedAt: Schema.String,
        baseRefName: Schema.String,
        headRefName: Schema.String,
        author: RawActorSchema,
        reviewThreads: Schema.Struct({
          nodes: Schema.Array(RawPullRequestReviewThreadSchema),
        }),
        comments: Schema.Struct({
          nodes: Schema.Array(RawGeneralCommentSchema),
        }),
      }),
    ),
  }),
});

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function clampPositiveLine(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeRange(start: number | undefined, end: number | undefined) {
  if (!start && !end) {
    return undefined;
  }
  const safeStart = start ?? end;
  const safeEnd = end ?? start;
  return safeStart && safeEnd
    ? {
        startLine: Math.min(safeStart, safeEnd),
        endLine: Math.max(safeStart, safeEnd),
      }
    : undefined;
}

function buildAnchor(input: {
  readonly path: string;
  readonly diffHunk?: string | null;
  readonly line: number | null | undefined;
  readonly originalLine: number | null | undefined;
  readonly startLine: number | null | undefined;
  readonly originalStartLine: number | null | undefined;
}) {
  const normalizedPath = normalizeStoredReviewRelativePath(input.path);
  const newRange = normalizeRange(
    clampPositiveLine(input.startLine),
    clampPositiveLine(input.line),
  );
  const oldRange = normalizeRange(
    clampPositiveLine(input.originalStartLine),
    clampPositiveLine(input.originalLine),
  );
  const excerpt =
    trimToNull(input.diffHunk)?.slice(0, 100_000) ??
    `diff anchor for ${normalizedPath}`.slice(0, 100_000);

  return {
    normalizedPath,
    provenance: {
      scope: "branch" as const,
      lane: "committed" as const,
    },
    ...(oldRange ? { oldRange } : {}),
    ...(newRange ? { newRange } : {}),
    excerpt,
  };
}

function normalizePullRequestState(value: string): "open" | "closed" | "merged" {
  const normalized = value.trim().toUpperCase();
  if (normalized === "MERGED") {
    return "merged";
  }
  if (normalized === "CLOSED") {
    return "closed";
  }
  return "open";
}

function classifyUnavailableReason(message: string): ReviewProviderUnavailableReason {
  const lower = message.toLowerCase();
  if (lower.includes("required but not available on path") || lower.includes("command not found")) {
    return "provider-cli-missing";
  }
  if (lower.includes("not authenticated") || lower.includes("gh auth login")) {
    return "provider-auth-missing";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("network") ||
    lower.includes("connection") ||
    lower.includes("tls") ||
    lower.includes("resolve host") ||
    lower.includes("temporary failure")
  ) {
    return "provider-network-error";
  }
  return "provider-request-failed";
}

function toUnavailableResult(input: {
  readonly reason: ReviewProviderUnavailableReason;
  readonly message: string;
  readonly pullRequest: ReviewProviderPullRequest | null;
}): ReviewProviderReadResult {
  return {
    status: "unavailable",
    provider: "github",
    reason: input.reason,
    message: input.message,
    pullRequest: input.pullRequest,
  };
}

function toReviewComment(comment: Schema.Schema.Type<typeof RawPullRequestReviewCommentSchema>) {
  const result = {
    id: comment.id.trim(),
    body: comment.body,
    path: normalizeStoredReviewRelativePath(comment.path),
    anchor: buildAnchor({
      path: comment.path,
      diffHunk: comment.diffHunk,
      line: comment.line,
      originalLine: comment.originalLine,
      startLine: comment.startLine,
      originalStartLine: comment.originalStartLine,
    }),
    authorLogin: trimToNull(comment.author?.login) ?? "github",
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };

  return {
    ...result,
    ...(trimToNull(comment.url) ? { url: comment.url!.trim() } : {}),
    ...(trimToNull(comment.author?.avatarUrl)
      ? { authorAvatarUrl: comment.author!.avatarUrl!.trim() }
      : {}),
  };
}

function toGeneralComment(comment: Schema.Schema.Type<typeof RawGeneralCommentSchema>) {
  const result = {
    id: comment.id.trim(),
    body: comment.body,
    authorLogin: trimToNull(comment.author?.login) ?? "github",
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };

  return Object.assign(
    result,
    trimToNull(comment.url) ? { url: comment.url!.trim() } : {},
    trimToNull(comment.author?.avatarUrl)
      ? { authorAvatarUrl: comment.author!.avatarUrl!.trim() }
      : {},
  );
}

const graphQlQuery = `
query FenrirReviewProvider($url: URI!, $threadsFirst: Int!, $commentsFirst: Int!, $threadCommentsFirst: Int!) {
  resource(url: $url) {
    __typename
    ... on PullRequest {
      number
      url
      title
      state
      isDraft
      body
      createdAt
      updatedAt
      baseRefName
      headRefName
      author {
        login
        avatarUrl
      }
      reviewThreads(first: $threadsFirst) {
        nodes {
          id
          path
          diffSide
          startDiffSide
          line
          originalLine
          startLine
          originalStartLine
          subjectType
          isResolved
          isOutdated
          isCollapsed
          comments(first: $threadCommentsFirst) {
            nodes {
              id
              url
              body
              path
              diffHunk
              line
              originalLine
              startLine
              originalStartLine
              createdAt
              updatedAt
              author {
                login
                avatarUrl
              }
            }
          }
        }
      }
      comments(first: $commentsFirst) {
        nodes {
          id
          url
          body
          createdAt
          updatedAt
          author {
            login
            avatarUrl
          }
        }
      }
    }
  }
}
`.trim();

const makeGitHubReviewProvider = Effect.gen(function* () {
  const gitHubCli = yield* GitHubCli;

  const service = {
    provider: "github" as const,
    resolvePullRequestReference: ({ cwd, reference }) =>
      gitHubCli
        .getPullRequest({
          cwd,
          reference,
        })
        .pipe(
          Effect.map(
            (pullRequest) =>
              ({
                provider: "github",
                number: pullRequest.number,
                url: pullRequest.url,
                baseRef: pullRequest.baseRefName,
                headRef: pullRequest.headRefName,
              }) satisfies ReviewProviderPullRequest,
          ),
          Effect.mapError(
            (cause) =>
              new ReviewProviderError({
                operation: "GitHubReviewProvider.resolvePullRequestReference",
                provider: "github",
                message: cause.message,
                cause,
              }),
          ),
        ),
    readReview: ({ cwd, pullRequest }) => {
      if (pullRequest === null) {
        return Effect.succeed<ReviewProviderReadResult>(
          toUnavailableResult({
            reason: "no-pull-request",
            message: "No GitHub pull request is attached to this review session.",
            pullRequest: null,
          }),
        );
      }

      return gitHubCli
        .execute({
          cwd,
          timeoutMs: GRAPHQL_TIMEOUT_MS,
          args: [
            "api",
            "graphql",
            "-F",
            `url=${pullRequest.url}`,
            "-F",
            `threadsFirst=${GRAPHQL_PAGE_SIZE}`,
            "-F",
            `commentsFirst=${GRAPHQL_PAGE_SIZE}`,
            "-F",
            `threadCommentsFirst=${GRAPHQL_PAGE_SIZE}`,
            "-f",
            `query=${graphQlQuery}`,
          ],
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            Schema.decodeEffect(Schema.fromJsonString(RawGraphqlResponseSchema))(raw),
          ),
          Effect.flatMap((decoded) => {
            const resource = decoded.data.resource;
            if (!resource || resource.__typename !== "PullRequest") {
              return Effect.succeed<ReviewProviderReadResult>(
                toUnavailableResult({
                  reason: "provider-request-failed",
                  message: `GitHub did not return a pull request for ${pullRequest.url}.`,
                  pullRequest,
                }),
              );
            }

            const snapshot: ReviewProviderSnapshot = {
              provider: "github",
              pullRequest: {
                number: resource.number,
                url: resource.url,
                title: resource.title.trim(),
                state: normalizePullRequestState(resource.state),
                isDraft: resource.isDraft,
                body: resource.body,
                baseRef: resource.baseRefName.trim(),
                headRef: resource.headRefName.trim(),
                ...(trimToNull(resource.author?.login)
                  ? { authorLogin: resource.author!.login.trim() }
                  : {}),
                ...(trimToNull(resource.author?.avatarUrl)
                  ? { authorAvatarUrl: resource.author!.avatarUrl!.trim() }
                  : {}),
                createdAt: resource.createdAt,
                updatedAt: resource.updatedAt,
              },
              reviewThreads: resource.reviewThreads.nodes.map((thread) => {
                const anchor = buildAnchor({
                  path: thread.path,
                  diffHunk: thread.comments.nodes[0]?.diffHunk ?? null,
                  line: thread.line,
                  originalLine: thread.originalLine,
                  startLine: thread.startLine,
                  originalStartLine: thread.originalStartLine,
                });

                return {
                  id: thread.id.trim(),
                  path: normalizeStoredReviewRelativePath(thread.path),
                  anchor,
                  isResolved: thread.isResolved,
                  isOutdated: thread.isOutdated,
                  isCollapsed: thread.isCollapsed,
                  comments: thread.comments.nodes.map(toReviewComment),
                };
              }),
              generalComments: resource.comments.nodes.map(toGeneralComment),
            };

            return Effect.succeed<ReviewProviderReadResult>({
              status: "available",
              provider: "github",
              snapshot,
            });
          }),
          Effect.catch((error: unknown) =>
            Effect.succeed<ReviewProviderReadResult>(
              toUnavailableResult({
                reason: classifyUnavailableReason(
                  error instanceof Error ? error.message : String(error),
                ),
                message: error instanceof Error ? error.message : "GitHub review read failed.",
                pullRequest,
              }),
            ),
          ),
        );
    },
  } satisfies ReviewProviderShape;

  return service;
});

export const GitHubReviewProviderLive = Layer.effect(ReviewProvider, makeGitHubReviewProvider);
