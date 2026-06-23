import { describe, expect, it } from "vitest";
import { Effect, Layer, Option } from "effect";
import { ProjectId, ThreadId } from "@fenrir/contracts";
import type { ChangeRequest } from "@fenrir/contracts/sourceControl";
import type { ExecuteGitInput, GitCoreShape } from "../../../git/Services/GitCore.ts";
import { GitCore } from "../../../git/Services/GitCore.ts";
import { GitWorkflowService } from "../../../git/Services/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SourceControlProviderRegistry } from "../../SourceControlProviderRegistry.ts";
import {
  SourceControlProvider,
  type SourceControlProviderShape,
} from "../../SourceControlProvider.ts";
import { SourceControl } from "../../Services/SourceControl.ts";
import { SourceControlStackService } from "../Services/SourceControlStackService.ts";
import { SourceControlStackServiceLive } from "./SourceControlStackService.ts";

import { selectProviderStackChain } from "../stackTopology.ts";

function changeRequest(input: {
  readonly number: number;
  readonly baseRefName: string;
  readonly headRefName: string;
}): ChangeRequest {
  return {
    provider: "github",
    number: input.number,
    title: `PR ${input.number}`,
    url: `https://github.com/fenrir/fenrir/pull/${input.number}`,
    baseRefName: input.baseRefName,
    headRefName: input.headRefName,
    state: "open",
    updatedAt: Option.none(),
  };
}

function makePublishingTestLayer(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly localBranches?: string;
  readonly readConfigValue?: GitCoreShape["readConfigValue"];
}) {
  const executeCalls: ExecuteGitInput[] = [];
  const providerInfo = {
    kind: "github" as const,
    name: "GitHub",
    baseUrl: "https://github.com",
  };
  const provider: SourceControlProviderShape = SourceControlProvider.of({
    kind: "github",
    listChangeRequests: () => Effect.succeed([]),
    getChangeRequest: () => Effect.die("getChangeRequest should not be called"),
    createChangeRequest: () => Effect.void,
    updateChangeRequest: () => Effect.void,
    closeChangeRequest: () => Effect.void,
    mergeChangeRequest: () => Effect.void,
    createChangeRequestLineComment: () => Effect.void,
    listChangeRequestChecks: () => Effect.succeed([]),
    listChangeRequestReviewThreads: () => Effect.succeed([]),
    getRepositoryCloneUrls: () => Effect.die("getRepositoryCloneUrls should not be called"),
    createRepository: () => Effect.die("createRepository should not be called"),
    getDefaultBranch: () => Effect.succeed("main"),
    checkoutChangeRequest: () => Effect.void,
  });

  const gitCore: Partial<GitCoreShape> = {
    execute: (executeInput) =>
      Effect.sync(() => {
        executeCalls.push(executeInput);
        const [command, ...args] = executeInput.args;

        if (command === "rev-parse") {
          return gitOutput("main");
        }
        if (command === "for-each-ref" && args.at(-1) === "refs/heads") {
          return gitOutput(input.localBranches ?? "main\nfeature-a");
        }
        if (command === "for-each-ref" && args.at(-1) === "refs/remotes") {
          return gitOutput("");
        }
        if (command === "log") {
          return gitOutput("");
        }
        if (command === "rev-list") {
          return gitOutput("0\t0");
        }
        return gitOutput("");
      }),
    readConfigValue: input.readConfigValue ?? (() => Effect.succeed(null)),
  };

  const testLayer = SourceControlStackServiceLive.pipe(
    Layer.provide(Layer.mock(GitCore)(gitCore)),
    Layer.provide(
      Layer.mock(GitWorkflowService)({
        switchRef: () => Effect.die("switchRef should not be called"),
      }),
    ),
    Layer.provide(
      Layer.mock(SourceControl)({
        resolveWorkspace: () =>
          Effect.succeed({
            kind: "git" as const,
            rootPath: input.cwd,
            metadataPath: `${input.cwd}/.git`,
            repositoryIdentity: null,
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(SourceControlProviderRegistry)({
        resolveHandle: () =>
          Effect.succeed({
            provider,
            context: {
              provider: providerInfo,
              remoteName: "upstream",
              remoteUrl: "git@github.com:fenrir/fenrir.git",
            },
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadSnapshot: () =>
          Effect.succeed(
            Option.some({
              id: input.threadId,
              projectId: input.projectId,
              worktreePath: null,
            } as never),
          ),
        getProjectShellById: () =>
          Effect.succeed(
            Option.some({
              id: input.projectId,
              workspaceRoot: input.cwd,
            } as never),
          ),
      }),
    ),
  );

  return { executeCalls, testLayer };
}

describe("SourceControlStackService topology", () => {
  it("discovers a main <- branch-a <- branch-b <- branch-c chain", () => {
    const result = selectProviderStackChain({
      selectedHeadRefName: "branch-c",
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "main", headRefName: "branch-a" }),
        changeRequest({ number: 2, baseRefName: "branch-a", headRefName: "branch-b" }),
        changeRequest({ number: 3, baseRefName: "branch-b", headRefName: "branch-c" }),
      ],
    });

    expect(result.rootBaseRef).toBe("main");
    expect(result.selected.map((node) => node.headRefName)).toEqual([
      "branch-a",
      "branch-b",
      "branch-c",
    ]);
    expect(result.problems).toEqual([]);
  });

  it("selects the connected chain containing the current branch", () => {
    const result = selectProviderStackChain({
      selectedHeadRefName: "stack-b",
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "main", headRefName: "stack-a" }),
        changeRequest({ number: 2, baseRefName: "stack-a", headRefName: "stack-b" }),
        changeRequest({ number: 3, baseRefName: "main", headRefName: "other-a" }),
      ],
    });

    expect(result.selected.map((node) => node.headRefName)).toEqual(["stack-a", "stack-b"]);
    expect(result.rootBaseRef).toBe("main");
  });

  it("reports ambiguous provider chains and cycles", () => {
    const ambiguous = selectProviderStackChain({
      selectedHeadRefName: null,
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "main", headRefName: "branch-a" }),
        changeRequest({ number: 2, baseRefName: "main", headRefName: "branch-b" }),
      ],
    });
    const cyclic = selectProviderStackChain({
      selectedHeadRefName: "branch-a",
      changeRequests: [
        changeRequest({ number: 1, baseRefName: "branch-b", headRefName: "branch-a" }),
        changeRequest({ number: 2, baseRefName: "branch-a", headRefName: "branch-b" }),
      ],
    });

    expect(ambiguous.problems).toContain("ambiguous-provider-chain");
    expect(cyclic.problems).toContain("cycle-detected");
  });
});

describe("SourceControlStackService publishing", () => {
  it("pushes new published stack entries to the detected provider remote", async () => {
    const threadId = ThreadId.make("thread-stack-publish");
    const projectId = ProjectId.make("project-stack-publish");
    const cwd = "/tmp/fenrir-stack-publish";
    const { executeCalls, testLayer } = makePublishingTestLayer({ threadId, projectId, cwd });

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SourceControlStackService;
        yield* service.createEntry({
          threadId,
          parentEntryId: null,
          position: "bottom",
          branchName: "feature-a",
          title: "Feature A",
          publish: true,
        });
      }).pipe(Effect.provide(testLayer)),
    );

    const pushCall = executeCalls.find((call) => call.operation === "stack.pushDraft");
    expect(pushCall?.args).toEqual(["push", "-u", "upstream", "feature-a"]);
  });

  it("pushes draft stack entries to the detected provider remote during publish", async () => {
    const threadId = ThreadId.make("thread-stack-publish-existing");
    const projectId = ProjectId.make("project-stack-publish-existing");
    const cwd = "/tmp/fenrir-stack-publish-existing";
    const { executeCalls, testLayer } = makePublishingTestLayer({
      threadId,
      projectId,
      cwd,
      readConfigValue: (_cwd, key) => {
        if (key === "branch.feature-a.fenrirStackParent") return Effect.succeed("main");
        if (key === "branch.feature-a.fenrirStackTitle") return Effect.succeed("Feature A");
        return Effect.succeed(null);
      },
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SourceControlStackService;
        yield* service.publish({
          threadId,
          createMissingChangeRequests: true,
          updateExistingChangeRequests: false,
        });
      }).pipe(Effect.provide(testLayer)),
    );

    const pushCall = executeCalls.find((call) => call.operation === "stack.publishPush");
    expect(pushCall?.args).toEqual(["push", "-u", "upstream", "feature-a"]);
  });
});

function gitOutput(stdout: string) {
  return {
    code: 0,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}
