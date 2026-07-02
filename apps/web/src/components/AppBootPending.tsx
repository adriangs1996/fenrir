/**
 * Full-window placeholder rendered while the root route's `beforeLoad` waits
 * for the local backend to become reachable. On large installs the backend
 * can take tens of seconds to boot (read-model hydration), and the desktop
 * shell creates the window immediately — without this the app shows a bare
 * black window that reads as "not booting".
 */
export function AppBootPending() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background">
      <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      <p className="text-sm text-muted-foreground">Starting Fenrir…</p>
    </div>
  );
}
