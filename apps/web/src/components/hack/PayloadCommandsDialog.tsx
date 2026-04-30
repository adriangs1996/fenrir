import { useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import {
  generatePayloadCommands,
  type ListenerSnapshot,
  type PayloadType,
} from "@fenrir/contracts";
import { toastManager } from "../ui/toast";

interface PayloadCommandsDialogProps {
  listener: ListenerSnapshot | null;
  onOpenChange: (open: boolean) => void;
}

export function PayloadCommandsDialog({ listener, onOpenChange }: PayloadCommandsDialogProps) {
  const commands = listener
    ? generatePayloadCommands(listener.payload as PayloadType, listener.lhost, listener.lport)
    : [];

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toastManager.add({
        type: "success",
        title: "Copied",
        description: `${label} command copied to clipboard`,
      });
    } catch {
      toastManager.add({
        type: "error",
        title: "Copy failed",
        description: "Could not copy to clipboard",
      });
    }
  }, []);

  return (
    <Dialog open={listener !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payload Commands — {listener?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="text-xs text-muted-foreground">
            {listener?.payload} · {listener?.lhost}:{listener?.lport}
          </div>
          {commands.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No payload commands available for this payload type.
            </p>
          )}
          {commands.map((cmd) => (
            <div key={cmd.label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{cmd.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => copyToClipboard(cmd.command, cmd.label)}
                >
                  Copy
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                <code>{cmd.command}</code>
              </pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
