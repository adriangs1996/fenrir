import type {
  TrafficLensOverride,
  TrafficLensOverrideInput,
  TrafficLensProfile,
  TrafficLensProfileInput,
  TrafficLensRule,
  TrafficLensRuleInput,
} from "@fenrir/contracts";

export function toProfileInput(profile: TrafficLensProfile): TrafficLensProfileInput {
  return {
    name: profile.name,
    partitionKey: profile.partitionKey,
    userAgentPreset: profile.userAgentPreset,
    proxyPreset: profile.proxyPreset,
    notes: profile.notes,
  };
}

export function toRuleInput(rule: TrafficLensRule): TrafficLensRuleInput {
  return {
    name: rule.name,
    enabled: rule.enabled,
    phase: rule.phase,
    action: rule.action,
    scope: rule.scope,
    urlRewrite: rule.urlRewrite,
    headerMutation: rule.headerMutation,
    bodyReplace: rule.bodyReplace,
    mockResponse: rule.mockResponse,
  };
}

export function toOverrideInput(override: TrafficLensOverride): TrafficLensOverrideInput {
  return {
    name: override.name,
    enabled: override.enabled,
    match: override.match,
    response: override.response,
    latencyMs: override.latencyMs,
    offline: override.offline,
  };
}

export function makeProfilePartitionKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `persist:traffic-lens:${slug || "profile"}`;
}
