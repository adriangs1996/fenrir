import type {
  EnvironmentId,
  MessageId,
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationSession,
  OrchestrationSessionStatus,
  OrchestrationThread,
  OrchestrationThreadShell,
  OrchestrationThreadActivity,
  ProviderKind,
  ThreadId,
  ThreadVisibility,
  TurnId,
} from "@fenrir/contracts";
import { resolveModelSlugForProvider } from "@fenrir/shared/model";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  hasActionableProposedPlan,
} from "../session-logic";
import {
  type ChatMessage,
  type Project,
  type ProposedPlan,
  type SidebarThreadSummary,
  type Thread,
  type ThreadSession,
  type ThreadShell,
  type ThreadTurnState,
  type TurnDiffSummary,
} from "../types";
import { resolveEnvironmentHttpUrl } from "../environments/runtime";
import { sanitizeThreadErrorMessage } from "../rpc/transportError";
import type { EnvironmentState } from "./state";

export function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T>,
  nextThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  const nextRecord: Record<ThreadId, T> = {};
  for (const [threadId, value] of Object.entries(record) as Array<[ThreadId, T]>) {
    if (nextThreadIds.has(threadId)) {
      nextRecord[threadId] = value;
    }
  }
  return nextRecord;
}

export function normalizeModelSelection<T extends { provider: string; model: string }>(
  selection: T,
): T {
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.provider, selection.model),
  };
}

export function normalizeThreadVisibility(
  visibility: ThreadVisibility | undefined,
): ThreadVisibility {
  return visibility ?? "normal";
}

function threadOwnerKey(owner: { kind: string; parentThreadId?: string } | null | undefined) {
  return owner ? `${owner.kind}:${owner.parentThreadId ?? ""}` : "";
}

export function mapProjectScripts(
  scripts: ReadonlyArray<Project["scripts"][number]>,
): Project["scripts"] {
  return scripts.map((script) => ({ ...script }));
}

export function mapSession(session: OrchestrationSession): ThreadSession {
  return {
    provider: toLegacyProvider(session.providerName),
    ...(session.providerInstanceId !== undefined
      ? { providerInstanceId: session.providerInstanceId }
      : {}),
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

export function mapMessage(
  environmentId: EnvironmentId,
  message: OrchestrationMessage,
): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: resolveEnvironmentHttpUrl({
      environmentId,
      pathname: attachmentPreviewRoutePath(attachment.id),
    }),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

export function mapProposedPlan(proposedPlan: OrchestrationProposedPlan): ProposedPlan {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

export function mapTurnDiffSummary(checkpoint: OrchestrationCheckpointSummary): TurnDiffSummary {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}

export function mapProject(
  project: OrchestrationReadModel["projects"][number],
  environmentId: EnvironmentId,
): Project {
  return {
    id: project.id,
    environmentId,
    name: project.title,
    cwd: project.workspaceRoot,
    repositoryIdentity: project.repositoryIdentity ?? null,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
    managedProcesses: [...(project.managedProcesses ?? [])],
    globalScriptDefaults: [...(project.globalScriptDefaults ?? [])],
  };
}

export function mapThreadShellSession(
  session: OrchestrationThreadShell["session"],
): ThreadSession | null {
  return session ? mapSession(session) : null;
}

export function mapThreadShellRecord(
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
): ThreadShell {
  return {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    visibility: normalizeThreadVisibility(thread.visibility),
    owner: thread.owner ?? null,
    deleteOnSettled: thread.deleteOnSettled ?? false,
    mcpServerIds: [...(thread.mcpServerIds ?? [])],
  };
}

export function mapThreadTurnStateFromShell(thread: OrchestrationThreadShell): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.latestTurn?.sourceProposedPlan
      ? { pendingSourceProposedPlan: thread.latestTurn.sourceProposedPlan }
      : {}),
  };
}

export function buildSidebarThreadSummaryFromShell(
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
): SidebarThreadSummary {
  return {
    id: thread.id,
    environmentId,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: mapThreadShellSession(thread.session),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    visibility: normalizeThreadVisibility(thread.visibility),
    owner: thread.owner ?? null,
    deleteOnSettled: thread.deleteOnSettled ?? false,
    mcpServerIds: [...(thread.mcpServerIds ?? [])],
    latestUserMessageAt: thread.latestUserMessageAt,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
  };
}

export function mapThread(thread: OrchestrationThread, environmentId: EnvironmentId): Thread {
  return {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session: thread.session ? mapSession(thread.session) : null,
    messages: thread.messages.map((message) => mapMessage(environmentId, message)),
    proposedPlans: thread.proposedPlans.map(mapProposedPlan),
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    visibility: normalizeThreadVisibility(thread.visibility),
    owner: thread.owner ?? null,
    deleteOnSettled: thread.deleteOnSettled ?? false,
    mcpServerIds: [...(thread.mcpServerIds ?? [])],
    turnDiffSummaries: thread.checkpoints.map(mapTurnDiffSummary),
    activities: thread.activities.map((activity) => ({ ...activity })),
  };
}

export function setThreadDetailsHydrated(
  state: EnvironmentState,
  threadId: ThreadId,
  hydrated: boolean,
): EnvironmentState {
  if ((state.threadDetailsHydratedById?.[threadId] ?? false) === hydrated) {
    return state;
  }

  return {
    ...state,
    threadDetailsHydratedById: {
      ...state.threadDetailsHydratedById,
      [threadId]: hydrated,
    },
  };
}

export function toThreadShell(thread: Thread): ThreadShell {
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    codexThreadId: thread.codexThreadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: thread.error,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    visibility: normalizeThreadVisibility(thread.visibility),
    owner: thread.owner ?? null,
    deleteOnSettled: thread.deleteOnSettled ?? false,
  };
}

export function toThreadTurnState(thread: Thread): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
      : {}),
  };
}

export function getLatestUserMessageAt(messages: ReadonlyArray<ChatMessage>): string | null {
  let latestUserMessageAt: string | null = null;
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    if (latestUserMessageAt === null || message.createdAt > latestUserMessageAt) {
      latestUserMessageAt = message.createdAt;
    }
  }
  return latestUserMessageAt;
}

export function buildSidebarThreadSummary(thread: Thread): SidebarThreadSummary {
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: thread.session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    visibility: normalizeThreadVisibility(thread.visibility),
    owner: thread.owner ?? null,
    deleteOnSettled: thread.deleteOnSettled ?? false,
    latestUserMessageAt: getLatestUserMessageAt(thread.messages),
    hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
    hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
    hasActionableProposedPlan: hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    ),
  };
}

export function sidebarThreadSummariesEqual(
  left: SidebarThreadSummary | undefined,
  right: SidebarThreadSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.interactionMode === right.interactionMode &&
    left.session === right.session &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    left.latestTurn === right.latestTurn &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.visibility === right.visibility &&
    threadOwnerKey(left.owner) === threadOwnerKey(right.owner) &&
    left.deleteOnSettled === right.deleteOnSettled &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan
  );
}

export function threadShellsEqual(left: ThreadShell | undefined, right: ThreadShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.environmentId === right.environmentId &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.visibility === right.visibility &&
    threadOwnerKey(left.owner) === threadOwnerKey(right.owner) &&
    left.deleteOnSettled === right.deleteOnSettled
  );
}

export function threadTurnStatesEqual(
  left: ThreadTurnState | undefined,
  right: ThreadTurnState,
): boolean {
  return (
    left !== undefined &&
    left.latestTurn === right.latestTurn &&
    left.pendingSourceProposedPlan === right.pendingSourceProposedPlan
  );
}

export function appendId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

export function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id);
}

export function buildMessageSlice(thread: Thread): {
  ids: MessageId[];
  byId: Record<MessageId, ChatMessage>;
} {
  return {
    ids: thread.messages.map((message) => message.id),
    byId: Object.fromEntries(
      thread.messages.map((message) => [message.id, message] as const),
    ) as Record<MessageId, ChatMessage>,
  };
}

export function buildActivitySlice(thread: Thread): {
  ids: string[];
  byId: Record<string, OrchestrationThreadActivity>;
} {
  return {
    ids: thread.activities.map((activity) => activity.id),
    byId: Object.fromEntries(
      thread.activities.map((activity) => [activity.id, activity] as const),
    ) as Record<string, OrchestrationThreadActivity>,
  };
}

export function buildProposedPlanSlice(thread: Thread): {
  ids: string[];
  byId: Record<string, ProposedPlan>;
} {
  return {
    ids: thread.proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(
      thread.proposedPlans.map((plan) => [plan.id, plan] as const),
    ) as Record<string, ProposedPlan>,
  };
}

export function buildTurnDiffSlice(thread: Thread): {
  ids: TurnId[];
  byId: Record<TurnId, TurnDiffSummary>;
} {
  return {
    ids: thread.turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(
      thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
    ) as Record<TurnId, TurnDiffSummary>,
  };
}

export function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") {
    return "error" as const;
  }
  if (status === "missing") {
    return "interrupted" as const;
  }
  return "completed" as const;
}

export function compareActivities(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Thread["pendingSourceProposedPlan"];
}): NonNullable<Thread["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

export function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
  turnId: TurnId,
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"],
): TurnDiffSummary[] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

export function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

export function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  retainedTurnIds: ReadonlySet<string>,
): OrchestrationThreadActivity[] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

export function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  retainedTurnIds: ReadonlySet<string>,
): ProposedPlan[] {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

export function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

export function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === "codex" || providerName === "claudeAgent") {
    return providerName;
  }
  return "codex";
}

export function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}
