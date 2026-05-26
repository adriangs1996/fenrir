import { Link } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "../components/ui/button";

function HackIndexRouteView() {
  return (
    <div className="flex h-full flex-1 items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p className="text-lg font-medium">Select a session or create a listener</p>
        <p className="mt-1 text-sm">Use the sidebar to get started</p>
        <div className="mt-4">
          <Button render={<Link to="/browser-lab" />} size="sm" variant="outline">
            Open Browser Lab
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/hack/")({
  component: HackIndexRouteView,
});
