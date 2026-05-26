import { useEffect, useMemo, useState } from "react";
import type { TrafficLensRuleId } from "@fenrir/contracts";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime/service";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTrafficLensStore } from "../stores/useTrafficLensStore";
import {
  decodeBase64ToText,
  encodeTextToBase64,
  headersToText,
  parseHeadersText,
} from "../httpSerialization";
import { toRuleInput } from "../workbenchModels";
import { cn } from "~/lib/utils";

export function InterceptPanel() {
  const pausedRequestsById = useTrafficLensStore((state) => state.pausedRequests);
  const selectedPausedId = useTrafficLensStore((state) => state.selectedPausedId);
  const rulesById = useTrafficLensStore((state) => state.rules);
  const pausedRequests = useMemo(
    () =>
      Object.values(pausedRequestsById).sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [pausedRequestsById],
  );
  const selectedPaused = useMemo(
    () => (selectedPausedId ? (pausedRequestsById[selectedPausedId] ?? null) : null),
    [pausedRequestsById, selectedPausedId],
  );
  const rules = useMemo(
    () =>
      Object.values(rulesById).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [rulesById],
  );
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [ruleName, setRuleName] = useState("Pause API");
  const [ruleMethod, setRuleMethod] = useState("GET");
  const [ruleUrlPattern, setRuleUrlPattern] = useState("*api*");
  const [rulePhase, setRulePhase] = useState<"beforeRequest" | "beforeResponse">("beforeRequest");
  const rpcClient = useMemo(() => {
    try {
      return getPrimaryEnvironmentConnection().client;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!selectedPaused) {
      return;
    }
    setUrl(selectedPaused.url);
    setHeadersText(headersToText(selectedPaused.responseHeaders ?? selectedPaused.headers));
    setBodyText(selectedPaused.body ? decodeBase64ToText(selectedPaused.body) : "");
    setStatusCode(selectedPaused.statusCode ? String(selectedPaused.statusCode) : "");
  }, [selectedPaused]);

  const handleContinue = async () => {
    if (!selectedPaused) {
      return;
    }
    await window.desktopBridge?.trafficLensContinuePaused({
      pauseId: selectedPaused.pauseId,
      url,
      headers: parseHeadersText(headersText),
      body: bodyText.length > 0 ? encodeTextToBase64(bodyText) : null,
      ...(selectedPaused.phase === "beforeResponse" && statusCode.trim()
        ? { statusCode: Number(statusCode) }
        : {}),
    });
  };

  const handleDrop = async () => {
    if (!selectedPaused) {
      return;
    }
    await window.desktopBridge?.trafficLensDropPaused({ pauseId: selectedPaused.pauseId });
  };

  const handleCreatePauseRule = async () => {
    if (!rpcClient || !window.desktopBridge) {
      return;
    }
    const runtimeRule = await window.desktopBridge.trafficLensCreateRule({
      name: ruleName,
      enabled: true,
      phase: rulePhase,
      action: "pause",
      scope: {
        method: ruleMethod,
        urlPattern: ruleUrlPattern,
      },
    });
    const persistedRule = await rpcClient.trafficLens.upsertRule({
      id: runtimeRule.id,
      input: toRuleInput(runtimeRule),
    });
    const nextRules = [
      ...Object.values(useTrafficLensStore.getState().rules).filter(
        (rule) => rule.id !== persistedRule.id,
      ),
      persistedRule,
    ];
    useTrafficLensStore.getState().setRules(nextRules);
  };

  const handleToggleRule = async (ruleId: TrafficLensRuleId, enabled: boolean) => {
    if (!rpcClient || !window.desktopBridge) {
      return;
    }
    const existingRule = useTrafficLensStore.getState().rules[ruleId];
    if (!existingRule) {
      return;
    }
    await window.desktopBridge.trafficLensSetRuleEnabled(ruleId, enabled);
    const persistedRule = await rpcClient.trafficLens.upsertRule({
      id: ruleId,
      input: {
        ...toRuleInput(existingRule),
        enabled,
      },
    });
    useTrafficLensStore
      .getState()
      .setRules(
        Object.values(useTrafficLensStore.getState().rules).map((rule) =>
          rule.id === persistedRule.id ? persistedRule : rule,
        ),
      );
  };

  const handleDeleteRule = async (ruleId: TrafficLensRuleId) => {
    if (!rpcClient || !window.desktopBridge) {
      return;
    }
    await Promise.all([
      window.desktopBridge.trafficLensDeleteRule(ruleId),
      rpcClient.trafficLens.deleteRule({ id: ruleId }),
    ]);
    useTrafficLensStore
      .getState()
      .setRules(
        Object.values(useTrafficLensStore.getState().rules).filter((rule) => rule.id !== ruleId),
      );
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
      <div className="flex min-h-0 flex-col border-r border-border/70">
        <div className="border-b border-border/70 px-3 py-2 text-xs font-medium text-muted-foreground">
          Paused Requests
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {pausedRequests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
              No intercepted traffic is paused right now.
            </div>
          ) : (
            <div className="space-y-2">
              {pausedRequests.map((paused) => (
                <button
                  key={paused.pauseId}
                  type="button"
                  className={cn(
                    "block w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                    paused.pauseId === selectedPausedId
                      ? "border-border bg-accent text-accent-foreground"
                      : "border-border/60 hover:bg-muted/40",
                  )}
                  onClick={() =>
                    useTrafficLensStore.getState().setSelectedPausedRequest(paused.pauseId)
                  }
                >
                  <div className="font-mono text-[11px] uppercase text-muted-foreground">
                    {paused.phase}
                  </div>
                  <div className="mt-1 truncate font-medium">
                    {paused.method} {paused.url}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-border/70 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Break Rule</div>
          <div className="space-y-2">
            <Input
              nativeInput
              value={ruleName}
              onChange={(event) => setRuleName(event.currentTarget.value)}
              placeholder="Rule name"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={ruleMethod}
                onChange={(event) => setRuleMethod(event.currentTarget.value)}
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={rulePhase}
                onChange={(event) =>
                  setRulePhase(event.currentTarget.value as "beforeRequest" | "beforeResponse")
                }
              >
                <option value="beforeRequest">Before Request</option>
                <option value="beforeResponse">Before Response</option>
              </select>
            </div>
            <Input
              nativeInput
              value={ruleUrlPattern}
              onChange={(event) => setRuleUrlPattern(event.currentTarget.value)}
              placeholder="*api*"
            />
            <Button className="w-full" size="sm" onClick={() => void handleCreatePauseRule()}>
              Add Pause Rule
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_220px] overflow-hidden">
        <div className="min-h-0 overflow-y-auto p-3">
          {!selectedPaused ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
              Select a paused request to edit and continue it.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">URL</div>
                <Input
                  nativeInput
                  value={url}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                />
              </div>
              {selectedPaused.phase === "beforeResponse" ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Status Code</div>
                  <Input
                    nativeInput
                    value={statusCode}
                    onChange={(event) => setStatusCode(event.currentTarget.value)}
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Headers</div>
                <textarea
                  className="min-h-40 w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={headersText}
                  onChange={(event) => setHeadersText(event.currentTarget.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Body</span>
                  {selectedPaused.phase === "beforeResponse" ? (
                    <span>Response-body edits are not applied in this build.</span>
                  ) : null}
                </div>
                <textarea
                  className="min-h-48 w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={bodyText}
                  onChange={(event) => setBodyText(event.currentTarget.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleContinue()}>
                  Continue
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleDrop()}>
                  Drop
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 border-t border-border/70 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Active Break Rules</div>
          <div className="space-y-2 overflow-y-auto">
            {rules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                No break rules defined yet.
              </div>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{rule.name}</div>
                    <div className="truncate text-muted-foreground">
                      {rule.phase} {rule.scope.method ?? "*"} {rule.scope.urlPattern ?? "*"}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant={rule.enabled ? "secondary" : "outline"}
                    onClick={() => void handleToggleRule(rule.id, !rule.enabled)}
                  >
                    {rule.enabled ? "On" : "Off"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void handleDeleteRule(rule.id)}>
                    Delete
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
