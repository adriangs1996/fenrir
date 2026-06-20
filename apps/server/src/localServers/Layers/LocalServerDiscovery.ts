import { connect } from "node:net";

import type {
  DiscoveredLocalServer,
  LocalServerTerminalOwner,
  LocalServerSource,
  LocalServersSnapshot,
} from "@fenrir/contracts";
import { ThreadId, TrimmedNonEmptyString } from "@fenrir/contracts";
import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { LocalServerDiscovery } from "../Services/LocalServerDiscovery";

export const COMMON_DEV_PORTS: ReadonlyArray<number> = Object.freeze([
  3000, 3001, 3333, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 8000, 8080, 8081, 8888, 9000,
]);

const POLL_INTERVAL_MS = 3_000;
const LSOF_TIMEOUT_MS = 5_000;
const WINDOWS_LISTENER_TIMEOUT_MS = 5_000;
const LISTENER_OUTPUT_MAX_BYTES = 1024 * 1024;
const COMMON_PORT_CONNECT_TIMEOUT_MS = 250;
const LOCAL_HTTP_PROBE_TIMEOUT_MS = 350;
const LOCAL_HTTP_PROBE_CACHE_TTL_MS = 10_000;
const PROCESS_TREE_TIMEOUT_MS = 1_000;
const PROCESS_TREE_MAX_BYTES = 1024 * 1024;
const LOCAL_HOST_TOKENS = new Set([
  "*",
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "::",
  "[::]",
]);
const COMMON_DEV_PORT_SET = new Set(COMMON_DEV_PORTS);
const KNOWN_NOISE_PROCESS_NAME_PREFIXES: ReadonlyArray<string> = Object.freeze([
  "1password",
  "discord",
  "dropbox",
  "figma",
  "linear",
  "notion",
  "opencode",
  "raycast",
  "slack",
  "spotify",
  "telegram",
  "whatsapp",
  "zoom",
]);
const KNOWN_DEV_SERVER_PROCESS_NAMES = new Set([
  "air",
  "astro",
  "bun",
  "cargo",
  "deno",
  "django",
  "flask",
  "go",
  "gunicorn",
  "http-server",
  "java",
  "live-server",
  "next",
  "node",
  "npm",
  "nuxt",
  "parcel",
  "php",
  "php-fpm",
  "pnpm",
  "puma",
  "rails",
  "rackup",
  "remix",
  "ruby",
  "serve",
  "svelte-kit",
  "sveltekit",
  "trunk",
  "ts-node",
  "tsx",
  "uvicorn",
  "vite",
  "vite-node",
  "webpack",
  "yarn",
]);
const KNOWN_DEV_SERVER_PROCESS_NAME_PREFIXES: ReadonlyArray<string> = Object.freeze([
  "node",
  "python",
  "ruby",
  "java",
  "php",
  "uvicorn",
  "gunicorn",
]);

type Listener = (snapshot: LocalServersSnapshot) => void;

interface TerminalProcessRegistration {
  readonly owner: LocalServerTerminalOwner;
  readonly processIds: ReadonlySet<number>;
}

interface ProcessTreeRow {
  readonly pid: number;
  readonly ppid: number;
}

type LocalServerHttpProbe = (server: DiscoveredLocalServer) => Promise<boolean>;

function terminalOwnerKey(input: { readonly threadId: string; readonly terminalId: string }) {
  return `${input.threadId}\u0000${input.terminalId}`;
}

function normalizeProcessName(processName: string | null | undefined): string {
  return (processName ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.exe$/u, "")
    .replace(/\s+/gu, " ");
}

function matchesProcessNamePrefix(processName: string, prefix: string): boolean {
  if (processName === prefix || processName.startsWith(`${prefix} `)) return true;

  const suffix = processName.slice(prefix.length);
  if (suffix.length === 0) return false;
  const firstSuffixChar = suffix.charAt(0);
  return firstSuffixChar === "." || (firstSuffixChar >= "0" && firstSuffixChar <= "9");
}

export function isKnownNoiseLocalServerProcessName(
  processName: string | null | undefined,
): boolean {
  const normalized = normalizeProcessName(processName);
  if (normalized.length === 0) return false;
  return KNOWN_NOISE_PROCESS_NAME_PREFIXES.some((prefix) =>
    matchesProcessNamePrefix(normalized, prefix),
  );
}

export function isLikelyDevServerProcessName(processName: string | null | undefined): boolean {
  const normalized = normalizeProcessName(processName);
  if (normalized.length === 0) return false;
  if (KNOWN_DEV_SERVER_PROCESS_NAMES.has(normalized)) return true;
  return KNOWN_DEV_SERVER_PROCESS_NAME_PREFIXES.some((prefix) =>
    matchesProcessNamePrefix(normalized, prefix),
  );
}

export function parsePortFromLsofName(name: string): number | null {
  const trimmed = name.split(" ", 1)[0]?.trim() ?? "";
  if (trimmed.length === 0) return null;

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon < 0) return null;

  const host = trimmed.slice(0, lastColon);
  if (!LOCAL_HOST_TOKENS.has(host)) return null;

  const port = Number.parseInt(trimmed.slice(lastColon + 1), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
}

function toServer(input: {
  readonly port: number;
  readonly source: LocalServerSource;
  readonly processName?: string | null | undefined;
  readonly pid?: number | null;
  readonly terminal?: LocalServerTerminalOwner | null | undefined;
}): DiscoveredLocalServer {
  const pid = input.pid && Number.isInteger(input.pid) && input.pid > 0 ? input.pid : null;
  return {
    host: "localhost",
    port: input.port,
    url: `http://localhost:${input.port}`,
    processName: input.processName?.trim() || null,
    pid,
    source: input.source,
    terminal: input.terminal ?? null,
  };
}

export function parseLsofOutput(
  raw: string,
  terminalByProcessId: ReadonlyMap<number, LocalServerTerminalOwner> = new Map(),
): ReadonlyArray<DiscoveredLocalServer> {
  const seen = new Map<number, DiscoveredLocalServer>();
  let pid: number | null = null;
  let processName: string | null = null;

  for (const line of raw.split(/\r?\n/g)) {
    if (line.length === 0) continue;

    const tag = line.charAt(0);
    const value = line.slice(1);

    if (tag === "p") {
      const parsedPid = Number.parseInt(value, 10);
      pid = Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : null;
      processName = null;
      continue;
    }

    if (tag === "c") {
      processName = value.trim() || null;
      continue;
    }

    if (tag !== "n") continue;

    const port = parsePortFromLsofName(value);
    if (port === null || seen.has(port)) continue;

    seen.set(
      port,
      toServer({
        port,
        processName,
        pid,
        source: "lsof",
        terminal: pid === null ? null : terminalByProcessId.get(pid),
      }),
    );
  }

  return [...seen.values()].toSorted((left, right) => left.port - right.port);
}

export function parseWindowsListenerOutput(
  raw: string,
  terminalByProcessId: ReadonlyMap<number, LocalServerTerminalOwner> = new Map(),
): ReadonlyArray<DiscoveredLocalServer> {
  const seen = new Map<number, DiscoveredLocalServer>();

  for (const line of raw.split(/\r?\n/g)) {
    const [hostRaw, portRaw, pidRaw, processNameRaw] = line.trim().split("|", 4);
    const host = hostRaw?.trim() ?? "";
    if (!LOCAL_HOST_TOKENS.has(host)) continue;

    const port = Number.parseInt(portRaw ?? "", 10);
    const pid = Number.parseInt(pidRaw ?? "", 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || seen.has(port)) continue;

    seen.set(
      port,
      toServer({
        port,
        pid,
        processName: processNameRaw,
        source: "powershell",
        terminal: Number.isInteger(pid) && pid > 0 ? terminalByProcessId.get(pid) : null,
      }),
    );
  }

  return [...seen.values()].toSorted((left, right) => left.port - right.port);
}

function serversEqual(
  left: ReadonlyArray<DiscoveredLocalServer>,
  right: ReadonlyArray<DiscoveredLocalServer>,
): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const leftServer = left[index];
    const rightServer = right[index];
    if (!leftServer || !rightServer) return false;
    if (
      leftServer.host !== rightServer.host ||
      leftServer.port !== rightServer.port ||
      leftServer.url !== rightServer.url ||
      leftServer.processName !== rightServer.processName ||
      leftServer.pid !== rightServer.pid ||
      leftServer.source !== rightServer.source ||
      leftServer.terminal?.threadId !== rightServer.terminal?.threadId ||
      leftServer.terminal?.terminalId !== rightServer.terminal?.terminalId
    ) {
      return false;
    }
  }

  return true;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let settled = false;

    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(COMMON_PORT_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function isLocalPortListening(port: number): Promise<boolean> {
  const results = await Promise.all([canConnect("127.0.0.1", port), canConnect("::1", port)]);
  return results.some(Boolean);
}

async function probeCommonPorts(): Promise<ReadonlyArray<DiscoveredLocalServer>> {
  const results = await Promise.all(
    COMMON_DEV_PORTS.map(async (port) => ({
      port,
      listening: await isLocalPortListening(port),
    })),
  );

  return results
    .filter((result) => result.listening)
    .map((result) => toServer({ port: result.port, source: "common-port-probe" }))
    .filter((server) => !isKnownNoiseLocalServerProcessName(server.processName))
    .toSorted((left, right) => left.port - right.port);
}

export async function probeLocalHttpServer(server: DiscoveredLocalServer): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, LOCAL_HTTP_PROBE_TIMEOUT_MS);

  try {
    await fetch(server.url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function localHttpProbeCacheKey(server: DiscoveredLocalServer): string {
  return `${server.pid ?? "unknown"}:${server.port}:${server.url}`;
}

export function makeCachedLocalServerHttpProbe(
  probe: LocalServerHttpProbe = probeLocalHttpServer,
  now: () => number = Date.now,
  ttlMs = LOCAL_HTTP_PROBE_CACHE_TTL_MS,
): LocalServerHttpProbe {
  const cache = new Map<
    string,
    { readonly expiresAt: number; readonly result: Promise<boolean> }
  >();

  return async (server) => {
    const key = localHttpProbeCacheKey(server);
    const currentTime = now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > currentTime) {
      return cached.result;
    }

    const result = probe(server).catch(() => false);
    cache.set(key, { expiresAt: currentTime + ttlMs, result });
    return result;
  };
}

export function shouldProbeLocalServerCandidate(server: DiscoveredLocalServer): boolean {
  if (server.terminal !== null) return false;
  if (isKnownNoiseLocalServerProcessName(server.processName)) return false;
  return COMMON_DEV_PORT_SET.has(server.port) || isLikelyDevServerProcessName(server.processName);
}

const cachedLocalHttpProbe = makeCachedLocalServerHttpProbe();

export async function filterRelevantLocalServers(
  servers: ReadonlyArray<DiscoveredLocalServer>,
  probe: LocalServerHttpProbe = cachedLocalHttpProbe,
): Promise<ReadonlyArray<DiscoveredLocalServer>> {
  const filtered = await Promise.all(
    servers.map(async (server) => {
      if (server.terminal !== null) return server;
      if (!shouldProbeLocalServerCandidate(server)) return null;
      return (await probe(server)) ? server : null;
    }),
  );

  return filtered.filter((server): server is DiscoveredLocalServer => server !== null);
}

function parseProcessTreeRows(raw: string): ReadonlyArray<ProcessTreeRow> {
  const rows: ProcessTreeRow[] = [];
  for (const line of raw.split(/\r?\n/g)) {
    const [pidRaw, ppidRaw] = line.trim().split(/\s+/g);
    const pid = Number.parseInt(pidRaw ?? "", 10);
    const ppid = Number.parseInt(ppidRaw ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0) continue;
    rows.push({ pid, ppid });
  }
  return rows;
}

function collectDescendantProcessIds(
  rootIds: ReadonlySet<number>,
  rows: ReadonlyArray<ProcessTreeRow>,
): ReadonlySet<number> {
  const processIds = new Set(rootIds);
  const childrenByParent = new Map<number, number[]>();

  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.ppid, children);
  }

  const stack = [...rootIds];
  while (stack.length > 0) {
    const parentId = stack.pop();
    if (parentId === undefined) continue;

    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (processIds.has(childId)) continue;
      processIds.add(childId);
      stack.push(childId);
    }
  }

  return processIds;
}

async function readProcessTreeRows(): Promise<ReadonlyArray<ProcessTreeRow>> {
  if (process.platform === "win32") {
    try {
      const result = await runProcess(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          'Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { Write-Output "$($_.ProcessId) $($_.ParentProcessId)" }',
        ],
        {
          allowNonZeroExit: true,
          maxBufferBytes: PROCESS_TREE_MAX_BYTES,
          outputMode: "truncate",
          timeoutMs: PROCESS_TREE_TIMEOUT_MS,
        },
      );
      if (result.timedOut || result.code !== 0) return [];
      return parseProcessTreeRows(result.stdout);
    } catch {
      return [];
    }
  }

  try {
    const result = await runProcess("ps", ["-eo", "pid=,ppid="], {
      allowNonZeroExit: true,
      maxBufferBytes: PROCESS_TREE_MAX_BYTES,
      outputMode: "truncate",
      timeoutMs: PROCESS_TREE_TIMEOUT_MS,
    });
    if (result.timedOut || result.code !== 0) return [];
    return parseProcessTreeRows(result.stdout);
  } catch {
    return [];
  }
}

async function buildTerminalProcessIndex(
  terminalProcesses: ReadonlyMap<string, TerminalProcessRegistration>,
): Promise<ReadonlyMap<number, LocalServerTerminalOwner>> {
  const processIndex = new Map<number, LocalServerTerminalOwner>();
  if (terminalProcesses.size === 0) return processIndex;

  const processTreeRows = await readProcessTreeRows();
  for (const registration of terminalProcesses.values()) {
    const processIds =
      processTreeRows.length > 0
        ? collectDescendantProcessIds(registration.processIds, processTreeRows)
        : registration.processIds;

    for (const processId of processIds) {
      processIndex.set(processId, registration.owner);
    }
  }

  return processIndex;
}

async function scanWithLsof(
  terminalByProcessId: ReadonlyMap<number, LocalServerTerminalOwner>,
): Promise<ReadonlyArray<DiscoveredLocalServer> | null> {
  try {
    const result = await runProcess("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"], {
      allowNonZeroExit: true,
      maxBufferBytes: LISTENER_OUTPUT_MAX_BYTES,
      outputMode: "truncate",
      timeoutMs: LSOF_TIMEOUT_MS,
    });
    if (result.timedOut) return null;
    return parseLsofOutput(result.stdout, terminalByProcessId);
  } catch {
    return null;
  }
}

async function scanWithPowerShell(
  terminalByProcessId: ReadonlyMap<number, LocalServerTerminalOwner>,
): Promise<ReadonlyArray<DiscoveredLocalServer> | null> {
  const command =
    'Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { $processName = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName; Write-Output "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)|$processName" }';

  try {
    const result = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        allowNonZeroExit: true,
        maxBufferBytes: LISTENER_OUTPUT_MAX_BYTES,
        outputMode: "truncate",
        timeoutMs: WINDOWS_LISTENER_TIMEOUT_MS,
      },
    );
    if (result.timedOut || (result.code !== 0 && result.stdout.trim().length === 0)) {
      return null;
    }
    return parseWindowsListenerOutput(result.stdout, terminalByProcessId);
  } catch {
    return null;
  }
}

async function scanServers(
  terminalProcesses: ReadonlyMap<string, TerminalProcessRegistration>,
): Promise<LocalServersSnapshot> {
  const terminalByProcessId = await buildTerminalProcessIndex(terminalProcesses);
  const detected =
    process.platform === "win32"
      ? await scanWithPowerShell(terminalByProcessId)
      : await scanWithLsof(terminalByProcessId);
  const servers = await filterRelevantLocalServers(
    detected ?? (await probeCommonPorts()),
    cachedLocalHttpProbe,
  );

  return {
    servers,
    scannedAt: new Date().toISOString(),
  };
}

function makeLocalServerDiscovery() {
  const listeners = new Set<Listener>();
  const terminalProcesses = new Map<string, TerminalProcessRegistration>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let latestSnapshot: LocalServersSnapshot | null = null;
  let scanInFlight: Promise<LocalServersSnapshot> | null = null;

  const runScan = (): Promise<LocalServersSnapshot> => {
    scanInFlight ??= scanServers(new Map(terminalProcesses)).finally(() => {
      scanInFlight = null;
    });
    return scanInFlight;
  };

  const notifyAll = (snapshot: LocalServersSnapshot) => {
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const refresh = async (target?: Listener) => {
    try {
      const snapshot = await runScan();
      const changed =
        latestSnapshot === null || !serversEqual(latestSnapshot.servers, snapshot.servers);
      latestSnapshot = snapshot;

      if (target) {
        if (listeners.has(target)) {
          target(snapshot);
        }
        return;
      }

      if (changed) {
        notifyAll(snapshot);
      }
    } catch (error) {
      console.warn("[local-servers] Local server scan failed:", error);
    }
  };

  const start = () => {
    if (timer !== null) return;
    timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
  };

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    scan: Effect.promise(runScan),
    subscribe: (listener: Listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        start();
        void refresh(listener);

        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) {
            stop();
          }
        };
      }),
    registerTerminalProcesses: (input: {
      readonly threadId: string;
      readonly terminalId: string;
      readonly processIds: ReadonlyArray<number>;
    }) =>
      Effect.sync(() => {
        const processIds = new Set(
          input.processIds.filter((processId) => Number.isInteger(processId) && processId > 0),
        );
        const key = terminalOwnerKey(input);

        if (processIds.size === 0) {
          terminalProcesses.delete(key);
        } else {
          terminalProcesses.set(key, {
            owner: {
              threadId: ThreadId.make(input.threadId),
              terminalId: TrimmedNonEmptyString.make(input.terminalId),
            },
            processIds,
          });
        }

        if (listeners.size > 0) {
          void refresh();
        }
      }),
    unregisterTerminal: (input: { readonly threadId: string; readonly terminalId: string }) =>
      Effect.sync(() => {
        terminalProcesses.delete(terminalOwnerKey(input));
        if (listeners.size > 0) {
          void refresh();
        }
      }),
    unregisterThread: (input: { readonly threadId: string }) =>
      Effect.sync(() => {
        for (const key of terminalProcesses.keys()) {
          if (key.startsWith(`${input.threadId}\u0000`)) {
            terminalProcesses.delete(key);
          }
        }
        if (listeners.size > 0) {
          void refresh();
        }
      }),
  };
}

export const LocalServerDiscoveryLive = Layer.effect(
  LocalServerDiscovery,
  Effect.sync(makeLocalServerDiscovery),
);
