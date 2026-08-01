import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/agents")({
  component: () => <Outlet />,
});
