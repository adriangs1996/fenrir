import { Schema } from "effect";
import { makeEntityId } from "./baseSchemas";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const BrowserTabId = makeEntityId("BrowserTabId");
export type BrowserTabId = typeof BrowserTabId.Type;

// ─── Schemas ────────────────────────────────────────────────────────────────

export const BrowserTabSnapshot = Schema.Struct({
  tabId: BrowserTabId,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
});
export type BrowserTabSnapshot = typeof BrowserTabSnapshot.Type;

// ─── Input Schemas ──────────────────────────────────────────────────────────

export const BrowserCreateTabInput = Schema.Struct({
  url: Schema.optional(Schema.String),
});
export type BrowserCreateTabInput = typeof BrowserCreateTabInput.Type;

export const BrowserNavigateInput = Schema.Struct({
  tabId: BrowserTabId,
  url: Schema.String,
});
export type BrowserNavigateInput = typeof BrowserNavigateInput.Type;

export const BrowserBoundsInput = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type BrowserBoundsInput = typeof BrowserBoundsInput.Type;

// ─── Events ─────────────────────────────────────────────────────────────────

export const BrowserTabCreatedEvent = Schema.Struct({
  type: Schema.Literal("tab.created"),
  snapshot: BrowserTabSnapshot,
});

export const BrowserTabClosedEvent = Schema.Struct({
  type: Schema.Literal("tab.closed"),
  tabId: BrowserTabId,
});

export const BrowserTabNavigatedEvent = Schema.Struct({
  type: Schema.Literal("tab.navigated"),
  tabId: BrowserTabId,
  url: Schema.String,
});

export const BrowserTabTitleUpdatedEvent = Schema.Struct({
  type: Schema.Literal("tab.titleUpdated"),
  tabId: BrowserTabId,
  title: Schema.String,
});

export const BrowserTabLoadingChangedEvent = Schema.Struct({
  type: Schema.Literal("tab.loadingChanged"),
  tabId: BrowserTabId,
  loading: Schema.Boolean,
});

export const BrowserTabEvent = Schema.Union([
  BrowserTabCreatedEvent,
  BrowserTabClosedEvent,
  BrowserTabNavigatedEvent,
  BrowserTabTitleUpdatedEvent,
  BrowserTabLoadingChangedEvent,
]);
export type BrowserTabEvent = typeof BrowserTabEvent.Type;

// ─── Errors ─────────────────────────────────────────────────────────────────

export class BrowserTabNotFoundError extends Schema.TaggedErrorClass<BrowserTabNotFoundError>()(
  "BrowserTabNotFoundError",
  { tabId: Schema.String, message: Schema.String },
) {}

export class BrowserError extends Schema.TaggedErrorClass<BrowserError>()(
  "BrowserError",
  { message: Schema.String },
) {}

export class BrowserTrafficNotFoundError extends Schema.TaggedErrorClass<BrowserTrafficNotFoundError>()(
  "BrowserTrafficNotFoundError",
  { trafficId: Schema.Number, message: Schema.String },
) {}

// ─── Traffic Schemas ───────────────────────────────────────────────────────

export const BrowserTrafficEntry = Schema.Struct({
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
export type BrowserTrafficEntry = typeof BrowserTrafficEntry.Type;

export const BrowserTrafficDetail = Schema.Struct({
  ...BrowserTrafficEntry.fields,
  requestHeadersJson: Schema.String,
  requestBody: Schema.NullOr(Schema.String),
  responseHeadersJson: Schema.NullOr(Schema.String),
  responseBody: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
});
export type BrowserTrafficDetail = typeof BrowserTrafficDetail.Type;

export const BrowserTrafficQueryInput = Schema.Struct({
  tabId: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});
export type BrowserTrafficQueryInput = typeof BrowserTrafficQueryInput.Type;

export const BrowserTrafficIngestPayload = Schema.Struct({
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
export type BrowserTrafficIngestPayload = typeof BrowserTrafficIngestPayload.Type;

// ─── Traffic Events ────────────────────────────────────────────────────────

export const BrowserTrafficCapturedEvent = Schema.Struct({
  type: Schema.Literal("traffic.captured"),
  entry: BrowserTrafficEntry,
});

export const BrowserEvent = Schema.Union([
  BrowserTabCreatedEvent,
  BrowserTabClosedEvent,
  BrowserTabNavigatedEvent,
  BrowserTabTitleUpdatedEvent,
  BrowserTabLoadingChangedEvent,
  BrowserTrafficCapturedEvent,
]);
export type BrowserEvent = typeof BrowserEvent.Type;
