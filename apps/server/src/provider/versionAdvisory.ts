import type { ServerProvider, ServerProviderVersionAdvisory } from "@fenrir/contracts";
import { compareCliVersions } from "./cliVersion";

const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_VERSION_TIMEOUT_MS = 4_000;

interface LatestVersionCacheEntry {
  readonly expiresAt: number;
  readonly version: string | null;
}

const latestVersionCache = new Map<string, LatestVersionCacheEntry>();

const PROVIDER_PACKAGE_NAME: Record<string, string | null> = {
  codex: "@openai/codex",
  claudeAgent: "@anthropic-ai/claude-code",
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function createUnknownVersionAdvisory(input: {
  currentVersion: string | null;
  checkedAt: string | null;
}): ServerProviderVersionAdvisory {
  return {
    status: "unknown",
    currentVersion: input.currentVersion,
    latestVersion: null,
    checkedAt: input.checkedAt,
    message: null,
  };
}

export function createProviderVersionAdvisory(input: {
  currentVersion: string | null;
  latestVersion: string | null;
  checkedAt: string | null;
}): ServerProviderVersionAdvisory {
  if (!input.currentVersion || !input.latestVersion) {
    return createUnknownVersionAdvisory(input);
  }

  if (compareCliVersions(input.currentVersion, input.latestVersion) < 0) {
    return {
      status: "behind_latest",
      currentVersion: input.currentVersion,
      latestVersion: input.latestVersion,
      checkedAt: input.checkedAt,
      message: `Update available: install ${input.latestVersion}.`,
    };
  }

  return {
    status: "current",
    currentVersion: input.currentVersion,
    latestVersion: input.latestVersion,
    checkedAt: input.checkedAt,
    message: null,
  };
}

export function clearLatestProviderVersionCacheForTests(): void {
  latestVersionCache.clear();
}

async function fetchNpmLatestVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, LATEST_VERSION_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: {
          accept: "application/json",
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { version?: unknown };
    return nonEmptyString(payload.version);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveLatestProviderVersion(provider: string): Promise<string | null> {
  const packageName = PROVIDER_PACKAGE_NAME[provider];
  if (!packageName) {
    return null;
  }

  const now = Date.now();
  const cached = latestVersionCache.get(packageName);
  if (cached && cached.expiresAt > now) {
    return cached.version;
  }

  const version = await fetchNpmLatestVersion(packageName);
  latestVersionCache.set(packageName, {
    expiresAt: now + LATEST_VERSION_CACHE_TTL_MS,
    version,
  });
  return version;
}

export async function enrichProviderSnapshotWithVersionAdvisory(
  snapshot: ServerProvider,
): Promise<ServerProvider> {
  if (!snapshot.enabled || !snapshot.installed || !snapshot.version) {
    return {
      ...snapshot,
      versionAdvisory: createUnknownVersionAdvisory({
        currentVersion: snapshot.version,
        checkedAt: snapshot.checkedAt,
      }),
    };
  }

  const providerKey = snapshot.driver ?? snapshot.provider;
  const latestVersion = providerKey ? await resolveLatestProviderVersion(providerKey) : null;
  return {
    ...snapshot,
    versionAdvisory: createProviderVersionAdvisory({
      currentVersion: snapshot.version,
      latestVersion,
      checkedAt: latestVersion ? new Date().toISOString() : snapshot.checkedAt,
    }),
  };
}
