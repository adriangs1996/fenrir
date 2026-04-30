import { isElectron } from "./env";

export const PERSISTED_ROUTE_KEY = "fenrir:last-route:v1";

interface PersistedRouteDocument {
  path?: string;
}

const ROUTE_BASE_URL = "https://fenrir.local";
const MAX_ROUTE_LENGTH = 2_048;
const EXCLUDED_PATHNAMES = new Set(["/pair"]);

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function parseRoute(route: string): URL | null {
  try {
    return new URL(route, ROUTE_BASE_URL);
  } catch {
    return null;
  }
}

export function normalizePersistedRoute(route: string | null | undefined): string | null {
  if (typeof route !== "string") {
    return null;
  }

  const trimmed = route.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ROUTE_LENGTH || !trimmed.startsWith("/")) {
    return null;
  }

  const parsed = parseRoute(trimmed);
  if (!parsed || parsed.origin !== ROUTE_BASE_URL) {
    return null;
  }

  const normalized = `${parsed.pathname}${parsed.search}`;
  return normalized.length <= MAX_ROUTE_LENGTH ? normalized : null;
}

function shouldPersistRoute(route: string): boolean {
  const parsed = parseRoute(route);
  return parsed !== null && !EXCLUDED_PATHNAMES.has(parsed.pathname);
}

export function clearPersistedRoute(): void {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.removeItem(PERSISTED_ROUTE_KEY);
  } catch {
    // Ignore storage errors to avoid breaking app boot.
  }
}

export function readPersistedRoute(): string | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PERSISTED_ROUTE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedRouteDocument;
    const normalized = normalizePersistedRoute(parsed.path);
    if (!normalized || !shouldPersistRoute(normalized)) {
      clearPersistedRoute();
      return null;
    }
    return normalized;
  } catch {
    clearPersistedRoute();
    return null;
  }
}

export function writePersistedRoute(route: string): void {
  if (!hasWindow()) {
    return;
  }

  const normalized = normalizePersistedRoute(route);
  if (!normalized || !shouldPersistRoute(normalized)) {
    return;
  }

  try {
    window.localStorage.setItem(
      PERSISTED_ROUTE_KEY,
      JSON.stringify({ path: normalized } satisfies PersistedRouteDocument),
    );
  } catch {
    // Ignore quota/storage errors to avoid breaking app navigation.
  }
}

export function readCurrentRoute(): string | null {
  if (!hasWindow()) {
    return null;
  }

  if (isElectron) {
    const hash = window.location.hash;
    if (hash.length === 0 || hash === "#") {
      return "/";
    }
    if (!hash.startsWith("#/")) {
      return null;
    }
    return normalizePersistedRoute(hash.slice(1));
  }

  return normalizePersistedRoute(`${window.location.pathname}${window.location.search}`);
}

export function persistCurrentRoute(): void {
  const route = readCurrentRoute();
  if (!route || !shouldPersistRoute(route)) {
    return;
  }
  writePersistedRoute(route);
}

function replaceCurrentRoute(route: string): void {
  if (!hasWindow()) {
    return;
  }

  if (isElectron) {
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = route === "/" ? "#/" : `#${route}`;
    window.history.replaceState(null, "", nextUrl);
    return;
  }

  window.history.replaceState(null, "", route);
}

export function restorePersistedRouteOnLoad(): boolean {
  const currentRoute = readCurrentRoute();
  if (currentRoute !== "/") {
    return false;
  }

  const persistedRoute = readPersistedRoute();
  if (!persistedRoute || persistedRoute === "/") {
    return false;
  }

  replaceCurrentRoute(persistedRoute);
  return true;
}
