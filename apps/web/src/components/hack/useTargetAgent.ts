import { useState, useCallback, useRef } from "react";
import { useMetasploitStore } from "../../metasploitStore";

interface AgentMessage {
  role: "user" | "agent";
  content: string;
}

export function useTargetAgent(sessionId: string) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const session = useMetasploitStore((s) => s.sessions[sessionId]);
  const messagesRef = useRef<AgentMessage[]>([]);

  // Keep ref in sync
  messagesRef.current = messages;

  const buildSystemPrompt = useCallback(() => {
    if (!session) return "";
    return [
      "You are a penetration testing agent operating on a compromised target.",
      `Target: ${session.targetHost}`,
      `Platform: ${session.platform}`,
      `Session Type: ${session.type}`,
      `Session Info: ${session.info}`,
      "",
      "You can execute commands on the target. When asked to perform an action,",
      "respond with the exact command(s) to run. The user will execute them.",
      "",
      session.type === "meterpreter"
        ? "You have a Meterpreter session. You can use Meterpreter commands."
        : "You have a raw shell. Use standard shell commands.",
    ].join("\n");
  }, [session]);

  const sendInstruction = useCallback(
    (instruction: string) => {
      const userMessage: AgentMessage = { role: "user", content: instruction };
      setMessages((prev) => [...prev, userMessage]);
      setIsProcessing(true);

      // Simulate agent response — in production, this would call the LLM
      // via the existing provider infrastructure
      const systemPrompt = buildSystemPrompt();

      // For now, provide a placeholder response indicating the agent
      // would process this through the provider infrastructure
      setTimeout(() => {
        const agentResponse: AgentMessage = {
          role: "agent",
          content: `[Agent would process: "${instruction}" with context: ${session?.targetHost ?? "unknown"} (${session?.type ?? "unknown"})]`,
        };
        setMessages((prev) => [...prev, agentResponse]);
        setIsProcessing(false);
      }, 500);
    },
    [buildSystemPrompt, session],
  );

  return {
    messages,
    isProcessing,
    sendInstruction,
  };
}
