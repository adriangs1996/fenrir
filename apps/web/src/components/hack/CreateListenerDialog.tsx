import { useState, type FormEvent } from "react";
import type { EnvironmentId } from "@fenrir/contracts";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { readEnvironmentApi } from "../../environmentApi";

interface Props {
  environmentId: EnvironmentId | null;
  trigger: React.ReactElement;
}

export function CreateListenerDialog({ environmentId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState("4444");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!environmentId) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;

    const portNum = Number.parseInt(port, 10);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port must be 1–65535");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.rawTcp.createListener({
        label: label.trim() || `Listener on ${host}:${portNum}`,
        host: host.trim() || "0.0.0.0",
        port: portNum,
      });
      setOpen(false);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create listener");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create raw TCP listener</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rtl-label">Label</Label>
            <Input
              id="rtl-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rtl-host">Host</Label>
            <Input id="rtl-host" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rtl-port">Port</Label>
            <Input id="rtl-port" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !environmentId}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
