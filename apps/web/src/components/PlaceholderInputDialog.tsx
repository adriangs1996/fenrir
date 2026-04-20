import type { GlobalScript, GlobalScriptProjectDefaults } from "@fenrir/contracts";
import React, { type FormEvent, useState, useMemo } from "react";
import { parsePlaceholders, substitutePlaceholders } from "~/lib/placeholders";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface PlaceholderInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  script: GlobalScript;
  defaults: GlobalScriptProjectDefaults | null;
  onRun: (values: Record<string, string>, saveAsDefault: boolean) => void;
}

export default function PlaceholderInputDialog({
  open,
  onOpenChange,
  script,
  defaults,
  onRun,
}: PlaceholderInputDialogProps) {
  const formId = React.useId();
  const placeholders = useMemo(() => parsePlaceholders(script.command), [script.command]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  // Reset values when dialog opens with new script/defaults
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const name of placeholders) {
        initial[name] = defaults?.defaults[name] ?? "";
      }
      setValues(initial);
      setSaveAsDefault(true);
    }
  }, [open, script.id, defaults, placeholders]);

  const resolvedCommand = useMemo(
    () => substitutePlaceholders(script.command, values),
    [script.command, values],
  );

  const allFilled = placeholders.every((name) => (values[name] ?? "").trim().length > 0);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!allFilled) return;
    onRun(values, saveAsDefault);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{script.name}</DialogTitle>
          <DialogDescription>Fill in the values to run this action</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id={formId} className="space-y-4" onSubmit={handleSubmit}>
            {placeholders.map((name) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={`placeholder-${name}`}>
                  <code className="text-xs">{name}</code>
                </Label>
                <Input
                  id={`placeholder-${name}`}
                  autoFocus={placeholders[0] === name}
                  placeholder={name}
                  value={values[name] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
                />
              </div>
            ))}

            <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
              <span>Save as default for this project</span>
              <Switch
                checked={saveAsDefault}
                onCheckedChange={(checked) => setSaveAsDefault(Boolean(checked))}
              />
            </label>

            {/* Command preview */}
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-1">Command preview</p>
              <code className="text-xs break-all">{resolvedCommand}</code>
            </div>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button form={formId} type="submit" disabled={!allFilled}>
            Run
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
