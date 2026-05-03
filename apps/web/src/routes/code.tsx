import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/code")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <Outlet />
    </>
  );
}
