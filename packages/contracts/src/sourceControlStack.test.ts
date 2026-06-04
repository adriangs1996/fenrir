import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  SourceControlChangeRequestCloseInput,
  SourceControlChangeRequestListInput,
  SourceControlChangeRequestUpdateInput,
} from "./sourceControl";
import {
  SourceControlStackCreateEntryInput,
  SourceControlStackMutationResult,
  SourceControlStackSnapshot,
  SourceControlStackStreamEvent,
} from "./sourceControlStack";

const decodeSnapshot = Schema.decodeUnknownSync(SourceControlStackSnapshot);
const decodeCreateEntry = Schema.decodeUnknownSync(SourceControlStackCreateEntryInput);
const decodeMutationResult = Schema.decodeUnknownSync(SourceControlStackMutationResult);
const decodeStreamEvent = Schema.decodeUnknownSync(SourceControlStackStreamEvent);
const decodeChangeRequestListInput = Schema.decodeUnknownSync(SourceControlChangeRequestListInput);
const decodeChangeRequestUpdateInput = Schema.decodeUnknownSync(
  SourceControlChangeRequestUpdateInput,
);
const decodeChangeRequestCloseInput = Schema.decodeUnknownSync(
  SourceControlChangeRequestCloseInput,
);

describe("Source-control stack contracts", () => {
  it("decodes a stack snapshot with draft and published entries", () => {
    const snapshot = decodeSnapshot({
      threadId: "thread-1",
      cwd: "/repo",
      repositoryRoot: "/repo",
      provider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      rootBaseRef: "main",
      currentEntryId: "github:42",
      capabilities: ["create-entry", "switch-entry", "publish"],
      problems: [],
      generatedAt: "2026-06-02T10:00:00.000Z",
      entries: [
        {
          id: "github:42",
          index: 0,
          title: "Add stack contracts",
          branchName: "feature/contracts",
          headRefName: "feature/contracts",
          baseRefName: "main",
          parentEntryId: null,
          childEntryIds: ["local:feature/ui"],
          publication: "published",
          changeRequest: null,
          commits: [
            {
              oid: "abc123",
              subject: "Add source control stack contracts",
              authoredAt: "2026-06-02T09:00:00.000Z",
            },
          ],
          commitOids: ["abc123"],
          aheadCount: 1,
          behindCount: 0,
          hasLocalBranch: true,
          hasRemoteBranch: true,
          isCurrent: true,
          problems: [],
        },
        {
          id: "local:feature/ui",
          index: 1,
          title: "Wire stack UI",
          description: "Local unpublished stack entry.",
          branchName: "feature/ui",
          headRefName: "feature/ui",
          baseRefName: "feature/contracts",
          parentEntryId: "github:42",
          childEntryIds: [],
          publication: "draft-local",
          changeRequest: null,
          commits: [],
          commitOids: [],
          aheadCount: 0,
          behindCount: 0,
          hasLocalBranch: true,
          hasRemoteBranch: false,
          isCurrent: false,
          problems: [],
        },
      ],
    });

    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[1]?.publication).toBe("draft-local");
  });

  it("decodes mutation inputs, results, and stream events", () => {
    const createInput = decodeCreateEntry({
      threadId: "thread-1",
      parentEntryId: "github:42",
      position: "below",
      branchName: "feature/follow-up",
      title: "Follow-up stack entry",
      publish: false,
    });
    const result = decodeMutationResult({
      operationId: "source-control-stack-operation-1",
      status: "completed",
      message: "Stack updated.",
      snapshot: {
        threadId: "thread-1",
        cwd: "/repo",
        repositoryRoot: "/repo",
        provider: null,
        rootBaseRef: "main",
        currentEntryId: null,
        entries: [],
        capabilities: [],
        problems: [],
        generatedAt: "2026-06-02T10:00:00.000Z",
      },
    });
    const event = decodeStreamEvent({
      _tag: "operationCompleted",
      operationId: "source-control-stack-operation-1",
      result,
    });

    expect(createInput.parentEntryId).toBe("github:42");
    expect(event._tag).toBe("operationCompleted");
  });

  it("decodes provider change-request list/update/close inputs", () => {
    const list = decodeChangeRequestListInput({
      cwd: "/repo",
      baseRefName: "main",
      state: "open",
      limit: 50,
    });
    const update = decodeChangeRequestUpdateInput({
      cwd: "/repo",
      reference: "42",
      baseRefName: "feature/contracts",
      title: "Retarget stack entry",
      bodyFile: "/tmp/body.md",
    });
    const close = decodeChangeRequestCloseInput({
      cwd: "/repo",
      reference: "42",
    });

    expect(list.headSelector).toBeUndefined();
    expect(update.baseRefName).toBe("feature/contracts");
    expect(close.reference).toBe("42");
  });
});
