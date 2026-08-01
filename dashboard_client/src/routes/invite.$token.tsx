import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Mic, ArrowRight, AlertCircle, ShieldAlert, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  component: InviteAcceptPage,
});

type Invite = {
  id: string;
  org_id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  status: "pending" | "accepted" | "revoked";
  organizations: {
    name: string;
  } | null;
};

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [errorStatus, setErrorStatus] = useState<
    "none" | "not_found" | "revoked" | "accepted" | "email_mismatch" | "fetch_error" | "expired"
  >("none");
  const [errorMessage, setErrorMessage] = useState("");
  const [accepting, setAccepting] = useState(false);

  async function loadInviteAndUser() {
    setLoading(true);
    setErrorStatus("none");
    setErrorMessage("");
    try {
      // 1. Get current user session
      const { data: userRes } = await supabase.auth.getUser();
      setCurrentUser(userRes.user ?? null);

      // 2. Fetch the invite details via secure RPC
      const { data: previewRes, error: inviteErr } = await (supabase as any)
        .rpc("get_invite_preview", { invite_token: token });

      if (inviteErr) {
        setErrorStatus("fetch_error");
        setErrorMessage(inviteErr.message);
        return;
      }

      const preview = previewRes as {
        found: boolean;
        status: "pending" | "accepted" | "revoked" | "expired" | "not_found";
        org_name?: string;
        email?: string;
        role?: "owner" | "editor" | "viewer";
      };

      if (!preview || !preview.found) {
        setErrorStatus("not_found");
        return;
      }

      const inviteData: Invite = {
        id: token,
        org_id: "",
        email: preview.email || "",
        role: preview.role || "viewer",
        status: preview.status === "expired" ? "pending" : (preview.status as any),
        organizations: preview.org_name ? { name: preview.org_name } : null,
      };
      setInvite(inviteData);

      if (preview.status === "revoked") {
        setErrorStatus("revoked");
      } else if (preview.status === "accepted") {
        setErrorStatus("accepted");
      } else if (preview.status === "expired") {
        setErrorStatus("expired");
      } else if (userRes.user && preview.email) {
        const userEmail = userRes.user.email?.toLowerCase();
        const inviteEmail = preview.email.toLowerCase();
        if (userEmail !== inviteEmail) {
          setErrorStatus("email_mismatch");
        }
      }
    } catch (err: any) {
      setErrorStatus("fetch_error");
      setErrorMessage(err.message || "Failed to load invitation details");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInviteAndUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function acceptInvite() {
    if (!currentUser || !invite) return;
    setAccepting(true);
    try {
      const { data, error } = await supabase.rpc("accept_org_invite", {
        invite_token: token,
      });

      if (error) throw error;

      const result = data as any;
      if (!result.success) {
        throw new Error(result.message || "Failed to accept invitation");
      }

      toast.success("Invitation accepted successfully!");
      navigate({ to: "/orgs/$orgId/agents", params: { orgId: result.org_id } });
    } catch (err: any) {
      toast.error(err.message || "Failed to accept invitation");
    } finally {
      setAccepting(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/10 font-sans">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading invitation details…</p>
        </div>
      </div>
    );
  }

  // Not Logged In screen
  if (!currentUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/10 relative px-4 font-sans">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/5 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md space-y-6 relative z-10">
          <div className="flex items-center gap-2.5 justify-center mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-violet-600 to-blue-500 shadow-md">
              <Mic className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">Kzuno</span>
          </div>

          <Card className="p-8 border-border/40 shadow-xl shadow-muted/10 bg-background/90 backdrop-blur-md text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">You've been invited!</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              You have been invited to join an organization on Kzuno. Please sign in or create an account to accept this invitation.
            </p>
            <div className="mt-6">
              <Button asChild className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 rounded-lg">
                <Link to="/auth" search={{ redirect: `/invite/${token}` }}>
                  <span>Sign in to Accept Invite</span>
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Error States
  const renderError = (title: string, desc: string, icon = <ShieldAlert className="h-10 w-10 text-rose-500" />) => (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/10 relative px-4 font-sans">
      <div className="w-full max-w-md space-y-6 relative z-10">
        <Card className="p-8 border-border/40 shadow-xl text-center flex flex-col items-center gap-4">
          {icon}
          <div>
            <h1 className="text-xl font-bold text-foreground">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</p>
          </div>
          <Button asChild variant="outline" className="w-full mt-2 rounded-lg">
            <Link to="/">Go to Dashboard</Link>
          </Button>
        </Card>
      </div>
    </div>
  );

  if (errorStatus === "expired") {
    return renderError(
      "Invitation Expired",
      "This invitation link has expired. Invitations are valid for 7 days. Please request a new invite from the organization owner."
    );
  }

  if (errorStatus === "not_found") {
    return renderError(
      "Invitation Not Found",
      "This invitation link is invalid or does not exist. Please check the URL or request a new invite from the organization owner."
    );
  }

  if (errorStatus === "revoked") {
    return renderError(
      "Invitation Revoked",
      "This invitation has been revoked by the organization owner. Please ask them to send a new invite if you still need access."
    );
  }

  if (errorStatus === "accepted") {
    return renderError(
      "Invitation Already Accepted",
      "This invitation has already been accepted and processed.",
      <CheckCircle2 className="h-10 w-10 text-emerald-500" />
    );
  }

  if (errorStatus === "email_mismatch") {
    return renderError(
      "Email Address Mismatch",
      `This invitation was sent to ${invite?.email}, but you are currently signed in as ${currentUser.email}. Please sign out and sign in using the correct account, or ask the owner to invite your current email address.`
    );
  }

  if (errorStatus === "fetch_error") {
    return renderError(
      "Error Loading Invitation",
      errorMessage || "An unexpected error occurred while loading your invitation details. Please try again."
    );
  }

  // Success/Accept invitation screen
  const orgName = invite?.organizations?.name || "an organization";
  const roleName = invite?.role ? invite.role.charAt(0).toUpperCase() + invite.role.slice(1) : "member";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/10 relative px-4 font-sans">
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        <div className="flex items-center gap-2.5 justify-center mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-violet-600 to-blue-500 shadow-md">
            <Mic className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">Kzuno</span>
        </div>

        <Card className="p-8 border-border/40 shadow-xl shadow-muted/10 bg-background/90 backdrop-blur-md text-center flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Accept Invitation</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              You've been invited to join <strong className="text-foreground">{orgName}</strong> as <strong className="text-foreground">{roleName}</strong>.
            </p>
          </div>
          <div className="w-full mt-4 space-y-2">
            <Button
              onClick={acceptInvite}
              disabled={accepting}
              className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 rounded-lg text-white font-medium shadow-md transition-all"
            >
              {accepting ? "Accepting Invitation…" : "Accept Invitation"}
            </Button>
            <Button asChild variant="ghost" className="w-full rounded-lg text-xs">
              <Link to="/">Decline</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
