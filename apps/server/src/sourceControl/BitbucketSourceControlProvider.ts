import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@fenrir/contracts";

import * as BitbucketApi from "./BitbucketApi.ts";
import * as BitbucketPullRequests from "./bitbucketPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import type * as SourceControlProviderDiscovery from "./SourceControlProviderDiscovery.ts";

function providerError(
  operation: string,
  cause: BitbucketApi.BitbucketApiError,
): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "bitbucket",
    operation,
    detail: cause.detail,
    cause,
  });
}

function unsupported(operation: string): Effect.Effect<never, SourceControlProviderError> {
  return Effect.fail(
    new SourceControlProviderError({
      provider: "bitbucket",
      operation,
      detail: "This Bitbucket source control operation is not supported yet.",
    }),
  );
}

function toChangeRequest(
  summary: BitbucketPullRequests.NormalizedBitbucketPullRequestRecord,
): ChangeRequest {
  return {
    provider: "bitbucket",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state,
    updatedAt: summary.updatedAt ?? Option.none(),
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

export const make = Effect.fn("makeBitbucketSourceControlProvider")(function* () {
  const bitbucket = yield* BitbucketApi.BitbucketApi;

  return SourceControlProvider.SourceControlProvider.of({
    kind: "bitbucket",
    listChangeRequests: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return bitbucket
        .listPullRequests({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          ...(input.headSelector ? { headSelector: input.headSelector } : {}),
          ...(source ? { source } : {}),
          ...(input.baseRefName ? { baseRefName: input.baseRefName } : {}),
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError((error) => providerError("listChangeRequests", error)),
        );
    },
    getChangeRequest: (input) =>
      bitbucket.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) => providerError("getChangeRequest", error)),
      ),
    createChangeRequest: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return bitbucket
        .createPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          ...(input.target ? { target: input.target } : {}),
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(Effect.mapError((error) => providerError("createChangeRequest", error)));
    },
    updateChangeRequest: (input) =>
      bitbucket
        .updatePullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
          ...(input.baseRefName ? { baseRefName: input.baseRefName } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.bodyFile ? { bodyFile: input.bodyFile } : {}),
        })
        .pipe(Effect.mapError((error) => providerError("updateChangeRequest", error))),
    closeChangeRequest: (input) =>
      bitbucket
        .closePullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
        })
        .pipe(Effect.mapError((error) => providerError("closeChangeRequest", error))),
    mergeChangeRequest: () => unsupported("mergeChangeRequest"),
    createChangeRequestLineComment: () => unsupported("createChangeRequestLineComment"),
    listChangeRequestChecks: () => unsupported("listChangeRequestChecks"),
    getRepositoryCloneUrls: (input) =>
      bitbucket
        .getRepositoryCloneUrls(input)
        .pipe(Effect.mapError((error) => providerError("getRepositoryCloneUrls", error))),
    createRepository: (input) =>
      bitbucket
        .createRepository(input)
        .pipe(Effect.mapError((error) => providerError("createRepository", error))),
    getDefaultBranch: (input) =>
      bitbucket
        .getDefaultBranch({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
        })
        .pipe(Effect.mapError((error) => providerError("getDefaultBranch", error))),
    checkoutChangeRequest: (input) =>
      bitbucket
        .checkoutPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
          ...(input.force !== undefined ? { force: input.force } : {}),
        })
        .pipe(Effect.mapError((error) => providerError("checkoutChangeRequest", error))),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make());

export const makeDiscovery = Effect.fn("makeBitbucketSourceControlProviderDiscovery")(function* () {
  const bitbucket = yield* BitbucketApi.BitbucketApi;

  return {
    type: "api",
    kind: "bitbucket",
    label: "Bitbucket",
    installHint:
      "Set T3CODE_BITBUCKET_EMAIL and T3CODE_BITBUCKET_API_TOKEN on the server (use a Bitbucket API token with pull request and repository scopes).",
    probeAuth: bitbucket.probeAuth,
  } satisfies SourceControlProviderDiscovery.SourceControlApiDiscoverySpec;
});
