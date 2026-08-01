import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!data.user.email_confirmed_at) throw redirect({ to: "/verify-email" });

    // Fetch the user's profile to retrieve name, email, and admin status
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_platform_admin, name, email")
      .eq("id", data.user.id)
      .maybeSingle();

    return { 
      user: data.user,
      profile: profile || { is_platform_admin: false, name: null, email: data.user.email || null }
    };
  },
  component: () => <AppShell />,
});
