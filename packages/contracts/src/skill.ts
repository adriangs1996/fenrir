import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderSelectionKind } from "./orchestration";
import { ProviderInstanceId } from "./providerInstance";

export const ServerProviderSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  path: TrimmedNonEmptyString,
  scope: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderSkill = typeof ServerProviderSkill.Type;

export const ServerListProviderSkillsInput = Schema.Struct({
  provider: ProviderSelectionKind,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  cwd: TrimmedNonEmptyString,
});
export type ServerListProviderSkillsInput = typeof ServerListProviderSkillsInput.Type;

export const ServerListProviderSkillsResult = Schema.Struct({
  skills: Schema.Array(ServerProviderSkill),
});
export type ServerListProviderSkillsResult = typeof ServerListProviderSkillsResult.Type;
