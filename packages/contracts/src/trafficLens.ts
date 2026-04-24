import { Schema } from "effect";
import { makeEntityId } from "./baseSchemas";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export const TrafficLensTabId = makeEntityId("TrafficLensTabId");
export type TrafficLensTabId = typeof TrafficLensTabId.Type;

// ─── Schemas ────────────────────────────────────────────────────────────────

export const TrafficLensTabSnapshot = Schema.Struct({
  tabId: TrafficLensTabId,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
});
export type TrafficLensTabSnapshot = typeof TrafficLensTabSnapshot.Type;

// ─── Input Schemas ──────────────────────────────────────────────────────────

export const TrafficLensCreateTabInput = Schema.Struct({
  url: Schema.optional(Schema.String),
});
export type TrafficLensCreateTabInput = typeof TrafficLensCreateTabInput.Type;

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

export const TrafficLensTabEvent = Schema.Union([
  TrafficLensTabCreatedEvent,
  TrafficLensTabClosedEvent,
  TrafficLensTabNavigatedEvent,
  TrafficLensTabTitleUpdatedEvent,
  TrafficLensTabLoadingChangedEvent,
]);
export type TrafficLensTabEvent = typeof TrafficLensTabEvent.Type;

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

// ─── Traffic Events ────────────────────────────────────────────────────────

export const TrafficLensCapturedEvent = Schema.Struct({
  type: Schema.Literal("traffic.captured"),
  entry: TrafficLensEntry,
});

export const TrafficLensEvent = Schema.Union([
  TrafficLensTabCreatedEvent,
  TrafficLensTabClosedEvent,
  TrafficLensTabNavigatedEvent,
  TrafficLensTabTitleUpdatedEvent,
  TrafficLensTabLoadingChangedEvent,
  TrafficLensCapturedEvent,
]);
export type TrafficLensEvent = typeof TrafficLensEvent.Type;
