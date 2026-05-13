import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

// ─── Skill Sync Status ─────────────────────────────────────────
export const SkillSyncState = Schema.Literals(["synced", "pending", "conflict", "unsupported"]);
export type SkillSyncState = typeof SkillSyncState.Type;

// ─── Provider Sync Status ──────────────────────────────────────
export const SkillProviderSync = Schema.Struct({
  provider: Schema.Literals(["codex", "claudeAgent"]),
  state: SkillSyncState,
  lastSyncedAt: Schema.NullOr(IsoDateTime),
});
export type SkillProviderSync = typeof SkillProviderSync.Type;

// ─── Skill Icon ────────────────────────────────────────────────
export const SkillIcon = Schema.Literals([
  "default",
  "flame",
  "search",
  "code",
  "bug",
  "test",
  "docs",
  "security",
  "deploy",
  "design",
  "chat",
]);
export type SkillIcon = typeof SkillIcon.Type;

// ─── Server Provider Skill (sent to UI) ────────────────────────
export const ServerProviderSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
  icon: Schema.optional(SkillIcon),
  tags: Schema.Array(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  syncStatus: Schema.Array(SkillProviderSync),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ServerProviderSkill = typeof ServerProviderSkill.Type;

// ─── Skill Detail / File Inventory ────────────────────────────
export const SkillFileScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("general") }),
  Schema.Struct({
    kind: Schema.Literal("providerSpecific"),
    provider: Schema.Literals(["codex", "claudeAgent"]),
  }),
]);
export type SkillFileScope = typeof SkillFileScope.Type;

export const ServerSkillFileEntry = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  absolutePath: TrimmedNonEmptyString,
  executable: Schema.Boolean,
  scope: SkillFileScope,
});
export type ServerSkillFileEntry = typeof ServerSkillFileEntry.Type;

export const ServerSkillDetails = Schema.Struct({
  skill: ServerProviderSkill,
  files: Schema.Array(ServerSkillFileEntry),
});
export type ServerSkillDetails = typeof ServerSkillDetails.Type;

export const GetSkillDetailsInput = Schema.Struct({
  name: TrimmedNonEmptyString,
});
export type GetSkillDetailsInput = typeof GetSkillDetailsInput.Type;

// ─── Skill Create/Update Inputs ────────────────────────────────
export const CreateSkillInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
  icon: Schema.optional(SkillIcon),
  tags: Schema.Array(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
});
export type CreateSkillInput = typeof CreateSkillInput.Type;

export const UpdateSkillInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedNonEmptyString),
  body: Schema.optional(TrimmedNonEmptyString),
  icon: Schema.optional(SkillIcon),
  tags: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  enabled: Schema.optional(Schema.Boolean),
});
export type UpdateSkillInput = typeof UpdateSkillInput.Type;

// ─── Conflict Resolution ───────────────────────────────────────
export const ResolveSkillConflictInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  provider: Schema.Literals(["codex", "claudeAgent"]),
  resolution: Schema.Literals(["keep-fenrir", "accept-external"]),
});
export type ResolveSkillConflictInput = typeof ResolveSkillConflictInput.Type;

// ─── Skills Updated Event (for WS stream) ──────────────────────
export const SkillsUpdatedPayload = Schema.Struct({
  skills: Schema.Array(ServerProviderSkill),
});
export type SkillsUpdatedPayload = typeof SkillsUpdatedPayload.Type;

// ─── Skill RPC Error ───────────────────────────────────────────
export class SkillRpcError extends Schema.TaggedErrorClass<SkillRpcError>()("SkillRpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}
