import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  OpenCodeSettings,
  type ProviderDriverKind,
  type ProviderSettingsFormAnnotation,
  type ProviderSettingsFormControl,
  type ProviderSettingsFormSchemaAnnotation,
} from "@fenrir/contracts";
import { Schema } from "effect";

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

export type ProviderDriverField = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly placeholder: string;
  readonly control?: ProviderSettingsFormControl;
};

export type ProviderDriverDefinition = {
  readonly value: ProviderDriverKind | string;
  readonly label: string;
  readonly settingsSchema: ProviderSettingsSchema;
  readonly settingsFields: ReadonlyArray<ProviderDriverField>;
};

type ProviderDriverDefinitionInput = Omit<ProviderDriverDefinition, "settingsFields">;

function titleizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function readFieldAnnotations(fieldSchema: Schema.Top) {
  return fieldSchema.ast.context?.annotations ?? Schema.resolveInto(fieldSchema);
}

function readStringAnnotation(
  annotations: ReturnType<typeof readFieldAnnotations>,
  key: "title" | "description",
): string | undefined {
  const value = annotations?.[key];
  return typeof value === "string" ? value : undefined;
}

function readProviderSettingsFormAnnotation(
  fieldSchema: Schema.Top,
): ProviderSettingsFormAnnotation {
  const annotation = readFieldAnnotations(fieldSchema)?.providerSettingsForm;
  return annotation ?? {};
}

function readProviderSettingsFormSchemaAnnotation(
  settingsSchema: ProviderSettingsSchema,
): ProviderSettingsFormSchemaAnnotation {
  return Schema.resolveInto(settingsSchema)?.providerSettingsFormSchema ?? {};
}

export function deriveProviderSettingsFields(
  settingsSchema: ProviderSettingsSchema,
): ReadonlyArray<ProviderDriverField> {
  const schemaAnnotation = readProviderSettingsFormSchemaAnnotation(settingsSchema);
  const orderedKeys = new Map(
    (schemaAnnotation.order ?? []).map((key, index) => [key, index] as const),
  );
  const orderFallbackOffset = orderedKeys.size;

  return Object.keys(settingsSchema.fields)
    .map((key, index) => ({ key, index }))
    .toSorted((left, right) => {
      return (
        (orderedKeys.get(left.key) ?? orderFallbackOffset + left.index) -
        (orderedKeys.get(right.key) ?? orderFallbackOffset + right.index)
      );
    })
    .flatMap(({ key }) => {
      const fieldSchema = settingsSchema.fields[key]!;
      const formAnnotation = readProviderSettingsFormAnnotation(fieldSchema);
      if (formAnnotation.hidden) return [];

      const fieldAnnotations = readFieldAnnotations(fieldSchema);
      const label = readStringAnnotation(fieldAnnotations, "title") ?? titleizeFieldKey(key);
      const description = readStringAnnotation(fieldAnnotations, "description") ?? "";
      const placeholder = formAnnotation.placeholder ?? "";

      return [
        {
          key,
          label,
          description,
          placeholder,
          ...(formAnnotation.control !== undefined ? { control: formAnnotation.control } : {}),
        },
      ];
    });
}

function defineProviderDriverDefinition(
  definition: ProviderDriverDefinitionInput,
): ProviderDriverDefinition {
  return {
    ...definition,
    settingsFields: deriveProviderSettingsFields(definition.settingsSchema),
  };
}

export const PROVIDER_DRIVER_DEFINITIONS: ReadonlyArray<ProviderDriverDefinition> = [
  {
    value: "codex",
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    value: "claudeAgent",
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  {
    value: "cursor",
    label: "Cursor",
    settingsSchema: CursorSettings,
  },
  {
    value: "opencode",
    label: "OpenCode",
    settingsSchema: OpenCodeSettings,
  },
].map(defineProviderDriverDefinition);

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
