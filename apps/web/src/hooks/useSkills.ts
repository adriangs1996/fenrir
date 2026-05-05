import { useMemo } from "react";
import type {
  ServerProviderSkill,
  CreateSkillInput,
  UpdateSkillInput,
  ResolveSkillConflictInput,
} from "@fenrir/contracts";

import { ensureLocalApi } from "../localApi";
import { useServerSkills } from "../rpc/serverState";
import { searchProviderSkills } from "../skillSearch";

/**
 * Returns the current skill list from the subscribeServerConfig stream.
 * Updates reactively whenever a `skillsUpdated` event is received.
 */
export function useSkills(): readonly ServerProviderSkill[] {
  return useServerSkills();
}

/**
 * Returns stable callbacks for skill CRUD operations via RPC.
 */
export function useSkillActions() {
  return useMemo(
    () => ({
      create: (input: CreateSkillInput): Promise<ServerProviderSkill> =>
        ensureLocalApi().server.createSkill(input),

      update: (input: UpdateSkillInput): Promise<ServerProviderSkill> =>
        ensureLocalApi().server.updateSkill(input),

      delete: (name: string): Promise<void> => ensureLocalApi().server.deleteSkill(name),

      resolveConflict: (input: ResolveSkillConflictInput): Promise<ServerProviderSkill> =>
        ensureLocalApi().server.resolveSkillConflict(input),
    }),
    [],
  );
}

/**
 * Returns skills filtered by optional tag and search query.
 * Tag filter is applied first; search ranking is applied second.
 */
export function useFilteredSkills(
  query: string,
  tagFilter?: string,
): readonly ServerProviderSkill[] {
  const skills = useSkills();

  return useMemo(() => {
    let filtered: readonly ServerProviderSkill[] = skills;

    if (tagFilter) {
      filtered = filtered.filter((s) => s.tags.includes(tagFilter));
    }

    if (query.trim()) {
      return searchProviderSkills(filtered, query);
    }

    return filtered;
  }, [skills, query, tagFilter]);
}
