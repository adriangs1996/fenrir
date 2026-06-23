import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type { ChangeRequest } from "@fenrir/contracts/sourceControl";
import {
  SourceControlStackRpcError,
  type SourceControlStackCapability,
  type SourceControlStackCommit,
  type SourceControlStackCreateEntryInput,
  type SourceControlStackEntry,
  type SourceControlStackEntryId,
  type SourceControlStackGetSnapshotInput,
  type SourceControlStackMutationResult,
  type SourceControlStackOperationId,
  type SourceControlStackProblem,
  type SourceControlStackSnapshot,
  type SourceControlStackStreamEvent,
} from "@fenrir/contracts/sourceControlStack";

import { GitWorkflowService } from "../../../git/Services/GitWorkflowService.ts";
import { GitCore } from "../../../git/Services/GitCore.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SourceControlProviderRegistry } from "../../SourceControlProviderRegistry.ts";
import type {
  SourceControlProviderContext,
  SourceControlProviderShape,
} from "../../SourceControlProvider.ts";
import { SourceControl } from "../../Services/SourceControl.ts";
import { SourceControlStackService } from "../Services/SourceControlStackService.ts";
import { selectProviderStackChain } from "../stackTopology.ts";

interface ResolvedStackContext {
  readonly threadId: SourceControlStackSnapshot["threadId"];
  readonly cwd: string;
  readonly repositoryRoot: string;
  readonly currentBranch: string | null;
  readonly provider: SourceControlStackSnapshot["provider"];
  readonly providerShape: SourceControlProviderShape | null;
  readonly providerContext: SourceControlProviderContext | null;
  readonly providerUnavailable: boolean;
  readonly isRepository: boolean;
}

interface DraftMetadata {
  readonly branchName: string;
  readonly parent: string | null;
  readonly title: string | null;
  readonly description: string | null;
  readonly createdAt: string | null;
}

interface StackEventEnvelope {
  readonly threadId: SourceControlStackSnapshot["threadId"];
  readonly event: SourceControlStackStreamEvent;
}

const GIT_CAPABILITIES: ReadonlyArray<SourceControlStackCapability> = [
  "create-entry",
  "switch-entry",
  "rename-entry",
  "drop-entry",
  "reorder",
  "restack",
  "sync",
  "squash",
  "split-commits",
  "push",
  "publish",
];

function stackError(message: string, cause?: unknown): SourceControlStackRpcError {
  return new SourceControlStackRpcError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function makeOperationId(): SourceControlStackOperationId {
  return `source-control-stack-operation-${randomUUID()}` as SourceControlStackOperationId;
}

function entryIdFromBranch(branchName: string): SourceControlStackEntryId {
  return `local:${branchName}` as SourceControlStackEntryId;
}

function entryIdFromChangeRequest(changeRequest: ChangeRequest): SourceControlStackEntryId {
  return `${changeRequest.provider}:${changeRequest.number}` as SourceControlStackEntryId;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function configKey(branchName: string, key: string): string {
  return `branch.${branchName}.fenrirStack${key}`;
}

function publicationForProviderEntry(input: {
  readonly changeRequest: ChangeRequest;
  readonly draft: DraftMetadata | undefined;
}): SourceControlStackEntry["publication"] {
  if (!input.draft) return "published";
  return input.draft.parent !== null && input.draft.parent !== input.changeRequest.baseRefName
    ? "stale-local"
    : "published";
}

function defaultSnapshot(input: {
  readonly context: ResolvedStackContext;
  readonly rootBaseRef: string;
  readonly entries: ReadonlyArray<SourceControlStackEntry>;
  readonly problems: ReadonlyArray<SourceControlStackProblem>;
}): SourceControlStackSnapshot {
  return {
    threadId: input.context.threadId,
    cwd: input.context.cwd,
    repositoryRoot: input.context.repositoryRoot,
    provider: input.context.provider,
    rootBaseRef: input.rootBaseRef,
    currentEntryId: input.entries.find((entry) => entry.isCurrent)?.id ?? null,
    entries: input.entries.map((entry, index) => ({ ...entry, index })),
    capabilities: [
      ...GIT_CAPABILITIES,
      ...(input.context.providerShape
        ? ([
            "update-change-requests",
            "close-change-requests",
          ] satisfies ReadonlyArray<SourceControlStackCapability>)
        : []),
    ],
    problems: input.problems,
    generatedAt: new Date().toISOString(),
  };
}

function hasRemoteBranch(remoteBranches: ReadonlySet<string>, branchName: string): boolean {
  return [...remoteBranches].some((remoteRef) => remoteRef.endsWith(`/${branchName}`));
}

function attachChildren(
  entries: ReadonlyArray<SourceControlStackEntry>,
): ReadonlyArray<SourceControlStackEntry> {
  const childrenByParent = new Map<SourceControlStackEntryId, SourceControlStackEntryId[]>();
  for (const entry of entries) {
    if (entry.parentEntryId) {
      childrenByParent.set(entry.parentEntryId, [
        ...(childrenByParent.get(entry.parentEntryId) ?? []),
        entry.id,
      ]);
    }
  }
  return entries.map((entry) => ({
    ...entry,
    childEntryIds: childrenByParent.get(entry.id) ?? [],
  }));
}

function blockedResult(
  operationId: SourceControlStackOperationId,
  message: string,
  snapshot: SourceControlStackSnapshot,
): SourceControlStackMutationResult {
  return {
    operationId,
    status: "blocked",
    message,
    snapshot,
  };
}

function publishRemoteName(context: ResolvedStackContext): string {
  return context.providerContext?.remoteName ?? "origin";
}

function completedResult(
  operationId: SourceControlStackOperationId,
  message: string,
  snapshot: SourceControlStackSnapshot,
): SourceControlStackMutationResult {
  return {
    operationId,
    status: "completed",
    message,
    snapshot,
  };
}

export const makeSourceControlStackService = Effect.gen(function* () {
  const git = yield* GitCore;
  const gitWorkflow = yield* GitWorkflowService;
  const sourceControl = yield* SourceControl;
  const providers = yield* SourceControlProviderRegistry;
  const projection = yield* ProjectionSnapshotQuery;
  const events = yield* PubSub.unbounded<StackEventEnvelope>();
  const locks = new Map<string, Semaphore.Semaphore>();

  const getLock = (cwd: string): Effect.Effect<Semaphore.Semaphore> => {
    const existing = locks.get(cwd);
    if (existing) return Effect.succeed(existing);
    return Semaphore.make(1).pipe(
      Effect.tap((semaphore) => Effect.sync(() => locks.set(cwd, semaphore))),
    );
  };

  const publishEvent = (
    threadId: SourceControlStackSnapshot["threadId"],
    event: SourceControlStackStreamEvent,
  ) => PubSub.publish(events, { threadId, event }).pipe(Effect.asVoid);

  const gitResult = (
    cwd: string,
    args: ReadonlyArray<string>,
    operation: string,
    allowNonZeroExit = true,
  ) =>
    git
      .execute({ cwd, args, operation, allowNonZeroExit })
      .pipe(
        Effect.mapError((cause) =>
          stackError(`Git command failed while running ${operation}.`, cause),
        ),
      );

  const gitString = (cwd: string, args: ReadonlyArray<string>, operation: string) =>
    gitResult(cwd, args, operation).pipe(
      Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
    );

  const gitVoid = (cwd: string, args: ReadonlyArray<string>, operation: string) =>
    gitResult(cwd, args, operation, false).pipe(Effect.asVoid);

  const resolveContext = (
    input: SourceControlStackGetSnapshotInput,
  ): Effect.Effect<ResolvedStackContext, SourceControlStackRpcError> =>
    Effect.gen(function* () {
      const thread = Option.getOrNull(
        yield* projection
          .getThreadSnapshot(input.threadId)
          .pipe(Effect.mapError((cause) => stackError("Failed to resolve stack thread.", cause))),
      );
      if (!thread) {
        return yield* stackError(`Thread ${input.threadId} was not found.`);
      }

      const project = Option.getOrNull(
        yield* projection
          .getProjectShellById(thread.projectId)
          .pipe(Effect.mapError((cause) => stackError("Failed to resolve stack project.", cause))),
      );
      if (!project) {
        return yield* stackError(`Project ${thread.projectId} was not found.`);
      }

      const cwd = thread.worktreePath ?? project.workspaceRoot;
      const workspace = yield* sourceControl
        .resolveWorkspace(cwd)
        .pipe(
          Effect.mapError((cause) =>
            stackError("Failed to resolve source-control workspace.", cause),
          ),
        );
      if (!workspace || workspace.kind !== "git") {
        return {
          threadId: input.threadId,
          cwd,
          repositoryRoot: cwd,
          currentBranch: null,
          provider: null,
          providerShape: null,
          providerContext: null,
          providerUnavailable: false,
          isRepository: false,
        };
      }

      const currentBranch = yield* gitString(
        cwd,
        ["rev-parse", "--abbrev-ref", "HEAD"],
        "stack.currentBranch",
      ).pipe(Effect.map((branch) => (branch === "HEAD" ? null : nonEmpty(branch))));

      const providerHandle = yield* providers.resolveHandle({ cwd }).pipe(
        Effect.map((handle) => ({
          provider: handle.context?.provider ?? null,
          providerShape: handle.provider,
          providerContext: handle.context ?? null,
          providerUnavailable: false,
        })),
        Effect.catch(() =>
          Effect.succeed({
            provider: null,
            providerShape: null,
            providerContext: null,
            providerUnavailable: true,
          }),
        ),
      );

      return {
        threadId: input.threadId,
        cwd,
        repositoryRoot: workspace.rootPath,
        currentBranch,
        isRepository: true,
        ...providerHandle,
      };
    });

  const listRefs = (
    cwd: string,
    refPrefix: "refs/heads" | "refs/remotes",
  ): Effect.Effect<ReadonlyArray<string>, SourceControlStackRpcError> =>
    gitString(
      cwd,
      ["for-each-ref", "--format=%(refname:short)", refPrefix],
      `stack.list.${refPrefix}`,
    ).pipe(Effect.map((stdout) => stdout.split(/\r?\n/u).filter((line) => line.length > 0)));

  const readDraftMetadata = (
    cwd: string,
    branches: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<DraftMetadata>, SourceControlStackRpcError> =>
    Effect.forEach(branches, (branchName) =>
      Effect.all(
        {
          parent: git
            .readConfigValue(cwd, configKey(branchName, "Parent"))
            .pipe(Effect.catch(() => Effect.succeed(null))),
          title: git
            .readConfigValue(cwd, configKey(branchName, "Title"))
            .pipe(Effect.catch(() => Effect.succeed(null))),
          description: git
            .readConfigValue(cwd, configKey(branchName, "Description"))
            .pipe(Effect.catch(() => Effect.succeed(null))),
          createdAt: git
            .readConfigValue(cwd, configKey(branchName, "CreatedAt"))
            .pipe(Effect.catch(() => Effect.succeed(null))),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((metadata) => ({
          branchName,
          parent: nonEmpty(metadata.parent),
          title: nonEmpty(metadata.title),
          description: nonEmpty(metadata.description),
          createdAt: nonEmpty(metadata.createdAt),
        })),
      ),
    ).pipe(
      Effect.map((drafts) =>
        drafts.filter((draft) => draft.parent !== null || draft.title !== null),
      ),
      Effect.mapError((cause) => stackError("Failed to read local draft stack metadata.", cause)),
    );

  const writeDraftMetadata = (cwd: string, draft: DraftMetadata) =>
    Effect.all(
      [
        gitVoid(
          cwd,
          ["config", configKey(draft.branchName, "Parent"), draft.parent ?? ""],
          "stack.writeParent",
        ),
        gitVoid(
          cwd,
          ["config", configKey(draft.branchName, "Title"), draft.title ?? draft.branchName],
          "stack.writeTitle",
        ),
        gitVoid(
          cwd,
          [
            "config",
            configKey(draft.branchName, "CreatedAt"),
            draft.createdAt ?? new Date().toISOString(),
          ],
          "stack.writeCreatedAt",
        ),
        draft.description
          ? gitVoid(
              cwd,
              ["config", configKey(draft.branchName, "Description"), draft.description],
              "stack.writeDescription",
            )
          : Effect.void,
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid);

  const unsetDraftMetadata = (cwd: string, branchName: string) =>
    Effect.all(
      ["Parent", "Title", "Description", "CreatedAt"].map((key) =>
        gitResult(cwd, ["config", "--unset", configKey(branchName, key)], `stack.unset${key}`).pipe(
          Effect.asVoid,
        ),
      ),
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid);

  const readCommits = (
    cwd: string,
    baseRefName: string,
    headRefName: string,
  ): Effect.Effect<ReadonlyArray<SourceControlStackCommit>, SourceControlStackRpcError> =>
    gitString(
      cwd,
      ["log", "--format=%H%x1f%s%x1f%aI", `${baseRefName}..${headRefName}`],
      "stack.readCommits",
    ).pipe(
      Effect.map((stdout) =>
        stdout
          .split(/\r?\n/u)
          .filter((line) => line.length > 0)
          .map((line) => {
            const [oid, subject, authoredAt] = line.split("\x1f");
            const commit: {
              oid: string;
              subject: string;
              authoredAt?: string;
            } = {
              oid: oid ?? "",
              subject: nonEmpty(subject) ?? "(no subject)",
            };
            if (authoredAt) {
              commit.authoredAt = authoredAt;
            }
            return commit;
          })
          .filter((commit) => commit.oid.length > 0),
      ),
    );

  const readAheadBehind = (
    cwd: string,
    baseRefName: string,
    headRefName: string,
  ): Effect.Effect<
    { readonly ahead: number; readonly behind: number },
    SourceControlStackRpcError
  > =>
    gitString(
      cwd,
      ["rev-list", "--left-right", "--count", `${baseRefName}...${headRefName}`],
      "stack.readAheadBehind",
    ).pipe(
      Effect.map((stdout) => {
        const [behindRaw, aheadRaw] = stdout.split(/\s+/u);
        return {
          behind: Number.parseInt(behindRaw ?? "0", 10) || 0,
          ahead: Number.parseInt(aheadRaw ?? "0", 10) || 0,
        };
      }),
      Effect.catch(() => Effect.succeed({ ahead: 0, behind: 0 })),
    );

  const buildEntry = (input: {
    readonly context: ResolvedStackContext;
    readonly localBranches: ReadonlySet<string>;
    readonly remoteBranches: ReadonlySet<string>;
    readonly id: SourceControlStackEntryId;
    readonly title: string;
    readonly description: string | null;
    readonly branchName: string;
    readonly baseRefName: string;
    readonly headRefName: string;
    readonly parentEntryId: SourceControlStackEntryId | null;
    readonly publication: SourceControlStackEntry["publication"];
    readonly changeRequest: ChangeRequest | null;
    readonly problems?: ReadonlyArray<SourceControlStackProblem>;
  }): Effect.Effect<SourceControlStackEntry, SourceControlStackRpcError> =>
    Effect.gen(function* () {
      const commits = yield* readCommits(
        input.context.cwd,
        input.baseRefName,
        input.headRefName,
      ).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<SourceControlStackCommit>)));
      const counts = yield* readAheadBehind(
        input.context.cwd,
        input.baseRefName,
        input.headRefName,
      );
      const hasLocalBranch = input.localBranches.has(input.headRefName);
      const entryProblems = new Set(input.problems ?? []);
      if (!hasLocalBranch) entryProblems.add("missing-local-branch");

      return {
        id: input.id,
        index: 0,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        branchName: input.branchName,
        headRefName: input.headRefName,
        baseRefName: input.baseRefName,
        parentEntryId: input.parentEntryId,
        childEntryIds: [],
        publication: input.publication,
        changeRequest: input.changeRequest,
        commits,
        commitOids: commits.map((commit) => commit.oid),
        aheadCount: counts.ahead,
        behindCount: counts.behind,
        hasLocalBranch,
        hasRemoteBranch: hasRemoteBranch(input.remoteBranches, input.headRefName),
        isCurrent: input.context.currentBranch === input.headRefName,
        problems: [...entryProblems],
      };
    });

  const loadSnapshot = (
    input: SourceControlStackGetSnapshotInput,
  ): Effect.Effect<SourceControlStackSnapshot, SourceControlStackRpcError> =>
    Effect.gen(function* () {
      const context = yield* resolveContext(input);
      if (!context.isRepository) {
        return defaultSnapshot({
          context,
          rootBaseRef: "main",
          entries: [],
          problems: ["not-a-repository"],
        });
      }

      const [localBranches, remoteBranches] = yield* Effect.all(
        [listRefs(context.cwd, "refs/heads"), listRefs(context.cwd, "refs/remotes")],
        { concurrency: "unbounded" },
      );
      const localBranchSet = new Set(localBranches);
      const remoteBranchSet = new Set(remoteBranches);
      const drafts = yield* readDraftMetadata(context.cwd, localBranches);
      const draftsByBranch = new Map(drafts.map((draft) => [draft.branchName, draft]));

      const providerChangeRequests =
        context.providerShape === null
          ? []
          : yield* context.providerShape
              .listChangeRequests({
                cwd: context.cwd,
                ...(context.providerContext ? { context: context.providerContext } : {}),
                state: "open",
                limit: 100,
              })
              .pipe(
                Effect.mapError((cause) =>
                  stackError("Failed to list provider change requests.", cause),
                ),
                Effect.catch(() => Effect.succeed([] as ReadonlyArray<ChangeRequest>)),
              );

      const selectedHeadRefName = input.selectedHeadRefName ?? context.currentBranch;
      const providerChain = selectProviderStackChain({
        changeRequests: providerChangeRequests,
        selectedHeadRefName,
      });

      const problems = new Set<SourceControlStackProblem>(providerChain.problems);
      if (context.providerUnavailable) problems.add("provider-unavailable");

      const providerEntries: SourceControlStackEntry[] = [];
      const entryByHead = new Map<string, SourceControlStackEntry>();
      const entryIdByHead = new Map<string, SourceControlStackEntryId>();
      for (const node of providerChain.selected) {
        const id = entryIdFromChangeRequest(node.changeRequest);
        entryIdByHead.set(node.headRefName, id);
      }

      for (const node of providerChain.selected) {
        const parentEntryId = entryIdByHead.get(node.baseRefName) ?? null;
        const draft = draftsByBranch.get(node.headRefName);
        const entry = yield* buildEntry({
          context,
          localBranches: localBranchSet,
          remoteBranches: remoteBranchSet,
          id: entryIdFromChangeRequest(node.changeRequest),
          title: node.changeRequest.title,
          description: draft?.description ?? null,
          branchName: node.headRefName,
          headRefName: node.headRefName,
          baseRefName: node.baseRefName,
          parentEntryId,
          publication: publicationForProviderEntry({
            changeRequest: node.changeRequest,
            draft,
          }),
          changeRequest: node.changeRequest,
        });
        providerEntries.push(entry);
        entryByHead.set(entry.headRefName, entry);
      }

      const rootBaseRef =
        providerChain.rootBaseRef ??
        drafts.find((draft) => draft.branchName === context.currentBranch)?.parent ??
        "main";

      const draftEntries: SourceControlStackEntry[] = [];
      const attachableHeads = new Set<string>([
        rootBaseRef,
        ...providerEntries.map((entry) => entry.headRefName),
      ]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const draft of drafts) {
          if (entryByHead.has(draft.branchName)) continue;
          if (!draft.parent || !attachableHeads.has(draft.parent)) continue;
          const parentEntryId = entryIdByHead.get(draft.parent) ?? null;
          const entry = yield* buildEntry({
            context,
            localBranches: localBranchSet,
            remoteBranches: remoteBranchSet,
            id: entryIdFromBranch(draft.branchName),
            title: draft.title ?? draft.branchName,
            description: draft.description,
            branchName: draft.branchName,
            headRefName: draft.branchName,
            baseRefName: draft.parent,
            parentEntryId,
            publication: "draft-local",
            changeRequest: null,
          });
          draftEntries.push(entry);
          entryByHead.set(entry.headRefName, entry);
          entryIdByHead.set(entry.headRefName, entry.id);
          attachableHeads.add(entry.headRefName);
          changed = true;
        }
      }

      if (providerEntries.length === 0 && draftEntries.length === 0 && context.currentBranch) {
        const fallbackEntry = yield* buildEntry({
          context,
          localBranches: localBranchSet,
          remoteBranches: remoteBranchSet,
          id: entryIdFromBranch(context.currentBranch),
          title: context.currentBranch,
          description: null,
          branchName: context.currentBranch,
          headRefName: context.currentBranch,
          baseRefName: rootBaseRef,
          parentEntryId: null,
          publication: "draft-local",
          changeRequest: null,
        });
        draftEntries.push(fallbackEntry);
      }

      return defaultSnapshot({
        context,
        rootBaseRef,
        entries: attachChildren([...providerEntries, ...draftEntries]),
        problems: [...problems],
      });
    });

  const withLockedContext = <A>(
    input: SourceControlStackGetSnapshotInput,
    operation: (
      context: ResolvedStackContext,
      operationId: SourceControlStackOperationId,
    ) => Effect.Effect<A, SourceControlStackRpcError>,
  ): Effect.Effect<A, SourceControlStackRpcError> =>
    Effect.gen(function* () {
      const context = yield* resolveContext(input);
      const lock = yield* getLock(context.cwd);
      return yield* lock.withPermits(1)(operation(context, makeOperationId()));
    });

  const emitCompleted = (result: SourceControlStackMutationResult) =>
    Effect.all(
      [
        publishEvent(result.snapshot.threadId, {
          _tag: "snapshotReplaced",
          snapshot: result.snapshot,
        }),
        publishEvent(result.snapshot.threadId, {
          _tag: "operationCompleted",
          operationId: result.operationId,
          result,
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid, Effect.as(result));

  const createEntry = (
    input: SourceControlStackCreateEntryInput,
  ): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      Effect.gen(function* () {
        const before = yield* loadSnapshot({ threadId: input.threadId });
        const parentEntry =
          input.parentEntryId === null
            ? null
            : (before.entries.find((entry) => entry.id === input.parentEntryId) ?? null);
        const parentRef = parentEntry?.headRefName ?? context.currentBranch ?? before.rootBaseRef;
        yield* gitVoid(context.cwd, ["branch", input.branchName, parentRef], "stack.createBranch");
        yield* writeDraftMetadata(context.cwd, {
          branchName: input.branchName,
          parent: parentRef,
          title: input.title,
          description: input.description ?? null,
          createdAt: new Date().toISOString(),
        });

        if (input.publish === true) {
          if (!context.providerShape) {
            return blockedResult(
              opId,
              "Created the draft branch, but no provider is available to publish it.",
              yield* loadSnapshot({ threadId: input.threadId }),
            );
          }
          yield* gitVoid(
            context.cwd,
            ["push", "-u", publishRemoteName(context), input.branchName],
            "stack.pushDraft",
          );
          const bodyFile = join(tmpdir(), `fenrir-stack-${randomUUID()}.md`);
          yield* Effect.promise(() =>
            writeFile(bodyFile, `Stack entry: ${input.title}\n\nParent branch: ${parentRef}\n`),
          ).pipe(
            Effect.mapError((cause) => stackError("Failed to write change-request body.", cause)),
          );
          yield* context.providerShape
            .createChangeRequest({
              cwd: context.cwd,
              ...(context.providerContext ? { context: context.providerContext } : {}),
              baseRefName: parentRef,
              headSelector: input.branchName,
              title: input.title,
              bodyFile,
            })
            .pipe(
              Effect.mapError((cause) => stackError("Failed to create change request.", cause)),
            );
        }

        return completedResult(
          opId,
          input.publish === true
            ? "Stack entry created and published."
            : "Draft stack entry created.",
          yield* loadSnapshot({ threadId: input.threadId, selectedHeadRefName: input.branchName }),
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const switchEntry = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
    readonly entryId: SourceControlStackEntryId;
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      Effect.gen(function* () {
        const snapshot = yield* loadSnapshot({ threadId: input.threadId });
        const entry = snapshot.entries.find((candidate) => candidate.id === input.entryId);
        if (!entry) {
          return blockedResult(opId, "Stack entry was not found.", snapshot);
        }
        yield* gitWorkflow
          .switchRef({ cwd: context.cwd, refName: entry.headRefName })
          .pipe(Effect.mapError((cause) => stackError("Failed to switch stack branch.", cause)));
        return completedResult(
          opId,
          `Switched to ${entry.headRefName}.`,
          yield* loadSnapshot({ threadId: input.threadId, selectedHeadRefName: entry.headRefName }),
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const renameEntry = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
    readonly entryId: SourceControlStackEntryId;
    readonly branchName: string;
    readonly title?: string;
    readonly description?: string;
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      Effect.gen(function* () {
        const snapshot = yield* loadSnapshot({ threadId: input.threadId });
        const entry = snapshot.entries.find((candidate) => candidate.id === input.entryId);
        if (!entry) return blockedResult(opId, "Stack entry was not found.", snapshot);

        if (entry.changeRequest) {
          if (input.branchName !== entry.headRefName) {
            return blockedResult(
              opId,
              "Published branch rename is not provider-neutral in this slice.",
              snapshot,
            );
          }
          if (context.providerShape && (input.title || input.description)) {
            const bodyFile =
              input.description === undefined
                ? undefined
                : join(tmpdir(), `fenrir-stack-${randomUUID()}.md`);
            if (bodyFile) {
              yield* Effect.promise(() => writeFile(bodyFile, input.description ?? "")).pipe(
                Effect.mapError((cause) =>
                  stackError("Failed to write change-request body.", cause),
                ),
              );
            }
            yield* context.providerShape
              .updateChangeRequest({
                cwd: context.cwd,
                ...(context.providerContext ? { context: context.providerContext } : {}),
                reference: String(entry.changeRequest.number),
                ...(input.title ? { title: input.title } : {}),
                ...(bodyFile ? { bodyFile } : {}),
              })
              .pipe(
                Effect.mapError((cause) => stackError("Failed to update change request.", cause)),
              );
          }
          return completedResult(
            opId,
            "Published stack entry metadata updated.",
            yield* loadSnapshot({
              threadId: input.threadId,
              selectedHeadRefName: entry.headRefName,
            }),
          );
        }

        if (input.branchName !== entry.headRefName) {
          yield* gitVoid(
            context.cwd,
            ["branch", "-m", entry.headRefName, input.branchName],
            "stack.renameDraftBranch",
          );
          yield* unsetDraftMetadata(context.cwd, entry.headRefName);
        }
        yield* writeDraftMetadata(context.cwd, {
          branchName: input.branchName,
          parent: entry.baseRefName,
          title: input.title ?? entry.title,
          description: input.description ?? entry.description ?? null,
          createdAt: new Date().toISOString(),
        });

        return completedResult(
          opId,
          "Draft stack entry renamed.",
          yield* loadSnapshot({ threadId: input.threadId, selectedHeadRefName: input.branchName }),
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const dropEntry = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
    readonly entryId: SourceControlStackEntryId;
    readonly closeChangeRequest?: boolean;
    readonly deleteLocalBranch?: boolean;
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      Effect.gen(function* () {
        const snapshot = yield* loadSnapshot({ threadId: input.threadId });
        const entry = snapshot.entries.find((candidate) => candidate.id === input.entryId);
        if (!entry) return blockedResult(opId, "Stack entry was not found.", snapshot);

        if (entry.changeRequest && input.closeChangeRequest === true && context.providerShape) {
          yield* context.providerShape
            .closeChangeRequest({
              cwd: context.cwd,
              ...(context.providerContext ? { context: context.providerContext } : {}),
              reference: String(entry.changeRequest.number),
            })
            .pipe(Effect.mapError((cause) => stackError("Failed to close change request.", cause)));
        }

        if (input.deleteLocalBranch === true) {
          if (entry.isCurrent) {
            return blockedResult(
              opId,
              "Cannot delete the currently checked-out stack branch.",
              snapshot,
            );
          }
          yield* gitVoid(
            context.cwd,
            ["branch", "-D", entry.headRefName],
            "stack.deleteDraftBranch",
          );
        }
        yield* unsetDraftMetadata(context.cwd, entry.headRefName);

        return completedResult(
          opId,
          "Stack entry dropped from local stack metadata.",
          yield* loadSnapshot({ threadId: input.threadId }),
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const sync = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
    readonly fetch?: boolean;
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      Effect.gen(function* () {
        if (input.fetch === true) {
          yield* gitVoid(context.cwd, ["fetch", "--all", "--prune"], "stack.syncFetch");
        }
        return completedResult(
          opId,
          "Stack snapshot synchronized.",
          yield* loadSnapshot({ threadId: input.threadId }),
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const publish = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
    readonly entryIds?: ReadonlyArray<SourceControlStackEntryId>;
    readonly createMissingChangeRequests: boolean;
    readonly updateExistingChangeRequests: boolean;
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      Effect.gen(function* () {
        const snapshot = yield* loadSnapshot({ threadId: input.threadId });
        if (!context.providerShape) {
          return blockedResult(
            opId,
            "No source-control provider is available for publishing.",
            snapshot,
          );
        }

        const selected = snapshot.entries.filter((entry) =>
          input.entryIds ? input.entryIds.includes(entry.id) : true,
        );
        for (const entry of selected) {
          if (entry.publication === "draft-local" && input.createMissingChangeRequests) {
            yield* gitVoid(
              context.cwd,
              ["push", "-u", publishRemoteName(context), entry.headRefName],
              "stack.publishPush",
            );
            const bodyFile = join(tmpdir(), `fenrir-stack-${randomUUID()}.md`);
            const parentLabel =
              snapshot.entries.find((candidate) => candidate.id === entry.parentEntryId)?.title ??
              entry.baseRefName;
            yield* Effect.promise(() =>
              writeFile(
                bodyFile,
                [
                  entry.description ?? entry.title,
                  "",
                  "Fenrir stack context:",
                  `- Position: ${entry.index + 1} of ${snapshot.entries.length}`,
                  `- Parent: ${parentLabel}`,
                  `- Branch: ${entry.headRefName}`,
                ].join("\n"),
              ),
            ).pipe(
              Effect.mapError((cause) => stackError("Failed to write change-request body.", cause)),
            );
            yield* context.providerShape
              .createChangeRequest({
                cwd: context.cwd,
                ...(context.providerContext ? { context: context.providerContext } : {}),
                baseRefName: entry.baseRefName,
                headSelector: entry.headRefName,
                title: entry.title,
                bodyFile,
              })
              .pipe(
                Effect.mapError((cause) => stackError("Failed to create change request.", cause)),
              );
          } else if (entry.changeRequest && input.updateExistingChangeRequests) {
            yield* context.providerShape
              .updateChangeRequest({
                cwd: context.cwd,
                ...(context.providerContext ? { context: context.providerContext } : {}),
                reference: String(entry.changeRequest.number),
                baseRefName: entry.baseRefName,
                title: entry.title,
              })
              .pipe(
                Effect.mapError((cause) => stackError("Failed to update change request.", cause)),
              );
          }
        }

        return completedResult(
          opId,
          "Stack publish operation completed.",
          yield* loadSnapshot({ threadId: input.threadId }),
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const blockedRewriteOperation = (
    input: SourceControlStackGetSnapshotInput,
    label: string,
  ): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (_context, opId) =>
      Effect.gen(function* () {
        const snapshot = yield* loadSnapshot(input);
        return blockedResult(
          opId,
          `${label} requires a durable rebase operation journal and is blocked in this slice.`,
          snapshot,
        );
      }).pipe(Effect.flatMap(emitCompleted)),
    );

  const continueOperation = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      gitVoid(context.cwd, ["rebase", "--continue"], "stack.rebaseContinue").pipe(
        Effect.flatMap(() =>
          loadSnapshot({ threadId: input.threadId }).pipe(
            Effect.map((snapshot) =>
              completedResult(opId, "Rebase operation continued.", snapshot),
            ),
          ),
        ),
        Effect.flatMap(emitCompleted),
      ),
    );

  const abortOperation = (input: {
    readonly threadId: SourceControlStackSnapshot["threadId"];
  }): Effect.Effect<SourceControlStackMutationResult, SourceControlStackRpcError> =>
    withLockedContext(input, (context, opId) =>
      gitVoid(context.cwd, ["rebase", "--abort"], "stack.rebaseAbort").pipe(
        Effect.flatMap(() =>
          loadSnapshot({ threadId: input.threadId }).pipe(
            Effect.map((snapshot) => completedResult(opId, "Rebase operation aborted.", snapshot)),
          ),
        ),
        Effect.flatMap(emitCompleted),
      ),
    );

  return SourceControlStackService.of({
    getSnapshot: loadSnapshot,
    createEntry,
    switchEntry,
    renameEntry,
    dropEntry,
    reorderEntries: (input) => blockedRewriteOperation(input, "Reorder"),
    restack: (input) => blockedRewriteOperation(input, "Restack"),
    sync,
    squashEntry: (input) => blockedRewriteOperation(input, "Squash"),
    splitEntry: (input) => blockedRewriteOperation(input, "Split"),
    publish,
    continueOperation,
    abortOperation,
    streamEvents: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const initial = yield* loadSnapshot(input);
          const subscription = yield* PubSub.subscribe(events);
          return Stream.concat(
            Stream.make({
              _tag: "snapshotReplaced" as const,
              snapshot: initial,
            }),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((envelope) => envelope.threadId === input.threadId),
              Stream.map((envelope) => envelope.event),
            ),
          );
        }),
      ).pipe(Stream.mapError((cause) => stackError("Failed to stream stack events.", cause))),
  });
});

export const SourceControlStackServiceLive = Layer.effect(
  SourceControlStackService,
  makeSourceControlStackService,
);
