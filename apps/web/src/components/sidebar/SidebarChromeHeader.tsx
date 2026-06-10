import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarHeader, SidebarTrigger } from "../ui/sidebar";

function FenrirIcon() {
  return (
    <svg
      aria-label="Fenrir"
      className="size-8 shrink-0 text-primary"
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Eyes */}
      <ellipse cx="80" cy="35" rx="6" ry="3" fill="currentColor" opacity={0.9} />
      <ellipse cx="120" cy="35" rx="6" ry="3" fill="currentColor" opacity={0.9} />
      {/* Upper jaw */}
      <path
        d="M42,88 L58,55 L75,72 L88,40 L100,62 L112,40 L125,72 L142,55 L158,88"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Upper fangs */}
      <line
        x1="88"
        y1="40"
        x2="90"
        y2="90"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1="112"
        y1="40"
        x2="110"
        y2="90"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Small upper teeth */}
      <line
        x1="75"
        y1="72"
        x2="77"
        y2="92"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.6}
      />
      <line
        x1="125"
        y1="72"
        x2="123"
        y2="92"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.6}
      />
      {/* Lower jaw */}
      <path
        d="M48,112 L68,132 L88,118 L100,138 L112,118 L132,132 L152,112"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Lower fangs */}
      <line
        x1="88"
        y1="118"
        x2="89"
        y2="110"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="112"
        y1="118"
        x2="111"
        y2="110"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label="Go to threads"
              className="ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
              to="/"
            >
              <FenrirIcon />
              <span className="truncate text-sm font-medium tracking-tight text-foreground">
                Fenrir
              </span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </Link>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return isElectron ? (
    <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px] wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)]">
      {wordmark}
    </SidebarHeader>
  ) : (
    <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">{wordmark}</SidebarHeader>
  );
});
