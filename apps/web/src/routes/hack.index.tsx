import { createFileRoute } from "@tanstack/react-router";

function HackIndexRouteView() {
  return (
    <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p className="text-lg font-medium">Select a session or create a listener</p>
        <p className="mt-1 text-sm">Use the sidebar to get started</p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/hack/")({
  component: HackIndexRouteView,
});
