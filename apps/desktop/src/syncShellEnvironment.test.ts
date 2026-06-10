import { describe, expect, it, vi } from "vitest";

import { syncShellEnvironment } from "./syncShellEnvironment";

const EXPECTED_LOGIN_SHELL_ENV_NAMES = [
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

describe("syncShellEnvironment", () => {
  it("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on macOS", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/Users/test/.local/bin:/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
      HOMEBREW_PREFIX: "/opt/homebrew",
      ZDOTDIR: "/Users/test/.config/zsh",
      STARSHIP_CONFIG: "/Users/test/.config/starship.toml",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", EXPECTED_LOGIN_SHELL_ENV_NAMES);
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/Users/test/.local/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/secretive.sock");
    expect(env.HOMEBREW_PREFIX).toBe("/opt/homebrew");
    expect(env.ZDOTDIR).toBe("/Users/test/.config/zsh");
    expect(env.STARSHIP_CONFIG).toBe("/Users/test/.config/starship.toml");
  });

  it("preserves an inherited SSH_AUTH_SOCK value", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/login-shell.sock",
      SHELL: "/bin/zsh",
      STARSHIP_CONFIG: "/tmp/login-shell-starship.toml",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });

  it("preserves inherited values when the login shell omits them", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });

  it("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on linux", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/home/linuxbrew/.linuxbrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
    }));

    syncShellEnvironment(env, {
      platform: "linux",
      readEnvironment,
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", EXPECTED_LOGIN_SHELL_ENV_NAMES);
    expect(env.PATH).toBe("/home/linuxbrew/.linuxbrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/secretive.sock");
  });

  it("falls back to launchctl PATH on macOS when shell probing does not return one", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/opt/homebrew/bin/nu",
      PATH: "/usr/bin",
    };
    const readEnvironment = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("unknown flag");
      })
      .mockImplementationOnce(() => ({}));
    const readLaunchctlPath = vi.fn(() => "/opt/homebrew/bin:/usr/bin");
    const logWarning = vi.fn();

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
      readLaunchctlPath,
      userShell: "/bin/zsh",
      logWarning,
    });

    expect(readEnvironment).toHaveBeenNthCalledWith(
      1,
      "/opt/homebrew/bin/nu",
      EXPECTED_LOGIN_SHELL_ENV_NAMES,
    );
    expect(readEnvironment).toHaveBeenNthCalledWith(2, "/bin/zsh", EXPECTED_LOGIN_SHELL_ENV_NAMES);
    expect(readLaunchctlPath).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(
      "Failed to read login shell environment from /opt/homebrew/bin/nu.",
      expect.any(Error),
    );
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("does nothing outside macOS and linux", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "C:/Program Files/Git/bin/bash.exe",
      PATH: "C:\\Windows\\System32",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/usr/local/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
    }));

    syncShellEnvironment(env, {
      platform: "win32",
      readEnvironment,
    });

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(env.PATH).toBe("C:\\Windows\\System32");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });

  it("hydrates the missing SHELL value for packaged GUI launches", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SHELL: "/bin/zsh",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
      userShell: "/bin/zsh",
    });

    expect(env.SHELL).toBe("/bin/zsh");
  });

  it("hydrates missing locale variables for packaged GUI launches", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      LC_CTYPE: "en_US.UTF-8",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
      userShell: "/bin/zsh",
    });

    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.LC_CTYPE).toBe("en_US.UTF-8");
  });

  it("falls back to a UTF-8 LC_CTYPE on macOS when no locale is available anywhere", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
      userShell: "/bin/zsh",
    });

    expect(env.LC_CTYPE).toBe("UTF-8");
    expect(env.LANG).toBeUndefined();
  });

  it("falls back to C.UTF-8 LANG on linux when no locale is available anywhere", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/usr/local/bin:/usr/bin",
    }));

    syncShellEnvironment(env, {
      platform: "linux",
      readEnvironment,
      userShell: "/bin/zsh",
    });

    expect(env.LANG).toBe("C.UTF-8");
  });

  it("does not override an inherited locale with the UTF-8 fallback", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      LANG: "es_ES.UTF-8",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
      userShell: "/bin/zsh",
    });

    expect(env.LANG).toBe("es_ES.UTF-8");
    expect(env.LC_CTYPE).toBeUndefined();
  });

  it("preserves inherited shell-specific environment variables", () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      ZDOTDIR: "/tmp/inherited-zdotdir",
      STARSHIP_CONFIG: "/tmp/inherited-starship.toml",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      ZDOTDIR: "/tmp/login-shell-zdotdir",
      STARSHIP_CONFIG: "/tmp/login-shell-starship.toml",
    }));

    syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(env.ZDOTDIR).toBe("/tmp/inherited-zdotdir");
    expect(env.STARSHIP_CONFIG).toBe("/tmp/inherited-starship.toml");
  });
});
