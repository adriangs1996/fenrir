import type { Effect } from "effect";
import { Schema } from "effect";

import type { ProviderKind, ServerProviderSkill, SkillFileScope } from "@fenrir/contracts";

import type { RawSkillFile } from "./skillFileFormat.ts";

export interface ProviderSkillFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly bytes: Uint8Array;
  readonly executable: boolean;
  readonly scope: SkillFileScope;
}

export interface ProviderSkillFolder {
  readonly skillName: string;
  readonly absolutePath: string;
  readonly entry: RawSkillFile;
  readonly entryFile: ProviderSkillFile;
  readonly files: readonly ProviderSkillFile[];
}

export interface ProviderSkillProjectionFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array | string;
  readonly executable: boolean;
  readonly scope: SkillFileScope;
}

export interface ProviderSkillProjection {
  readonly skill: ServerProviderSkill;
  readonly files: readonly ProviderSkillProjectionFile[];
}

export class SkillAdapterError extends Schema.TaggedErrorClass<SkillAdapterError>()(
  "SkillAdapterError",
  {
    provider: Schema.String,
    reason: Schema.String,
    filePath: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    const loc = this.filePath !== undefined ? ` (${this.filePath})` : "";
    return `[${this.provider}] Skill adapter error: ${this.reason}${loc}`;
  }
}

export interface ProviderSkillAdapter {
  readonly provider: ProviderKind;
  readonly priority: number;
  readonly entryFileName: string;
  readonly serializeEntry: (skill: ServerProviderSkill) => string;
  readonly watchPath: () => string | null;
  readonly classifyRelativePath: (relativePath: string) => SkillFileScope;
  readonly readProviderSkillFolders: () => Effect.Effect<
    readonly ProviderSkillFolder[],
    SkillAdapterError
  >;
  readonly writeSkillProjection: (
    projection: ProviderSkillProjection,
  ) => Effect.Effect<void, SkillAdapterError>;
  readonly deleteSkillFromProvider: (skillName: string) => Effect.Effect<void, SkillAdapterError>;
}
