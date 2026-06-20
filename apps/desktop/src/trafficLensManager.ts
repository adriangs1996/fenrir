import { WebContentsView, type BrowserWindow, session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import * as FS from "node:fs";
import * as Path from "node:path";
import type {
  TrafficLensArchivedSessionStorageSummary,
  TrafficLensCaptureStorageOriginInput,
  TrafficLensClearLiveSessionStorageInput,
  TrafficLensClearLocalStorageInput,
  TrafficLensContinueInput,
  TrafficLensCookieEntry,
  TrafficLensDeleteCookieForOriginInput,
  TrafficLensDeleteCookieInput,
  TrafficLensDeleteLiveSessionStorageItemInput,
  TrafficLensDeleteLocalStorageItemInput,
  TrafficLensDeleteStorageEntryInput,
  TrafficLensDomStorageEntry,
  TrafficLensGetApplicableCookiesInput,
  TrafficLensGetLiveSessionStorageInput,
  TrafficLensGetLocalStorageInput,
  TrafficLensGetSessionStorageSnapshotInput,
  TrafficLensOverride,
  TrafficLensOverrideInput,
  TrafficLensPausedEvent,
  TrafficLensPausedRequest,
  TrafficLensProfile,
  TrafficLensProfileInput,
  TrafficLensRehydrateSessionStorageSnapshotInput,
  TrafficLensRule,
  TrafficLensRuleInput,
  TrafficLensSetCookieForOriginInput,
  TrafficLensSetCookieInput,
  TrafficLensSetTabMobilePresetInput,
  TrafficLensSetTabViewModeInput,
  TrafficLensSetLiveSessionStorageItemInput,
  TrafficLensSetLocalStorageItemInput,
  TrafficLensSetStorageEntryInput,
  TrafficLensStorageEvent,
  TrafficLensStorageIngestPayload,
  TrafficLensStorageOriginSummary,
  TrafficLensStorageEntry,
  TrafficLensMobilePreset,
  TrafficLensTabEvent,
  TrafficLensTabSnapshot,
  TrafficLensUpdateSessionStorageSnapshotInput,
  TrafficLensViewMode,
} from "@fenrir/contracts";
import {
  addLiveSessionTab,
  listStorageOriginSummaries,
  removeLiveSessionTab,
  storageOriginCatalogKey,
  type StorageOriginCatalogEntry,
  upsertStorageOriginCatalogEntry,
} from "./trafficLens/storageCatalog";
import { buildCookieSnapshot, buildDomStorageSnapshot } from "./trafficLens/storageSnapshot";
import { scriptLiteral, toOriginUrl } from "./trafficLens/storageMutation";
import { createStorageUtilityTarget } from "./trafficLens/storageUtilityTarget";
import { normalizeBrowserNavigationUrl } from "./browserNavigation";

export interface TrafficLensManagerConfig {
  window: BrowserWindow;
  backendHttpUrl?: string;
  bootstrapToken?: string;
  onSidebarToggleShortcut?: () => void;
  tabSessionPath?: string;
}

export interface TrafficLensManager {
  getActiveTab(): TrafficLensTabSnapshot | null;
  ensureActiveTab(url?: string): TrafficLensTabSnapshot;
  setActiveTab(tabId: string): TrafficLensTabSnapshot;
  createTab(url?: string): TrafficLensTabSnapshot;
  createTabInProfile(input: { url?: string; profileId: string }): TrafficLensTabSnapshot;
  navigateTab(tabId: string, url: string): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reloadTab(tabId: string): void;
  closeTab(tabId: string): void;
  setTabViewMode(input: TrafficLensSetTabViewModeInput): TrafficLensTabSnapshot;
  setTabMobilePreset(input: TrafficLensSetTabMobilePresetInput): TrafficLensTabSnapshot;
  setTabBounds(
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void;
  showTab(tabId: string): void;
  hideAllTabs(): void;
  getTabs(): TrafficLensTabSnapshot[];
  capturePageSnapshot(tabId?: string): Promise<unknown>;
  captureScreenshot(tabId?: string): Promise<{ data: string; mimeType: string }>;
  clickPage(input: { tabId?: string; x?: number; y?: number; selector?: string }): Promise<void>;
  typeIntoPage(input: { tabId?: string; text: string; selector?: string }): Promise<void>;
  pressPage(input: { tabId?: string; key: string }): Promise<void>;
  waitForTabLoad(input?: { tabId?: string; timeoutMs?: number }): Promise<TrafficLensTabSnapshot>;
  listRules(): readonly TrafficLensRule[];
  createRule(input: TrafficLensRuleInput): TrafficLensRule;
  updateRule(id: string, input: TrafficLensRuleInput): TrafficLensRule;
  deleteRule(id: string): void;
  setRuleEnabled(id: string, enabled: boolean): void;
  listPaused(): readonly TrafficLensPausedRequest[];
  continuePaused(input: TrafficLensContinueInput): Promise<void>;
  dropPaused(input: { pauseId: string }): Promise<void>;
  listProfiles(): readonly TrafficLensProfile[];
  createProfile(input: TrafficLensProfileInput): TrafficLensProfile;
  updateProfile(id: string, input: TrafficLensProfileInput): TrafficLensProfile;
  deleteProfile(id: string): void;
  getCookies(tabId: string): Promise<readonly TrafficLensCookieEntry[]>;
  setCookie(input: TrafficLensSetCookieInput): Promise<void>;
  deleteCookie(input: TrafficLensDeleteCookieInput): Promise<void>;
  getStorage(tabId: string): Promise<readonly TrafficLensStorageEntry[]>;
  setStorageEntry(input: TrafficLensSetStorageEntryInput): Promise<void>;
  deleteStorageEntry(input: TrafficLensDeleteStorageEntryInput): Promise<void>;
  listStorageOrigins(profileId: string): readonly TrafficLensStorageOriginSummary[];
  captureStorageOrigin(input: TrafficLensCaptureStorageOriginInput): Promise<void>;
  getApplicableCookies(
    input: TrafficLensGetApplicableCookiesInput,
  ): Promise<readonly TrafficLensCookieEntry[]>;
  setCookieForOrigin(input: TrafficLensSetCookieForOriginInput): Promise<void>;
  deleteCookieForOrigin(input: TrafficLensDeleteCookieForOriginInput): Promise<void>;
  getLocalStorage(
    input: TrafficLensGetLocalStorageInput,
  ): Promise<readonly TrafficLensDomStorageEntry[]>;
  setLocalStorageItem(input: TrafficLensSetLocalStorageItemInput): Promise<void>;
  deleteLocalStorageItem(input: TrafficLensDeleteLocalStorageItemInput): Promise<void>;
  clearLocalStorage(input: TrafficLensClearLocalStorageInput): Promise<void>;
  getLiveSessionStorage(
    input: TrafficLensGetLiveSessionStorageInput,
  ): Promise<readonly TrafficLensDomStorageEntry[]>;
  setLiveSessionStorageItem(input: TrafficLensSetLiveSessionStorageItemInput): Promise<void>;
  deleteLiveSessionStorageItem(input: TrafficLensDeleteLiveSessionStorageItemInput): Promise<void>;
  clearLiveSessionStorage(input: TrafficLensClearLiveSessionStorageInput): Promise<void>;
  listSessionStorageSnapshots(
    profileId: string,
    origin: string,
  ): readonly TrafficLensArchivedSessionStorageSummary[];
  getSessionStorageSnapshot(
    input: TrafficLensGetSessionStorageSnapshotInput,
  ): readonly TrafficLensDomStorageEntry[];
  updateSessionStorageSnapshot(input: TrafficLensUpdateSessionStorageSnapshotInput): void;
  rehydrateSessionStorageSnapshot(
    input: TrafficLensRehydrateSessionStorageSnapshotInput,
  ): Promise<{ tabId: string }>;
  listOverrides(): readonly TrafficLensOverride[];
  createOverride(input: TrafficLensOverrideInput): TrafficLensOverride;
  updateOverride(id: string, input: TrafficLensOverrideInput): TrafficLensOverride;
  deleteOverride(id: string): void;
  setOverrideEnabled(id: string, enabled: boolean): void;
  onTabEvent(listener: (event: TrafficLensTabEvent) => void): () => void;
  onPausedEvent(listener: (event: TrafficLensPausedEvent) => void): () => void;
  onStorageChanged(listener: (tabId: string) => void): () => void;
  onStorageEvent(listener: (event: TrafficLensStorageEvent) => void): () => void;
  stop(): void;
}

interface TabEntry {
  view: WebContentsView;
  tabId: string;
  profileId: string;
  viewMode: TrafficLensViewMode;
  mobilePreset: TrafficLensMobilePreset;
  lastKnownUrl: string;
  bounds: TrafficLensViewBounds | null;
  viewAttached: boolean;
  viewportOverrideActive: boolean;
}

interface TrafficLensViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PersistedTrafficLensProfile {
  readonly id: string;
  readonly name: string;
  readonly partitionKey: string;
  readonly userAgentPreset?: string;
  readonly proxyPreset?: string | null;
  readonly notes?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PersistedTrafficLensTab {
  readonly tabId: string;
  readonly url: string;
  readonly profile: PersistedTrafficLensProfile;
  readonly viewMode: TrafficLensViewMode;
  readonly mobilePreset: TrafficLensMobilePreset;
}

interface PersistedTrafficLensTabSession {
  readonly version: 1;
  readonly activeTabId: string | null;
  readonly tabs: readonly PersistedTrafficLensTab[];
}

interface RequestContext {
  tabId: string;
  profileId: string;
  requestId: string;
  networkId: string;
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  resourceType?: string;
  body: string | null;
}

interface ResponseContext extends RequestContext {
  statusCode: number;
  responseHeaders: Record<string, string>;
}

interface PausedRequestInternal {
  snapshot: TrafficLensPausedRequest;
  debugger: Electron.Debugger;
  phase: "beforeRequest" | "beforeResponse";
  requestId: string;
}

interface ArchivedSessionSnapshotInternal {
  summary: TrafficLensArchivedSessionStorageSummary;
  entries: TrafficLensDomStorageEntry[];
}

const MAX_CAPTURE_BODY_BYTES = 10 * 1024 * 1024; // 10MB
const CDP_BODY_READ_TIMEOUT_MS = 500;
const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";
const DEFAULT_PROFILE_PARTITION_KEY = "persist:traffic-lens:default";
const DEFAULT_MOBILE_PRESET: TrafficLensMobilePreset = "iphone-15-pro";
const BROWSER_LAB_TYPE_CHUNK_SIZE = 3;
const DEFAULT_BROWSER_LAB_DESKTOP_CAPTURE_BOUNDS: TrafficLensViewBounds = {
  x: 0,
  y: 0,
  width: 1280,
  height: 720,
};
const BROWSER_LAB_MOBILE_CAPTURE_BOUNDS: Record<
  TrafficLensMobilePreset,
  Pick<TrafficLensViewBounds, "width" | "height">
> = {
  "iphone-15-pro": { width: 390, height: 844 },
  "pixel-8": { width: 412, height: 760 },
  "ipad-mini": { width: 744, height: 940 },
};
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
const MOBILE_USER_AGENTS: Record<TrafficLensMobilePreset, string> = {
  "iphone-15-pro":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "pixel-8":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36",
  "ipad-mini":
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

function isTrafficLensViewMode(value: unknown): value is TrafficLensViewMode {
  return value === "desktop" || value === "mobile";
}

function isTrafficLensMobilePreset(value: unknown): value is TrafficLensMobilePreset {
  return value === "iphone-15-pro" || value === "pixel-8" || value === "ipad-mini";
}

function normalizeTrafficLensViewBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): TrafficLensViewBounds | null {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 1 ||
    bounds.height < 1
  ) {
    return null;
  }

  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

function getBrowserLabCaptureBounds(entry: TabEntry): TrafficLensViewBounds {
  if (entry.bounds) {
    return entry.bounds;
  }

  if (entry.viewMode === "mobile") {
    const preset = BROWSER_LAB_MOBILE_CAPTURE_BOUNDS[entry.mobilePreset];
    return { x: 0, y: 0, width: preset.width, height: preset.height };
  }

  return DEFAULT_BROWSER_LAB_DESKTOP_CAPTURE_BOUNDS;
}

async function applyBrowserLabCaptureViewport(
  entry: TabEntry,
  bounds: TrafficLensViewBounds,
): Promise<void> {
  entry.view.setBounds(bounds);
  if (entry.viewAttached && entry.bounds) {
    clearBrowserLabCaptureViewportOverride(entry);
    return;
  }

  await setBrowserLabCaptureViewportOverride(entry, bounds);
}

async function setBrowserLabCaptureViewportOverride(
  entry: TabEntry,
  bounds: TrafficLensViewBounds,
): Promise<void> {
  try {
    await entry.view.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: bounds.width,
      height: bounds.height,
      deviceScaleFactor: 1,
      mobile: entry.viewMode === "mobile",
    });
    entry.viewportOverrideActive = true;
  } catch {
    // Bounds still give Electron a valid target when DevTools emulation is unavailable.
  }
}

function clearBrowserLabCaptureViewportOverride(entry: TabEntry): void {
  if (!entry.viewportOverrideActive) {
    return;
  }
  entry.viewportOverrideActive = false;
  try {
    void Promise.resolve(
      entry.view.webContents.debugger.sendCommand("Emulation.clearDeviceMetricsOverride"),
    ).catch(() => {
      // A failed cleanup is non-fatal; the next valid bounds update will retry normal layout.
    });
  } catch {
    // A failed cleanup is non-fatal; the next valid bounds update will retry normal layout.
  }
}

async function captureBrowserLabScreenshotWithDevTools(
  entry: TabEntry,
  bounds: TrafficLensViewBounds,
): Promise<string> {
  entry.view.setBounds(bounds);
  await setBrowserLabCaptureViewportOverride(entry, bounds);
  await Promise.resolve(entry.view.webContents.debugger.sendCommand("Page.enable")).catch(
    () => undefined,
  );
  const result = await entry.view.webContents.debugger.sendCommand("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (
    !result ||
    typeof result !== "object" ||
    typeof (result as { data?: unknown }).data !== "string"
  ) {
    throw new Error("Browser Lab screenshot fallback returned an invalid result.");
  }
  return (result as { data: string }).data;
}

interface BrowserLabTypingState {
  ok: boolean;
  error?: string;
  kind?: "form-field" | "contenteditable";
  value?: string;
  text?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  valid?: boolean;
  validationMessage?: string;
}

function splitTypingChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += BROWSER_LAB_TYPE_CHUNK_SIZE) {
    chunks.push(text.slice(index, index + BROWSER_LAB_TYPE_CHUNK_SIZE));
  }
  return chunks;
}

function browserLabTypingStateScript(selector?: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector ?? null)};
    const readState = (target) => {
      if (!target || target === document.body || target === document.documentElement) {
        return { ok: false, error: "No editable element is focused. Click the input before typing." };
      }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.disabled) {
          return { ok: false, error: "Focused input is disabled." };
        }
        if (target.readOnly) {
          return { ok: false, error: "Focused input is read-only." };
        }
        let selectionStart = null;
        let selectionEnd = null;
        try {
          selectionStart = target.selectionStart;
          selectionEnd = target.selectionEnd;
        } catch {
          selectionStart = null;
          selectionEnd = null;
        }
        return {
          ok: true,
          kind: "form-field",
          value: target.value,
          selectionStart,
          selectionEnd,
          valid: target.validity ? target.validity.valid : true,
          validationMessage: target.validationMessage || "",
        };
      }
      if (target.isContentEditable) {
        return {
          ok: true,
          kind: "contenteditable",
          text: target.textContent || "",
          valid: true,
          validationMessage: "",
        };
      }
      return { ok: false, error: "Focused element is not editable." };
    };

    const active = document.activeElement;
    if (selector) {
      const selected = document.querySelector(selector);
      if (!selected) {
        return { ok: false, error: "Selector not found: " + selector };
      }
      if (active !== selected && !selected.contains(active)) {
        return {
          ok: false,
          error: "Active element does not match selector: " + selector + ". Browser Lab will not move focus; click the input first.",
        };
      }
    }

    if (!window.__fenrirBrowserLabTypingTarget) {
      window.__fenrirBrowserLabTypingTarget = active;
    }

    if (document.activeElement !== window.__fenrirBrowserLabTypingTarget) {
      return { ok: false, error: "Focused element changed while typing. Browser Lab will not move focus." };
    }

    return readState(window.__fenrirBrowserLabTypingTarget);
  })()`;
}

function requireBrowserLabTypingState(value: unknown): BrowserLabTypingState {
  if (!value || typeof value !== "object") {
    throw new Error("Browser Lab could not inspect the focused input.");
  }
  const state = value as BrowserLabTypingState;
  if (!state.ok) {
    throw new Error(state.error ?? "Browser Lab could not type into the focused input.");
  }
  return state;
}

function expectedFormFieldValueAfterChunk(state: BrowserLabTypingState, chunk: string) {
  if (
    state.kind !== "form-field" ||
    typeof state.value !== "string" ||
    typeof state.selectionStart !== "number" ||
    typeof state.selectionEnd !== "number"
  ) {
    return null;
  }
  return `${state.value.slice(0, state.selectionStart)}${chunk}${state.value.slice(
    state.selectionEnd,
  )}`;
}

function validateTypingChunk(input: {
  before: BrowserLabTypingState;
  after: BrowserLabTypingState;
  chunk: string;
}): void {
  const expectedValue = expectedFormFieldValueAfterChunk(input.before, input.chunk);
  if (
    expectedValue !== null &&
    input.after.kind === "form-field" &&
    input.after.value !== expectedValue
  ) {
    throw new Error(
      `Focused input did not accept typed text. Expected value after chunk '${input.chunk}' to be '${expectedValue}', got '${input.after.value ?? ""}'.`,
    );
  }

  if (
    expectedValue === null &&
    input.before.kind === "form-field" &&
    input.after.kind === "form-field" &&
    input.before.value === input.after.value
  ) {
    throw new Error(`Focused input did not accept typed text chunk '${input.chunk}'.`);
  }

  if (
    input.before.kind === "contenteditable" &&
    input.after.kind === "contenteditable" &&
    input.before.text === input.after.text
  ) {
    throw new Error(`Focused editor did not accept typed text chunk '${input.chunk}'.`);
  }

  if (input.after.valid === false) {
    throw new Error(
      input.after.validationMessage
        ? `Focused input is invalid: ${input.after.validationMessage}`
        : "Focused input is invalid.",
    );
  }
}

function readJsonFile(filePath: string): unknown {
  try {
    if (!FS.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(FS.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const directory = Path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

function toPersistedProfile(profile: TrafficLensProfile): PersistedTrafficLensProfile {
  return {
    id: profile.id,
    name: profile.name,
    partitionKey: profile.partitionKey,
    ...(profile.userAgentPreset ? { userAgentPreset: profile.userAgentPreset } : {}),
    ...(profile.proxyPreset !== undefined ? { proxyPreset: profile.proxyPreset } : {}),
    ...(profile.notes !== undefined ? { notes: profile.notes } : {}),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function decodePersistedProfile(value: unknown): PersistedTrafficLensProfile | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.partitionKey !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    partitionKey: candidate.partitionKey,
    ...(typeof candidate.userAgentPreset === "string"
      ? { userAgentPreset: candidate.userAgentPreset }
      : {}),
    ...(candidate.proxyPreset === null || typeof candidate.proxyPreset === "string"
      ? { proxyPreset: candidate.proxyPreset }
      : {}),
    ...(candidate.notes === null || typeof candidate.notes === "string"
      ? { notes: candidate.notes }
      : {}),
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function decodePersistedTabSession(filePath: string): PersistedTrafficLensTabSession | null {
  const parsed = readJsonFile(filePath);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.tabs)) {
    return null;
  }

  const tabs = candidate.tabs.flatMap((rawTab): PersistedTrafficLensTab[] => {
    if (typeof rawTab !== "object" || rawTab === null) {
      return [];
    }
    const tab = rawTab as Record<string, unknown>;
    const profile = decodePersistedProfile(tab.profile);
    if (
      typeof tab.tabId !== "string" ||
      typeof tab.url !== "string" ||
      !profile ||
      !isTrafficLensViewMode(tab.viewMode) ||
      !isTrafficLensMobilePreset(tab.mobilePreset)
    ) {
      return [];
    }
    return [
      {
        tabId: tab.tabId,
        url: tab.url,
        profile,
        viewMode: tab.viewMode,
        mobilePreset: tab.mobilePreset,
      },
    ];
  });

  return {
    version: 1,
    activeTabId: typeof candidate.activeTabId === "string" ? candidate.activeTabId : null,
    tabs,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeHeaders(
  rawHeaders: Record<string, unknown> | Array<{ name: string; value: string }> | undefined,
): Record<string, string> {
  if (!rawHeaders) {
    return {};
  }

  if (Array.isArray(rawHeaders)) {
    return Object.fromEntries(rawHeaders.map((header) => [header.name, header.value]));
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    headers[key] = typeof value === "string" ? value : String(value);
  }
  return headers;
}

function toCdpHeaders(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function wildcardMatches(pattern: string | undefined, value: string): boolean {
  if (!pattern) {
    return true;
  }

  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function mergeHeaders(
  current: Record<string, string>,
  setHeaders: Record<string, string>,
  removeHeaders: readonly string[],
): Record<string, string> {
  const next = { ...current };
  for (const key of removeHeaders) {
    const lowerKey = key.toLowerCase();
    for (const existingKey of Object.keys(next)) {
      if (existingKey.toLowerCase() === lowerKey) {
        delete next[existingKey];
      }
    }
  }
  for (const [key, value] of Object.entries(setHeaders)) {
    next[key] = value;
  }
  return next;
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    return new URL(isHttpUrl(value) ? value : `http://${value}`);
  }
}

function isSidebarToggleInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown") {
    return false;
  }

  const key = input.key.toLowerCase();
  const isModPressed = process.platform === "darwin" ? input.meta : input.control;
  const isOtherModPressed = process.platform === "darwin" ? input.control : input.meta;
  return key === "b" && isModPressed && !isOtherModPressed && !input.alt && !input.shift;
}

export function createTrafficLensManager(config: TrafficLensManagerConfig): TrafficLensManager {
  const parentWindow = config.window;
  const activeTabs = new Map<string, TabEntry>();
  const pausedRequests = new Map<string, PausedRequestInternal>();
  const originCatalog = new Map<string, StorageOriginCatalogEntry>();
  const utilityTargets = new Map<string, WebContentsView>();
  const archivedSessionSnapshots = new Map<number, ArchivedSessionSnapshotInternal>();
  let nextArchivedSessionSnapshotId = 1;
  const configuredSessions = new Set<string>();
  const profileSessions = new Map<string, Session>();
  const rules = new Map<string, TrafficLensRule>();
  const overrides = new Map<string, TrafficLensOverride>();
  const profiles = new Map<string, TrafficLensProfile>();
  let activeTabId: string | null = null;
  let tabListeners: Array<(event: TrafficLensTabEvent) => void> = [];
  let pausedListeners: Array<(event: TrafficLensPausedEvent) => void> = [];
  let storageListeners: Array<(tabId: string) => void> = [];
  let storageEventListeners: Array<(event: TrafficLensStorageEvent) => void> = [];
  const backendUrl = config.backendHttpUrl ?? "";
  const backendToken = config.bootstrapToken ?? "";
  const tabSessionPath = config.tabSessionPath;

  const defaultProfile: TrafficLensProfile = {
    id: DEFAULT_PROFILE_ID as any,
    name: DEFAULT_PROFILE_NAME,
    partitionKey: DEFAULT_PROFILE_PARTITION_KEY,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  profiles.set(defaultProfile.id, defaultProfile);

  function emitTab(event: TrafficLensTabEvent): void {
    for (const listener of tabListeners) {
      try {
        listener(event);
      } catch {
        // listener errors must not crash the manager
      }
    }
  }

  function emitPaused(event: TrafficLensPausedEvent): void {
    for (const listener of pausedListeners) {
      try {
        listener(event);
      } catch {
        // listener errors must not crash the manager
      }
    }
  }

  function emitStorage(tabId: string): void {
    for (const listener of storageListeners) {
      try {
        listener(tabId);
      } catch {
        // listener errors must not crash the manager
      }
    }
  }

  function emitStorageEvent(event: TrafficLensStorageEvent): void {
    for (const listener of storageEventListeners) {
      try {
        listener(event);
      } catch {
        // listener errors must not crash the manager
      }
    }
  }

  function getProfile(profileId: string): TrafficLensProfile {
    return profiles.get(profileId) ?? defaultProfile;
  }

  function getEffectiveUserAgent(entry: TabEntry): string {
    if (entry.viewMode === "mobile") {
      return MOBILE_USER_AGENTS[entry.mobilePreset];
    }
    const profile = getProfile(entry.profileId);
    return profile.userAgentPreset ?? DESKTOP_USER_AGENT;
  }

  function ensureSession(profileId: string): Session {
    const profile = getProfile(profileId);
    const existing = profileSessions.get(profile.id);
    if (existing) {
      return existing;
    }

    const targetSession = session.fromPartition(profile.partitionKey);
    profileSessions.set(profile.id, targetSession);

    if (!configuredSessions.has(profile.partitionKey)) {
      configuredSessions.add(profile.partitionKey);
      targetSession.setCertificateVerifyProc((_request, callback) => {
        callback(0);
      });
      targetSession.setUserAgent(profile.userAgentPreset ?? DESKTOP_USER_AGENT);
      targetSession.cookies.on?.("changed", (_event, cookie) => {
        const domain = String(cookie.domain ?? "").replace(/^\./, "");
        void Promise.all(
          [...originCatalog.values()]
            .filter(
              (entry) =>
                entry.profileId === profile.id &&
                entry.origin.includes(domain) &&
                entry.origin !== "null",
            )
            .map((entry) =>
              persistCookieSnapshot(
                entry.profileId,
                entry.origin,
                "mutation",
                undefined,
                entry.lastDocumentUrl ?? undefined,
              ).then(() =>
                emitStorageEvent({
                  type: "cookies.updated",
                  profileId: entry.profileId as any,
                  origin: entry.origin,
                  areaKind: "cookies",
                  timestamp: nowIso(),
                }),
              ),
            ),
        );
      });
    }

    return targetSession;
  }

  function getTabEntry(tabId: string): TabEntry {
    const entry = activeTabs.get(tabId);
    if (!entry) {
      throw new Error(`Tab not found: ${tabId}`);
    }
    return entry;
  }

  function getTabSnapshot(tabId: string): TrafficLensTabSnapshot {
    const entry = getTabEntry(tabId);
    const profile = getProfile(entry.profileId);
    const wc = entry.view.webContents;
    const currentUrl = wc.getURL();
    return {
      tabId: tabId as any,
      url:
        currentUrl && (currentUrl !== "about:blank" || entry.lastKnownUrl === "about:blank")
          ? currentUrl
          : entry.lastKnownUrl,
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      profileId: profile.id as any,
      profileName: profile.name,
      viewMode: entry.viewMode,
      mobilePreset: entry.mobilePreset,
    };
  }

  function getTabNavigationCapabilities(tabId: string): {
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
  } {
    const wc = getTabEntry(tabId).view.webContents;
    return {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  function getTabsInDisplayOrder(): TrafficLensTabSnapshot[] {
    const snapshots = Array.from(activeTabs.keys()).map(getTabSnapshot);
    if (!activeTabId) {
      return snapshots;
    }
    return snapshots.toSorted((left, right) => {
      if (left.tabId === activeTabId) {
        return -1;
      }
      if (right.tabId === activeTabId) {
        return 1;
      }
      return 0;
    });
  }

  function persistTabSession(): void {
    if (!tabSessionPath) {
      return;
    }

    try {
      writeJsonFile(tabSessionPath, {
        version: 1,
        activeTabId: activeTabId && activeTabs.has(activeTabId) ? activeTabId : null,
        tabs: Array.from(activeTabs.values()).map((entry) => ({
          tabId: entry.tabId,
          url: getTabSnapshot(entry.tabId).url,
          profile: toPersistedProfile(getProfile(entry.profileId)),
          viewMode: entry.viewMode,
          mobilePreset: entry.mobilePreset,
        })),
      } satisfies PersistedTrafficLensTabSession);
    } catch (error) {
      console.error("[trafficLensManager] Could not persist browser lab tabs:", error);
    }
  }

  function getActiveTabEntry(): TabEntry {
    if (activeTabId && activeTabs.has(activeTabId)) {
      return getTabEntry(activeTabId);
    }
    const first = activeTabs.values().next().value as TabEntry | undefined;
    if (first) {
      activeTabId = first.tabId;
      return first;
    }
    const created = createTabForProfile(DEFAULT_PROFILE_ID, "about:blank");
    activeTabId = created.tabId;
    return getTabEntry(created.tabId);
  }

  function selectActiveTab(tabId: string, options?: { emit?: boolean; persist?: boolean }) {
    const snapshot = getTabSnapshot(tabId);
    activeTabId = tabId;
    if (options?.persist !== false) {
      persistTabSession();
    }
    if (options?.emit !== false) {
      emitTab({ type: "tab.selected", tabId: tabId as any });
    }
    return snapshot;
  }

  function resolveTabId(tabId?: string): string {
    return tabId ?? getActiveTabEntry().tabId;
  }

  function noteOrigin(
    profileId: string,
    url: string,
    tabId?: string,
  ): StorageOriginCatalogEntry | null {
    const parsedUrl = parseUrl(url);
    if (parsedUrl.origin === "null") {
      return null;
    }
    const entry = upsertStorageOriginCatalogEntry(originCatalog, {
      profileId,
      origin: parsedUrl.origin,
      lastDocumentUrl: parsedUrl.toString(),
      timestamp: nowIso(),
    });
    if (tabId) {
      addLiveSessionTab(originCatalog, profileId, parsedUrl.origin, tabId);
    }
    emitStorageEvent({
      type: "origin.discovered",
      profileId: profileId as any,
      origin: parsedUrl.origin,
      areaKind: "localStorage",
      ...(tabId ? { tabId } : {}),
      timestamp: entry.lastSeenAt,
    });
    return entry;
  }

  function listOriginsForProfile(profileId: string): readonly TrafficLensStorageOriginSummary[] {
    return listStorageOriginSummaries(originCatalog, profileId);
  }

  async function forwardStorageSnapshot(payload: TrafficLensStorageIngestPayload): Promise<void> {
    if (!backendUrl || !backendToken) {
      return;
    }
    try {
      const response = await fetch(`${backendUrl}/api/traffic-lens/storage/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${backendToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error("[trafficLensManager] Storage snapshot forward rejected:", {
          status: response.status,
          statusText: response.statusText,
          responseBody,
        });
        emitStorageEvent({
          type: "origin.persistenceSyncFailed",
          profileId: payload.profileId,
          origin: payload.origin,
          areaKind: payload.areaKind,
          ...(payload.sourceTabId ? { tabId: payload.sourceTabId } : {}),
          timestamp: nowIso(),
          message: responseBody || response.statusText,
        });
      }
    } catch (error) {
      console.error("[trafficLensManager] Storage snapshot forward failed:", error);
      emitStorageEvent({
        type: "origin.persistenceSyncFailed",
        profileId: payload.profileId,
        origin: payload.origin,
        areaKind: payload.areaKind,
        ...(payload.sourceTabId ? { tabId: payload.sourceTabId } : {}),
        timestamp: nowIso(),
        message: error instanceof Error ? error.message : "Unknown persistence error",
      });
    }
  }

  function findOpenTabForOrigin(
    profileId: string,
    origin: string,
    preferredTabId?: string,
  ): TabEntry | null {
    if (preferredTabId) {
      const preferred = activeTabs.get(preferredTabId);
      if (preferred && preferred.profileId === profileId) {
        const preferredUrl = preferred.view.webContents.getURL();
        if (preferredUrl && parseUrl(preferredUrl).origin === origin) {
          return preferred;
        }
      }
    }

    for (const entry of activeTabs.values()) {
      if (entry.profileId !== profileId) {
        continue;
      }
      const url = entry.view.webContents.getURL();
      if (url && parseUrl(url).origin === origin) {
        return entry;
      }
    }

    return null;
  }

  function resolveUtilityTargetUrl(profileId: string, origin: string): string {
    const catalogEntry = originCatalog.get(storageOriginCatalogKey(profileId, origin));
    if (catalogEntry?.lastDocumentUrl) {
      return catalogEntry.lastDocumentUrl;
    }
    const openTab = findOpenTabForOrigin(profileId, origin);
    if (openTab) {
      return openTab.view.webContents.getURL();
    }
    return toOriginUrl(origin);
  }

  function ensureUtilityTarget(profileId: string): WebContentsView {
    const existing = utilityTargets.get(profileId);
    if (existing) {
      return existing;
    }
    const profile = getProfile(profileId);
    const target = createStorageUtilityTarget(profile.partitionKey);
    utilityTargets.set(profileId, target);
    return target;
  }

  async function executeScriptForOrigin<T>(input: {
    profileId: string;
    origin: string;
    preferredTabId: string | undefined;
    script: string;
    allowUtilityTarget: boolean;
  }): Promise<T> {
    const openTab = findOpenTabForOrigin(input.profileId, input.origin, input.preferredTabId);
    if (openTab) {
      return openTab.view.webContents.executeJavaScript(input.script, true) as Promise<T>;
    }
    if (!input.allowUtilityTarget) {
      throw new Error(`No live tab available for origin ${input.origin}.`);
    }
    const target = ensureUtilityTarget(input.profileId);
    const targetUrl = resolveUtilityTargetUrl(input.profileId, input.origin);
    await target.webContents.loadURL(targetUrl);
    noteOrigin(input.profileId, targetUrl);
    return target.webContents.executeJavaScript(input.script, true) as Promise<T>;
  }

  async function readDomStorageEntries(input: {
    profileId: string;
    origin: string;
    preferredTabId: string | undefined;
    kind: "localStorage" | "sessionStorage";
    allowUtilityTarget: boolean;
  }): Promise<TrafficLensDomStorageEntry[]> {
    const payload = await executeScriptForOrigin<{
      origin: string;
      entries: Array<{ key: string; value: string | null }>;
    }>({
      ...input,
      script: `(() => {
        if (window.location.origin !== ${scriptLiteral(input.origin)}) {
          throw new Error("Storage origin mismatch.");
        }
        const storage = window.${input.kind};
        return {
          origin: window.location.origin,
          entries: Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index);
            return key === null ? null : { key, value: storage.getItem(key) };
          }).filter(Boolean),
        };
      })()`,
    });
    if (payload.origin !== input.origin) {
      throw new Error("Storage origin changed while reading browser state.");
    }
    return payload.entries.map((entry) => ({
      key: entry.key,
      value: entry.value,
    }));
  }

  async function writeDomStorage(input: {
    profileId: string;
    origin: string;
    preferredTabId: string | undefined;
    kind: "localStorage" | "sessionStorage";
    mode: "set" | "delete" | "clear";
    key?: string;
    value?: string;
    allowUtilityTarget: boolean;
  }): Promise<void> {
    const operationScript =
      input.mode === "set"
        ? `window.${input.kind}.setItem(${scriptLiteral(input.key ?? "")}, ${scriptLiteral(input.value ?? "")});`
        : input.mode === "delete"
          ? `window.${input.kind}.removeItem(${scriptLiteral(input.key ?? "")});`
          : `window.${input.kind}.clear();`;
    await executeScriptForOrigin<void>({
      ...input,
      script: `(() => {
        if (window.location.origin !== ${scriptLiteral(input.origin)}) {
          throw new Error("Storage origin mismatch.");
        }
        ${operationScript}
      })()`,
    });
  }

  async function readApplicableCookies(
    profileId: string,
    origin: string,
  ): Promise<readonly TrafficLensCookieEntry[]> {
    const profile = getProfile(profileId);
    const targetSession = ensureSession(profile.id);
    const cookies = await targetSession.cookies.get({
      url: toOriginUrl(origin),
    });
    return cookies.map((cookie) => {
      const entry = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain ?? "",
        path: cookie.path ?? "/",
        secure: cookie.secure ?? false,
        httpOnly: cookie.httpOnly ?? false,
      };
      if (cookie.sameSite) {
        Object.assign(entry, { sameSite: cookie.sameSite });
      }
      if (cookie.expirationDate !== undefined) {
        Object.assign(entry, { expirationDate: cookie.expirationDate });
      }
      if (cookie.session !== undefined) {
        Object.assign(entry, { session: cookie.session });
      }
      if (cookie.hostOnly !== undefined) {
        Object.assign(entry, { hostOnly: cookie.hostOnly });
      }
      return entry;
    });
  }

  async function persistCookieSnapshot(
    profileId: string,
    origin: string,
    reason: TrafficLensStorageIngestPayload["snapshotReason"],
    sourceTabId?: string,
    sourceUrl?: string,
  ): Promise<void> {
    const cookies = await readApplicableCookies(profileId, origin);
    await forwardStorageSnapshot({
      profileId: profileId as any,
      origin,
      areaKind: "cookies",
      scopeKey: "",
      snapshotReason: reason,
      ...(sourceTabId ? { sourceTabId } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      payloadJson: JSON.stringify(buildCookieSnapshot(origin, cookies)),
      capturedAt: nowIso(),
    });
  }

  async function persistLocalStorageSnapshot(
    profileId: string,
    origin: string,
    reason: TrafficLensStorageIngestPayload["snapshotReason"],
    preferredTabId?: string,
    sourceUrl?: string,
  ): Promise<void> {
    const entries = await readDomStorageEntries({
      profileId,
      origin,
      preferredTabId,
      kind: "localStorage",
      allowUtilityTarget: true,
    });
    await forwardStorageSnapshot({
      profileId: profileId as any,
      origin,
      areaKind: "localStorage",
      scopeKey: "",
      snapshotReason: reason,
      ...(preferredTabId ? { sourceTabId: preferredTabId } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      payloadJson: JSON.stringify(buildDomStorageSnapshot(origin, "localStorage", entries)),
      capturedAt: nowIso(),
    });
  }

  async function archiveSessionStorageSnapshot(
    tabId: string,
    reason: TrafficLensStorageIngestPayload["snapshotReason"],
  ): Promise<void> {
    const entry = activeTabs.get(tabId);
    if (!entry) {
      return;
    }
    const sourceUrl = entry.view.webContents.getURL();
    if (!sourceUrl) {
      return;
    }
    const parsedUrl = parseUrl(sourceUrl);
    if (parsedUrl.origin === "null") {
      return;
    }

    const entries = await readDomStorageEntries({
      profileId: entry.profileId,
      origin: parsedUrl.origin,
      preferredTabId: tabId,
      kind: "sessionStorage",
      allowUtilityTarget: false,
    }).catch(() => []);

    const capturedAt = nowIso();
    const snapshotSummary: TrafficLensArchivedSessionStorageSummary = {
      versionId: nextArchivedSessionSnapshotId++,
      profileId: entry.profileId as any,
      origin: parsedUrl.origin,
      sourceTabId: tabId,
      sourceUrl,
      capturedAt,
      snapshotReason: reason,
    };
    archivedSessionSnapshots.set(snapshotSummary.versionId, {
      summary: snapshotSummary,
      entries,
    });

    await forwardStorageSnapshot({
      profileId: entry.profileId as any,
      origin: parsedUrl.origin,
      areaKind: "sessionStorage",
      scopeKey: `tab:${tabId}`,
      snapshotReason: reason,
      sourceTabId: tabId,
      sourceUrl,
      payloadJson: JSON.stringify(
        buildDomStorageSnapshot(parsedUrl.origin, "sessionStorage", entries),
      ),
      capturedAt,
    });

    emitStorageEvent({
      type: "sessionStorage.snapshotCaptured",
      profileId: entry.profileId as any,
      origin: parsedUrl.origin,
      areaKind: "sessionStorage",
      tabId,
      versionId: snapshotSummary.versionId,
      timestamp: capturedAt,
    });
  }

  async function forwardTraffic(payload: {
    tabId: string;
    requestId: string;
    stage: "request" | "response";
    method: string;
    url: string;
    host: string;
    path: string;
    statusCode?: number;
    contentType?: string;
    contentLength?: number;
    requestHeadersJson?: string;
    requestBody?: string | null;
    responseHeadersJson?: string;
    responseBody?: string | null;
    bodyTruncated?: boolean;
    timestamp: string;
  }): Promise<void> {
    if (!backendUrl) {
      return;
    }
    if (!backendToken) {
      console.error("[trafficLensManager] Traffic forward skipped: missing backend auth token.");
      return;
    }
    try {
      const response = await fetch(`${backendUrl}/api/traffic-lens/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${backendToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error("[trafficLensManager] Traffic forward rejected:", {
          status: response.status,
          statusText: response.statusText,
          responseBody,
        });
      }
    } catch (error) {
      console.error("[trafficLensManager] Traffic forward failed:", error);
    }
  }

  async function fulfillMockResponse(
    debuggerClient: Electron.Debugger,
    requestId: string,
    response: TrafficLensOverride["response"],
  ): Promise<void> {
    await debuggerClient.sendCommand("Fetch.fulfillRequest", {
      requestId,
      responseCode: response.statusCode,
      responseHeaders: toCdpHeaders(response.headers),
      body: response.body ?? undefined,
    });
  }

  function scopeMatches(
    scope: TrafficLensRule["scope"] | TrafficLensOverride["match"],
    context: RequestContext | ResponseContext,
  ): boolean {
    if (scope.tabId && scope.tabId !== context.tabId) {
      return false;
    }
    if (scope.profileId && scope.profileId !== context.profileId) {
      return false;
    }
    if (scope.method && scope.method.toUpperCase() !== context.method.toUpperCase()) {
      return false;
    }
    if (scope.resourceType && scope.resourceType !== context.resourceType) {
      return false;
    }
    if (!wildcardMatches(scope.hostPattern, context.host)) {
      return false;
    }
    if (!wildcardMatches(scope.urlPattern, context.url)) {
      return false;
    }
    return true;
  }

  async function pauseRequest(
    internal: PausedRequestInternal,
    snapshot: TrafficLensPausedRequest,
  ): Promise<void> {
    pausedRequests.set(snapshot.pauseId, internal);
    emitPaused({
      type: "paused.created",
      paused: snapshot,
    });
  }

  function removePausedRequest(pauseId: string): void {
    if (!pausedRequests.has(pauseId)) {
      return;
    }
    pausedRequests.delete(pauseId);
    emitPaused({ type: "paused.resolved", pauseId: pauseId as any });
  }

  async function maybeApplyOverride(
    context: RequestContext,
    debuggerClient: Electron.Debugger,
    requestId: string,
  ): Promise<boolean> {
    const match = Array.from(overrides.values()).find(
      (override) => override.enabled && scopeMatches(override.match, context),
    );
    if (!match) {
      return false;
    }

    if (match.latencyMs) {
      await delay(match.latencyMs);
    }

    if (match.offline) {
      await debuggerClient.sendCommand("Fetch.failRequest", {
        requestId,
        errorReason: "InternetDisconnected",
      });
      return true;
    }

    await forwardTraffic({
      tabId: context.tabId,
      requestId: context.networkId,
      stage: "request",
      method: context.method,
      url: context.url,
      host: context.host,
      path: context.path,
      requestHeadersJson: JSON.stringify(context.headers),
      requestBody: context.body,
      timestamp: nowIso(),
    });

    await fulfillMockResponse(debuggerClient, requestId, match.response);

    void forwardTraffic({
      tabId: context.tabId,
      requestId: context.networkId,
      stage: "response",
      method: context.method,
      url: context.url,
      host: context.host,
      path: context.path,
      statusCode: match.response.statusCode,
      responseHeadersJson: JSON.stringify(match.response.headers),
      responseBody: match.response.body,
      bodyTruncated: false,
      timestamp: nowIso(),
      ...((match.response.headers["content-type"] ?? match.response.headers["Content-Type"])
        ? {
            contentType:
              match.response.headers["content-type"] ?? match.response.headers["Content-Type"],
          }
        : {}),
      ...(match.response.body
        ? {
            contentLength: Buffer.byteLength(match.response.body, "base64"),
          }
        : {}),
    });

    return true;
  }

  async function maybeApplyRule(
    phase: "beforeRequest" | "beforeResponse",
    context: RequestContext | ResponseContext,
    debuggerClient: Electron.Debugger,
    requestId: string,
  ): Promise<boolean> {
    const matchingRules = Array.from(rules.values()).filter(
      (rule) => rule.enabled && rule.phase === phase && scopeMatches(rule.scope, context),
    );

    const actionableRule = matchingRules.find((rule) => rule.action !== "observe");
    if (!actionableRule) {
      return false;
    }

    if (actionableRule.action === "drop") {
      await debuggerClient.sendCommand("Fetch.failRequest", {
        requestId,
        errorReason: "Aborted",
      });
      return true;
    }

    if (actionableRule.action === "mockResponse" && phase === "beforeRequest") {
      if (actionableRule.mockResponse) {
        await fulfillMockResponse(debuggerClient, requestId, actionableRule.mockResponse);
        return true;
      }
      return false;
    }

    if (actionableRule.action === "modify") {
      if (phase === "beforeRequest") {
        const nextHeaders = actionableRule.headerMutation
          ? mergeHeaders(
              context.headers,
              actionableRule.headerMutation.set,
              actionableRule.headerMutation.remove,
            )
          : context.headers;
        await debuggerClient.sendCommand("Fetch.continueRequest", {
          requestId,
          url: actionableRule.urlRewrite ?? context.url,
          headers: toCdpHeaders(nextHeaders),
          postData: actionableRule.bodyReplace ?? context.body ?? undefined,
        });
        return true;
      }

      const responseContext = context as ResponseContext;
      const nextHeaders = actionableRule.headerMutation
        ? mergeHeaders(
            responseContext.responseHeaders,
            actionableRule.headerMutation.set,
            actionableRule.headerMutation.remove,
          )
        : responseContext.responseHeaders;
      await debuggerClient.sendCommand("Fetch.continueResponse", {
        requestId,
        responseCode: responseContext.statusCode,
        responseHeaders: toCdpHeaders(nextHeaders),
      });
      return true;
    }

    if (actionableRule.action === "pause") {
      const pausedRequest: TrafficLensPausedRequest = {
        pauseId: randomUUID() as any,
        tabId: context.tabId,
        requestId: context.networkId,
        phase,
        method: context.method,
        url: context.url,
        headers:
          phase === "beforeRequest"
            ? context.headers
            : (context as ResponseContext).responseHeaders,
        body: context.body,
        ...(phase === "beforeResponse"
          ? {
              statusCode: (context as ResponseContext).statusCode,
              responseHeaders: (context as ResponseContext).responseHeaders,
            }
          : {}),
        createdAt: nowIso(),
      };

      await pauseRequest(
        {
          snapshot: pausedRequest,
          debugger: debuggerClient,
          phase,
          requestId,
        },
        pausedRequest,
      );
      return true;
    }

    return false;
  }

  async function handleFetchPaused(
    tabId: string,
    profileId: string,
    debuggerClient: Electron.Debugger,
    params: any,
  ): Promise<void> {
    const { requestId, request, responseStatusCode, responseHeaders } = params;
    const networkId = String(params.networkId ?? requestId);

    try {
      if (responseStatusCode !== undefined) {
        let responseBody: string | null = null;
        let bodyTruncated = false;

        try {
          const bodyResult = await withTimeout(
            debuggerClient.sendCommand("Fetch.getResponseBody", {
              requestId,
            }),
            CDP_BODY_READ_TIMEOUT_MS,
          );
          responseBody = bodyResult.base64Encoded
            ? bodyResult.body
            : Buffer.from(bodyResult.body).toString("base64");
          const bodyBytes = Buffer.byteLength(
            bodyResult.body,
            bodyResult.base64Encoded ? "base64" : "utf-8",
          );
          if (responseBody && bodyBytes > MAX_CAPTURE_BODY_BYTES) {
            responseBody = responseBody.slice(0, MAX_CAPTURE_BODY_BYTES);
            bodyTruncated = true;
          }
        } catch {
          // body not always available (streaming, redirect, opaque response)
        }

        const parsedUrl = parseUrl(request.url);
        const normalizedResponseHeaders = normalizeHeaders(responseHeaders);
        const responseContext: ResponseContext = {
          tabId,
          profileId,
          requestId: String(requestId),
          networkId,
          method: request.method,
          url: request.url,
          host: parsedUrl.host,
          path: parsedUrl.pathname + parsedUrl.search,
          headers: normalizeHeaders(request.headers),
          body: responseBody,
          statusCode: responseStatusCode,
          responseHeaders: normalizedResponseHeaders,
        };

        void forwardTraffic({
          tabId,
          requestId: networkId,
          stage: "response",
          method: responseContext.method,
          url: responseContext.url,
          host: responseContext.host,
          path: responseContext.path,
          statusCode: responseStatusCode,
          responseHeadersJson: JSON.stringify(normalizedResponseHeaders),
          responseBody,
          bodyTruncated,
          timestamp: nowIso(),
          ...((normalizedResponseHeaders["content-type"] ??
          normalizedResponseHeaders["Content-Type"])
            ? {
                contentType:
                  normalizedResponseHeaders["content-type"] ??
                  normalizedResponseHeaders["Content-Type"],
              }
            : {}),
          ...(normalizedResponseHeaders["content-length"]
            ? {
                contentLength: parseInt(normalizedResponseHeaders["content-length"]!, 10),
              }
            : {}),
        });

        if (
          await maybeApplyRule("beforeResponse", responseContext, debuggerClient, String(requestId))
        ) {
          return;
        }

        await debuggerClient.sendCommand("Fetch.continueResponse", {
          requestId,
        });
        return;
      }

      let requestBody: string | null = null;
      if (request.hasPostData) {
        try {
          const postData = await withTimeout(
            debuggerClient.sendCommand("Fetch.getRequestPostData", {
              requestId,
            }),
            CDP_BODY_READ_TIMEOUT_MS,
          );
          requestBody = Buffer.from(postData.postData).toString("base64");
        } catch {
          // POST data is not always available
        }
      }

      const parsedUrl = parseUrl(request.url);
      const requestContext: RequestContext = {
        tabId,
        profileId,
        requestId: String(requestId),
        networkId,
        method: request.method,
        url: request.url,
        host: parsedUrl.host,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: normalizeHeaders(request.headers),
        resourceType: params.resourceType,
        body: requestBody,
      };

      if (await maybeApplyOverride(requestContext, debuggerClient, String(requestId))) {
        return;
      }

      void forwardTraffic({
        tabId,
        requestId: networkId,
        stage: "request",
        method: requestContext.method,
        url: requestContext.url,
        host: requestContext.host,
        path: requestContext.path,
        requestHeadersJson: JSON.stringify(requestContext.headers),
        requestBody,
        timestamp: nowIso(),
      });

      if (
        await maybeApplyRule("beforeRequest", requestContext, debuggerClient, String(requestId))
      ) {
        return;
      }

      await debuggerClient.sendCommand("Fetch.continueRequest", { requestId });
    } catch (error) {
      try {
        if (responseStatusCode !== undefined) {
          await debuggerClient.sendCommand("Fetch.continueResponse", {
            requestId,
          });
        } else {
          await debuggerClient.sendCommand("Fetch.continueRequest", {
            requestId,
          });
        }
      } catch {
        // debugger might be detached
      }
      console.error("[trafficLensManager] handleFetchPaused error:", error);
    }
  }

  function wireWebContents(entry: TabEntry): void {
    const wc = entry.view.webContents;
    const tabId = entry.tabId;

    wc.on("before-input-event", (event, input) => {
      if (!isSidebarToggleInput(input)) {
        return;
      }

      event.preventDefault();
      config.onSidebarToggleShortcut?.();
    });

    wc.setWindowOpenHandler(({ url }) => {
      createTabForProfile(entry.profileId, url);
      return { action: "deny" };
    });

    wc.on("will-navigate", () => {
      void archiveSessionStorageSnapshot(tabId, "navigation");
    });

    wc.on("did-navigate", (_event, navUrl) => {
      entry.lastKnownUrl = navUrl;
      noteOrigin(entry.profileId, navUrl, tabId);
      emitTab({
        type: "tab.navigated",
        tabId: tabId as any,
        url: navUrl,
        ...getTabNavigationCapabilities(tabId),
      });
      persistTabSession();
    });

    wc.on("did-navigate-in-page", (_event, navUrl) => {
      entry.lastKnownUrl = navUrl;
      noteOrigin(entry.profileId, navUrl, tabId);
      emitTab({
        type: "tab.navigated",
        tabId: tabId as any,
        url: navUrl,
        ...getTabNavigationCapabilities(tabId),
      });
      persistTabSession();
    });

    wc.on("page-title-updated", (_event, title) => {
      emitTab({
        type: "tab.titleUpdated",
        tabId: tabId as any,
        title,
      });
    });

    wc.on("did-start-loading", () => {
      emitTab({
        type: "tab.loadingChanged",
        tabId: tabId as any,
        loading: true,
        ...getTabNavigationCapabilities(tabId),
      });
    });

    wc.on("did-stop-loading", () => {
      const currentUrl = wc.getURL();
      if (currentUrl) {
        entry.lastKnownUrl = currentUrl;
        const catalogEntry = noteOrigin(entry.profileId, currentUrl, tabId);
        if (catalogEntry) {
          void persistCookieSnapshot(
            entry.profileId,
            catalogEntry.origin,
            "navigation",
            tabId,
            currentUrl,
          );
          void persistLocalStorageSnapshot(
            entry.profileId,
            catalogEntry.origin,
            "navigation",
            tabId,
            currentUrl,
          );
        }
      }
      emitTab({
        type: "tab.loadingChanged",
        tabId: tabId as any,
        loading: false,
        ...getTabNavigationCapabilities(tabId),
      });
      persistTabSession();
    });

    const debuggerClient = wc.debugger;
    try {
      debuggerClient.attach("1.3");
      void debuggerClient.sendCommand("Fetch.enable", {
        patterns: [
          { urlPattern: "*", requestStage: "Request" },
          { urlPattern: "*", requestStage: "Response" },
        ],
        handleAuthRequests: true,
      });

      debuggerClient.on("message", (_event: Electron.Event, method: string, params: any) => {
        if (method === "Fetch.requestPaused") {
          void handleFetchPaused(entry.tabId, entry.profileId, debuggerClient, params);
        }
      });
    } catch (error) {
      console.error("[trafficLensManager] Debugger attach failed:", error);
    }
  }

  function createTabForProfile(
    profileId: string,
    url?: string,
    options?: {
      readonly tabId?: string;
      readonly viewMode?: TrafficLensViewMode;
      readonly mobilePreset?: TrafficLensMobilePreset;
      readonly persist?: boolean;
    },
  ): TrafficLensTabSnapshot {
    const profile = getProfile(profileId);
    ensureSession(profile.id);
    const tabId = options?.tabId ?? randomUUID();
    const initialUrl = normalizeBrowserNavigationUrl(url || "about:blank");
    const view = new WebContentsView({
      webPreferences: {
        partition: profile.partitionKey,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    const entry: TabEntry = {
      view,
      tabId,
      profileId: profile.id,
      viewMode: options?.viewMode ?? "desktop",
      mobilePreset: options?.mobilePreset ?? DEFAULT_MOBILE_PRESET,
      lastKnownUrl: initialUrl,
      bounds: null,
      viewAttached: false,
      viewportOverrideActive: false,
    };
    activeTabs.set(tabId, entry);
    activeTabId = tabId;
    view.webContents.setUserAgent(getEffectiveUserAgent(entry));
    wireWebContents(entry);
    void view.webContents.loadURL(initialUrl);
    const snapshot = getTabSnapshot(tabId);
    emitTab({ type: "tab.created", snapshot });
    if (options?.persist !== false) {
      persistTabSession();
    }
    return snapshot;
  }

  function restorePersistedTabSession(): void {
    if (!tabSessionPath) {
      return;
    }

    const persisted = decodePersistedTabSession(tabSessionPath);
    if (!persisted || persisted.tabs.length === 0) {
      return;
    }

    for (const tab of persisted.tabs) {
      profiles.set(tab.profile.id as any, {
        id: tab.profile.id as any,
        name: tab.profile.name,
        partitionKey: tab.profile.partitionKey,
        ...(tab.profile.userAgentPreset ? { userAgentPreset: tab.profile.userAgentPreset } : {}),
        ...(tab.profile.proxyPreset !== undefined ? { proxyPreset: tab.profile.proxyPreset } : {}),
        ...(tab.profile.notes !== undefined ? { notes: tab.profile.notes } : {}),
        createdAt: tab.profile.createdAt,
        updatedAt: tab.profile.updatedAt,
      });
    }

    for (const tab of persisted.tabs) {
      try {
        createTabForProfile(tab.profile.id, tab.url, {
          tabId: tab.tabId,
          viewMode: tab.viewMode,
          mobilePreset: tab.mobilePreset,
          persist: false,
        });
      } catch (error) {
        console.error("[trafficLensManager] Could not restore browser lab tab:", error);
      }
    }

    if (persisted.activeTabId && activeTabs.has(persisted.activeTabId)) {
      activeTabId = persisted.activeTabId;
    }
    persistTabSession();
  }

  async function runStorageScript<T>(tabId: string, script: string): Promise<T> {
    const entry = getTabEntry(tabId);
    return entry.view.webContents.executeJavaScript(script, true) as Promise<T>;
  }

  function getOriginForTab(tabId: string): string {
    const url = getTabEntry(tabId).view.webContents.getURL();
    const parsedUrl = parseUrl(url || "about:blank");
    return parsedUrl.origin;
  }

  async function getStorage(tabId: string): Promise<readonly TrafficLensStorageEntry[]> {
    const origin = getOriginForTab(tabId);
    if (origin === "null") {
      return [];
    }

    const payload = await runStorageScript<{
      origin: string;
      localStorage: Array<{ key: string; value: string | null }>;
      sessionStorage: Array<{ key: string; value: string | null }>;
      indexedDb: Array<{ key: string; value: string | null }>;
    }>(
      tabId,
      `(() => {
        const collect = (storage) =>
          Array.from({ length: storage.length }, (_, index) => {
            const key = storage.key(index);
            return key === null ? null : { key, value: storage.getItem(key) };
          }).filter(Boolean);
        const indexedDbEntries = typeof indexedDB.databases === "function"
          ? indexedDB.databases().then((dbs) =>
              dbs.map((db) => ({
                key: db.name ?? "unnamed",
                value: db.version === undefined ? null : String(db.version),
              })),
            )
          : Promise.resolve([]);
        return indexedDbEntries.then((indexedDbList) => ({
          origin: window.location.origin,
          localStorage: collect(window.localStorage),
          sessionStorage: collect(window.sessionStorage),
          indexedDb: indexedDbList,
        }));
      })()`,
    );

    if (payload.origin !== origin) {
      throw new Error("Storage origin changed while reading browser state.");
    }

    return [
      ...payload.localStorage.map((entry) => ({
        tabId,
        origin,
        kind: "localStorage" as const,
        key: entry.key,
        value: entry.value,
      })),
      ...payload.sessionStorage.map((entry) => ({
        tabId,
        origin,
        kind: "sessionStorage" as const,
        key: entry.key,
        value: entry.value,
      })),
      ...payload.indexedDb.map((entry) => ({
        tabId,
        origin,
        kind: "indexedDb" as const,
        key: entry.key,
        value: entry.value,
      })),
    ];
  }

  restorePersistedTabSession();

  const manager: TrafficLensManager = {
    getActiveTab: () =>
      activeTabId && activeTabs.has(activeTabId) ? getTabSnapshot(activeTabId) : null,

    ensureActiveTab: (url) => {
      if (activeTabId && activeTabs.has(activeTabId)) {
        return getTabSnapshot(activeTabId);
      }
      return createTabForProfile(DEFAULT_PROFILE_ID, url ?? "about:blank");
    },

    setActiveTab: (tabId) => selectActiveTab(tabId),

    createTab: (url) => createTabForProfile(DEFAULT_PROFILE_ID, url),

    createTabInProfile: ({ url, profileId }) => createTabForProfile(profileId, url),

    navigateTab: (tabId, url) => {
      const entry = getTabEntry(tabId);
      const normalizedUrl = normalizeBrowserNavigationUrl(url);
      entry.lastKnownUrl = normalizedUrl;
      persistTabSession();
      void entry.view.webContents.loadURL(normalizedUrl);
    },

    goBack: (tabId) => {
      getTabEntry(tabId).view.webContents.navigationHistory.goBack();
    },

    goForward: (tabId) => {
      getTabEntry(tabId).view.webContents.navigationHistory.goForward();
    },

    reloadTab: (tabId) => {
      getTabEntry(tabId).view.webContents.reload();
    },

    closeTab: (tabId) => {
      const entry = activeTabs.get(tabId);
      if (!entry) {
        return;
      }

      void archiveSessionStorageSnapshot(tabId, "tabClose");

      for (const [pauseId, paused] of pausedRequests.entries()) {
        if (paused.snapshot.tabId === tabId) {
          removePausedRequest(pauseId);
        }
      }

      try {
        parentWindow.contentView.removeChildView(entry.view);
      } catch {
        // view might already be detached
      }
      entry.viewAttached = false;

      entry.view.webContents.close();
      activeTabs.delete(tabId);
      if (activeTabId === tabId) {
        activeTabId = activeTabs.keys().next().value ?? null;
      }
      removeLiveSessionTab(originCatalog, tabId);
      persistTabSession();
      emitTab({ type: "tab.closed", tabId: tabId as any });
    },

    setTabViewMode: (input) => {
      const entry = getTabEntry(input.tabId);
      if (entry.viewMode === input.viewMode) {
        return getTabSnapshot(input.tabId);
      }

      entry.viewMode = input.viewMode;
      entry.bounds = null;
      entry.view.webContents.setUserAgent(getEffectiveUserAgent(entry));
      emitTab({
        type: "tab.viewModeChanged",
        tabId: input.tabId,
        viewMode: input.viewMode,
      });
      persistTabSession();
      entry.view.webContents.reload();
      return getTabSnapshot(input.tabId);
    },

    setTabMobilePreset: (input) => {
      const entry = getTabEntry(input.tabId);
      if (entry.mobilePreset === input.mobilePreset) {
        return getTabSnapshot(input.tabId);
      }

      entry.mobilePreset = input.mobilePreset;
      entry.bounds = null;
      entry.view.webContents.setUserAgent(getEffectiveUserAgent(entry));
      emitTab({
        type: "tab.mobilePresetChanged",
        tabId: input.tabId,
        mobilePreset: input.mobilePreset,
      });
      persistTabSession();
      if (entry.viewMode === "mobile") {
        entry.view.webContents.reload();
      }
      return getTabSnapshot(input.tabId);
    },

    setTabBounds: (tabId, bounds) => {
      const entry = activeTabs.get(tabId);
      if (!entry) {
        return;
      }
      const normalizedBounds = normalizeTrafficLensViewBounds(bounds);
      if (!normalizedBounds) {
        return;
      }
      entry.bounds = normalizedBounds;
      entry.view.setBounds(normalizedBounds);
      clearBrowserLabCaptureViewportOverride(entry);
    },

    showTab: (tabId) => {
      const entry = activeTabs.get(tabId);
      if (!entry) {
        return;
      }
      selectActiveTab(tabId);

      for (const [id, other] of activeTabs) {
        if (id !== tabId) {
          try {
            parentWindow.contentView.removeChildView(other.view);
          } catch {
            // view may already be detached
          }
          other.viewAttached = false;
        }
      }

      try {
        if (entry.bounds) {
          entry.view.setBounds(entry.bounds);
        }
        parentWindow.contentView.addChildView(entry.view);
        entry.viewAttached = true;
      } catch {
        try {
          parentWindow.contentView.removeChildView(entry.view);
        } catch {
          // ignore
        }
        if (entry.bounds) {
          entry.view.setBounds(entry.bounds);
        }
        parentWindow.contentView.addChildView(entry.view);
        entry.viewAttached = true;
      }
    },

    hideAllTabs: () => {
      for (const entry of activeTabs.values()) {
        try {
          parentWindow.contentView.removeChildView(entry.view);
        } catch {
          // view may already be detached
        }
        entry.viewAttached = false;
      }
    },

    getTabs: () => getTabsInDisplayOrder(),

    capturePageSnapshot: async (tabId) => {
      const entry = getTabEntry(resolveTabId(tabId));
      await applyBrowserLabCaptureViewport(entry, getBrowserLabCaptureBounds(entry));
      return entry.view.webContents.executeJavaScript(
        `(() => {
          const cssString = (value) => JSON.stringify(String(value)).replace(/\\u0000/g, "\\uFFFD");
          const visible = (el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
          };
          const selectorFor = (el) => {
            if (el.id) return "#" + CSS.escape(el.id);
            const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
            if (testId) return "[" + (el.hasAttribute("data-testid") ? "data-testid" : "data-test") + "=" + cssString(testId) + "]";
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) return el.tagName.toLowerCase() + "[aria-label=" + cssString(ariaLabel) + "]";
            const href = el.getAttribute("href");
            if (el.tagName.toLowerCase() === "a" && href) return "a[href=" + cssString(href) + "]";
            const segments = [];
            let current = el;
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
              const tag = current.tagName.toLowerCase();
              if (current.id) {
                segments.unshift("#" + CSS.escape(current.id));
                break;
              }
              const siblings = Array.from(current.parentElement?.children || []).filter((candidate) => candidate.tagName === current.tagName);
              const index = siblings.indexOf(current) + 1;
              segments.unshift(tag + ":nth-of-type(" + Math.max(index, 1) + ")");
              current = current.parentElement;
            }
            return segments.join(" > ");
          };
          const describe = (el) => {
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().slice(0, 200);
            const rawHref = el.getAttribute("href") || undefined;
            return { tag, selector: selectorFor(el), text, role: el.getAttribute("role"), href: el.href || undefined, rawHref, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
          };
          const interactive = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")).filter(visible).slice(0, 80).map(describe);
          const focused = document.activeElement && document.activeElement !== document.body ? describe(document.activeElement) : null;
          return {
            url: location.href,
            title: document.title,
            viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
            focused,
            text: (document.body?.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 12000),
            interactive,
          };
        })()`,
        true,
      );
    },

    captureScreenshot: async (tabId) => {
      const entry = getTabEntry(resolveTabId(tabId));
      const bounds = getBrowserLabCaptureBounds(entry);
      await applyBrowserLabCaptureViewport(entry, bounds);
      if (!entry.viewAttached || !entry.bounds) {
        return {
          data: await captureBrowserLabScreenshotWithDevTools(entry, bounds),
          mimeType: "image/png",
        };
      }
      const image = await entry.view.webContents.capturePage({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height,
      });
      const size = image.getSize();
      const png = image.toPNG();
      if (size.width < 1 || size.height < 1 || png.byteLength < 1) {
        return {
          data: await captureBrowserLabScreenshotWithDevTools(entry, bounds),
          mimeType: "image/png",
        };
      }
      return { data: png.toString("base64"), mimeType: "image/png" };
    },

    clickPage: async (input) => {
      const entry = getTabEntry(resolveTabId(input.tabId));
      let x = input.x;
      let y = input.y;
      if (input.selector) {
        const point = await entry.view.webContents.executeJavaScript(
          `(() => {
            const selector = ${JSON.stringify(input.selector)};
            const extractHrefSelectorValue = (value) => {
              const match = /^a\\[href=(["'])(.*)\\1\\]$/.exec(value.trim());
              return match ? match[2] : null;
            };
            const resolveElement = () => {
              try {
                const selected = document.querySelector(selector);
                if (selected) return selected;
              } catch (error) {
                throw new Error("Invalid selector: " + selector);
              }
              const href = extractHrefSelectorValue(selector);
              if (!href) return null;
              return Array.from(document.querySelectorAll("a[href]")).find((anchor) => {
                const rawHref = anchor.getAttribute("href");
                return rawHref === href || anchor.href === href || (rawHref && new URL(rawHref, location.href).href === href);
              }) || null;
            };
            const el = resolveElement();
            if (!el) throw new Error("Selector not found: " + selector);
            const rect = el.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          })()`,
          true,
        );
        x = point.x;
        y = point.y;
      }
      if (typeof x !== "number" || typeof y !== "number") {
        throw new Error("clickPage requires x/y coordinates or selector.");
      }
      entry.view.webContents.focus();
      entry.view.webContents.sendInputEvent({
        type: "mouseMove",
        x,
        y,
      });
      entry.view.webContents.sendInputEvent({
        type: "mouseDown",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      entry.view.webContents.sendInputEvent({
        type: "mouseUp",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    },

    typeIntoPage: async (input) => {
      const entry = getTabEntry(resolveTabId(input.tabId));
      entry.view.webContents.focus();
      if (input.selector) {
        await entry.view.webContents.executeJavaScript(
          `(() => {
            const el = document.querySelector(${JSON.stringify(input.selector)});
            if (!el) throw new Error("Selector not found.");
            el.focus();
          })()`,
          true,
        );
      }
      entry.view.webContents.sendInputEvent({
        type: "char",
        keyCode: input.text,
      });
    },

    pressPage: async (input) => {
      const entry = getTabEntry(resolveTabId(input.tabId));
      entry.view.webContents.focus();
      entry.view.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: input.key,
      });
      entry.view.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: input.key,
      });
    },

    waitForTabLoad: async (input) => {
      const tabId = resolveTabId(input?.tabId);
      const entry = getTabEntry(tabId);
      if (!entry.view.webContents.isLoading()) {
        return getTabSnapshot(tabId);
      }
      const timeoutMs = input?.timeoutMs ?? 60_000;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          entry.view.webContents.off("did-stop-loading", onStop);
          reject(new Error("Timed out waiting for tab load."));
        }, timeoutMs);
        const onStop = () => {
          clearTimeout(timer);
          resolve();
        };
        entry.view.webContents.once("did-stop-loading", onStop);
      });
      return getTabSnapshot(tabId);
    },

    listRules: () => Array.from(rules.values()),

    createRule: (input) => {
      const { id: providedId, ...ruleInput } = input as TrafficLensRuleInput & {
        id?: string;
      };
      const timestamp = nowIso();
      const rule: TrafficLensRule = {
        ...ruleInput,
        id: (providedId ?? randomUUID()) as any,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      rules.set(rule.id, rule);
      return rule;
    },

    updateRule: (id, input) => {
      const existing = rules.get(id);
      if (!existing) {
        throw new Error(`Rule not found: ${id}`);
      }
      const updated: TrafficLensRule = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };
      rules.set(id, updated);
      return updated;
    },

    deleteRule: (id) => {
      rules.delete(id);
    },

    setRuleEnabled: (id, enabled) => {
      const existing = rules.get(id);
      if (!existing) {
        throw new Error(`Rule not found: ${id}`);
      }
      rules.set(id, { ...existing, enabled, updatedAt: nowIso() });
    },

    listPaused: () => Array.from(pausedRequests.values()).map((entry) => entry.snapshot),

    continuePaused: async (input) => {
      const paused = pausedRequests.get(input.pauseId);
      if (!paused) {
        throw new Error(`Paused request not found: ${input.pauseId}`);
      }

      if (paused.phase === "beforeRequest") {
        await paused.debugger.sendCommand("Fetch.continueRequest", {
          requestId: paused.requestId,
          url: input.url ?? paused.snapshot.url,
          headers: toCdpHeaders(input.headers ?? paused.snapshot.headers),
          postData:
            input.body !== undefined
              ? (input.body ?? undefined)
              : (paused.snapshot.body ?? undefined),
        });
      } else {
        await paused.debugger.sendCommand("Fetch.continueResponse", {
          requestId: paused.requestId,
          responseCode: input.statusCode ?? paused.snapshot.statusCode,
          responseHeaders: toCdpHeaders(
            input.headers ?? paused.snapshot.responseHeaders ?? paused.snapshot.headers,
          ),
        });
      }

      removePausedRequest(input.pauseId);
    },

    dropPaused: async ({ pauseId }) => {
      const paused = pausedRequests.get(pauseId);
      if (!paused) {
        throw new Error(`Paused request not found: ${pauseId}`);
      }
      await paused.debugger.sendCommand("Fetch.failRequest", {
        requestId: paused.requestId,
        errorReason: "Aborted",
      });
      removePausedRequest(pauseId);
    },

    listProfiles: () => Array.from(profiles.values()),

    createProfile: (input) => {
      const { id: providedId, ...profileInput } = input as TrafficLensProfileInput & {
        id?: string;
      };
      const timestamp = nowIso();
      const profile: TrafficLensProfile = {
        ...profileInput,
        id: (providedId ?? randomUUID()) as any,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      profiles.set(profile.id, profile);
      persistTabSession();
      return profile;
    },

    updateProfile: (id, input) => {
      const existing = profiles.get(id);
      if (!existing) {
        throw new Error(`Profile not found: ${id}`);
      }
      const updated: TrafficLensProfile = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };
      profiles.set(id, updated);
      const existingSession = profileSessions.get(id);
      if (existingSession) {
        existingSession.setUserAgent(updated.userAgentPreset ?? DESKTOP_USER_AGENT);
      }
      for (const entry of activeTabs.values()) {
        if (entry.profileId !== id) {
          continue;
        }
        entry.view.webContents.setUserAgent(getEffectiveUserAgent(entry));
      }
      persistTabSession();
      return updated;
    },

    deleteProfile: (id) => {
      if (id === DEFAULT_PROFILE_ID) {
        throw new Error("The default profile cannot be deleted.");
      }
      if (Array.from(activeTabs.values()).some((entry) => entry.profileId === id)) {
        throw new Error("Cannot delete a profile with open tabs.");
      }
      profiles.delete(id);
      profileSessions.delete(id);
      persistTabSession();
    },

    getCookies: async (tabId) => {
      const entry = getTabEntry(tabId);
      const cookies = await entry.view.webContents.session.cookies.get({});
      return cookies.map((cookie) => {
        const entry = {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain ?? "",
          path: cookie.path ?? "/",
          secure: cookie.secure ?? false,
          httpOnly: cookie.httpOnly ?? false,
        };
        if (cookie.sameSite) {
          Object.assign(entry, { sameSite: cookie.sameSite });
        }
        if (cookie.expirationDate !== undefined) {
          Object.assign(entry, { expirationDate: cookie.expirationDate });
        }
        if (cookie.session !== undefined) {
          Object.assign(entry, { session: cookie.session });
        }
        if (cookie.hostOnly !== undefined) {
          Object.assign(entry, { hostOnly: cookie.hostOnly });
        }
        return entry;
      });
    },

    setCookie: async (input) => {
      const entry = getTabEntry(input.tabId);
      await manager.setCookieForOrigin({
        profileId: entry.profileId as any,
        url: input.url,
        name: input.name,
        value: input.value,
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.path ? { path: input.path } : {}),
        ...(input.secure !== undefined ? { secure: input.secure } : {}),
        ...(input.httpOnly !== undefined ? { httpOnly: input.httpOnly } : {}),
        ...(input.sameSite ? { sameSite: input.sameSite } : {}),
        ...(input.expirationDate !== undefined ? { expirationDate: input.expirationDate } : {}),
      });
      emitStorage(input.tabId);
    },

    deleteCookie: async (input) => {
      const entry = getTabEntry(input.tabId);
      await manager.deleteCookieForOrigin({
        profileId: entry.profileId as any,
        url: `https://${input.domain.replace(/^\./, "")}${input.path}`,
        name: input.name,
        domain: input.domain,
        path: input.path,
      });
      emitStorage(input.tabId);
    },

    getStorage,

    setStorageEntry: async (input) => {
      if (input.kind === "indexedDb") {
        throw new Error("IndexedDB entries are read-only in this browser workbench version.");
      }
      if (input.kind === "localStorage") {
        await manager.setLocalStorageItem({
          profileId: getTabEntry(input.tabId).profileId as any,
          origin: input.origin,
          tabId: input.tabId,
          key: input.key,
          value: input.value,
        });
      } else {
        await manager.setLiveSessionStorageItem({
          tabId: input.tabId,
          origin: input.origin,
          key: input.key,
          value: input.value,
        });
      }
      emitStorage(input.tabId);
    },

    deleteStorageEntry: async (input) => {
      if (input.kind === "indexedDb") {
        throw new Error("IndexedDB entries are read-only in this browser workbench version.");
      }
      if (input.kind === "localStorage") {
        await manager.deleteLocalStorageItem({
          profileId: getTabEntry(input.tabId).profileId as any,
          origin: input.origin,
          tabId: input.tabId,
          key: input.key,
        });
      } else {
        await manager.deleteLiveSessionStorageItem({
          tabId: input.tabId,
          origin: input.origin,
          key: input.key,
        });
      }
      emitStorage(input.tabId);
    },

    listStorageOrigins: (profileId) => listOriginsForProfile(profileId),

    captureStorageOrigin: async (input) => {
      const catalogEntry =
        originCatalog.get(storageOriginCatalogKey(input.profileId, input.origin)) ??
        upsertStorageOriginCatalogEntry(originCatalog, {
          profileId: input.profileId,
          origin: input.origin,
          lastDocumentUrl:
            findOpenTabForOrigin(
              input.profileId,
              input.origin,
              input.tabId,
            )?.view.webContents.getURL() ?? toOriginUrl(input.origin),
          timestamp: nowIso(),
        });
      await persistCookieSnapshot(
        input.profileId,
        input.origin,
        "manual",
        input.tabId,
        catalogEntry.lastDocumentUrl ?? undefined,
      );
      await persistLocalStorageSnapshot(
        input.profileId,
        input.origin,
        "manual",
        input.tabId,
        catalogEntry.lastDocumentUrl ?? undefined,
      );
      if (input.tabId) {
        await archiveSessionStorageSnapshot(input.tabId, "manual");
      }
    },

    getApplicableCookies: async (input) => readApplicableCookies(input.profileId, input.origin),

    setCookieForOrigin: async (input) => {
      const targetSession = ensureSession(input.profileId);
      const details: Electron.CookiesSetDetails = {
        url: input.url,
        name: input.name,
        value: input.value,
      };
      if (input.domain) {
        details.domain = input.domain;
      }
      if (input.path) {
        details.path = input.path;
      }
      if (input.secure !== undefined) {
        details.secure = input.secure;
      }
      if (input.httpOnly !== undefined) {
        details.httpOnly = input.httpOnly;
      }
      if (
        input.sameSite === "unspecified" ||
        input.sameSite === "no_restriction" ||
        input.sameSite === "lax" ||
        input.sameSite === "strict"
      ) {
        details.sameSite = input.sameSite;
      }
      if (input.expirationDate !== undefined) {
        details.expirationDate = input.expirationDate;
      }
      await targetSession.cookies.set(details);
      const catalogEntry = noteOrigin(input.profileId, input.url);
      const origin = parseUrl(input.url).origin;
      await persistCookieSnapshot(
        input.profileId,
        origin,
        "mutation",
        undefined,
        catalogEntry?.lastDocumentUrl ?? input.url,
      );
      emitStorageEvent({
        type: "cookies.updated",
        profileId: input.profileId,
        origin,
        areaKind: "cookies",
        timestamp: nowIso(),
      });
    },

    deleteCookieForOrigin: async (input) => {
      const targetSession = ensureSession(input.profileId);
      await targetSession.cookies.remove(input.url, input.name);
      const origin = parseUrl(input.url).origin;
      await persistCookieSnapshot(input.profileId, origin, "mutation", undefined, input.url);
      emitStorageEvent({
        type: "cookies.updated",
        profileId: input.profileId,
        origin,
        areaKind: "cookies",
        timestamp: nowIso(),
      });
    },

    getLocalStorage: async (input) =>
      readDomStorageEntries({
        profileId: input.profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "localStorage",
        allowUtilityTarget: true,
      }),

    setLocalStorageItem: async (input) => {
      await writeDomStorage({
        profileId: input.profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "localStorage",
        mode: "set",
        key: input.key,
        value: input.value,
        allowUtilityTarget: true,
      });
      await persistLocalStorageSnapshot(
        input.profileId,
        input.origin,
        "mutation",
        input.tabId,
        findOpenTabForOrigin(input.profileId, input.origin, input.tabId)?.view.webContents.getURL(),
      );
      emitStorageEvent({
        type: "localStorage.updated",
        profileId: input.profileId,
        origin: input.origin,
        areaKind: "localStorage",
        ...(input.tabId ? { tabId: input.tabId } : {}),
        timestamp: nowIso(),
      });
    },

    deleteLocalStorageItem: async (input) => {
      await writeDomStorage({
        profileId: input.profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "localStorage",
        mode: "delete",
        key: input.key,
        allowUtilityTarget: true,
      });
      await persistLocalStorageSnapshot(
        input.profileId,
        input.origin,
        "mutation",
        input.tabId,
        findOpenTabForOrigin(input.profileId, input.origin, input.tabId)?.view.webContents.getURL(),
      );
      emitStorageEvent({
        type: "localStorage.updated",
        profileId: input.profileId,
        origin: input.origin,
        areaKind: "localStorage",
        ...(input.tabId ? { tabId: input.tabId } : {}),
        timestamp: nowIso(),
      });
    },

    clearLocalStorage: async (input) => {
      await writeDomStorage({
        profileId: input.profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "localStorage",
        mode: "clear",
        allowUtilityTarget: true,
      });
      await persistLocalStorageSnapshot(
        input.profileId,
        input.origin,
        "mutation",
        input.tabId,
        findOpenTabForOrigin(input.profileId, input.origin, input.tabId)?.view.webContents.getURL(),
      );
      emitStorageEvent({
        type: "localStorage.updated",
        profileId: input.profileId,
        origin: input.origin,
        areaKind: "localStorage",
        ...(input.tabId ? { tabId: input.tabId } : {}),
        timestamp: nowIso(),
      });
    },

    getLiveSessionStorage: async (input) =>
      readDomStorageEntries({
        profileId: getTabEntry(input.tabId).profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "sessionStorage",
        allowUtilityTarget: false,
      }),

    setLiveSessionStorageItem: async (input) => {
      const profileId = getTabEntry(input.tabId).profileId;
      await writeDomStorage({
        profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "sessionStorage",
        mode: "set",
        key: input.key,
        value: input.value,
        allowUtilityTarget: false,
      });
      await archiveSessionStorageSnapshot(input.tabId, "mutation");
      emitStorageEvent({
        type: "sessionStorage.liveUpdated",
        profileId: profileId as any,
        origin: input.origin,
        areaKind: "sessionStorage",
        tabId: input.tabId,
        timestamp: nowIso(),
      });
    },

    deleteLiveSessionStorageItem: async (input) => {
      const profileId = getTabEntry(input.tabId).profileId;
      await writeDomStorage({
        profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "sessionStorage",
        mode: "delete",
        key: input.key,
        allowUtilityTarget: false,
      });
      await archiveSessionStorageSnapshot(input.tabId, "mutation");
      emitStorageEvent({
        type: "sessionStorage.liveUpdated",
        profileId: profileId as any,
        origin: input.origin,
        areaKind: "sessionStorage",
        tabId: input.tabId,
        timestamp: nowIso(),
      });
    },

    clearLiveSessionStorage: async (input) => {
      const profileId = getTabEntry(input.tabId).profileId;
      await writeDomStorage({
        profileId,
        origin: input.origin,
        preferredTabId: input.tabId,
        kind: "sessionStorage",
        mode: "clear",
        allowUtilityTarget: false,
      });
      await archiveSessionStorageSnapshot(input.tabId, "mutation");
      emitStorageEvent({
        type: "sessionStorage.liveUpdated",
        profileId: profileId as any,
        origin: input.origin,
        areaKind: "sessionStorage",
        tabId: input.tabId,
        timestamp: nowIso(),
      });
    },

    listSessionStorageSnapshots: (profileId, origin) =>
      [...archivedSessionSnapshots.values()]
        .map((snapshot) => snapshot.summary)
        .filter((snapshot) => snapshot.profileId === profileId && snapshot.origin === origin)
        .toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt)),

    getSessionStorageSnapshot: (input) =>
      archivedSessionSnapshots.get(input.versionId)?.entries ?? [],

    updateSessionStorageSnapshot: (input) => {
      const existing = archivedSessionSnapshots.get(input.versionId);
      if (!existing) {
        throw new Error(`Session storage snapshot not found: ${input.versionId}`);
      }
      existing.entries = [...input.entries];
      existing.summary = {
        ...existing.summary,
        capturedAt: nowIso(),
        snapshotReason: "mutation",
      };
      emitStorageEvent({
        type: "sessionStorage.snapshotUpdated",
        profileId: existing.summary.profileId,
        origin: existing.summary.origin,
        areaKind: "sessionStorage",
        ...(existing.summary.sourceTabId ? { tabId: existing.summary.sourceTabId } : {}),
        versionId: input.versionId,
        timestamp: nowIso(),
      });
    },

    rehydrateSessionStorageSnapshot: async (input) => {
      const snapshot = archivedSessionSnapshots.get(input.versionId);
      if (!snapshot) {
        throw new Error(`Session storage snapshot not found: ${input.versionId}`);
      }
      const destinationTabId =
        input.destinationTabId ??
        createTabForProfile(
          snapshot.summary.profileId,
          snapshot.summary.sourceUrl ?? snapshot.summary.origin,
        ).tabId;
      await writeDomStorage({
        profileId: snapshot.summary.profileId,
        origin: snapshot.summary.origin,
        preferredTabId: destinationTabId,
        kind: "sessionStorage",
        mode: "clear",
        allowUtilityTarget: false,
      });
      for (const entry of snapshot.entries) {
        await writeDomStorage({
          profileId: snapshot.summary.profileId,
          origin: snapshot.summary.origin,
          preferredTabId: destinationTabId,
          kind: "sessionStorage",
          mode: "set",
          key: entry.key,
          value: entry.value ?? "",
          allowUtilityTarget: false,
        });
      }
      getTabEntry(destinationTabId).view.webContents.reload();
      void archiveSessionStorageSnapshot(destinationTabId, "rehydrate");
      return { tabId: destinationTabId };
    },

    listOverrides: () => Array.from(overrides.values()),

    createOverride: (input) => {
      const { id: providedId, ...overrideInput } = input as TrafficLensOverrideInput & {
        id?: string;
      };
      const timestamp = nowIso();
      const override: TrafficLensOverride = {
        ...overrideInput,
        id: (providedId ?? randomUUID()) as any,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      overrides.set(override.id, override);
      return override;
    },

    updateOverride: (id, input) => {
      const existing = overrides.get(id);
      if (!existing) {
        throw new Error(`Override not found: ${id}`);
      }
      const updated: TrafficLensOverride = {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      };
      overrides.set(id, updated);
      return updated;
    },

    deleteOverride: (id) => {
      overrides.delete(id);
    },

    setOverrideEnabled: (id, enabled) => {
      const existing = overrides.get(id);
      if (!existing) {
        throw new Error(`Override not found: ${id}`);
      }
      overrides.set(id, { ...existing, enabled, updatedAt: nowIso() });
    },

    onTabEvent: (listener) => {
      tabListeners.push(listener);
      return () => {
        tabListeners = tabListeners.filter((candidate) => candidate !== listener);
      };
    },

    onPausedEvent: (listener) => {
      pausedListeners.push(listener);
      return () => {
        pausedListeners = pausedListeners.filter((candidate) => candidate !== listener);
      };
    },

    onStorageChanged: (listener) => {
      storageListeners.push(listener);
      return () => {
        storageListeners = storageListeners.filter((candidate) => candidate !== listener);
      };
    },

    onStorageEvent: (listener) => {
      storageEventListeners.push(listener);
      return () => {
        storageEventListeners = storageEventListeners.filter((candidate) => candidate !== listener);
      };
    },

    stop: () => {
      persistTabSession();
      for (const pauseId of pausedRequests.keys()) {
        removePausedRequest(pauseId);
      }
      for (const tabId of Array.from(activeTabs.keys())) {
        try {
          const entry = activeTabs.get(tabId);
          if (!entry) {
            continue;
          }
          try {
            parentWindow.contentView.removeChildView(entry.view);
          } catch {
            // view may already be detached
          }
          entry.view.webContents.close();
        } catch {
          // ignore shutdown races
        }
      }
      activeTabs.clear();
      pausedRequests.clear();
      originCatalog.clear();
      archivedSessionSnapshots.clear();
      tabListeners = [];
      pausedListeners = [];
      storageListeners = [];
      storageEventListeners = [];
      for (const target of utilityTargets.values()) {
        try {
          target.webContents.close();
        } catch {
          // ignore shutdown races
        }
      }
      utilityTargets.clear();
    },
  };

  return manager;
}
