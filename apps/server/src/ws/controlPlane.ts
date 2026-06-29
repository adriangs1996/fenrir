import { makeRpcDomain, makeRpcDomainWithErrors } from "./handlers";

/**
 * WebSocket route helpers for server-owned lifecycle and metadata contracts.
 *
 * These aliases intentionally keep the existing RPC transport and payloads. They
 * mark route modules as control-plane surfaces so future bulk terminal,
 * provider, process log, or raw TCP streams can move behind an explicit data
 * plane without threading byte streams through orchestration routes.
 */
export const makeControlPlaneDomain = makeRpcDomain;
export const makeControlPlaneDomainWithErrors = makeRpcDomainWithErrors;
