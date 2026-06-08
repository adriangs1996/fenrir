import nodePath from "node:path";

import { Effect, FileSystem, Option } from "effect";

import { ServerConfig } from "../../config";

const LAZYGIT_THEME_DIR = "lazygit";
const LAZYGIT_PIERRE_DARK_CONFIG_FILE = "pierre-dark.yml";

export const LAZYGIT_PIERRE_DARK_CONFIG = `gui:
  theme:
    activeBorderColor:
      - "#009fff"
      - bold
    inactiveBorderColor:
      - "#737373"
    searchingActiveBorderColor:
      - "#08c0ef"
      - bold
    optionsTextColor:
      - "#009fff"
    selectedLineBgColor:
      - "#19283c"
    inactiveViewSelectedLineBgColor:
      - "#1d1d1d"
    cherryPickedCommitFgColor:
      - "#009fff"
    cherryPickedCommitBgColor:
      - "#08c0ef"
    markedBaseCommitFgColor:
      - "#009fff"
    markedBaseCommitBgColor:
      - "#ffca00"
    unstagedChangesColor:
      - "#ff2e3f"
    defaultFgColor:
      - "#fafafa"
`;

function nonEmptyEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function uniquePaths(paths: ReadonlyArray<string>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const pathValue of paths) {
    const normalizedPath = pathValue.trim();
    if (!normalizedPath || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    output.push(normalizedPath);
  }
  return output;
}

export function appendLazygitConfigFile(
  currentValue: string | undefined,
  configPath: string,
): string {
  return uniquePaths([...(currentValue?.split(",") ?? []), configPath]).join(",");
}

export function lazygitDefaultConfigCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const candidates: string[] = [];
  const configDir = nonEmptyEnvValue(env.CONFIG_DIR);
  const home = nonEmptyEnvValue(env.HOME);
  const xdgConfigHome = nonEmptyEnvValue(env.XDG_CONFIG_HOME);

  if (configDir) {
    candidates.push(
      nodePath.join(configDir, "config.yml"),
      nodePath.join(configDir, "config.yaml"),
    );
  }

  if (xdgConfigHome) {
    candidates.push(
      nodePath.join(xdgConfigHome, "lazygit", "config.yml"),
      nodePath.join(xdgConfigHome, "lazygit", "config.yaml"),
    );
  }

  if (platform === "win32") {
    const localAppData = nonEmptyEnvValue(env.LOCALAPPDATA);
    const appData = nonEmptyEnvValue(env.APPDATA);
    if (localAppData) {
      candidates.push(
        nodePath.join(localAppData, "lazygit", "config.yml"),
        nodePath.join(localAppData, "lazygit", "config.yaml"),
      );
    }
    if (appData) {
      candidates.push(
        nodePath.join(appData, "lazygit", "config.yml"),
        nodePath.join(appData, "lazygit", "config.yaml"),
        nodePath.join(appData, "jesseduffield", "lazygit", "config.yml"),
        nodePath.join(appData, "jesseduffield", "lazygit", "config.yaml"),
      );
    }
  } else if (home) {
    candidates.push(
      nodePath.join(home, ".config", "lazygit", "config.yml"),
      nodePath.join(home, ".config", "lazygit", "config.yaml"),
      nodePath.join(home, ".config", "jesseduffield", "lazygit", "config.yml"),
      nodePath.join(home, ".config", "jesseduffield", "lazygit", "config.yaml"),
    );

    if (platform === "darwin") {
      candidates.push(
        nodePath.join(home, "Library", "Application Support", "lazygit", "config.yml"),
        nodePath.join(home, "Library", "Application Support", "lazygit", "config.yaml"),
        nodePath.join(
          home,
          "Library",
          "Application Support",
          "jesseduffield",
          "lazygit",
          "config.yml",
        ),
        nodePath.join(
          home,
          "Library",
          "Application Support",
          "jesseduffield",
          "lazygit",
          "config.yaml",
        ),
      );
    }
  }

  return uniquePaths(candidates);
}

function existingDefaultConfigFiles(env: NodeJS.ProcessEnv) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const candidates = lazygitDefaultConfigCandidates(env);
    const existingFiles: string[] = [];

    for (const candidate of candidates) {
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (exists) existingFiles.push(candidate);
    }

    return existingFiles;
  });
}

export function withPierreDarkLazygitThemeEnvForStateDir(env: NodeJS.ProcessEnv, stateDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const themeDir = nodePath.join(stateDir, LAZYGIT_THEME_DIR);
    const themePath = nodePath.join(themeDir, LAZYGIT_PIERRE_DARK_CONFIG_FILE);

    yield* fs.makeDirectory(themeDir, { recursive: true });
    yield* fs.writeFileString(themePath, LAZYGIT_PIERRE_DARK_CONFIG);
    yield* fs.chmod(themePath, 0o600).pipe(Effect.ignore);

    const existingConfigFiles = env.LG_CONFIG_FILE ? [] : yield* existingDefaultConfigFiles(env);

    return {
      ...env,
      LG_CONFIG_FILE: appendLazygitConfigFile(
        env.LG_CONFIG_FILE ?? existingConfigFiles.join(","),
        themePath,
      ),
    };
  }).pipe(Effect.orElseSucceed(() => env));
}

export function withPierreDarkLazygitThemeEnv(env: NodeJS.ProcessEnv) {
  return Effect.gen(function* () {
    const serverConfig = yield* Effect.serviceOption(ServerConfig);
    if (Option.isNone(serverConfig)) return env;

    return yield* withPierreDarkLazygitThemeEnvForStateDir(env, serverConfig.value.stateDir);
  });
}
