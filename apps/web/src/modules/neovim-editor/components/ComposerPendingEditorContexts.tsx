import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME } from "~/components/composerInlineChip";
import {
  type EditorContextDraft,
  formatEditorContextLabel,
  isEditorContextExpired,
} from "../editorContext";
import { EditorContextInlineChip } from "./EditorContextInlineChip";

interface ComposerPendingEditorContextsProps {
  contexts: ReadonlyArray<EditorContextDraft>;
  onRemove: (id: string) => void;
  className?: string;
}

interface ComposerPendingEditorContextChipProps {
  context: EditorContextDraft;
  onRemove: (id: string) => void;
}

export function ComposerPendingEditorContextChip({
  context,
  onRemove,
}: ComposerPendingEditorContextChipProps) {
  const label = formatEditorContextLabel(context);
  const expired = isEditorContextExpired(context);
  const tooltipText = expired
    ? `Editor context expired. Remove and re-add ${label} to include it in your message.`
    : `${context.file}:${context.lineStart}-${context.lineEnd}\n${context.text}`;

  return (
    <span className="inline-flex items-center gap-0">
      <EditorContextInlineChip label={label} tooltipText={tooltipText} expired={expired} />
      <button
        type="button"
        className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
        onClick={() => onRemove(context.id)}
        aria-label={`Remove ${label}`}
      >
        <XIcon className="size-2.5" />
      </button>
    </span>
  );
}

export function ComposerPendingEditorContexts(props: ComposerPendingEditorContextsProps) {
  const { contexts, onRemove, className } = props;

  if (contexts.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {contexts.map((context) => (
        <ComposerPendingEditorContextChip key={context.id} context={context} onRemove={onRemove} />
      ))}
    </div>
  );
}
