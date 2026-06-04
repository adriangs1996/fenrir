import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderSelectionKind,
  ServerListProviderSkillsResult,
} from "@fenrir/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environmentApi";

export const providerSkillsQueryKeys = {
  all: ["provider-skills"] as const,
  list: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    provider: ProviderSelectionKind | null,
    providerInstanceId: ProviderInstanceId | null,
  ) =>
    [
      ...providerSkillsQueryKeys.all,
      environmentId ?? null,
      cwd,
      provider,
      providerInstanceId,
    ] as const,
};

const EMPTY_PROVIDER_SKILLS_RESULT: ServerListProviderSkillsResult = {
  skills: [],
};

const DEFAULT_PROVIDER_SKILLS_STALE_TIME = 15_000;

export function providerSkillsQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  provider: ProviderSelectionKind | null;
  providerInstanceId: ProviderInstanceId | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: providerSkillsQueryKeys.list(
      input.environmentId,
      input.cwd,
      input.provider,
      input.providerInstanceId,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd || !input.provider) {
        throw new Error("Provider skill lookup is unavailable.");
      }
      const api = ensureEnvironmentApi(input.environmentId);
      return api.server.listProviderSkills({
        provider: input.provider,
        cwd: input.cwd,
        ...(input.providerInstanceId ? { providerInstanceId: input.providerInstanceId } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.cwd !== null &&
      input.provider !== null,
    staleTime: input.staleTime ?? DEFAULT_PROVIDER_SKILLS_STALE_TIME,
    placeholderData: EMPTY_PROVIDER_SKILLS_RESULT,
  });
}
