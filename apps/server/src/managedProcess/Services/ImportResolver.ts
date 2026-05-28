/**
 * ImportResolver - Service interface for managed process import proposals.
 *
 * Reads workspace files (portless.json, package.json) to suggest
 * ManagedProcess definitions. Pure read-only — never writes to disk.
 *
 * @module ManagedProcess/ImportResolver
 */
import type { ManagedProcess, ManagedProcessImportProposal, ProjectId } from "@fenrir/contracts";
import type { Effect } from "effect";
import { Context } from "effect";

export interface ImportResolverShape {
  /** Proposes managed process definitions from workspace files. */
  propose(input: {
    projectId: ProjectId;
    workspaceRoot: string;
    existingDefinitions: ManagedProcess[];
  }): Effect.Effect<ManagedProcessImportProposal[], never, never>;
}

export class ImportResolver extends Context.Service<ImportResolver, ImportResolverShape>()(
  "t3/managedProcess/ImportResolver",
) {}
