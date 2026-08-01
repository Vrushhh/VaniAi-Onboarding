import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context }) => {
    const profile = (context as any).profile;
    if (!profile || !profile.is_platform_admin) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 font-sans">
      {/* Admin Portal Header */}
      <div className="flex items-center justify-between border-b border-border/60 pb-5">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-mono uppercase font-semibold">
            Platform Operator
          </div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground mt-2">
            Admin Portal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage organization lifecycles, user accounts, and voice-telephony systems.
          </p>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex gap-6 mt-6 border-b border-border/40 pb-px">
        <Link
          to="/admin/orgs"
          className="text-sm font-medium pb-3 border-b-2 border-transparent [&.active]:border-primary [&.active]:text-foreground text-muted-foreground hover:text-foreground transition-all duration-200"
          activeProps={{ className: "active" }}
        >
          Organizations
        </Link>
        <Link
          to="/admin/users"
          className="text-sm font-medium pb-3 border-b-2 border-transparent [&.active]:border-primary [&.active]:text-foreground text-muted-foreground hover:text-foreground transition-all duration-200"
          activeProps={{ className: "active" }}
        >
          Users
        </Link>
        <Link
          to="/admin/activity"
          className="text-sm font-medium pb-3 border-b-2 border-transparent [&.active]:border-primary [&.active]:text-foreground text-muted-foreground hover:text-foreground transition-all duration-200"
          activeProps={{ className: "active" }}
        >
          Activity Log
        </Link>
      </div>

      {/* Active Panel Area */}
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
