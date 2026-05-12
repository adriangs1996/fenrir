import { AlertCircleIcon, ArrowLeftIcon, PlusIcon, XIcon, ZapIcon } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { ServerProviderSkill } from "@fenrir/contracts";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { toastManager } from "~/components/ui/toast";
import { useFilteredSkills, useSkillActions, useSkills } from "~/hooks/useSkills";
import { readLocalApi } from "~/localApi";
import { useRightPanelStore } from "~/rightPanelStore";
import { SkillInspectView } from "./SkillInspectView";
import { SkillListItem } from "./SkillListItem";
import {
  parseTagInput,
  SkillMetadataForm,
  type SkillMetadataFormValues,
} from "./SkillMetadataForm";
import { SkillSearchBar } from "./SkillSearchBar";
import { SkillTagFilter } from "./SkillTagFilter";
import { openCanonicalSkillFileInEditor } from "./skillFiles";
import { useSkillPanelStore } from "./stores/skillPanelStore";

interface SkillsPanelProps {
  onInsert: (skillName: string) => void;
}

const NEW_SKILL_PLACEHOLDER_BODY = "TODO: Define the skill content";

const EMPTY_CREATE_VALUES: SkillMetadataFormValues = {
  displayName: "",
  name: "",
  description: "",
  icon: "default",
  tagsInput: "",
  enabled: false,
};

export function SkillsPanel({ onInsert }: SkillsPanelProps) {
  const { view } = useSkillPanelStore();

  switch (view.kind) {
    case "list":
      return <SkillsListView onInsert={onInsert} />;
    case "inspect":
      return <SkillInspectView skillName={view.skillName} onInsert={onInsert} />;
    case "create":
      return <SkillCreateView />;
    case "edit":
      return <SkillEditView skillName={view.skillName} />;
  }
}

function SkillsListView({ onInsert }: { onInsert: (skillName: string) => void }) {
  const {
    searchQuery,
    activeTagFilter,
    setSearchQuery,
    setActiveTagFilter,
    setView,
    openInspectView,
  } = useSkillPanelStore();
  const { close } = useRightPanelStore();
  const { update, delete: deleteSkill } = useSkillActions();

  const skills = useFilteredSkills(searchQuery, activeTagFilter ?? undefined);
  const allSkills = useFilteredSkills("", undefined);

  const handleInsert = useCallback(
    (skillName: string) => {
      onInsert(skillName);
      close();
    },
    [onInsert, close],
  );

  const handleToggleEnabled = useCallback(
    async (skill: ServerProviderSkill) => {
      try {
        await update({ name: skill.name, enabled: !skill.enabled });
        toastManager.add({
          type: "success",
          title: skill.enabled ? `/${skill.name} disabled` : `/${skill.name} enabled`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to update skill",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [update],
  );

  const handleDelete = useCallback(
    async (skill: ServerProviderSkill) => {
      const api = readLocalApi();
      if (!api) {
        toastManager.add({ type: "error", title: "Delete is unavailable right now" });
        return;
      }

      const confirmed = await api.dialogs.confirm(`Delete /${skill.name}? This cannot be undone.`);
      if (!confirmed) return;

      try {
        await deleteSkill(skill.name);
        toastManager.add({
          type: "success",
          title: `/${skill.name} deleted`,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to delete skill",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [deleteSkill],
  );

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Skills"
        onCreate={() => setView({ kind: "create" })}
        onClose={close}
        showCreate
      />

      <div className="shrink-0 space-y-2 px-3 py-2">
        <SkillSearchBar value={searchQuery} onChange={setSearchQuery} />
        <SkillTagFilter
          skills={allSkills}
          activeTag={activeTagFilter}
          onTagChange={setActiveTagFilter}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {skills.length === 0 ? (
          <SkillsEmptyState
            hasQuery={searchQuery.length > 0 || activeTagFilter !== null}
            onCreate={() => setView({ kind: "create" })}
          />
        ) : (
          <ScrollArea className="h-full">
            <div className="divide-y divide-border/40">
              {skills.map((skill) => (
                <SkillListItem
                  key={skill.name}
                  skill={skill}
                  onInspect={openInspectView}
                  onEditMetadata={(skillName) => setView({ kind: "edit", skillName })}
                  onToggleEnabled={handleToggleEnabled}
                  onDelete={handleDelete}
                  onInsert={handleInsert}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function SkillCreateView() {
  const { create, getDetails } = useSkillActions();
  const { goBack, openInspectView, setSkillDetails } = useSkillPanelStore();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (values: SkillMetadataFormValues) => {
      setPending(true);
      setErrorMessage(null);

      try {
        const created = await create({
          name: values.name,
          displayName: values.displayName,
          description: values.description,
          body: NEW_SKILL_PLACEHOLDER_BODY,
          icon: values.icon,
          tags: parseTagInput(values.tagsInput),
          enabled: values.enabled,
        });

        const details = await getDetails(created.name);
        setSkillDetails(created.name, details);
        try {
          const api = readLocalApi();
          if (!api) {
            throw new Error("Open in editor is unavailable.");
          }
          await openCanonicalSkillFileInEditor(api, details);
        } catch (error) {
          openInspectView(created.name);
          toastManager.add({
            type: "error",
            title: "Skill created, but editor handoff failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
          return;
        }

        openInspectView(created.name);
        toastManager.add({
          type: "success",
          title: `/${created.name} created`,
          description: "Opened canonical skill.md in your preferred editor.",
        });
      } catch (error) {
        const description = error instanceof Error ? error.message : "An error occurred.";
        setErrorMessage(description);
        toastManager.add({
          type: "error",
          title: "Unable to create skill",
          description,
        });
      } finally {
        setPending(false);
      }
    },
    [create, getDetails, openInspectView, setSkillDetails],
  );

  return (
    <SkillMetadataScreen
      title="New Skill"
      onBack={goBack}
      body={
        <SkillMetadataForm
          mode="create"
          title="Create a skill"
          description="Capture metadata here, then write the real body in your editor."
          initialValues={EMPTY_CREATE_VALUES}
          pending={pending}
          errorMessage={errorMessage}
          submitLabel="Create and open skill.md"
          onCancel={goBack}
          onSubmit={handleSubmit}
        />
      }
    />
  );
}

function SkillEditView({ skillName }: { skillName: string }) {
  const skills = useSkills();
  const skill = skills.find((entry) => entry.name === skillName) ?? null;
  const { update, getDetails } = useSkillActions();
  const { openInspectView, detailStateBySkillName, setSkillDetails, setSkillDetailError } =
    useSkillPanelStore();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const initialValues = useMemo<SkillMetadataFormValues | null>(() => {
    if (!skill) return null;
    return {
      displayName: skill.displayName,
      name: skill.name,
      description: skill.description,
      icon: skill.icon ?? "default",
      tagsInput: skill.tags.join(", "),
      enabled: skill.enabled,
    };
  }, [skill]);

  const openCanonicalFile = useCallback(async () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({ type: "error", title: "Open in editor is unavailable" });
      return;
    }

    try {
      const detailState = detailStateBySkillName[skillName];
      const details =
        detailState?.status === "loaded" ? detailState.details : await getDetails(skillName);
      setSkillDetails(skillName, details);
      await openCanonicalSkillFileInEditor(api, details);
    } catch (error) {
      const description = error instanceof Error ? error.message : "An error occurred.";
      setSkillDetailError(skillName, description);
      toastManager.add({
        type: "error",
        title: "Unable to open skill.md",
        description,
      });
    }
  }, [detailStateBySkillName, getDetails, setSkillDetailError, setSkillDetails, skillName]);

  const handleSubmit = useCallback(
    async (values: SkillMetadataFormValues) => {
      setPending(true);
      setErrorMessage(null);

      try {
        await update({
          name: skillName,
          displayName: values.displayName,
          description: values.description,
          icon: values.icon,
          tags: parseTagInput(values.tagsInput),
          enabled: values.enabled,
        });
        openInspectView(skillName);
        toastManager.add({
          type: "success",
          title: `/${skillName} metadata updated`,
        });
      } catch (error) {
        const description = error instanceof Error ? error.message : "An error occurred.";
        setErrorMessage(description);
        toastManager.add({
          type: "error",
          title: "Unable to update skill",
          description,
        });
      } finally {
        setPending(false);
      }
    },
    [openInspectView, skillName, update],
  );

  return (
    <SkillMetadataScreen
      title={`Edit /${skillName}`}
      onBack={() => openInspectView(skillName)}
      body={
        initialValues ? (
          <SkillMetadataForm
            mode="edit"
            title="Edit metadata"
            description="Metadata updates leave the canonical folder and support files untouched."
            initialValues={initialValues}
            pending={pending}
            errorMessage={errorMessage}
            submitLabel="Save metadata"
            secondaryActionLabel="Open skill.md"
            onSecondaryAction={openCanonicalFile}
            onCancel={() => openInspectView(skillName)}
            onSubmit={handleSubmit}
          />
        ) : (
          <Alert variant="error">
            <AlertCircleIcon />
            <AlertTitle>Skill not found</AlertTitle>
            <AlertDescription>The selected skill is no longer available.</AlertDescription>
          </Alert>
        )
      }
    />
  );
}

function SkillMetadataScreen({
  title,
  onBack,
  body,
}: {
  title: string;
  onBack: () => void;
  body: ReactNode;
}) {
  const { close } = useRightPanelStore();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onBack}
          className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <span className="flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={close}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          aria-label="Close panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">{body}</div>
      </ScrollArea>
    </div>
  );
}

function PanelHeader({
  title,
  onCreate,
  onClose,
  showCreate = false,
}: {
  title: string;
  onCreate?: () => void;
  onClose: () => void;
  showCreate?: boolean;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <span className="text-sm font-medium text-foreground">{title}</span>
      <div className="flex items-center gap-0.5">
        {showCreate && onCreate ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onCreate}
            className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
            aria-label="Create skill"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onClose}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          aria-label="Close panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SkillsEmptyState({ hasQuery, onCreate }: { hasQuery: boolean; onCreate: () => void }) {
  if (hasQuery) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <ZapIcon className="size-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60">No skills match your search.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <ZapIcon className="size-7 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/60">No skills yet.</p>
        <Button variant="outline" size="sm" type="button" onClick={onCreate} className="gap-1.5">
          <PlusIcon className="size-3.5" />
          Create a skill
        </Button>
      </div>
    </div>
  );
}
