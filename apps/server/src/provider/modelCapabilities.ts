import type {
  ContextWindowOption,
  EffortOption,
  ModelCapabilities,
  ProviderOptionDescriptor,
} from "@fenrir/contracts";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

export function selectModelOptionDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly options: ReadonlyArray<EffortOption | ContextWindowOption>;
  readonly promptInjectedValues?: ReadonlyArray<string>;
}): ProviderOptionDescriptor {
  return {
    id: input.id,
    label: input.label,
    type: "select",
    options: input.options.map((option) => ({
      id: option.value,
      label: option.label,
      ...(option.isDefault !== undefined ? { isDefault: option.isDefault } : {}),
    })),
    ...(input.promptInjectedValues !== undefined && input.promptInjectedValues.length > 0
      ? { promptInjectedValues: input.promptInjectedValues }
      : {}),
  };
}

export function booleanModelOptionDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly currentValue?: boolean;
}): ProviderOptionDescriptor {
  return {
    id: input.id,
    label: input.label,
    type: "boolean",
    ...(input.currentValue !== undefined ? { currentValue: input.currentValue } : {}),
  };
}

export function createModelCapabilitiesFromDescriptors(
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ModelCapabilities {
  const effortDescriptor = optionDescriptors.find(
    (descriptor): descriptor is SelectDescriptor =>
      descriptor.type === "select" &&
      (descriptor.id === "effort" || descriptor.id === "reasoningEffort"),
  );
  const contextWindowDescriptor = optionDescriptors.find(
    (descriptor): descriptor is SelectDescriptor =>
      descriptor.type === "select" && descriptor.id === "contextWindow",
  );

  return {
    optionDescriptors: optionDescriptors.map(cloneDescriptor),
    reasoningEffortLevels:
      effortDescriptor?.options.map((option) => legacyOptionFromDescriptorOption(option)) ?? [],
    supportsFastMode: optionDescriptors.some(
      (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
    ),
    supportsThinkingToggle: optionDescriptors.some(
      (descriptor) => descriptor.type === "boolean" && descriptor.id === "thinking",
    ),
    contextWindowOptions:
      contextWindowDescriptor?.options.map((option) => legacyOptionFromDescriptorOption(option)) ??
      [],
    promptInjectedEffortLevels: effortDescriptor?.promptInjectedValues ?? [],
  };
}

function legacyOptionFromDescriptorOption(option: SelectDescriptor["options"][number]): {
  readonly value: string;
  readonly label: string;
  readonly isDefault?: boolean;
} {
  return option.isDefault === undefined
    ? { value: option.id, label: option.label }
    : { value: option.id, label: option.label, isDefault: option.isDefault };
}

function cloneDescriptor(descriptor: ProviderOptionDescriptor): ProviderOptionDescriptor {
  return descriptor.type === "select"
    ? {
        ...descriptor,
        options: descriptor.options.map((option) => ({ ...option })),
        ...(descriptor.promptInjectedValues !== undefined
          ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
          : {}),
      }
    : { ...descriptor };
}
