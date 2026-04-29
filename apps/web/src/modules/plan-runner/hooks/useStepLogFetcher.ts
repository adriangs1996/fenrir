import { useEffect, useRef } from "react";
import { PlanRunId as PlanRunIdSchema } from "@fenrir/contracts";
import type { WsRpcClient } from "~/rpc/wsRpcClient";
import { stepLogCacheKey, usePlanRunnerStore } from "../stores/usePlanRunnerStore";

/**
 * Backfill the cached step log for `(runId, stepKey)` once per selection.
 *
 * Live appends arrive via the global WebSocket subscription (see
 * `usePlanRunnerSync`) and merge into the same cache slot, so a one-shot
 * `getStepLog` is enough to seed history when a step is first opened.
 *
 * The fetch is gated by an in-memory ref so reselecting the same step within
 * a session does not re-issue the RPC. The cache itself is also rolled over
 * by `upsertRun` when a new run id replaces an old one for the same feature,
 * so reopening that older run id later would still see a stale-empty cache —
 * which is fine because the old run is unreachable from the UI.
 */
export function useStepLogFetcher(
  rpcClient: WsRpcClient | null,
  runId: string | null,
  stepKey: string | null,
): void {
  const setStepLog = usePlanRunnerStore((s) => s.setStepLog);
  const fetchedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!rpcClient || !runId || !stepKey) return;
    const cacheKey = stepLogCacheKey(runId, stepKey);
    if (fetchedKeysRef.current.has(cacheKey)) return;
    fetchedKeysRef.current.add(cacheKey);

    let cancelled = false;
    rpcClient.planRunner
      .getStepLog({
        runId: PlanRunIdSchema.makeUnsafe(runId),
        stepKey,
      })
      .then((result) => {
        if (cancelled) return;
        setStepLog(runId, stepKey, result.entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Allow a retry on next selection if the fetch failed.
        fetchedKeysRef.current.delete(cacheKey);
        console.error("planRunner.getStepLog failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [rpcClient, runId, stepKey, setStepLog]);
}
