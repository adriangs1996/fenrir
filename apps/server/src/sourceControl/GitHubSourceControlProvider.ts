import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  SourceControlProviderError,
  type ChangeRequest,
  type ChangeRequestCheck,
  type ChangeRequestCheckStatus,
  type ChangeRequestReviewThread,
  type ChangeRequestState,
} from "@fenrir/contracts";

import * as GitHubCli from "./GitHubCli.ts";
import * as GitHubPullRequests from "./gitHubPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import * as SourceControlProviderDiscovery from "./SourceControlProviderDiscovery.ts";
const isSourceControlProviderError = Schema.is(SourceControlProviderError);

const RawGitHubCheckSchema = Schema.Struct({
  name: Schema.String,
  state: Schema.optional(Schema.String),
  bucket: Schema.optional(Schema.String),
  link: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});
const RawGitHubChecksSchema = Schema.Array(RawGitHubCheckSchema);
const decodeRawGitHubChecks = Schema.decodeUnknownSync(RawGitHubChecksSchema);

const RawGitHubReviewCommentAuthorSchema = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.optional(Schema.NullOr(Schema.String)),
});
const RawGitHubReviewCommentSchema = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  author: Schema.NullOr(RawGitHubReviewCommentAuthorSchema),
  createdAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
});
type RawGitHubReviewComment = typeof RawGitHubReviewCommentSchema.Type;
const RawGitHubReviewThreadSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  diffSide: Schema.String,
  line: Schema.NullOr(Schema.Number),
  startLine: Schema.optional(Schema.NullOr(Schema.Number)),
  isResolved: Schema.Boolean,
  isOutdated: Schema.optional(Schema.Boolean),
  comments: Schema.Struct({
    nodes: Schema.Array(RawGitHubReviewCommentSchema),
  }),
});
const RawGitHubReviewThreadPageSchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            reviewThreads: Schema.Struct({
              nodes: Schema.Array(RawGitHubReviewThreadSchema),
            }),
          }),
        ),
      }),
    ),
  }),
});
const RawGitHubReviewThreadPagesSchema = Schema.Union([
  RawGitHubReviewThreadPageSchema,
  Schema.Array(RawGitHubReviewThreadPageSchema),
]);
const decodeRawGitHubReviewThreadPages = Schema.decodeUnknownSync(RawGitHubReviewThreadPagesSchema);

const REVIEW_THREADS_GRAPHQL_QUERY = `
query FenrirPullRequestReviewThreads(
  $owner: String!
  $name: String!
  $number: Int!
  $endCursor: String
) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        nodes {
          id
          path
          diffSide
          line
          startLine
          isResolved
          isOutdated
          comments(first: 50) {
            nodes {
              id
              body
              author {
                login
                avatarUrl
              }
              createdAt
              updatedAt
              url
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

function providerError(
  operation: string,
  cause: GitHubCli.GitHubCliError,
): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "github",
    operation,
    detail: cause.detail,
    cause,
  });
}

function toChangeRequest(summary: GitHubCli.GitHubPullRequestSummary): ChangeRequest {
  return {
    provider: "github",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function normalizeChangeRequestReference(reference: string): string {
  return reference.trim().replace(/^#/, "");
}

function splitRepositoryNameWithOwner(repository: string): { owner: string; name: string } | null {
  const trimmed = repository.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }
  return {
    owner: trimmed.slice(0, separatorIndex),
    name: trimmed.slice(separatorIndex + 1),
  };
}

function mapGitHubCheckStatus(raw: string | undefined): ChangeRequestCheckStatus {
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (
    normalized === "pass" ||
    normalized === "passing" ||
    normalized === "success" ||
    normalized === "successful"
  ) {
    return "success";
  }
  if (
    normalized === "fail" ||
    normalized === "failing" ||
    normalized === "failure" ||
    normalized === "error" ||
    normalized === "timed_out" ||
    normalized === "action_required"
  ) {
    return "failure";
  }
  if (
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "in_progress" ||
    normalized === "waiting" ||
    normalized === "expected"
  ) {
    return "pending";
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }
  if (normalized === "skipped") {
    return "skipped";
  }
  return "unknown";
}

function decodeGitHubChecks(raw: string): ReadonlyArray<ChangeRequestCheck> {
  const parsed = JSON.parse(raw) as unknown;
  const decoded = decodeRawGitHubChecks(parsed);
  return decoded.map((item) => {
    const name = item.name.trim() || "Check";
    const status = mapGitHubCheckStatus(item.state ?? item.bucket);
    const startedAt = Option.none();
    const completedAt = Option.none();
    if (item.link && item.description) {
      return {
        name,
        status,
        url: item.link,
        description: item.description,
        startedAt,
        completedAt,
      };
    }
    if (item.link) {
      return { name, status, url: item.link, startedAt, completedAt };
    }
    if (item.description) {
      return { name, status, description: item.description, startedAt, completedAt };
    }
    return { name, status, startedAt, completedAt };
  });
}

function mapGitHubReviewThreadSide(side: string): "additions" | "deletions" | null {
  const normalized = side.trim().toUpperCase();
  if (normalized === "RIGHT") return "additions";
  if (normalized === "LEFT") return "deletions";
  return null;
}

function positiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function decodeGitHubReviewThreads(raw: string): ReadonlyArray<ChangeRequestReviewThread> {
  const parsed = JSON.parse(raw) as unknown;
  const decoded = decodeRawGitHubReviewThreadPages(parsed);
  const pages = Array.isArray(decoded) ? decoded : [decoded];
  const threads: ChangeRequestReviewThread[] = [];

  for (const page of pages) {
    const rawThreads = page.data.repository?.pullRequest?.reviewThreads.nodes ?? [];
    for (const rawThread of rawThreads) {
      const side = mapGitHubReviewThreadSide(rawThread.diffSide);
      const line = positiveInteger(rawThread.line);
      if (side === null || line === null || rawThread.path.trim().length === 0) {
        continue;
      }

      const comments = rawThread.comments.nodes
        .filter((comment: RawGitHubReviewComment) => comment.id.trim().length > 0)
        .map((comment: RawGitHubReviewComment) => {
          const authorLogin = comment.author?.login.trim();
          const author = Object.assign(
            { login: authorLogin ? authorLogin : "unknown" },
            comment.author?.avatarUrl ? { avatarUrl: comment.author.avatarUrl } : {},
          );

          return Object.assign(
            {
              id: comment.id.trim(),
              body: comment.body,
              author,
            },
            comment.createdAt ? { createdAt: comment.createdAt } : {},
            comment.updatedAt ? { updatedAt: comment.updatedAt } : {},
            comment.url ? { url: comment.url } : {},
          );
        });
      if (comments.length === 0) {
        continue;
      }

      const startLine = positiveInteger(rawThread.startLine);
      threads.push({
        id: rawThread.id.trim(),
        path: rawThread.path.trim(),
        side,
        line,
        ...(startLine !== null && startLine !== line ? { startLine } : {}),
        isResolved: rawThread.isResolved,
        ...(rawThread.isOutdated !== undefined ? { isOutdated: rawThread.isOutdated } : {}),
        comments,
      });
    }
  }

  return threads;
}

function parseGitHubAuth(input: SourceControlProviderDiscovery.SourceControlAuthProbeInput) {
  const output = SourceControlProviderDiscovery.combinedAuthOutput(input);
  const account = SourceControlProviderDiscovery.matchFirst(output, [
    /Logged in to .* account\s+([^\s(]+)/iu,
    /Logged in to .* as\s+([^\s(]+)/iu,
  ]);
  const host = SourceControlProviderDiscovery.parseCliHost(output);

  if (input.exitCode !== 0) {
    return SourceControlProviderDiscovery.providerAuth({
      status: "unauthenticated",
      host,
      detail:
        SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
        "Run `gh auth login` to authenticate GitHub CLI.",
    });
  }

  if (account) {
    return SourceControlProviderDiscovery.providerAuth({ status: "authenticated", account, host });
  }

  return SourceControlProviderDiscovery.providerAuth({
    status: "unknown",
    host,
    detail:
      SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
      "GitHub CLI auth status could not be parsed.",
  });
}

export const discovery = {
  type: "cli",
  kind: "github",
  label: "GitHub",
  executable: "gh",
  versionArgs: ["--version"],
  authArgs: ["auth", "status"],
  parseAuth: parseGitHubAuth,
  installHint:
    "Install the GitHub command-line tool (`gh`) via https://cli.github.com/ or your package manager (for example `brew install gh`).",
} satisfies SourceControlProviderDiscovery.SourceControlCliDiscoverySpec;

export const make = Effect.fn("makeGitHubSourceControlProvider")(function* () {
  const github = yield* GitHubCli.GitHubCli;

  const listChangeRequests: SourceControlProvider.SourceControlProviderShape["listChangeRequests"] =
    (input) => {
      if (
        input.state === "open" &&
        input.headSelector !== undefined &&
        input.baseRefName === undefined
      ) {
        return github
          .listOpenPullRequests({
            cwd: input.cwd,
            headSelector: input.headSelector,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
          .pipe(
            Effect.map((items) => items.map(toChangeRequest)),
            Effect.mapError((error) => providerError("listChangeRequests", error)),
          );
      }

      const stateArg: ChangeRequestState | "all" = input.state;
      return github
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "list",
            ...(input.headSelector === undefined ? [] : ["--head", input.headSelector]),
            ...(input.baseRefName === undefined ? [] : ["--base", input.baseRefName]),
            "--state",
            stateArg,
            "--limit",
            String(input.limit ?? 20),
            "--json",
            "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
          ],
        })
        .pipe(
          Effect.flatMap((result) => {
            const raw = result.stdout.trim();
            if (raw.length === 0) {
              return Effect.succeed([]);
            }
            return Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
              Effect.flatMap((decoded) =>
                Result.isSuccess(decoded)
                  ? Effect.succeed(
                      decoded.success.map((item) => ({
                        ...toChangeRequest(item),
                        updatedAt: item.updatedAt,
                      })),
                    )
                  : Effect.fail(
                      new SourceControlProviderError({
                        provider: "github",
                        operation: "listChangeRequests",
                        detail: "GitHub CLI returned invalid change request JSON.",
                        cause: decoded.failure,
                      }),
                    ),
              ),
            );
          }),
          Effect.mapError((error) =>
            isSourceControlProviderError(error)
              ? error
              : providerError("listChangeRequests", error),
          ),
        );
    };

  return SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listChangeRequests,
    getChangeRequest: (input) =>
      github.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) => providerError("getChangeRequest", error)),
      ),
    createChangeRequest: (input) =>
      github
        .createPullRequest({
          cwd: input.cwd,
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(Effect.mapError((error) => providerError("createChangeRequest", error))),
    updateChangeRequest: (input) => {
      const args = [
        "pr",
        "edit",
        input.reference,
        ...(input.baseRefName === undefined ? [] : ["--base", input.baseRefName]),
        ...(input.title === undefined ? [] : ["--title", input.title]),
        ...(input.bodyFile === undefined ? [] : ["--body-file", input.bodyFile]),
      ];
      if (args.length === 3) {
        return Effect.void;
      }
      return github
        .execute({
          cwd: input.cwd,
          args,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((error) => providerError("updateChangeRequest", error)),
        );
    },
    closeChangeRequest: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: ["pr", "close", input.reference],
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((error) => providerError("closeChangeRequest", error)),
        ),
    mergeChangeRequest: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: ["pr", "merge", input.reference, `--${input.method ?? "merge"}`],
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError((error) => providerError("mergeChangeRequest", error)),
        ),
    createChangeRequestLineComment: (input) =>
      Effect.gen(function* () {
        const reference = normalizeChangeRequestReference(input.reference);
        const [repositoryResult, headShaResult] = yield* Effect.all(
          [
            github.execute({
              cwd: input.cwd,
              args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
            }),
            github.execute({
              cwd: input.cwd,
              args: ["pr", "view", reference, "--json", "headRefOid", "--jq", ".headRefOid"],
            }),
          ],
          { concurrency: "unbounded" },
        );
        const repository = repositoryResult.stdout.trim();
        const headSha = headShaResult.stdout.trim();
        if (repository.length === 0 || headSha.length === 0) {
          return yield* new SourceControlProviderError({
            provider: "github",
            operation: "createChangeRequestLineComment",
            detail: "GitHub CLI did not return repository or PR head commit metadata.",
          });
        }

        const side = input.side === "additions" ? "RIGHT" : "LEFT";
        yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            `repos/${repository}/pulls/${reference}/comments`,
            "--method",
            "POST",
            "-f",
            `body=${input.body}`,
            "-f",
            `commit_id=${headSha}`,
            "-f",
            `path=${input.path}`,
            "-f",
            `side=${side}`,
            "-F",
            `line=${input.line}`,
            ...(input.startLine !== undefined
              ? ["-F", `start_line=${input.startLine}`, "-f", `start_side=${side}`]
              : []),
          ],
        });
      }).pipe(
        Effect.mapError((error) =>
          isSourceControlProviderError(error)
            ? error
            : providerError("createChangeRequestLineComment", error),
        ),
      ),
    listChangeRequestChecks: (input) =>
      github
        .execute({
          cwd: input.cwd,
          args: ["pr", "checks", input.reference, "--json", "name,state,bucket,link,description"],
        })
        .pipe(
          Effect.flatMap((result) =>
            Effect.try({
              try: () => decodeGitHubChecks(result.stdout.trim() || "[]"),
              catch: (cause) =>
                new SourceControlProviderError({
                  provider: "github",
                  operation: "listChangeRequestChecks",
                  detail: "GitHub CLI returned invalid check JSON.",
                  cause,
                }),
            }),
          ),
          Effect.mapError((error) =>
            isSourceControlProviderError(error)
              ? error
              : providerError("listChangeRequestChecks", error),
          ),
        ),
    listChangeRequestReviewThreads: (input) =>
      Effect.gen(function* () {
        const reference = normalizeChangeRequestReference(input.reference);
        const repositoryResult = yield* github.execute({
          cwd: input.cwd,
          args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        });
        const repository = splitRepositoryNameWithOwner(repositoryResult.stdout);
        if (repository === null) {
          return yield* new SourceControlProviderError({
            provider: "github",
            operation: "listChangeRequestReviewThreads",
            detail: "GitHub CLI did not return repository metadata.",
          });
        }

        const commentsResult = yield* github.execute({
          cwd: input.cwd,
          args: [
            "api",
            "graphql",
            "--paginate",
            "--slurp",
            "-F",
            `owner=${repository.owner}`,
            "-F",
            `name=${repository.name}`,
            "-F",
            `number=${reference}`,
            "-f",
            `query=${REVIEW_THREADS_GRAPHQL_QUERY}`,
          ],
        });

        return yield* Effect.try({
          try: () => decodeGitHubReviewThreads(commentsResult.stdout.trim() || "[]"),
          catch: (cause) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "listChangeRequestReviewThreads",
              detail: "GitHub CLI returned invalid pull request review thread JSON.",
              cause,
            }),
        });
      }).pipe(
        Effect.mapError((error) =>
          isSourceControlProviderError(error)
            ? error
            : providerError("listChangeRequestReviewThreads", error),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      github
        .getRepositoryCloneUrls(input)
        .pipe(Effect.mapError((error) => providerError("getRepositoryCloneUrls", error))),
    createRepository: (input) =>
      github
        .createRepository(input)
        .pipe(Effect.mapError((error) => providerError("createRepository", error))),
    getDefaultBranch: (input) =>
      github
        .getDefaultBranch(input)
        .pipe(Effect.mapError((error) => providerError("getDefaultBranch", error))),
    checkoutChangeRequest: (input) =>
      github
        .checkoutPullRequest(input)
        .pipe(Effect.mapError((error) => providerError("checkoutChangeRequest", error))),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make());
