import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Search,
  Building,
  Calendar,
  Users,
  Shield,
  Trash2,
  AlertTriangle,
  Play,
  Pause,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/orgs")({
  component: AdminOrgsPage,
});

type OrgRow = {
  id: string;
  name: string;
  created_at: string;
  status: "active" | "suspended";
  org_members: {
    role: "owner" | "editor" | "viewer";
    profiles: {
      email: string | null;
      name: string | null;
    } | null;
  }[];
};

function AdminOrgsPage() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Deletion state
  const [deleteOrg, setDeleteOrg] = useState<OrgRow | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Status toggle state
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function loadOrgs() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select(`
          id,
          name,
          created_at,
          status,
          org_members(
            role,
            profiles(
              email,
              name
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrgs((data as unknown as OrgRow[]) ?? []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrgs();
  }, []);

  // Filter organizations
  const filteredOrgs = useMemo(() => {
    if (!orgs) return [];
    return orgs.filter((org) =>
      org.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [orgs, searchQuery]);

  async function handleToggleStatus(org: OrgRow) {
    const newStatus = org.status === "active" ? "suspended" : "active";
    setTogglingId(org.id);
    try {
      const { data, error } = await (supabase as any).rpc("admin_set_org_status", {
        _org_id: org.id,
        _status: newStatus,
      });

      if (error) throw error;
      const res = data as any;
      if (!res.success) {
        throw new Error(res.message || "Failed to toggle status");
      }

      toast.success(
        `Organization "${org.name}" status updated to ${newStatus}.`
      );
      setOrgs((prev) =>
        prev
          ? prev.map((o) => (o.id === org.id ? { ...o, status: newStatus } : o))
          : null
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to update status");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDeleteOrg() {
    if (!deleteOrg) return;
    if (confirmName !== deleteOrg.name) {
      toast.error("Organization name mismatch");
      return;
    }

    setDeleting(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .delete()
        .eq("id", deleteOrg.id);

      if (error) throw error;

      toast.success(`Organization "${deleteOrg.name}" deleted permanently.`);
      setOrgs((prev) => (prev ? prev.filter((o) => o.id !== deleteOrg.id) : null));
      setDeleteOrg(null);
      setConfirmName("");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete organization");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 border-border/80"
          />
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          Showing {filteredOrgs.length} organizations
        </div>
      </div>

      {/* Grid or Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded-lg bg-muted/40 border border-border/30"
            />
          ))}
        </div>
      ) : filteredOrgs.length === 0 ? (
        <Card className="p-8 text-center border-border/60">
          <Building className="mx-auto h-8 w-8 text-muted-foreground opacity-60 mb-2" />
          <p className="text-sm font-semibold text-foreground">No organizations found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search queries.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
                  <th className="px-5 py-3">Organization</th>
                  <th className="px-5 py-3">Owner</th>
                  <th className="px-5 py-3">Members</th>
                  <th className="px-5 py-3">Created At</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredOrgs.map((org) => {
                  const ownerNode = org.org_members.find((m) => m.role === "owner");
                  const ownerName = ownerNode?.profiles?.name || "Unknown";
                  const ownerEmail = ownerNode?.profiles?.email || "";
                  const memberCount = org.org_members.length;

                  return (
                    <tr
                      key={org.id}
                      className="hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-5 py-4 font-semibold text-foreground">
                        {org.name}
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-xs">
                          <p className="font-medium text-foreground">{ownerName}</p>
                          <p className="text-muted-foreground mt-0.5">{ownerEmail}</p>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-muted-foreground">
                        {memberCount}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {new Date(org.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <Badge
                          variant={org.status === "active" ? "outline" : "secondary"}
                          className={
                            org.status === "active"
                              ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/5"
                              : "border-destructive/30 text-destructive bg-destructive/5"
                          }
                        >
                          {org.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(org)}
                            disabled={togglingId === org.id}
                            className="h-8 text-xs font-medium cursor-pointer gap-1.5"
                          >
                            {org.status === "active" ? (
                              <>
                                <Pause className="h-3.5 w-3.5" />
                                <span>Suspend</span>
                              </>
                            ) : (
                              <>
                                <Play className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                <span className="text-emerald-600 dark:text-emerald-400">Activate</span>
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteOrg(org)}
                            className="h-8 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer gap-1.5"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Delete Confirmation Modal */}
      <Dialog
        open={deleteOrg !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOrg(null);
            setConfirmName("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>Delete Organization?</span>
            </DialogTitle>
            <DialogDescription className="pt-2 text-xs leading-relaxed text-muted-foreground">
              This action is permanent and **cannot be undone**. All agents, flows, settings, and telephone configurations associated with{" "}
              <strong className="text-foreground">"{deleteOrg?.name}"</strong> will be permanently destroyed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <label className="text-xs font-medium text-muted-foreground">
              Type the organization name to confirm:
            </label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={deleteOrg?.name}
              className="h-10 border-border/80 text-sm font-semibold"
            />
          </div>

          <DialogFooter className="pt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOrg(null);
                setConfirmName("");
              }}
              disabled={deleting}
              className="h-10 text-xs font-medium rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteOrg}
              disabled={deleting || confirmName !== deleteOrg?.name}
              variant="destructive"
              className="h-10 text-xs font-medium rounded-lg text-white"
            >
              {deleting ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
