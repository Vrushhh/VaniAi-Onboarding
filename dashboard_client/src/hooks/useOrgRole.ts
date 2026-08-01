import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OrgRole = "owner" | "editor" | "viewer" | null;

export function useOrgRole(orgId: string | undefined) {
  const [role, setRole] = useState<OrgRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      if (!orgId) {
        if (!cancelled) {
          setRole(null);
          setLoading(false);
        }
        return;
      }
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) {
        if (!cancelled) {
          setRole(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled) {
        setRole((data?.role as OrgRole) ?? null);
        setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const isOwner = role === "owner";
  const canEdit = role === "owner" || role === "editor";
  return { role, isOwner, canEdit, loading };
}
