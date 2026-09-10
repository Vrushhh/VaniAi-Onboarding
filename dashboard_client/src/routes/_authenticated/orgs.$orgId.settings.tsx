import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAuditEvent } from "@/lib/audit-logger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { NotificationPreferencesTab } from "@/components/NotificationPreferencesTab";
import { useOrgRole } from "@/hooks/useOrgRole";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/settings")({
  component: OrgSettings,
});

function renderAuditMessage(log: any) {
  const actor = log.profiles?.name || log.profiles?.email || "Someone";
  const meta = log.metadata || {};
  
  switch (log.action) {
    case "org.suspended":
      return "Platform administrator suspended this organization";
    case "org.activated":
      return "Platform administrator activated this organization";
    case "org.deleted":
      return `Organization "${meta.org_name || ""}" was deleted`;
    case "member.role_changed":
      return `${actor} changed a member's role from ${meta.old_role || ""} to ${meta.new_role || ""}`;
    case "member.removed":
      return `${actor} removed a member from this organization`;
    case "invite.created":
      return `${actor} invited ${meta.email || ""} as ${meta.role || ""}`;
    case "invite.revoked":
      return `${actor} revoked the invitation for ${meta.email || ""}`;
    default:
      return `${actor} performed action: ${log.action}`;
  }
}

function OrgSettings() {
  const { orgId } = Route.useParams();
  const navigate = useNavigate();
  const { role, canEdit, isOwner, loading: roleLoading } = useOrgRole(orgId);

  const [orgName, setOrgName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const [activeTab, setActiveTab] = useState<"settings" | "notifications" | "activity">("settings");
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        supabase
          .from("profiles")
          .select("is_platform_admin")
          .eq("id", data.user.id)
          .maybeSingle()
          .then(({ data: profile }) => {
            setIsPlatformAdmin(profile?.is_platform_admin ?? false);
          });
      }
    });
  }, []);

  async function loadAuditLogs() {
    setAuditLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("audit_log")
        .select(`
          id,
          action,
          target_type,
          target_id,
          metadata,
          created_at,
          profiles(name, email)
        `)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAuditLogs(data || []);
    } catch (err: any) {
      console.error("Failed to load audit logs", err);
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "activity") {
      loadAuditLogs();
    }
  }, [activeTab, orgId]);

  useEffect(() => {
    (async () => {
      const [{ data: userRes }, { data: org, error }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle(),
      ]);
      setUserId(userRes.user?.id ?? null);
      if (error) toast.error(error.message);
      if (org) {
        setOrgName(org.name);
        setOriginalName(org.name);
      }
      setLoading(false);
    })();
  }, [orgId]);

  async function saveName() {
    if (!orgName.trim() || orgName === originalName) return;
    setSaving(true);
    const { error } = await supabase
      .from("organizations")
      .update({ name: orgName.trim() })
      .eq("id", orgId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOriginalName(orgName.trim());
    logAuditEvent(orgId, "org.settings_updated", "org", orgId, { name: orgName.trim() });
    toast.success("Organization renamed");
  }

  async function leaveOrg() {
    if (!userId) return;
    setLeaving(true);
    const { error } = await supabase
      .from("org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId);
    setLeaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Left organization");
    navigate({ to: "/orgs" });
  }

  async function deleteOrg() {
    if (deleteConfirm !== originalName) {
      toast.error("Type the organization name exactly to confirm");
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from("organizations").delete().eq("id", orgId);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Organization deleted");
    navigate({ to: "/orgs" });
  }

  return (
    <>
      <main className="mx-auto max-w-2xl px-6 py-10 font-sans">
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">Organization Settings</h1>

        {/* Tab switcher */}
        <div className="flex gap-5 mt-5 border-b border-border/40 pb-px mb-6">
          <button
            onClick={() => setActiveTab("settings")}
            className={`text-sm font-medium pb-2.5 border-b-2 transition-all cursor-pointer ${
              activeTab === "settings"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            General & Organization
          </button>
          <button
            onClick={() => setActiveTab("notifications")}
            className={`text-sm font-medium pb-2.5 border-b-2 transition-all cursor-pointer ${
              activeTab === "notifications"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Notifications
          </button>
          {isOwner && (
            <button
              onClick={() => setActiveTab("activity")}
              className={`text-sm font-medium pb-2.5 border-b-2 transition-all cursor-pointer ${
                activeTab === "activity"
                  ? "border-primary text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Activity Log
            </button>
          )}
        </div>

        {activeTab === "notifications" ? (
          <NotificationPreferencesTab orgId={orgId} isPlatformAdmin={isPlatformAdmin} />
        ) : activeTab === "settings" ? (
          <>
            <Card className="p-6">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                General
              </h2>
              <div className="mt-4 space-y-2">
                <Label htmlFor="org-name">Name</Label>
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : canEdit ? (
                  <div className="flex gap-2">
                    <Input
                      id="org-name"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                    <Button
                      onClick={saveName}
                      disabled={saving || !orgName.trim() || orgName === originalName}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                ) : (
                  <div className="text-sm">{originalName}</div>
                )}
              </div>
            </Card>

            <Card className="mt-6 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Custom Webhooks & CRM Integrations
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Connect Kzuno to Shopify, Salesforce, HubSpot, or custom HTTPS endpoints.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/orgs/$orgId/integrations" params={{ orgId }}>
                    Manage Webhooks
                  </Link>
                </Button>
              </div>
            </Card>

            <Card className="mt-6 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Members
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    People with access to this organization.
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link to="/orgs/$orgId/members" params={{ orgId }}>
                    Manage Members
                  </Link>
                </Button>
              </div>
            </Card>

            <Card className="mt-6 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Telephony & Numbers
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Configure Plivo/Exotel credentials and assign caller-ID phone numbers.
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link to="/orgs/$orgId/telephony" params={{ orgId }}>
                    Manage Telephony
                  </Link>
                </Button>
              </div>
            </Card>

            <Card className="mt-6 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    Messaging & Templates
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Configure SMS/WhatsApp credentials and templates.
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link to="/orgs/$orgId/messaging" params={{ orgId }}>
                    Manage Messaging
                  </Link>
                </Button>
              </div>
            </Card>

            {!roleLoading && role && (
              <Card className="mt-6 border-destructive/40 p-6">
                <h2 className="text-sm font-medium uppercase tracking-wide text-destructive">
                  Danger zone
                </h2>

                {!isOwner && (
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">Leave organization</div>
                      <div className="text-xs text-muted-foreground">
                        You will lose access to all agents and flows in this org.
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline">Leave</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Leave organization?</AlertDialogTitle>
                          <AlertDialogDescription>
                            You'll lose access to “{originalName}”. You can be re-invited later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={leaveOrg} disabled={leaving}>
                            {leaving ? "Leaving…" : "Leave"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}

                {isOwner && (
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">Delete organization</div>
                      <div className="text-xs text-muted-foreground">
                        Permanently deletes the org and all its agents, flows, and members. This
                        cannot be undone.
                      </div>
                    </div>
                    <AlertDialog
                      onOpenChange={(open) => {
                        if (!open) setDeleteConfirm("");
                      }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive">Delete</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{originalName}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete this organization and every agent, flow,
                            and member inside it. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-2">
                          <Label htmlFor="confirm-name">
                            Type <span className="font-mono">{originalName}</span> to confirm
                          </Label>
                          <Input
                            id="confirm-name"
                            value={deleteConfirm}
                            onChange={(e) => setDeleteConfirm(e.target.value)}
                            autoComplete="off"
                          />
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={(e) => {
                              e.preventDefault();
                              deleteOrg();
                            }}
                            disabled={deleting || deleteConfirm !== originalName}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {deleting ? "Deleting…" : "Delete organization"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </Card>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <Card className="p-6 border-border/60">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                Organization Activity Log
              </h2>
              {auditLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-10 w-full animate-pulse rounded bg-muted/40" />
                  ))}
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-xs italic">
                  No activity logged yet.
                </div>
              ) : (
                <div className="space-y-4 relative pl-4 border-l border-border/50 text-xs">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="relative group space-y-1">
                      {/* Timeline dot */}
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary/45 border border-primary/20 group-hover:bg-primary transition-colors animate-pulse" />
                      
                      <p className="text-foreground/90 leading-relaxed font-medium">
                        {renderAuditMessage(log)}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {new Date(log.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </main>
    </>
  );
}
