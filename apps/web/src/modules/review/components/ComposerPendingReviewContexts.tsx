import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { ReviewContextAttachmentDraft } from "../reviewComposer";
import { buildReviewContextSummaryLabel, isReviewContextAttachmentStale } from "../reviewComposer";

interface ComposerPendingReviewContextsProps {
  attachments: ReadonlyArray<ReviewContextAttachmentDraft>;
  diffCacheToken: string | null | undefined;
  className?: string;
  onRemove: (attachmentId: string) => void;
}

export function ComposerPendingReviewContexts({
  attachments,
  diffCacheToken,
  className,
  onRemove,
}: ComposerPendingReviewContextsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {attachments.map((attachment) => {
        const stale = isReviewContextAttachmentStale(attachment, diffCacheToken);
        return (
          <div
            key={attachment.id}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]",
              stale
                ? "border-warning/40 bg-warning/8 text-warning-foreground"
                : "border-border/60 bg-card/70 text-foreground",
            )}
          >
            <Badge size="sm" variant={stale ? "warning" : "outline"}>
              {attachment.sourceKind}
            </Badge>
            <span className="max-w-64 truncate">{attachment.title}</span>
            <span className="text-muted-foreground">
              {buildReviewContextSummaryLabel(attachment)}
            </span>
            {stale ? <span>stale</span> : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px]"
              onClick={() => onRemove(attachment.id)}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </div>
  );
}
