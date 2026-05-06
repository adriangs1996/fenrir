import { createFileRoute } from "@tanstack/react-router";
import { RenderSurface } from "../components/RenderSurface";

export const Route = createFileRoute("/code/")({
  component: CodeIndexRoute,
});

function CodeIndexRoute() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <RenderSurface fps={60} style={{ flex: 1 }} />
    </div>
  );
}
