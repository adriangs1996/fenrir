import {
  findRiskySpans,
  prettyPrintCommand,
  splitCommandPrefix,
  type RiskySpan,
} from "@fenrir/shared/commandFormat";
import { CheckIcon, CopyIcon, AlertTriangleIcon } from "lucide-react";
import { Fragment, memo, useMemo } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ComposerPendingApprovalCommandProps {
  detail: string;
  className?: string;
}

/**
 * Renders a pending command approval in a way that lets the user audit every flag:
 *
 * - Strips the provider's `Bash:` / `Shell:` prefix into a small label.
 * - Pretty-prints long commands across multiple lines, breaking on `&&`/`|`/long flags.
 * - Highlights risky spans (rm -rf, sudo, --force, curl|sh, ...) with a warning color.
 * - Provides a copy button so users can paste into a terminal to inspect further.
 * - Shows the full command (no truncation) inside a scrollable container.
 */
export const ComposerPendingApprovalCommand = memo(function ComposerPendingApprovalCommand({
  detail,
  className,
}: ComposerPendingApprovalCommandProps) {
  const { prefix, command } = useMemo(() => splitCommandPrefix(detail), [detail]);
  const formatted = useMemo(() => prettyPrintCommand(command, 88), [command]);
  const riskySpans = useMemo(() => findRiskySpans(command), [command]);

  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500 });

  const segments = useMemo(
    () => buildHighlightedSegments(formatted, command, riskySpans),
    [formatted, command, riskySpans],
  );

  const riskSummary = useMemo(() => {
    if (riskySpans.length === 0) return null;
    const reasons = Array.from(new Set(riskySpans.map((span) => span.reason)));
    return reasons.join(", ");
  }, [riskySpans]);

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-muted/30 text-foreground",
        riskSummary ? "border-amber-500/40 bg-amber-500/5" : null,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <div className="flex items-center gap-2 min-w-0">
          {prefix ? (
            <span className="font-mono text-foreground/90">{prefix}</span>
          ) : (
            <span>Command</span>
          )}
          {riskSummary ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="img"
                    aria-label={`Potentially risky: ${riskSummary}`}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 normal-case tracking-normal"
                  >
                    <AlertTriangleIcon className="size-3" />
                    Review carefully
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-tight">
                Detected: {riskSummary}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={isCopied ? "Copied" : "Copy command"}
          onClick={() => copyToClipboard(command, undefined)}
        >
          {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </Button>
      </div>
      <pre
        className={cn(
          "max-h-[40vh] overflow-auto whitespace-pre-wrap break-all px-3 py-2.5",
          "font-mono text-[13px] leading-relaxed text-foreground/90",
        )}
      >
        {segments.map((segment) =>
          segment.risky ? (
            <mark
              key={`r:${segment.start}`}
              className="rounded bg-amber-500/25 px-0.5 text-amber-700 dark:text-amber-300"
              title={segment.reason ?? "risky"}
            >
              {segment.text}
            </mark>
          ) : (
            <Fragment key={`t:${segment.start}`}>{segment.text}</Fragment>
          ),
        )}
      </pre>
    </div>
  );
});

interface HighlightSegment {
  text: string;
  risky: boolean;
  /** Index in the formatted output where this segment begins — used as a stable React key. */
  start: number;
  reason?: string;
}

/**
 * Map risky spans (computed against the original command) onto the pretty-printed
 * output so the highlighted ranges stay correct after line-wrapping is applied.
 *
 * `prettyPrintCommand` only inserts whitespace and newlines between original tokens,
 * so we can re-anchor each risky span by walking the original text and the formatted
 * text in lockstep, skipping over inserted whitespace in the formatted side.
 */
function buildHighlightedSegments(
  formatted: string,
  original: string,
  spans: ReadonlyArray<RiskySpan>,
): ReadonlyArray<HighlightSegment> {
  if (spans.length === 0) {
    return [{ text: formatted, risky: false, start: 0 }];
  }

  // Build a mapping from each non-whitespace char index in `formatted` to the
  // corresponding index in `original`. Whitespace in formatted that is NOT in
  // original (i.e. inserted by prettyPrintCommand) maps back to the boundary
  // index between original tokens.
  const formattedToOriginal: number[] = Array.from({ length: formatted.length }, () => -1);
  let originalIndex = 0;
  for (let formattedIndex = 0; formattedIndex < formatted.length; formattedIndex += 1) {
    const formattedChar = formatted[formattedIndex];
    while (
      originalIndex < original.length &&
      isInsertedWhitespace(formattedChar, original[originalIndex])
    ) {
      originalIndex += 1;
    }
    if (originalIndex < original.length && formattedChar === original[originalIndex]) {
      formattedToOriginal[formattedIndex] = originalIndex;
      originalIndex += 1;
    } else {
      // Whitespace inserted by formatter — anchor to current boundary in original.
      formattedToOriginal[formattedIndex] = originalIndex;
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    let formattedStart = -1;
    let formattedEnd = -1;
    for (let i = 0; i < formatted.length; i += 1) {
      const mapped = formattedToOriginal[i];
      if (mapped === undefined) continue;
      if (formattedStart === -1 && mapped >= span.start && mapped < span.end) {
        formattedStart = i;
      }
      if (mapped < span.end) {
        formattedEnd = i + 1;
      }
    }
    if (formattedStart === -1 || formattedEnd <= formattedStart) continue;

    if (formattedStart > cursor) {
      segments.push({
        text: formatted.slice(cursor, formattedStart),
        risky: false,
        start: cursor,
      });
    }
    segments.push({
      text: formatted.slice(formattedStart, formattedEnd),
      risky: true,
      reason: span.reason,
      start: formattedStart,
    });
    cursor = formattedEnd;
  }
  if (cursor < formatted.length) {
    segments.push({ text: formatted.slice(cursor), risky: false, start: cursor });
  }
  return segments;
}

function isInsertedWhitespace(
  formattedChar: string | undefined,
  originalChar: string | undefined,
): boolean {
  if (formattedChar === originalChar) return false;
  return originalChar === " " || originalChar === "\t" || originalChar === "\n";
}
