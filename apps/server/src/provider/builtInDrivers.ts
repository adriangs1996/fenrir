import { ClaudeSettings, CodexSettings, ProviderDriverKind } from "@fenrir/contracts";
import { Schema } from "effect";

import type { BuiltInProviderDriver } from "./ProviderDriver.ts";

export const CodexBuiltInDriver = {
  driverKind: ProviderDriverKind.makeUnsafe("codex"),
  legacyProvider: "codex",
  metadata: {
    displayName: "Codex",
    supportsMultipleInstances: true,
  },
  configSchema: CodexSettings,
  defaultConfig: () => Schema.decodeSync(CodexSettings)({}),
} satisfies BuiltInProviderDriver;

export const ClaudeBuiltInDriver = {
  driverKind: ProviderDriverKind.makeUnsafe("claudeAgent"),
  legacyProvider: "claudeAgent",
  metadata: {
    displayName: "Claude",
    supportsMultipleInstances: true,
  },
  configSchema: ClaudeSettings,
  defaultConfig: () => Schema.decodeSync(ClaudeSettings)({}),
} satisfies BuiltInProviderDriver;

export const BUILT_IN_DRIVERS: ReadonlyArray<BuiltInProviderDriver> = [
  CodexBuiltInDriver,
  ClaudeBuiltInDriver,
];
