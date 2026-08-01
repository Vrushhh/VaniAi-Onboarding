import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/orgs/$orgId/agents/$agentId/flows/$flowId",
)({
  component: () => <Outlet />,
});
