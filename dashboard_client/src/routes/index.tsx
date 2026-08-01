import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });

    const { data: memberData } = await supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", data.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberData?.org_id) {
      throw redirect({ to: `/orgs/${memberData.org_id}` });
    }

    throw redirect({ to: "/orgs" });
  },
  component: () => null,
});
