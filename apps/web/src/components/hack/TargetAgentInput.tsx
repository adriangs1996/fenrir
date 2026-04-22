import { useState, useCallback } from "react";
import { Button } from "../ui/button";
import { useTargetAgent } from "./useTargetAgent";

interface TargetAgentInputProps {
  sessionId: string;
}

export function TargetAgentInput({ sessionId }: TargetAgentInputProps) {
  const [input, setInput] = useState("");
  const { sendInstruction, isProcessing, messages } = useTargetAgent(sessionId);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isProcessing) return;
    sendInstruction(input.trim());
    setInput("");
  }, [input, isProcessing, sendInstruction]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="border-t border-border">
      {/* Agent message history (compact) */}
      {messages.length > 0 && (
        <div className="max-h-32 overflow-y-auto border-b border-border px-4 py-2">
          {messages.slice(-5).map((msg, i) => (
            <div
              key={i}
              className={`text-xs ${
                msg.role === "user"
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="font-medium">
                {msg.role === "user" ? "You" : "Agent"}:
              </span>{" "}
              {msg.content}
            </div>
          ))}
        </div>
      )}
      {/* Input area */}
      <div className="flex items-center gap-2 px-4 py-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent to run commands on the target..."
          className="flex-1 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={isProcessing}
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!input.trim() || isProcessing}
        >
          {isProcessing ? "Running..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
