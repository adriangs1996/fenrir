import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/code/")({
  component: CodeIndexRoute,
});

function CodeIndexRoute() {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <h1>Code Index</h1>
    </div>
  );
}
