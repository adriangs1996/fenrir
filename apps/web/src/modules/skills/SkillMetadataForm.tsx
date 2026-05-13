import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { SkillIcon } from "@fenrir/contracts";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldItem, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

const SKILL_ICON_OPTIONS: ReadonlyArray<{ value: SkillIcon; label: string }> = [
  { value: "default", label: "Default" },
  { value: "flame", label: "Flame" },
  { value: "search", label: "Search" },
  { value: "code", label: "Code" },
  { value: "bug", label: "Bug" },
  { value: "test", label: "Test" },
  { value: "docs", label: "Docs" },
  { value: "security", label: "Security" },
  { value: "deploy", label: "Deploy" },
  { value: "design", label: "Design" },
  { value: "chat", label: "Chat" },
];

export interface SkillMetadataFormValues {
  displayName: string;
  name: string;
  description: string;
  icon: SkillIcon;
  tagsInput: string;
  enabled: boolean;
}

interface SkillMetadataFormProps {
  mode: "create" | "edit";
  title: string;
  description: string;
  initialValues: SkillMetadataFormValues;
  pending?: boolean;
  errorMessage?: string | null;
  submitLabel: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  onCancel: () => void;
  onSubmit: (values: SkillMetadataFormValues) => Promise<void> | void;
}

export function SkillMetadataForm({
  mode,
  title,
  description,
  initialValues,
  pending = false,
  errorMessage = null,
  submitLabel,
  secondaryActionLabel,
  onSecondaryAction,
  onCancel,
  onSubmit,
}: SkillMetadataFormProps) {
  const [values, setValues] = useState(initialValues);
  const [isNameDirty, setIsNameDirty] = useState(false);

  useEffect(() => {
    setValues(initialValues);
    setIsNameDirty(false);
  }, [initialValues]);

  const validationMessage = useMemo(() => validateValues(mode, values), [mode, values]);

  const handleDisplayNameChange = (nextDisplayName: string) => {
    setValues((current) => {
      const nextName =
        mode === "create" && !isNameDirty ? slugifySkillName(nextDisplayName) : current.name;
      return { ...current, displayName: nextDisplayName, name: nextName };
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validationMessage || pending) return;
    void onSubmit(normalizeValues(values));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {errorMessage ? (
            <Alert variant="error">
              <AlertCircleIcon />
              <AlertTitle>Unable to save skill</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 gap-4">
            <Field>
              <FieldLabel>Display name</FieldLabel>
              <FieldItem>
                <Input
                  value={values.displayName}
                  onChange={(event) => handleDisplayNameChange(event.target.value)}
                  placeholder="Code Review"
                  disabled={pending}
                />
              </FieldItem>
            </Field>

            <Field>
              <FieldLabel>Name</FieldLabel>
              <FieldItem>
                <Input
                  value={values.name}
                  onChange={(event) => {
                    setIsNameDirty(true);
                    setValues((current) => ({ ...current, name: event.target.value }));
                  }}
                  placeholder="code-review"
                  disabled={pending || mode === "edit"}
                />
              </FieldItem>
              <FieldDescription>
                {mode === "create"
                  ? "Used as the canonical folder name and slash-command id."
                  : "Name is fixed in v1 to avoid renaming the canonical folder."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Description</FieldLabel>
              <FieldItem>
                <Textarea
                  value={values.description}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Review code for correctness, risk, and missing tests."
                  disabled={pending}
                />
              </FieldItem>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field>
                <FieldLabel>Icon</FieldLabel>
                <Select
                  value={values.icon}
                  onValueChange={(nextIcon) =>
                    setValues((current) => ({ ...current, icon: nextIcon as SkillIcon }))
                  }
                  disabled={pending}
                >
                  <SelectTrigger aria-label="Skill icon">
                    <SelectValue>{skillIconLabel(values.icon)}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {SKILL_ICON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} hideIndicator>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Tags</FieldLabel>
                <FieldItem>
                  <Input
                    value={values.tagsInput}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, tagsInput: event.target.value }))
                    }
                    placeholder="review, quality, safety"
                    disabled={pending}
                  />
                </FieldItem>
                <FieldDescription>Comma-separated tags for search and filters.</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel>Enabled</FieldLabel>
              <label className="flex items-start gap-3 rounded-xl border border-border/60 px-3 py-3">
                <Checkbox
                  checked={values.enabled}
                  onCheckedChange={(checked) =>
                    setValues((current) => ({ ...current, enabled: checked === true }))
                  }
                  disabled={pending}
                />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">
                    {values.enabled ? "Skill is enabled" : "Skill starts disabled"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {mode === "create"
                      ? "Placeholder-backed skills default to disabled until their body is written."
                      : "Metadata edits do not touch the canonical file contents."}
                  </div>
                </div>
              </label>
            </Field>
          </div>

          {validationMessage ? (
            <p className="text-sm text-destructive-foreground">{validationMessage}</p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {secondaryActionLabel && onSecondaryAction ? (
              <Button
                type="button"
                variant="outline"
                onClick={onSecondaryAction}
                disabled={pending}
              >
                {secondaryActionLabel}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || validationMessage !== null}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function validateValues(mode: "create" | "edit", values: SkillMetadataFormValues): string | null {
  if (!values.displayName.trim()) return "Display name is required.";
  if (!values.description.trim()) return "Description is required.";

  if (mode === "create") {
    if (!values.name.trim()) return "Name is required.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.name.trim())) {
      return "Name must use lowercase letters, numbers, and hyphens.";
    }
  }

  const tags = parseTagInput(values.tagsInput);
  if (tags.some((tag) => tag.includes(" "))) {
    return "Tags should not contain spaces. Use commas to separate tags.";
  }

  return null;
}

function normalizeValues(values: SkillMetadataFormValues): SkillMetadataFormValues {
  return {
    ...values,
    displayName: values.displayName.trim(),
    name: values.name.trim(),
    description: values.description.trim(),
    tagsInput: parseTagInput(values.tagsInput).join(", "),
  };
}

export function parseTagInput(input: string): string[] {
  const deduped = new Set<string>();
  for (const part of input.split(",")) {
    const tag = part.trim();
    if (!tag) continue;
    deduped.add(tag);
  }
  return [...deduped];
}

function slugifySkillName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function skillIconLabel(icon: SkillIcon): string {
  return SKILL_ICON_OPTIONS.find((option) => option.value === icon)?.label ?? "Default";
}
