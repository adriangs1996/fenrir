import { createFileRoute } from "@tanstack/react-router";
import { EditorCanvas } from "../modules/neovim-editor/components/EditorCanvas";

export const Route = createFileRoute("/code/")({
  component: CodeIndexRoute,
});

function CodeIndexRoute() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <EditorCanvas cwd="/" />
    </div>
  );
}
