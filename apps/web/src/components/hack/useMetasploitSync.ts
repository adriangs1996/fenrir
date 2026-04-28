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

    // Fetch initial state
    rpcClient.metasploit.status().then(
      (status) => setConnected(status.connected),
      () => setConnected(false),
    );

    rpcClient.metasploit.listListeners().then(
      (listeners) => listeners.forEach(upsertListener),
      () => {},
    );

    rpcClient.metasploit.listSessions().then(
      (sessions) => sessions.forEach(upsertSession),
      () => {},
    );

    // Subscribe to events
    const unsubscribe = rpcClient.metasploit.onEvent((event) => {
      applyEvent(event);
      if (event.type === "session.output") {
        appendOutput(event.sessionId, event.data);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [rpcClient, applyEvent, setConnected, upsertListener, upsertSession, appendOutput]);
}
