/**
 * ImportResolver - reads workspace files to propose ManagedProcess definitions.
 *
 * Sources (in priority):
 * 1. `portless.json` → apps map
 * 2. `package.json#portless` → string or object
 * 3. `package.json#scripts` → dev/start/web entries (fallback)
 *
 * Also discovers workspace packages via `pnpm-workspace.yaml` or
 * `package.json#workspaces` to find nested portless configs.
 *
 * Read-only — never writes to disk.
 */
import type {
  ManagedProcess,
  ManagedProcessImportProposal,
  ManagedProcessProxy,
  ManagedProcessReadiness,
  ProjectScriptIcon,
} from "@fenrir/contracts";
import { Effect, FileSystem, Layer, Path } from "effect";

import { type ImportResolverShape, ImportResolver } from "../Services/ImportResolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "process"
  );
}

/** Detect package manager from lock files. */
function detectPackageManager(files: ReadonlySet<string>): string {
  if (files.has("bun.lock") || files.has("bun.lockb")) return "bun";
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  return "npm";
}

function readJsonFile(
  fs: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<unknown, never, never> {
  return fs.readFileString(filePath).pipe(
    Effect.flatMap((content) =>
      Effect.try({
        try: () => JSON.parse(content),
        catch: () => null,
      }),
    ),
    Effect.orElseSucceed(() => null),
  );
}

interface PortlessJsonAppsEntry {
  readonly path?: string;
  readonly script?: string;
  readonly package?: string;
}

// ---------------------------------------------------------------------------
// Build definition from portless.json app entry
// ---------------------------------------------------------------------------

function definitionFromPortlessApp(
  name: string,
  entry: PortlessJsonAppsEntry,
  packageManager: string,
  existingDefIds: ReadonlySet<string>,
): { proposal: ManagedProcessImportProposal } {
  const id = slugify(name);
  const relativePath = entry.path ?? "";
  const script = entry.script ?? "dev";
  const packageName = entry.package ?? name;
  const command =
    packageManager === "pnpm"
      ? `pnpm --filter ${packageName} run ${script}`
      : `${packageManager} run ${script}`;

  const definition: ManagedProcess = {
    id,
    name: relativePath || name,
    command,
    icon: "play" as ProjectScriptIcon,
    scope: "worktree",
    cwd: relativePath || null,
    env: {},
    proxy: { kind: "portless", appName: name } as ManagedProcessProxy,
    readiness: { kind: "portless-http" } as ManagedProcessReadiness,
    autoRestart: null,
  } as ManagedProcess;

  return {
    proposal: {
      suggestedDefinition: definition,
      sourceLabel: `portless.json: ${relativePath || name}`,
      conflictsWithDefId: existingDefIds.has(id) ? id : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Build definition from package.json script (no portless)
// ---------------------------------------------------------------------------

function definitionFromScript(
  scriptName: string,
  packageManager: string,
  existingDefIds: ReadonlySet<string>,
  sourceLabel: string,
): ManagedProcessImportProposal {
  const id = slugify(scriptName);
  const definition: ManagedProcess = {
    id,
    name: scriptName,
    command: `${packageManager} run ${scriptName}`,
    icon: "play" as ProjectScriptIcon,
    scope: "worktree",
    cwd: null,
    env: {},
    proxy: null,
    readiness: { kind: "none" } as ManagedProcessReadiness,
    autoRestart: null,
  } as ManagedProcess;

  return {
    suggestedDefinition: definition,
    sourceLabel,
    conflictsWithDefId: existingDefIds.has(id) ? id : null,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const makeImportResolver = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const propose: ImportResolverShape["propose"] = Effect.fn("ImportResolver.propose")(
    function* (input) {
      const { workspaceRoot, existingDefinitions } = input;
      const existingDefIds = new Set(existingDefinitions.map((d) => d.id));
      const proposals: ManagedProcessImportProposal[] = [];

      // Discover lock files for package manager detection
      const rootEntries = yield* fs.readDirectory(workspaceRoot).pipe(
        Effect.map((entries) => new Set(entries)),
        Effect.orElseSucceed(() => new Set<string>()),
      );
      const packageManager = detectPackageManager(rootEntries);

      // ---- 1. portless.json ----
      const portlessJsonPath = pathService.join(workspaceRoot, "portless.json");
      const portlessJson = yield* readJsonFile(fs, portlessJsonPath);

      let hasPortlessConfig = false;

      if (portlessJson && typeof portlessJson === "object") {
        const pj = portlessJson as Record<string, unknown>;
        if (pj.apps && typeof pj.apps === "object" && !Array.isArray(pj.apps)) {
          hasPortlessConfig = true;
          const apps = pj.apps as Record<string, unknown>;
          for (const [name, value] of Object.entries(apps)) {
            const entry: PortlessJsonAppsEntry =
              typeof value === "object" && value !== null ? (value as PortlessJsonAppsEntry) : {};
            const { proposal } = definitionFromPortlessApp(
              name,
              entry,
              packageManager,
              existingDefIds,
            );
            proposals.push(proposal);
          }
        }
      }

      // ---- 2. package.json#portless ----
      const packageJsonPath = pathService.join(workspaceRoot, "package.json");
      const packageJson = yield* readJsonFile(fs, packageJsonPath);

      if (!hasPortlessConfig && packageJson && typeof packageJson === "object") {
        const pkg = packageJson as Record<string, unknown>;
        if (pkg.portless) {
          hasPortlessConfig = true;
          if (typeof pkg.portless === "string") {
            // Simple portless string → single app
            const { proposal } = definitionFromPortlessApp(
              pkg.portless,
              {},
              packageManager,
              existingDefIds,
            );
            proposals.push(proposal);
          } else if (typeof pkg.portless === "object" && !Array.isArray(pkg.portless)) {
            const portlessConfig = pkg.portless as Record<string, unknown>;
            if (
              portlessConfig.apps &&
              typeof portlessConfig.apps === "object" &&
              !Array.isArray(portlessConfig.apps)
            ) {
              const apps = portlessConfig.apps as Record<string, unknown>;
              for (const [name, value] of Object.entries(apps)) {
                const entry: PortlessJsonAppsEntry =
                  typeof value === "object" && value !== null
                    ? (value as PortlessJsonAppsEntry)
                    : {};
                const { proposal } = definitionFromPortlessApp(
                  name,
                  entry,
                  packageManager,
                  existingDefIds,
                );
                proposals.push(proposal);
              }
            }
          }
        }
      }

      // ---- 3. Workspace packages with portless configs ----
      if (hasPortlessConfig && packageJson && typeof packageJson === "object") {
        const pkg = packageJson as Record<string, unknown>;
        let workspaceGlobs: string[] = [];

        // pnpm-workspace.yaml
        if (rootEntries.has("pnpm-workspace.yaml")) {
          const pnpmWsPath = pathService.join(workspaceRoot, "pnpm-workspace.yaml");
          const pnpmWsContent = yield* fs
            .readFileString(pnpmWsPath)
            .pipe(Effect.orElseSucceed(() => ""));
          // Simple yaml parsing for packages list
          const packagesMatch = /packages:\s*\n((?:\s+-\s+.+\n?)*)/m.exec(pnpmWsContent);
          if (packagesMatch?.[1]) {
            workspaceGlobs = packagesMatch[1]
              .split("\n")
              .map((line) => line.replace(/^\s*-\s*['"]?/, "").replace(/['"]?\s*$/, ""))
              .filter(Boolean);
          }
        } else if (pkg.workspaces) {
          // package.json#workspaces
          if (Array.isArray(pkg.workspaces)) {
            workspaceGlobs = pkg.workspaces.filter((w): w is string => typeof w === "string");
          } else if (
            typeof pkg.workspaces === "object" &&
            (pkg.workspaces as Record<string, unknown>).packages
          ) {
            const packages = (pkg.workspaces as Record<string, unknown>).packages;
            if (Array.isArray(packages)) {
              workspaceGlobs = packages.filter((w): w is string => typeof w === "string");
            }
          }
        }

        // For each workspace glob, try to find package.json files with portless configs
        for (const glob of workspaceGlobs) {
          // Simple glob expansion: "apps/*" → list apps/ subdirectories
          const basePath = glob.replace(/\/?\*.*$/, "");
          if (!basePath) continue;

          const absBase = pathService.join(workspaceRoot, basePath);
          const subDirs = yield* fs
            .readDirectory(absBase)
            .pipe(Effect.orElseSucceed(() => [] as string[]));

          for (const subDir of subDirs) {
            const subPkgPath = pathService.join(absBase, subDir, "package.json");
            const subPkg = yield* readJsonFile(fs, subPkgPath);
            if (!subPkg || typeof subPkg !== "object") continue;

            const subPkgObj = subPkg as Record<string, unknown>;
            const subName = typeof subPkgObj.name === "string" ? subPkgObj.name : subDir;
            const relativePath = pathService.join(basePath, subDir);

            // Check for portless config in this workspace package
            if (subPkgObj.portless || subPkgObj.name) {
              // Check if scripts.dev exists
              const scripts =
                typeof subPkgObj.scripts === "object" && subPkgObj.scripts !== null
                  ? (subPkgObj.scripts as Record<string, unknown>)
                  : {};
              if (scripts.dev || scripts.start) {
                const scriptName = scripts.dev ? "dev" : "start";
                const { proposal } = definitionFromPortlessApp(
                  subName,
                  { path: relativePath, script: scriptName, package: subName },
                  packageManager,
                  existingDefIds,
                );
                // Only add if not already covered by portless.json
                if (
                  !proposals.some(
                    (p) => p.suggestedDefinition.id === proposal.suggestedDefinition.id,
                  )
                ) {
                  proposals.push(proposal);
                }
              }
            }
          }
        }
      }

      // ---- 4. Fallback: package.json scripts (no portless detected) ----
      if (!hasPortlessConfig && packageJson && typeof packageJson === "object") {
        const pkg = packageJson as Record<string, unknown>;
        const scripts =
          typeof pkg.scripts === "object" && pkg.scripts !== null
            ? (pkg.scripts as Record<string, unknown>)
            : {};

        const fallbackScripts = ["dev", "start", "web"];
        for (const scriptName of fallbackScripts) {
          if (typeof scripts[scriptName] === "string") {
            proposals.push(
              definitionFromScript(
                scriptName,
                packageManager,
                existingDefIds,
                `package.json: scripts.${scriptName}`,
              ),
            );
          }
        }
      }

      return proposals;
    },
  );

  return { propose } satisfies ImportResolverShape;
});

export const ImportResolverLive = Layer.effect(ImportResolver, makeImportResolver);
