import type {
  AuthBearerBootstrapResult,
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthClientMetadata,
  AuthCreatePairingCredentialInput,
  AuthPairingCredentialResult,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthSessionId,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "@fenrir/contracts";

import {
  getPairingTokenFromUrl,
  stripPairingTokenFromUrl as stripPairingTokenUrl,
} from "../../pairingUrl";

import { RemoteEnvironmentAuthHttpError } from "../remote/api";
import { resolvePrimaryEnvironmentHttpUrl } from "./target";

export interface ServerPairingLinkRecord {
  readonly id: string;
  readonly credential: string;
  readonly role: "owner" | "client";
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ServerClientSessionRecord {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly role: "owner" | "client";
  readonly method: "browser-session-cookie" | "bearer-session-token";
  readonly client: AuthClientMetadata;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}

type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      auth: AuthSessionState["auth"];
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;
let primaryBearerSessionTokenFallback: string | null = null;
const AUTH_SESSION_ESTABLISH_TIMEOUT_MS = 2_000;
const AUTH_SESSION_ESTABLISH_STEP_MS = 100;
const PRIMARY_DESKTOP_BEARER_SESSION_STORAGE_KEY = "fenrir.primaryDesktopBearerSessionToken";

export function peekPairingTokenFromUrl(): string | null {
  return getPairingTokenFromUrl(new URL(window.location.href));
}

export function stripPairingTokenFromUrl() {
  const url = new URL(window.location.href);
  const next = stripPairingTokenUrl(url);
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState({}, document.title, next.toString());
}

export function takePairingTokenFromUrl(): string | null {
  const token = peekPairingTokenFromUrl();
  if (!token) {
    return null;
  }
  stripPairingTokenFromUrl();
  return token;
}

function getDesktopBootstrapCredential(): string | null {
  const bootstrap = window.desktopBridge?.getLocalEnvironmentBootstrap();
  return typeof bootstrap?.bootstrapToken === "string" && bootstrap.bootstrapToken.length > 0
    ? bootstrap.bootstrapToken
    : null;
}

function isDesktopAppOrigin(): boolean {
  return window.location.protocol === "t3:";
}

export function readPrimaryBearerSessionToken(): string | null {
  if (!isDesktopAppOrigin()) {
    return null;
  }

  try {
    const token = window.sessionStorage?.getItem(PRIMARY_DESKTOP_BEARER_SESSION_STORAGE_KEY);
    return token && token.length > 0 ? token : primaryBearerSessionTokenFallback;
  } catch {
    return primaryBearerSessionTokenFallback;
  }
}

function writePrimaryBearerSessionToken(token: string): void {
  primaryBearerSessionTokenFallback = token;
  try {
    window.sessionStorage?.setItem(PRIMARY_DESKTOP_BEARER_SESSION_STORAGE_KEY, token);
  } catch {
    // Session storage may be unavailable for custom app protocols in some runtimes.
  }
}

function clearPrimaryBearerSessionToken(): void {
  primaryBearerSessionTokenFallback = null;
  try {
    window.sessionStorage?.removeItem(PRIMARY_DESKTOP_BEARER_SESSION_STORAGE_KEY);
  } catch {
    // Session storage may be unavailable for custom app protocols in some runtimes.
  }
}

export function primaryAuthRequestInit(init?: RequestInit): RequestInit {
  const bearerToken = readPrimaryBearerSessionToken();
  const headers = new Headers(init?.headers);
  if (bearerToken) {
    headers.set("authorization", `Bearer ${bearerToken}`);
  }

  const requestInit: RequestInit = {
    ...init,
    credentials: bearerToken ? "omit" : "include",
  };
  if ([...headers.keys()].length > 0) {
    requestInit.headers = Object.fromEntries(headers.entries());
  }

  return requestInit;
}

export async function fetchSessionState(): Promise<AuthSessionState> {
  return retryTransientBootstrap(async () => {
    const bearerToken = readPrimaryBearerSessionToken();
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/session"), {
      ...primaryAuthRequestInit(),
      signal: bootstrapAttemptSignal(),
    });
    if (!response.ok) {
      throw new BootstrapHttpError(
        `Failed to load server auth session state (${response.status}).`,
        response.status,
      );
    }
    const session = (await response.json()) as AuthSessionState;
    if (bearerToken && !session.authenticated) {
      clearPrimaryBearerSessionToken();
    }
    return session;
  });
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  return text || fallbackMessage;
}

async function exchangeBootstrapCredential(credential: string): Promise<AuthBootstrapResult> {
  return retryTransientBootstrap(async () => {
    const payload: AuthBootstrapInput = { credential };
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/bootstrap"), {
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      signal: bootstrapAttemptSignal(),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new BootstrapHttpError(
        message || `Failed to bootstrap auth session (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as AuthBootstrapResult;
  });
}

async function exchangeBootstrapCredentialForBearerSession(
  credential: string,
): Promise<AuthBearerBootstrapResult> {
  return retryTransientBootstrap(async () => {
    const payload: AuthBootstrapInput = { credential };
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/bootstrap/bearer"), {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      signal: bootstrapAttemptSignal(),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new BootstrapHttpError(
        message || `Failed to bootstrap bearer auth session (${response.status}).`,
        response.status,
      );
    }

    return (await response.json()) as AuthBearerBootstrapResult;
  });
}

async function waitForAuthenticatedSessionAfterBootstrap(): Promise<AuthSessionState> {
  const startedAt = Date.now();

  while (true) {
    const session = await fetchSessionState();
    if (session.authenticated) {
      return session;
    }

    if (Date.now() - startedAt >= AUTH_SESSION_ESTABLISH_TIMEOUT_MS) {
      throw new Error("Timed out waiting for authenticated session after bootstrap.");
    }

    await waitForBootstrapRetry(AUTH_SESSION_ESTABLISH_STEP_MS);
  }
}

const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);
// The desktop backend can take tens of seconds to become reachable on large
// installs (boot-time read-model hydration), and the window is now created
// before the backend is ready — so the bootstrap must outlast that boot
// rather than give up after a few seconds and strand the app on a blank
// screen until a manual reload.
const BOOTSTRAP_RETRY_TIMEOUT_MS = 120_000;
const BOOTSTRAP_RETRY_STEP_MS = 500;
// Per-attempt cap so a request accepted by a bound-but-unresponsive server
// (event loop blocked mid-boot) aborts and retries instead of pending forever.
const BOOTSTRAP_ATTEMPT_TIMEOUT_MS = 5_000;

export function bootstrapAttemptSignal(): AbortSignal {
  return AbortSignal.timeout(BOOTSTRAP_ATTEMPT_TIMEOUT_MS);
}

export class BootstrapHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BootstrapHttpError";
    this.status = status;
  }
}

export async function retryTransientBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForBootstrapRetry(BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function waitForBootstrapRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isTransientBootstrapError(error: unknown): boolean {
  if (error instanceof BootstrapHttpError) {
    return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(error.status);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return (
    error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

async function bootstrapServerAuth(): Promise<ServerAuthGateState> {
  const bootstrapCredential = getDesktopBootstrapCredential();
  const currentSession = await fetchSessionState();
  if (currentSession.authenticated) {
    return { status: "authenticated" };
  }

  if (!bootstrapCredential) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
    };
  }

  try {
    if (isDesktopAppOrigin()) {
      const bearerSession = await exchangeBootstrapCredentialForBearerSession(bootstrapCredential);
      writePrimaryBearerSessionToken(bearerSession.sessionToken);
    } else {
      await exchangeBootstrapCredential(bootstrapCredential);
    }
    await waitForAuthenticatedSessionAfterBootstrap();
    return { status: "authenticated" };
  } catch (error) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
      errorMessage: error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

export async function submitServerAuthCredential(credential: string): Promise<void> {
  const trimmedCredential = credential.trim();
  if (!trimmedCredential) {
    throw new Error("Enter a pairing token to continue.");
  }

  if (isDesktopAppOrigin()) {
    const bearerSession = await exchangeBootstrapCredentialForBearerSession(trimmedCredential);
    writePrimaryBearerSessionToken(bearerSession.sessionToken);
  } else {
    await exchangeBootstrapCredential(trimmedCredential);
  }
  bootstrapPromise = null;
  stripPairingTokenFromUrl();
}

export async function createServerPairingCredential(
  label?: string,
): Promise<AuthPairingCredentialResult> {
  const trimmedLabel = label?.trim();
  const payload: AuthCreatePairingCredentialInput = trimmedLabel ? { label: trimmedLabel } : {};
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-token"),
    primaryAuthRequestInit({
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to create pairing credential (${response.status}).`),
    );
  }

  return (await response.json()) as AuthPairingCredentialResult;
}

export async function listServerPairingLinks(): Promise<ReadonlyArray<ServerPairingLinkRecord>> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-links"),
    primaryAuthRequestInit(),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load pairing links (${response.status}).`),
    );
  }

  return (await response.json()) as ReadonlyArray<ServerPairingLinkRecord>;
}

export async function revokeServerPairingLink(id: string): Promise<void> {
  const payload: AuthRevokePairingLinkInput = { id };
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-links/revoke"),
    primaryAuthRequestInit({
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke pairing link (${response.status}).`),
    );
  }
}

export async function listServerClientSessions(): Promise<
  ReadonlyArray<ServerClientSessionRecord>
> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/clients"),
    primaryAuthRequestInit(),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load paired clients (${response.status}).`),
    );
  }

  return (await response.json()) as ReadonlyArray<ServerClientSessionRecord>;
}

export async function revokeServerClientSession(sessionId: AuthSessionId): Promise<void> {
  const payload: AuthRevokeClientSessionInput = { sessionId };
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/clients/revoke"),
    primaryAuthRequestInit({
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke client session (${response.status}).`),
    );
  }
}

export async function revokeOtherServerClientSessions(): Promise<number> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/clients/revoke-others"),
    primaryAuthRequestInit({
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Failed to revoke other client sessions (${response.status}).`,
      ),
    );
  }

  const result = (await response.json()) as { revokedCount?: number };
  return result.revokedCount ?? 0;
}

export async function resolvePrimaryWebSocketConnectionUrl(wsBaseUrl: string): Promise<string> {
  const bearerToken = readPrimaryBearerSessionToken();
  if (!bearerToken) {
    return wsBaseUrl;
  }

  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/ws-token"),
    primaryAuthRequestInit({
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new RemoteEnvironmentAuthHttpError(
      await readErrorMessage(response, `Failed to issue websocket token (${response.status}).`),
      response.status,
    );
  }

  const issued = (await response.json()) as AuthWebSocketTokenResult;
  const url = new URL(wsBaseUrl);
  url.searchParams.set("wsToken", issued.token);
  return url.toString();
}

export async function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const nextPromise = bootstrapServerAuth();
  bootstrapPromise = nextPromise;
  return nextPromise.finally(() => {
    if (bootstrapPromise === nextPromise) {
      bootstrapPromise = null;
    }
  });
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
  clearPrimaryBearerSessionToken();
}
