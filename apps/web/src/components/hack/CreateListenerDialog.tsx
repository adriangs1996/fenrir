import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

import type { CreateListenerInput } from "@fenrir/contracts";

interface CreateListenerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateListener: (input: CreateListenerInput) => void;
}

const PAYLOAD_OPTIONS = [
  {
    value: "windows/meterpreter/reverse_tcp",
    label: "Windows Meterpreter x86 (TCP)",
  },
  {
    value: "windows/x64/meterpreter/reverse_tcp",
    label: "Windows Meterpreter x64 (TCP)",
  },
  {
    value: "linux/x86/meterpreter/reverse_tcp",
    label: "Linux Meterpreter x86 (TCP)",
  },
  {
    value: "linux/x64/meterpreter/reverse_tcp",
    label: "Linux Meterpreter x64 (TCP)",
  },
  { value: "cmd/unix/reverse_bash", label: "Unix Reverse Bash" },
  { value: "generic/shell_reverse_tcp", label: "Generic Reverse Shell (TCP)" },
  {
    value: "java/meterpreter/reverse_tcp",
    label: "Java Meterpreter (TCP)",
  },
  {
    value: "php/meterpreter/reverse_tcp",
    label: "PHP Meterpreter (TCP)",
  },
] as const;

export function CreateListenerDialog({
  open,
  onOpenChange,
  onCreateListener,
}: CreateListenerDialogProps) {
  const [name, setName] = useState("");
  const [payload, setPayload] = useState(PAYLOAD_OPTIONS[0].value);
  const [lhost, setLhost] = useState("0.0.0.0");
  const [lport, setLport] = useState("4444");

  const parsedPort = Number(lport);
  const isPortValid = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;

  const handleCreate = () => {
    if (!isPortValid) {
      return;
    }
    onCreateListener({
      name: name.trim(),
      payload,
      lhost: lhost.trim(),
      lport: parsedPort,
    } as CreateListenerInput);
    onOpenChange(false);
    setName("");
    setPayload(PAYLOAD_OPTIONS[0].value);
    setLhost("0.0.0.0");
    setLport("4444");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Listener</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="listener-name">Name</Label>
            <Input
              id="listener-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Listener"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="listener-payload">Payload</Label>
            <select
              id="listener-payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value as typeof payload)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {PAYLOAD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="listener-lhost">LHOST</Label>
              <Input
                id="listener-lhost"
                value={lhost}
                onChange={(e) => setLhost(e.target.value)}
                placeholder="0.0.0.0"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="listener-lport">LPORT</Label>
              <Input
                id="listener-lport"
                type="number"
                value={lport}
                onChange={(e) => setLport(e.target.value)}
                placeholder="4444"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || !isPortValid}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
