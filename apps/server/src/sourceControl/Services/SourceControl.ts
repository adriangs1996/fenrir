import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { RepositoryIdentity } from "@fenrir/contracts";
import type { VcsDriverKind } from "../../vcs/VcsDriver.ts";

export interface SourceControlWorkspace {
  readonly kind: VcsDriverKind;
  readonly rootPath: string;
  readonly metadataPath: string | null;
  readonly repositoryIdentity: RepositoryIdentity | null;
}

export interface SourceControlShape {
  readonly resolveWorkspace: (cwd: string) => Effect.Effect<SourceControlWorkspace | null>;
  readonly isSupportedWorkspace: (cwd: string) => Effect.Effect<boolean>;
  readonly resolveRepositoryIdentity: (cwd: string) => Effect.Effect<RepositoryIdentity | null>;
}

export class SourceControl extends ServiceMap.Service<SourceControl, SourceControlShape>()(
  "fenrir/sourceControl/Services/SourceControl",
) {}
