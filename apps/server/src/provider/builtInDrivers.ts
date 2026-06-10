import { ClaudeSettings, CodexSettings, ProviderDriverKind } from "@fenrir/contracts";
import { Schema } from "effect";

import type { BuiltInProviderDriver } from "./ProviderDriver.ts";

const decodeDefaultCodexSettings = Schema.decodeSync(CodexSettings);
const decodeDefaultClaudeSettings = Schema.decodeSync(ClaudeSettings);

export const CodexBuiltInDriver = {
  driverKind: ProviderDriverKind.make("codex"),
  legacyProvider: "codex",
  metadata: {
    displayName: "Codex",
    supportsMultipleInstances: true,
  },
  configSchema: CodexSettings,
  defaultConfig: () => decodeDefaultCodexSettings({}),
} satisfies BuiltInProviderDriver;

export const ClaudeBuiltInDriver = {
  driverKind: ProviderDriverKind.make("claudeAgent"),
  legacyProvider: "claudeAgent",
  metadata: {
    displayName: "Claude",
    supportsMultipleInstances: true,
  },
  configSchema: ClaudeSettings,
  defaultConfig: () => decodeDefaultClaudeSettings({}),
} satisfies BuiltInProviderDriver;

export const BUILT_IN_DRIVERS: ReadonlyArray<BuiltInProviderDriver> = [
  CodexBuiltInDriver,
  ClaudeBuiltInDriver,
];
