import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserOrg = {
  org_id: string;
  role: "owner" | "editor" | "viewer";
  org_name: string;
  created_at: string;
};

/**
 * Loads the current user's org memberships for the org switcher.
 * Re-fetches on mount; call `refetch` to force reload.
 */
export function useUserOrgs() {
  const [orgs, setOrgs] = useState<UserOrg[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setOrgs([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("org_members")
      .select("role, org_id, organizations(id, name, created_at)")
      .eq("user_id", userData.user.id)
      .order("created_at", { referencedTable: "organizations", ascending: true });

    if (error) {
      console.error("useUserOrgs:", error.message);
      setOrgs([]);
    } else {
      setOrgs(
        (data ?? []).map((d: any) => ({
          org_id: d.org_id,
          role: d.role,
          org_name: d.organizations?.name ?? "Unnamed",
          created_at: d.organizations?.created_at ?? "",
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { orgs, loading, refetch: load };
}
