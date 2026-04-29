import { useEffect } from "react";
import { useMetasploitStore } from "../../metasploitStore";
import { useMetasploitSessionTerminalStore } from "../../metasploitSessionTerminalStore";
import type { WsRpcClient } from "../../rpc/wsRpcClient";

export function useMetasploitSync(rpcClient: WsRpcClient | null) {
  const applyEvent = useMetasploitStore((s) => s.applyEvent);
  const setConnected = useMetasploitStore((s) => s.setConnected);
  const upsertListener = useMetasploitStore((s) => s.upsertListener);
  const upsertSession = useMetasploitStore((s) => s.upsertSession);
  const appendOutput = useMetasploitSessionTerminalStore((s) => s.appendOutput);

  useEffect(() => {
    if (!rpcClient) return;
    let cancelled = false;

    // 1. Subscribe FIRST so we don't drop events fired between list-call ack and list-result.
    const unsubscribe = rpcClient.metasploit.onEvent((event) => {
      if (cancelled) return;
      applyEvent(event);
      if (event.type === "session.output") {
        appendOutput(event.sessionId, event.data);
      }
    });

    // 2. Fetch initial state (after subscribe is wired).
    //    status() also triggers server-side ensureStarted.
    rpcClient.metasploit.status().then(
      (status) => {
        if (!cancelled) setConnected(status.connected);
      },
      () => {
        if (!cancelled) setConnected(false);
      },
    );

    rpcClient.metasploit.listListeners().then(
      (listeners) => {
        if (cancelled) return;
        listeners.forEach(upsertListener);
      },
      () => {},
    );

    rpcClient.metasploit.listSessions().then(
      (sessions) => {
        if (cancelled) return;
        sessions.forEach(upsertSession);
      },
      () => {},
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [rpcClient, applyEvent, setConnected, upsertListener, upsertSession, appendOutput]);
}
