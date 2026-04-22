import { useNavigate } from "@tanstack/react-router";
import { isElectron } from "../env";

type Workspace = "code" | "hack";

interface ActivityBarProps {
  activeWorkspace: Workspace;
  onWorkspaceChange: (workspace: Workspace) => void;
}

export function ActivityBar({ activeWorkspace, onWorkspaceChange }: ActivityBarProps) {
  const navigate = useNavigate();

  const handleWorkspaceChange = (workspace: Workspace) => {
    onWorkspaceChange(workspace);
    if (workspace === "hack") {
      void navigate({ to: "/hack" as string });
    } else {
      void navigate({ to: "/" });
    }
  };

  return (
    <div className="flex h-full w-12 shrink-0 flex-col bg-sidebar">
      {/* Electron drag-region spacer — no border so it doesn't cut traffic lights */}
      {isElectron && <div className="drag-region h-[52px] w-full shrink-0" />}
      {/* Icon strip — border-r starts below the traffic lights */}
      <div className="flex flex-1 flex-col items-center border-r border-border py-2">
        <ActivityBarIcon
          icon={<CodeIcon />}
          label="Code"
          active={activeWorkspace === "code"}
          onClick={() => handleWorkspaceChange("code")}
        />
        <ActivityBarIcon
          icon={<HackIcon />}
          label="Hack"
          active={activeWorkspace === "hack"}
          onClick={() => handleWorkspaceChange("hack")}
        />
        <div className="flex-1" />
        <ActivityBarIcon
          icon={<SettingsIcon />}
          label="Settings"
          active={false}
          onClick={() => void navigate({ to: "/settings" })}
        />
      </div>
    </div>
  );
}

function ActivityBarIcon({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-12 w-12 items-center justify-center transition-colors hover:text-foreground ${
        active ? "border-l-2 border-success text-success" : "text-muted-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function CodeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function HackIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="5" />
      <path d="M8 14s-4 2-4 6h16c0-4-4-6-4-6" />
      <path d="M9 6.5c0-1 .5-2.5 3-2.5s3 1.5 3 2.5" />
      <path d="M8 8h8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
