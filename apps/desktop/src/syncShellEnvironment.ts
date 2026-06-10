import {
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLaunchctl,
  readEnvironmentFromLoginShell,
  ShellEnvironmentReader,
} from "@fenrir/shared/shell";

const LOGIN_SHELL_ENV_NAMES = [
  "PATH",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "ZDOTDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "STARSHIP_CONFIG",
] as const;

function logShellEnvironmentWarning(message: string, error?: unknown): void {
  console.warn(`[desktop] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export function syncShellEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    platform?: NodeJS.Platform;
    readEnvironment?: ShellEnvironmentReader;
    readLaunchctlPath?: typeof readPathFromLaunchctl;
    userShell?: string;
    logWarning?: (message: string, error?: unknown) => void;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;

  const logWarning = options.logWarning ?? logShellEnvironmentWarning;
  const readEnvironment = options.readEnvironment ?? readEnvironmentFromLoginShell;
  const shellEnvironment: Partial<Record<string, string>> = {};

  try {
    for (const shell of listLoginShellCandidates(platform, env.SHELL, options.userShell)) {
      try {
        Object.assign(shellEnvironment, readEnvironment(shell, LOGIN_SHELL_ENV_NAMES));
        if (shellEnvironment.PATH) {
          break;
        }
      } catch (error) {
        logWarning(`Failed to read login shell environment from ${shell}.`, error);
      }
    }

    const launchctlPath =
      platform === "darwin" && !shellEnvironment.PATH
        ? (options.readLaunchctlPath ?? readPathFromLaunchctl)()
        : undefined;
    const mergedPath = mergePathEntries(shellEnvironment.PATH ?? launchctlPath, env.PATH, platform);
    if (mergedPath) {
      env.PATH = mergedPath;
    }

    for (const name of [
      "SHELL",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "SSH_AUTH_SOCK",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "ZDOTDIR",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "STARSHIP_CONFIG",
    ] as const) {
      if (!env[name] && shellEnvironment[name]) {
        env[name] = shellEnvironment[name];
      }
    }

    // GUI launches (Finder/Dock) carry no locale, and many setups only get
    // LANG from the terminal emulator — so the login shell probe can come
    // back empty too. Without a UTF-8 locale, tmux substitutes "_" for every
    // non-ASCII glyph in attached clients and shells disable multibyte
    // handling. Fall back to a UTF-8 locale rather than running in C.
    if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) {
      if (platform === "darwin") {
        // macOS accepts a bare charset for LC_CTYPE (Terminal.app sets the
        // same); it enables UTF-8 without guessing a language/region.
        env.LC_CTYPE = "UTF-8";
      } else {
        env.LANG = "C.UTF-8";
      }
    }
  } catch (error) {
    logWarning("Failed to synchronize the desktop shell environment.", error);
  }
}
