import { Schema } from "effect";
import { makeEntityId } from "./baseSchemas";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const TrafficLensTabId = makeEntityId("TrafficLensTabId");
export type TrafficLensTabId = typeof TrafficLensTabId.Type;

export const TrafficLensProfileId = makeEntityId("TrafficLensProfileId");
export type TrafficLensProfileId = typeof TrafficLensProfileId.Type;

export const TrafficLensRuleId = makeEntityId("TrafficLensRuleId");
export type TrafficLensRuleId = typeof TrafficLensRuleId.Type;

export const TrafficLensPauseId = makeEntityId("TrafficLensPauseId");
export type TrafficLensPauseId = typeof TrafficLensPauseId.Type;

export const TrafficLensOverrideId = makeEntityId("TrafficLensOverrideId");
export type TrafficLensOverrideId = typeof TrafficLensOverrideId.Type;

// ─── Shared primitives ──────────────────────────────────────────────────────

const StringRecord = Schema.Record(Schema.String, Schema.String);

export const TrafficLensInterceptPhase = Schema.Literals(["beforeRequest", "beforeResponse"]);
export type TrafficLensInterceptPhase = typeof TrafficLensInterceptPhase.Type;

export const TrafficLensRuleAction = Schema.Literals([
  "observe",
  "pause",
  "modify",
  "mockResponse",
  "drop",
]);
export type TrafficLensRuleAction = typeof TrafficLensRuleAction.Type;

export const TrafficLensHeaderMutation = Schema.Struct({
  set: StringRecord,
  remove: Schema.Array(Schema.String),
});
export type TrafficLensHeaderMutation = typeof TrafficLensHeaderMutation.Type;

export const TrafficLensMockResponse = Schema.Struct({
  statusCode: Schema.Number,
  headers: StringRecord,
  body: Schema.NullOr(Schema.String), // base64
});
export type TrafficLensMockResponse = typeof TrafficLensMockResponse.Type;

export const TrafficLensRuleScope = Schema.Struct({
  tabId: Schema.optional(TrafficLensTabId),
  profileId: Schema.optional(TrafficLensProfileId),
  hostPattern: Schema.optional(Schema.String),
  urlPattern: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  resourceType: Schema.optional(Schema.String),
});
export type TrafficLensRuleScope = typeof TrafficLensRuleScope.Type;

// ─── Browser state ──────────────────────────────────────────────────────────

export const TrafficLensProfile = Schema.Struct({
  id: TrafficLensProfileId,
  name: Schema.String,
  partitionKey: Schema.String,
  userAgentPreset: Schema.optional(Schema.String),
  proxyPreset: Schema.optional(Schema.NullOr(Schema.String)),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TrafficLensProfile = typeof TrafficLensProfile.Type;

export const TrafficLensProfileInput = Schema.Struct({
  name: Schema.String,
  partitionKey: Schema.String,
  userAgentPreset: Schema.optional(Schema.String),
  proxyPreset: Schema.optional(Schema.NullOr(Schema.String)),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TrafficLensProfileInput = typeof TrafficLensProfileInput.Type;

export const TrafficLensUpsertProfileInput = Schema.Struct({
  id: Schema.optional(TrafficLensProfileId),
  input: TrafficLensProfileInput,
});
export type TrafficLensUpsertProfileInput = typeof TrafficLensUpsertProfileInput.Type;

export const TrafficLensDeleteProfileInput = Schema.Struct({
  id: TrafficLensProfileId,
});
export type TrafficLensDeleteProfileInput = typeof TrafficLensDeleteProfileInput.Type;

export const TrafficLensRule = Schema.Struct({
  id: TrafficLensRuleId,
  name: Schema.String,
  enabled: Schema.Boolean,
  phase: TrafficLensInterceptPhase,
  action: TrafficLensRuleAction,
  scope: TrafficLensRuleScope,
  urlRewrite: Schema.optional(Schema.String),
  headerMutation: Schema.optional(TrafficLensHeaderMutation),
  bodyReplace: Schema.optional(Schema.NullOr(Schema.String)),
  mockResponse: Schema.optional(TrafficLensMockResponse),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TrafficLensRule = typeof TrafficLensRule.Type;

export const TrafficLensRuleInput = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
  phase: TrafficLensInterceptPhase,
  action: TrafficLensRuleAction,
  scope: TrafficLensRuleScope,
  urlRewrite: Schema.optional(Schema.String),
  headerMutation: Schema.optional(TrafficLensHeaderMutation),
  bodyReplace: Schema.optional(Schema.NullOr(Schema.String)),
  mockResponse: Schema.optional(TrafficLensMockResponse),
});
export type TrafficLensRuleInput = typeof TrafficLensRuleInput.Type;

export const TrafficLensUpsertRuleInput = Schema.Struct({
  id: Schema.optional(TrafficLensRuleId),
  input: TrafficLensRuleInput,
});
export type TrafficLensUpsertRuleInput = typeof TrafficLensUpsertRuleInput.Type;

export const TrafficLensDeleteRuleInput = Schema.Struct({
  id: TrafficLensRuleId,
});
export type TrafficLensDeleteRuleInput = typeof TrafficLensDeleteRuleInput.Type;

export const TrafficLensOverride = Schema.Struct({
  id: TrafficLensOverrideId,
  name: Schema.String,
  enabled: Schema.Boolean,
  match: TrafficLensRuleScope,
  response: TrafficLensMockResponse,
  latencyMs: Schema.optional(Schema.Number),
  offline: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TrafficLensOverride = typeof TrafficLensOverride.Type;

export const TrafficLensOverrideInput = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
  match: TrafficLensRuleScope,
  response: TrafficLensMockResponse,
  latencyMs: Schema.optional(Schema.Number),
  offline: Schema.optional(Schema.Boolean),
});
export type TrafficLensOverrideInput = typeof TrafficLensOverrideInput.Type;

export const TrafficLensUpsertOverrideInput = Schema.Struct({
  id: Schema.optional(TrafficLensOverrideId),
  input: TrafficLensOverrideInput,
});
export type TrafficLensUpsertOverrideInput = typeof TrafficLensUpsertOverrideInput.Type;

export const TrafficLensDeleteOverrideInput = Schema.Struct({
  id: TrafficLensOverrideId,
});
export type TrafficLensDeleteOverrideInput = typeof TrafficLensDeleteOverrideInput.Type;

export const TrafficLensFindingSeverity = Schema.Literals(["info", "low", "medium", "high"]);
export type TrafficLensFindingSeverity = typeof TrafficLensFindingSeverity.Type;

export const TrafficLensFindingKind = Schema.Literals([
  "missing-security-header",
  "weak-cookie-flag",
  "cors-wildcard",
  "mixed-content",
  "jwt-exposed-in-storage",
  "sourcemap-exposed",
]);
export type TrafficLensFindingKind = typeof TrafficLensFindingKind.Type;

export const TrafficLensFinding = Schema.Struct({
  id: Schema.Number,
  tabId: Schema.optional(Schema.NullOr(Schema.String)),
  trafficId: Schema.optional(Schema.NullOr(Schema.Number)),
  kind: TrafficLensFindingKind,
  severity: TrafficLensFindingSeverity,
  title: Schema.String,
  description: Schema.String,
  evidenceJson: Schema.String,
  createdAt: Schema.String,
});
export type TrafficLensFinding = typeof TrafficLensFinding.Type;

export const TrafficLensListFindingsInput = Schema.Struct({
  tabId: Schema.optional(Schema.String),
  kind: Schema.optional(TrafficLensFindingKind),
  severity: Schema.optional(TrafficLensFindingSeverity),
  limit: Schema.optional(Schema.Number),
});
export type TrafficLensListFindingsInput = typeof TrafficLensListFindingsInput.Type;

export const TrafficLensCookieEntry = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  secure: Schema.Boolean,
  httpOnly: Schema.Boolean,
  sameSite: Schema.optional(Schema.NullOr(Schema.String)),
  expirationDate: Schema.optional(Schema.NullOr(Schema.Number)),
  session: Schema.optional(Schema.Boolean),
  hostOnly: Schema.optional(Schema.Boolean),
});
export type TrafficLensCookieEntry = typeof TrafficLensCookieEntry.Type;

export const TrafficLensStorageKind = Schema.Literals([
  "localStorage",
  "sessionStorage",
  "indexedDb",
]);
export type TrafficLensStorageKind = typeof TrafficLensStorageKind.Type;

export const TrafficLensStorageAreaKind = Schema.Literals([
  "cookies",
  "localStorage",
  "sessionStorage",
]);
export type TrafficLensStorageAreaKind = typeof TrafficLensStorageAreaKind.Type;

export const TrafficLensStorageSnapshotReason = Schema.Literals([
  "navigation",
  "manual",
  "mutation",
  "tabClose",
  "rehydrate",
  "utilityCapture",
]);
export type TrafficLensStorageSnapshotReason = typeof TrafficLensStorageSnapshotReason.Type;

export const TrafficLensStorageBucket = Schema.Struct({
  kind: TrafficLensStorageKind,
  origin: Schema.String,
});
export type TrafficLensStorageBucket = typeof TrafficLensStorageBucket.Type;

export const TrafficLensDomStorageEntry = Schema.Struct({
  key: Schema.String,
  value: Schema.NullOr(Schema.String),
});
export type TrafficLensDomStorageEntry = typeof TrafficLensDomStorageEntry.Type;

export const TrafficLensCookieSnapshot = Schema.Struct({
  origin: Schema.String,
  cookies: Schema.Array(TrafficLensCookieEntry),
});
export type TrafficLensCookieSnapshot = typeof TrafficLensCookieSnapshot.Type;

export const TrafficLensDomStorageSnapshot = Schema.Struct({
  origin: Schema.String,
  kind: Schema.Union([Schema.Literal("localStorage"), Schema.Literal("sessionStorage")]),
  entries: Schema.Array(TrafficLensDomStorageEntry),
});
export type TrafficLensDomStorageSnapshot = typeof TrafficLensDomStorageSnapshot.Type;

export const TrafficLensStorageOriginSummary = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  lastDocumentUrl: Schema.NullOr(Schema.String),
  firstSeenAt: Schema.String,
  lastSeenAt: Schema.String,
  latestCookieVersionId: Schema.NullOr(Schema.Number),
  latestLocalStorageVersionId: Schema.NullOr(Schema.Number),
  latestSessionStorageVersionId: Schema.NullOr(Schema.Number),
  hasLiveSessionStorage: Schema.Boolean,
  liveSessionTabIds: Schema.Array(Schema.String),
});
export type TrafficLensStorageOriginSummary = typeof TrafficLensStorageOriginSummary.Type;

export const TrafficLensStorageAreaVersion = Schema.Struct({
  id: Schema.Number,
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  areaKind: TrafficLensStorageAreaKind,
  scopeKey: Schema.String,
  capturedAt: Schema.String,
  snapshotReason: TrafficLensStorageSnapshotReason,
  sourceTabId: Schema.NullOr(Schema.String),
  sourceUrl: Schema.NullOr(Schema.String),
});
export type TrafficLensStorageAreaVersion = typeof TrafficLensStorageAreaVersion.Type;

export const TrafficLensArchivedSessionStorageSummary = Schema.Struct({
  versionId: Schema.Number,
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  sourceTabId: Schema.NullOr(Schema.String),
  sourceUrl: Schema.NullOr(Schema.String),
  capturedAt: Schema.String,
  snapshotReason: TrafficLensStorageSnapshotReason,
});
export type TrafficLensArchivedSessionStorageSummary =
  typeof TrafficLensArchivedSessionStorageSummary.Type;

export const TrafficLensStorageEventType = Schema.Literals([
  "origin.discovered",
  "cookies.updated",
  "localStorage.updated",
  "sessionStorage.liveUpdated",
  "sessionStorage.snapshotCaptured",
  "sessionStorage.snapshotUpdated",
  "origin.persistenceSyncFailed",
]);
export type TrafficLensStorageEventType = typeof TrafficLensStorageEventType.Type;

export const TrafficLensStorageEvent = Schema.Struct({
  type: TrafficLensStorageEventType,
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  areaKind: TrafficLensStorageAreaKind,
  tabId: Schema.optional(Schema.String),
  timestamp: Schema.String,
  versionId: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
});
export type TrafficLensStorageEvent = typeof TrafficLensStorageEvent.Type;

export const TrafficLensStorageEntry = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
  kind: TrafficLensStorageKind,
  key: Schema.String,
  value: Schema.NullOr(Schema.String),
});
export type TrafficLensStorageEntry = typeof TrafficLensStorageEntry.Type;

export const TrafficLensSetCookieInput = Schema.Struct({
  tabId: Schema.String,
  url: Schema.String,
  name: Schema.String,
  value: Schema.String,
  domain: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  secure: Schema.optional(Schema.Boolean),
  httpOnly: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(Schema.String),
  expirationDate: Schema.optional(Schema.Number),
});
export type TrafficLensSetCookieInput = typeof TrafficLensSetCookieInput.Type;

export const TrafficLensDeleteCookieInput = Schema.Struct({
  tabId: Schema.String,
  name: Schema.String,
  domain: Schema.String,
  path: Schema.String,
});
export type TrafficLensDeleteCookieInput = typeof TrafficLensDeleteCookieInput.Type;

export const TrafficLensSetStorageEntryInput = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
  kind: TrafficLensStorageKind,
  key: Schema.String,
  value: Schema.String,
});
export type TrafficLensSetStorageEntryInput = typeof TrafficLensSetStorageEntryInput.Type;

export const TrafficLensDeleteStorageEntryInput = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
  kind: TrafficLensStorageKind,
  key: Schema.String,
});
export type TrafficLensDeleteStorageEntryInput = typeof TrafficLensDeleteStorageEntryInput.Type;

export const TrafficLensListStorageOriginsInput = Schema.Struct({
  profileId: TrafficLensProfileId,
});
export type TrafficLensListStorageOriginsInput = typeof TrafficLensListStorageOriginsInput.Type;

export const TrafficLensCaptureStorageOriginInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  tabId: Schema.optional(Schema.String),
});
export type TrafficLensCaptureStorageOriginInput = typeof TrafficLensCaptureStorageOriginInput.Type;

export const TrafficLensGetApplicableCookiesInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
});
export type TrafficLensGetApplicableCookiesInput = typeof TrafficLensGetApplicableCookiesInput.Type;

export const TrafficLensSetCookieForOriginInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  url: Schema.String,
  name: Schema.String,
  value: Schema.String,
  domain: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  secure: Schema.optional(Schema.Boolean),
  httpOnly: Schema.optional(Schema.Boolean),
  sameSite: Schema.optional(Schema.String),
  expirationDate: Schema.optional(Schema.Number),
});
export type TrafficLensSetCookieForOriginInput = typeof TrafficLensSetCookieForOriginInput.Type;

export const TrafficLensDeleteCookieForOriginInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  url: Schema.String,
  name: Schema.String,
  domain: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
});
export type TrafficLensDeleteCookieForOriginInput =
  typeof TrafficLensDeleteCookieForOriginInput.Type;

export const TrafficLensGetLocalStorageInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  tabId: Schema.optional(Schema.String),
});
export type TrafficLensGetLocalStorageInput = typeof TrafficLensGetLocalStorageInput.Type;

export const TrafficLensSetLocalStorageItemInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  tabId: Schema.optional(Schema.String),
  key: Schema.String,
  value: Schema.String,
});
export type TrafficLensSetLocalStorageItemInput = typeof TrafficLensSetLocalStorageItemInput.Type;

export const TrafficLensDeleteLocalStorageItemInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  tabId: Schema.optional(Schema.String),
  key: Schema.String,
});
export type TrafficLensDeleteLocalStorageItemInput =
  typeof TrafficLensDeleteLocalStorageItemInput.Type;

export const TrafficLensClearLocalStorageInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  tabId: Schema.optional(Schema.String),
});
export type TrafficLensClearLocalStorageInput = typeof TrafficLensClearLocalStorageInput.Type;

export const TrafficLensGetLiveSessionStorageInput = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
});
export type TrafficLensGetLiveSessionStorageInput =
  typeof TrafficLensGetLiveSessionStorageInput.Type;

export const TrafficLensSetLiveSessionStorageItemInput = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
  key: Schema.String,
  value: Schema.String,
});
export type TrafficLensSetLiveSessionStorageItemInput =
  typeof TrafficLensSetLiveSessionStorageItemInput.Type;

export const TrafficLensDeleteLiveSessionStorageItemInput = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
  key: Schema.String,
});
export type TrafficLensDeleteLiveSessionStorageItemInput =
  typeof TrafficLensDeleteLiveSessionStorageItemInput.Type;

export const TrafficLensClearLiveSessionStorageInput = Schema.Struct({
  tabId: Schema.String,
  origin: Schema.String,
});
export type TrafficLensClearLiveSessionStorageInput =
  typeof TrafficLensClearLiveSessionStorageInput.Type;

export const TrafficLensListSessionStorageSnapshotsInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
});
export type TrafficLensListSessionStorageSnapshotsInput =
  typeof TrafficLensListSessionStorageSnapshotsInput.Type;

export const TrafficLensGetSessionStorageSnapshotInput = Schema.Struct({
  versionId: Schema.Number,
});
export type TrafficLensGetSessionStorageSnapshotInput =
  typeof TrafficLensGetSessionStorageSnapshotInput.Type;

export const TrafficLensUpdateSessionStorageSnapshotInput = Schema.Struct({
  versionId: Schema.Number,
  entries: Schema.Array(TrafficLensDomStorageEntry),
});
export type TrafficLensUpdateSessionStorageSnapshotInput =
  typeof TrafficLensUpdateSessionStorageSnapshotInput.Type;

export const TrafficLensRehydrateSessionStorageSnapshotInput = Schema.Struct({
  versionId: Schema.Number,
  destinationTabId: Schema.optional(Schema.String),
});
export type TrafficLensRehydrateSessionStorageSnapshotInput =
  typeof TrafficLensRehydrateSessionStorageSnapshotInput.Type;

export const TrafficLensGetStorageVersionsInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  areaKind: Schema.optional(TrafficLensStorageAreaKind),
});
export type TrafficLensGetStorageVersionsInput = typeof TrafficLensGetStorageVersionsInput.Type;

export const TrafficLensClearPersistedOriginInput = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
});
export type TrafficLensClearPersistedOriginInput = typeof TrafficLensClearPersistedOriginInput.Type;

export const TrafficLensStorageIngestPayload = Schema.Struct({
  profileId: TrafficLensProfileId,
  origin: Schema.String,
  areaKind: TrafficLensStorageAreaKind,
  scopeKey: Schema.String,
  snapshotReason: TrafficLensStorageSnapshotReason,
  sourceTabId: Schema.optional(Schema.String),
  sourceUrl: Schema.optional(Schema.String),
  payloadJson: Schema.String,
  capturedAt: Schema.String,
});
export type TrafficLensStorageIngestPayload = typeof TrafficLensStorageIngestPayload.Type;

// ─── Schemas ────────────────────────────────────────────────────────────────

export const TrafficLensViewMode = Schema.Literals(["desktop", "mobile"]);
export type TrafficLensViewMode = typeof TrafficLensViewMode.Type;

export const TrafficLensMobilePreset = Schema.Literals(["iphone-15-pro", "pixel-8", "ipad-mini"]);
export type TrafficLensMobilePreset = typeof TrafficLensMobilePreset.Type;

export const TrafficLensTabSnapshot = Schema.Struct({
  tabId: TrafficLensTabId,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  profileId: Schema.NullOr(TrafficLensProfileId),
  profileName: Schema.NullOr(Schema.String),
  viewMode: TrafficLensViewMode,
  mobilePreset: TrafficLensMobilePreset,
});
export type TrafficLensTabSnapshot = typeof TrafficLensTabSnapshot.Type;

// ─── Input Schemas ──────────────────────────────────────────────────────────

export const TrafficLensCreateTabInput = Schema.Struct({
  url: Schema.optional(Schema.String),
});
export type TrafficLensCreateTabInput = typeof TrafficLensCreateTabInput.Type;

export const TrafficLensCreateTabInProfileInput = Schema.Struct({
  url: Schema.optional(Schema.String),
  profileId: TrafficLensProfileId,
});
export type TrafficLensCreateTabInProfileInput = typeof TrafficLensCreateTabInProfileInput.Type;

export const TrafficLensNavigateInput = Schema.Struct({
  tabId: TrafficLensTabId,
  url: Schema.String,
});
export type TrafficLensNavigateInput = typeof TrafficLensNavigateInput.Type;

export const TrafficLensBoundsInput = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type TrafficLensBoundsInput = typeof TrafficLensBoundsInput.Type;

export const TrafficLensSetTabViewModeInput = Schema.Struct({
  tabId: TrafficLensTabId,
  viewMode: TrafficLensViewMode,
});
export type TrafficLensSetTabViewModeInput = typeof TrafficLensSetTabViewModeInput.Type;

export const TrafficLensSetTabMobilePresetInput = Schema.Struct({
  tabId: TrafficLensTabId,
  mobilePreset: TrafficLensMobilePreset,
});
export type TrafficLensSetTabMobilePresetInput = typeof TrafficLensSetTabMobilePresetInput.Type;

export const TrafficLensPausedRequest = Schema.Struct({
  pauseId: TrafficLensPauseId,
  tabId: Schema.String,
  requestId: Schema.String,
  phase: TrafficLensInterceptPhase,
  method: Schema.String,
  url: Schema.String,
  headers: StringRecord,
  body: Schema.NullOr(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  responseHeaders: Schema.optional(StringRecord),
  createdAt: Schema.String,
});
export type TrafficLensPausedRequest = typeof TrafficLensPausedRequest.Type;

export const TrafficLensContinueInput = Schema.Struct({
  pauseId: TrafficLensPauseId,
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecord),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  statusCode: Schema.optional(Schema.Number),
});
export type TrafficLensContinueInput = typeof TrafficLensContinueInput.Type;

export const TrafficLensDropPausedInput = Schema.Struct({
  pauseId: TrafficLensPauseId,
});
export type TrafficLensDropPausedInput = typeof TrafficLensDropPausedInput.Type;

// ─── Events ─────────────────────────────────────────────────────────────────

export const TrafficLensTabCreatedEvent = Schema.Struct({
  type: Schema.Literal("tab.created"),
  snapshot: TrafficLensTabSnapshot,
});

export const TrafficLensTabClosedEvent = Schema.Struct({
  type: Schema.Literal("tab.closed"),
  tabId: TrafficLensTabId,
});

export const TrafficLensTabNavigatedEvent = Schema.Struct({
  type: Schema.Literal("tab.navigated"),
  tabId: TrafficLensTabId,
  url: Schema.String,
});

export const TrafficLensTabTitleUpdatedEvent = Schema.Struct({
  type: Schema.Literal("tab.titleUpdated"),
  tabId: TrafficLensTabId,
  title: Schema.String,
});

export const TrafficLensTabLoadingChangedEvent = Schema.Struct({
  type: Schema.Literal("tab.loadingChanged"),
  tabId: TrafficLensTabId,
  loading: Schema.Boolean,
});

export const TrafficLensTabViewModeChangedEvent = Schema.Struct({
  type: Schema.Literal("tab.viewModeChanged"),
  tabId: TrafficLensTabId,
  viewMode: TrafficLensViewMode,
});

export const TrafficLensTabMobilePresetChangedEvent = Schema.Struct({
  type: Schema.Literal("tab.mobilePresetChanged"),
  tabId: TrafficLensTabId,
  mobilePreset: TrafficLensMobilePreset,
});

export const TrafficLensTabEvent = Schema.Union([
  TrafficLensTabCreatedEvent,
  TrafficLensTabClosedEvent,
  TrafficLensTabNavigatedEvent,
  TrafficLensTabTitleUpdatedEvent,
  TrafficLensTabLoadingChangedEvent,
  TrafficLensTabViewModeChangedEvent,
  TrafficLensTabMobilePresetChangedEvent,
]);
export type TrafficLensTabEvent = typeof TrafficLensTabEvent.Type;

export const TrafficLensPausedCreatedEvent = Schema.Struct({
  type: Schema.Literal("paused.created"),
  paused: TrafficLensPausedRequest,
});

export const TrafficLensPausedResolvedEvent = Schema.Struct({
  type: Schema.Literal("paused.resolved"),
  pauseId: TrafficLensPauseId,
});

export const TrafficLensPausedEvent = Schema.Union([
  TrafficLensPausedCreatedEvent,
  TrafficLensPausedResolvedEvent,
]);
export type TrafficLensPausedEvent = typeof TrafficLensPausedEvent.Type;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class TrafficLensTabNotFoundError extends Schema.TaggedErrorClass<TrafficLensTabNotFoundError>()(
  "TrafficLensTabNotFoundError",
  { tabId: Schema.String, message: Schema.String },
) {}

export class TrafficLensError extends Schema.TaggedErrorClass<TrafficLensError>()(
  "TrafficLensError",
  { message: Schema.String },
) {}

export class TrafficLensNotFoundError extends Schema.TaggedErrorClass<TrafficLensNotFoundError>()(
  "TrafficLensNotFoundError",
  { trafficId: Schema.Number, message: Schema.String },
) {}

// ─── Traffic Schemas ───────────────────────────────────────────────────────

export const TrafficLensEntry = Schema.Struct({
  id: Schema.Number,
  tabId: Schema.String,
  requestId: Schema.String,
  method: Schema.String,
  url: Schema.String,
  host: Schema.String,
  path: Schema.String,
  statusCode: Schema.NullOr(Schema.Number),
  contentType: Schema.NullOr(Schema.String),
  contentLength: Schema.NullOr(Schema.Number),
  bodyTruncated: Schema.Boolean,
  isWebSocket: Schema.Boolean,
  timingStartedAt: Schema.String,
  timingResponseAt: Schema.NullOr(Schema.String),
  timingCompletedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type TrafficLensEntry = typeof TrafficLensEntry.Type;

export const TrafficLensDetail = Schema.Struct({
  ...TrafficLensEntry.fields,
  requestHeadersJson: Schema.String,
  requestBody: Schema.NullOr(Schema.String),
  responseHeadersJson: Schema.NullOr(Schema.String),
  responseBody: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
});
export type TrafficLensDetail = typeof TrafficLensDetail.Type;

export const TrafficLensQueryInput = Schema.Struct({
  tabId: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});
export type TrafficLensQueryInput = typeof TrafficLensQueryInput.Type;

export const TrafficLensIngestPayload = Schema.Struct({
  tabId: Schema.String,
  requestId: Schema.String,
  stage: Schema.Union([Schema.Literal("request"), Schema.Literal("response")]),
  method: Schema.String,
  url: Schema.String,
  host: Schema.String,
  path: Schema.String,
  statusCode: Schema.optional(Schema.Number),
  contentType: Schema.optional(Schema.String),
  contentLength: Schema.optional(Schema.Number),
  requestHeadersJson: Schema.optional(Schema.String),
  requestBody: Schema.optional(Schema.NullOr(Schema.String)),
  responseHeadersJson: Schema.optional(Schema.String),
  responseBody: Schema.optional(Schema.NullOr(Schema.String)),
  bodyTruncated: Schema.optional(Schema.Boolean),
  timestamp: Schema.String,
});
export type TrafficLensIngestPayload = typeof TrafficLensIngestPayload.Type;

// ─── Replay Schemas ───────────────────────────────────────────────────────

export const TrafficLensReplayInput = Schema.Struct({
  trafficId: Schema.optional(Schema.Number),
  method: Schema.String,
  url: Schema.String,
  headers: StringRecord,
  body: Schema.optional(Schema.NullOr(Schema.String)), // base64
});
export type TrafficLensReplayInput = typeof TrafficLensReplayInput.Type;

export const TrafficLensReplayResponse = Schema.Struct({
  statusCode: Schema.Number,
  statusText: Schema.String,
  headers: StringRecord,
  body: Schema.NullOr(Schema.String), // base64
  timing: Schema.Number, // ms
});
export type TrafficLensReplayResponse = typeof TrafficLensReplayResponse.Type;

// ─── Traffic Events ────────────────────────────────────────────────────────

export const TrafficLensCapturedEvent = Schema.Struct({
  type: Schema.Literal("traffic.captured"),
  entry: TrafficLensEntry,
});

export const TrafficLensFindingCreatedEvent = Schema.Struct({
  type: Schema.Literal("finding.created"),
  finding: TrafficLensFinding,
});

export const TrafficLensEvent = Schema.Union([
  TrafficLensTabCreatedEvent,
  TrafficLensTabClosedEvent,
  TrafficLensTabNavigatedEvent,
  TrafficLensTabTitleUpdatedEvent,
  TrafficLensTabLoadingChangedEvent,
  TrafficLensCapturedEvent,
  TrafficLensFindingCreatedEvent,
]);
export type TrafficLensEvent = typeof TrafficLensEvent.Type;
