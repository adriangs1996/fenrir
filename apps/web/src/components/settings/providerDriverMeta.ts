import { type ProviderDriverKind } from "@fenrir/contracts";

export type ProviderDriverField = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly placeholder: string;
  readonly control?: "text" | "password";
};

export type ProviderDriverDefinition = {
  readonly value: ProviderDriverKind | string;
  readonly label: string;
  readonly settingsFields: ReadonlyArray<ProviderDriverField>;
};

export const PROVIDER_DRIVER_DEFINITIONS: ReadonlyArray<ProviderDriverDefinition> = [
  {
    value: "codex",
    label: "Codex",
    settingsFields: [
      {
        key: "binaryPath",
        label: "Binary path",
        description: "Path to the Codex binary used by this instance.",
        placeholder: "codex",
      },
      {
        key: "homePath",
        label: "CODEX_HOME path",
        description: "Optional custom Codex home and config directory.",
        placeholder: "CODEX_HOME",
      },
    ],
  },
  {
    value: "claudeAgent",
    label: "Claude",
    settingsFields: [
      {
        key: "binaryPath",
        label: "Binary path",
        description: "Path to the Claude binary used by this instance.",
        placeholder: "claude",
      },
    ],
  },
  {
    value: "cursor",
    label: "Cursor",
    settingsFields: [
      {
        key: "binaryPath",
        label: "Binary path",
        description: "Path to the Cursor agent binary.",
        placeholder: "agent",
      },
      {
        key: "apiEndpoint",
        label: "API endpoint",
        description: "Override the Cursor API endpoint for this instance.",
        placeholder: "https://...",
      },
    ],
  },
  {
    value: "opencode",
    label: "OpenCode",
    settingsFields: [
      {
        key: "binaryPath",
        label: "Binary path",
        description: "Path to the OpenCode binary.",
        placeholder: "opencode",
      },
      {
        key: "serverUrl",
        label: "Server URL",
        description: "Leave blank to let Fenrir spawn the server when needed.",
        placeholder: "http://127.0.0.1:4096",
      },
      {
        key: "serverPassword",
        label: "Server password",
        description: "Stored in plain text on disk.",
        placeholder: "Optional",
        control: "password",
      },
    ],
  },
];

export const PROVIDER_DRIVER_DEFINITION_BY_VALUE = new Map(
  PROVIDER_DRIVER_DEFINITIONS.map((definition) => [definition.value, definition] as const),
);

export function getProviderDriverDefinition(
  driver: ProviderDriverKind | string | undefined,
): ProviderDriverDefinition | undefined {
  if (!driver) return undefined;
  return PROVIDER_DRIVER_DEFINITION_BY_VALUE.get(driver);
}

export function getProviderDriverLabel(driver: ProviderDriverKind | string | undefined): string {
  return getProviderDriverDefinition(driver)?.label ?? driver ?? "Provider";
}
