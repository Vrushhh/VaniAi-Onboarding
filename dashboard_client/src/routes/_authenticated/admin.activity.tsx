import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw, ClipboardList, Filter } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/activity")({
  component: AdminActivityPage,
});

type AuditLogRow = {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: any;
  created_at: string;
  org_id: string | null;
  organizations?: {
    name: string;
  };
  profiles?: {
    name: string;
    email: string;
  };
};

function renderAdminAuditMessage(log: AuditLogRow) {
  const actor = log.profiles?.name || log.profiles?.email || "Someone";
  const orgName = log.organizations?.name || "System";
  const meta = log.metadata || {};

  switch (log.action) {
    case "org.suspended":
      return `Platform administrator suspended organization "${orgName}"`;
    case "org.activated":
      return `Platform administrator activated organization "${orgName}"`;
    case "org.deleted":
      return `Organization "${meta.org_name || orgName}" was deleted`;
    case "member.role_changed":
      return `[${orgName}] ${actor} changed role from ${meta.old_role || ""} to ${meta.new_role || ""}`;
    case "member.removed":
      return `[${orgName}] ${actor} removed a member`;
    case "invite.created":
      return `[${orgName}] ${actor} invited ${meta.email || ""} as ${meta.role || ""}`;
    case "invite.revoked":
      return `[${orgName}] ${actor} revoked invitation for ${meta.email || ""}`;
    default:
      return `[${orgName}] ${actor} performed: ${log.action}`;
  }
}

function AdminActivityPage() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedOrgId, setSelectedOrgId] = useState<string>("all");
  const [selectedAction, setSelectedAction] = useState<string>("all");

  async function loadFilterOrgs() {
    try {
      const { data, error } = await (supabase as any)
        .from("organizations")
        .select("id, name")
        .order("name", { ascending: true });
      if (!error && data) {
        setOrgs(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadLogs() {
    setLoading(true);
    try {
      let query = (supabase as any)
        .from("audit_log")
        .select(`
          id,
          action,
          target_type,
          target_id,
          metadata,
          created_at,
          org_id,
          organizations(name),
          profiles(name, email)
        `)
        .order("created_at", { ascending: false });

      if (selectedOrgId !== "all") {
        query = query.eq("org_id", selectedOrgId);
      }
      if (selectedAction !== "all") {
        query = query.eq("action", selectedAction);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs((data as AuditLogRow[]) || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFilterOrgs();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [selectedOrgId, selectedAction]);

  return (
    <div className="space-y-6">
      {/* Filters Row */}
      <Card className="p-4 border-border/60 bg-card/60 backdrop-blur flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>Filter by:</span>
          </div>

          {/* Org Filter */}
          <div className="w-56">
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger className="h-8 border-border/80 text-xs">
                <SelectValue placeholder="All Organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Organizations</SelectItem>
                {orgs.map((org) => (
                  <SelectItem key={org.id} value={org.id} className="text-xs">
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action Filter */}
          <div className="w-48">
            <Select value={selectedAction} onValueChange={setSelectedAction}>
              <SelectTrigger className="h-8 border-border/80 text-xs">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Actions</SelectItem>
                <SelectItem value="member.role_changed" className="text-xs">Role Changed</SelectItem>
                <SelectItem value="member.removed" className="text-xs">Member Removed</SelectItem>
                <SelectItem value="invite.created" className="text-xs">Invite Created</SelectItem>
                <SelectItem value="invite.revoked" className="text-xs">Invite Revoked</SelectItem>
                <SelectItem value="org.suspended" className="text-xs">Organization Suspended</SelectItem>
                <SelectItem value="org.activated" className="text-xs">Organization Activated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadLogs}
          disabled={loading}
          className="h-8 text-xs font-semibold"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          <span>Refresh</span>
        </Button>
      </Card>

      {/* Audit Logs List Table */}
      <Card className="border-border/60 shadow-sm overflow-hidden bg-card/60 backdrop-blur">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-xs font-semibold text-foreground">No audit logs found</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Change filters or perform org actions to generate activity trail.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto text-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
                  <th className="px-4 py-2.5">Activity Log Message</th>
                  <th className="px-4 py-2.5">Performed By</th>
                  <th className="px-4 py-2.5">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/5 transition-colors">
                    <td className="px-4 py-3 text-xs text-foreground font-medium">
                      {renderAdminAuditMessage(log)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div>
                        <p className="font-semibold text-foreground text-[11px] leading-none">
                          {log.profiles?.name || "System"}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {log.profiles?.email || ""}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
