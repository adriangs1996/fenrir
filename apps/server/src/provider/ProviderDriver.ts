import type {
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  ProviderKind,
} from "@fenrir/contracts";
import type * as Schema from "effect/Schema";

export interface ProviderDriverMetadata {
  readonly displayName: string;
  readonly supportsMultipleInstances?: boolean;
}

export interface ProviderDriver<Config> {
  readonly driverKind: ProviderDriverKind;
  readonly legacyProvider: ProviderKind;
  readonly metadata: ProviderDriverMetadata;
  readonly configSchema: Schema.Schema<Config>;
  readonly defaultConfig: () => Config;
}

export type BuiltInProviderDriver = ProviderDriver<CodexSettings> | ProviderDriver<ClaudeSettings>;
