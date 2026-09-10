import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { emptyDraft } from "@/lib/flow-types";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Settings, MoreVertical } from "lucide-react";
import { VoiceTester } from "@/components/VoiceTester";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/agents/$agentId/")({
  component: FlowsList,
});

type Agent = { id: string; name: string; language: string; org_id: string };
type Flow = {
  id: string;
  name: string;
  updated_at: string;
  published_version_id: string | null;
  draft_json: unknown;
};

function FlowsList() {
  const navigate = useNavigate();
  const { orgId, agentId } = Route.useParams();
  const { canEdit, loading: roleLoading } = useOrgRole(orgId);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteFlowId, setDeleteFlowId] = useState<string | null>(null);

  async function load() {
    const [a, f] = await Promise.all([
      supabase
        .from("agents")
        .select("id, name, language, org_id")
        .eq("id", agentId)
        .maybeSingle(),
      supabase
        .from("flows")
        .select("id, name, updated_at, published_version_id, draft_json")
        .eq("agent_id", agentId)
        .order("updated_at", { ascending: false }),
    ]);
    if (a.error) toast.error(a.error.message);
    if (f.error) toast.error(f.error.message);
    setAgent(a.data);
    setFlows(f.data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function createFlow(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agent) return;
    setCreating(true);
    const draft = emptyDraft(agentId, agent.language);
    const { data, error } = await supabase
      .from("flows")
      .insert({
        agent_id: agentId,
        name: name.trim(),
        draft_json: draft as never,
      })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpen(false);
    setName("");
    navigate({ to: "/orgs/$orgId/agents/$agentId/flows/$flowId", params: { orgId, agentId, flowId: data.id } });
  }

  async function duplicateFlow(flow: Flow) {
    const { error } = await supabase.from("flows").insert({
      agent_id: agentId,
      name: flow.name + " (copy)",
      draft_json: flow.draft_json as never,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Flow duplicated");
    load();
  }

  async function deleteFlow(flowId: string) {
    setDeleteFlowId(flowId);
  }


  return (
    <>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Flows</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Conversation flows for this agent.
            </p>
          </div>
          <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" title="Agent settings">
            <Link
              to="/orgs/$orgId/agents/$agentId/settings"
              params={{ orgId, agentId }}
            >
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          {!roleLoading && canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New flow</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create flow</DialogTitle>
              </DialogHeader>
              <form onSubmit={createFlow} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="flow-name">Name</Label>
                  <Input
                    id="flow-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="COD confirmation v1"
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
          )}
          </div>
        </div>

        <div className="mt-8 space-y-3">
          {flows === null && <div className="text-sm text-muted-foreground">Loading…</div>}
          {flows && flows.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No flows yet. Create your first one.
            </Card>
          )}
          {flows?.map((f) => (
            <Link
              key={f.id}
              to="/orgs/$orgId/agents/$agentId/flows/$flowId"
              params={{ orgId, agentId, flowId: f.id }}
            >
              <Card className="flex items-center justify-between p-5 transition hover:border-foreground/30">
                <div>
                  <div className="font-medium">{f.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Updated {new Date(f.updated_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs">
                    {f.published_version_id ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Published
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                        Draft only
                      </span>
                    )}
                  </div>
                  {!roleLoading && canEdit && (
                    <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => duplicateFlow(f)}>
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onSelect={() => deleteFlow(f.id)}
                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-10">
          <VoiceTester />
        </div>
      </main>

      <Dialog open={!!deleteFlowId} onOpenChange={(open) => !open && setDeleteFlowId(null)}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold font-display text-destructive">Delete Flow</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            Are you sure you want to delete this flow? This action is permanent and cannot be undone.
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteFlowId(null)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={async () => {
                if (!deleteFlowId) return;
                const { error } = await supabase.from("flows").delete().eq("id", deleteFlowId);
                setDeleteFlowId(null);
                if (error) {
                  toast.error(error.message);
                  return;
                }
                toast.success("Flow deleted");
                load();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
