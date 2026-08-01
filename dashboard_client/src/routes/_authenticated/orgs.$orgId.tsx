import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/$orgId")({
  component: OrgLayout,
});

function OrgLayout() {
  const { orgId } = useParams({ strict: false }) as { orgId?: string };
  const [suspended, setSuspended] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    (supabase as any)
      .from("organizations")
      .select("status")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (data && data.status === "suspended") {
          setSuspended(true);
        } else {
          setSuspended(false);
        }
        setLoading(false);
      });
  }, [orgId]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider text-[11px]">Loading organization context…</p>
        </div>
      </div>
    );
  }

  if (suspended) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 font-sans">
        <Card className="w-full max-w-md p-8 border-destructive/40 shadow-xl text-center flex flex-col items-center gap-4 bg-background/50 backdrop-blur">
          <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground font-display">Organization Suspended</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              This organization has been suspended by the platform administrator. Access to agents, flows, and telephony is temporarily frozen.
            </p>
            <p className="mt-4 text-xs text-muted-foreground/80">
              Please contact support at <a href="mailto:support@kzuno.in" className="text-primary hover:underline font-semibold">support@kzuno.in</a> for assistance.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <Outlet />;
}
