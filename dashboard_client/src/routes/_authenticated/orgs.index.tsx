import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Building2, Calendar, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/")({
  component: OrgPicker,
});

type OrgMembership = {
  role: "owner" | "editor" | "viewer";
  org_id: string;
  organizations: { id: string; name: string; created_at: string } | null;
};

function OrgPicker() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      toast.error(userError?.message ?? "Not signed in");
      setOrgs([]);
      return;
    }

    const { data, error } = await supabase
      .from("org_members")
      .select("role, org_id, organizations(id, name, created_at)")
      .eq("user_id", userData.user.id)
      .order("created_at", { referencedTable: "organizations", ascending: true });
    if (error) {
      toast.error(error.message);
      setOrgs([]);
      return;
    }
    
    if (!data || data.length === 0) {
      navigate({ to: "/onboarding" });
      return;
    }

    // Direct land on organization dashboard
    const firstOrgId = data[0]?.org_id;
    if (firstOrgId) {
      navigate({ to: `/orgs/${firstOrgId}` });
      return;
    }

    setOrgs(data ?? []);
  }


  useEffect(() => {
    load();
  }, []);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .rpc("create_organization", { _name: newName.trim() })
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpen(false);
    setNewName("");
    navigate({ to: "/orgs/$orgId/agents", params: { orgId: (data as { id: string }).id } });
  }

  return (
    <>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">Your organizations</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Pick an organization to manage its agents and flows.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New organization</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display font-bold">Create organization</DialogTitle>
              </DialogHeader>
              <form onSubmit={createOrg} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Name</Label>
                  <Input
                    id="org-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Acme Beauty Co."
                    required
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <span className="eyebrow-label">Your Organizations</span>
          </div>
          {orgs === null && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <Card key={i} className="p-6 h-28 animate-pulse bg-muted/20" />
              ))}
            </div>
          )}
          {orgs && orgs.length === 0 && (
            <Card className="p-8 text-center border-dashed">
              <p className="text-sm text-muted-foreground">
                You don't belong to any organization yet. Create one to get started.
              </p>
            </Card>
          )}
          {orgs && orgs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {orgs.map((o) => {
                const badgeVariant =
                  o.role === "owner" ? "default" : o.role === "editor" ? "secondary" : "outline";
                return (
                  <Link
                    key={o.org_id}
                    to="/orgs/$orgId/agents"
                    params={{ orgId: o.org_id }}
                    className="group"
                  >
                    <Card className="p-5 h-full relative overflow-hidden transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:-translate-y-1 cursor-pointer">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--banyan-tint)] text-[var(--banyan)] font-bold group-hover:scale-105 transition-transform duration-300 border border-border">
                          <Building2 className="h-5 w-5 opacity-85" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                              {o.organizations?.name}
                            </span>
                            <Badge variant={badgeVariant} className="rounded-md px-1.5 py-0.5 text-[10px] uppercase font-bold shrink-0 tracking-wide">
                              {o.role}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                            <Calendar className="h-3.5 w-3.5 opacity-60" />
                            <span>Created {new Date(o.organizations?.created_at ?? "").toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
