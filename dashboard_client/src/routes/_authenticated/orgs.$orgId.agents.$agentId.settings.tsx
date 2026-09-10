import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { logAuditEvent } from "@/lib/audit-logger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useOrgRole } from "@/hooks/useOrgRole";

export const Route = createFileRoute(
  "/_authenticated/orgs/$orgId/agents/$agentId/settings",
)({
  component: AgentSettings,
});

type Direction = "outbound" | "inbound";

function AgentSettings() {
  const { orgId, agentId } = Route.useParams();
  const navigate = useNavigate();
  const { canEdit, isOwner, loading: roleLoading } = useOrgRole(orgId);
  const [deleting, setDeleting] = useState(false);

  async function deleteAgent() {
    setDeleting(true);
    const { error } = await supabase.from("agents").delete().eq("id", agentId);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    logAuditEvent(orgId, "agent.deleted", "agent", agentId, { name: original.name });
    toast.success("Agent deleted");
    navigate({ to: "/orgs/$orgId/agents", params: { orgId } });
  }

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [direction, setDirection] = useState<Direction>("outbound");
  const [numbersList, setNumbersList] = useState<{ id: string; phone_number: string; assigned_agent_id: string | null; provider: string }[]>([]);
  const [assignedNumberId, setAssignedNumberId] = useState<string>("none");
  const [original, setOriginal] = useState({
    name: "",
    language: "en-IN",
    direction: "outbound" as Direction,
    numberId: "none",
  });

  async function loadData() {
    setLoading(true);
    try {
      const [agentRes, numbersRes] = await Promise.all([
        supabase
          .from("agents")
          .select("id, name, language, direction")
          .eq("id", agentId)
          .maybeSingle(),
        (supabase as any)
          .from("phone_numbers")
          .select("id, phone_number, assigned_agent_id, provider")
          .eq("org_id", orgId)
      ]);

      if (agentRes.error) throw agentRes.error;
      if (numbersRes.error) throw numbersRes.error;

      if (agentRes.data) {
        const agent = agentRes.data;
        setName(agent.name);
        setLanguage(agent.language);
        setDirection(agent.direction as Direction);

        const numList = (numbersRes.data as any[]) || [];
        setNumbersList(numList);

        const currentNum = numList.find((n) => n.assigned_agent_id === agentId);
        const currentNumId = currentNum ? currentNum.id : "none";
        setAssignedNumberId(currentNumId);

        setOriginal({
          name: agent.name,
          language: agent.language,
          direction: agent.direction as Direction,
          numberId: currentNumId,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load agent settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [agentId, orgId]);

  const availableNumbers = useMemo(() => {
    return numbersList.filter(
      (n) => n.assigned_agent_id === null || n.assigned_agent_id === agentId
    );
  }, [numbersList, agentId]);

  const dirty =
    name !== original.name ||
    language !== original.language ||
    direction !== original.direction ||
    assignedNumberId !== original.numberId;

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // 1. Update Agent Details
      const { error: agentErr } = await supabase
        .from("agents")
        .update({ name: name.trim(), language, direction })
        .eq("id", agentId);

      if (agentErr) throw agentErr;

      // 2. Update Phone Number Assignments if changed
      if (assignedNumberId !== original.numberId) {
        if (original.numberId !== "none") {
          const { error: unassignErr } = await (supabase as any)
            .from("phone_numbers")
            .update({ assigned_agent_id: null })
            .eq("id", original.numberId);
          if (unassignErr) throw unassignErr;
        }

        if (assignedNumberId !== "none") {
          const { error: assignErr } = await (supabase as any)
            .from("phone_numbers")
            .update({ assigned_agent_id: agentId })
            .eq("id", assignedNumberId);
          if (assignErr) throw assignErr;
        }
      }

      setOriginal({ name: name.trim(), language, direction, numberId: assignedNumberId });
      logAuditEvent(orgId, "agent.updated", "agent", agentId, { name: name.trim(), language, direction });
      toast.success("Agent settings updated successfully");
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to update agent");
    } finally {
      setSaving(false);
    }
  }

  const readOnly = !roleLoading && !canEdit;

  return (
    <>
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Agent settings</h1>

        <Card className="mt-6 p-6">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select
                    value={language}
                    onValueChange={setLanguage}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-IN">English (India)</SelectItem>
                      <SelectItem value="hi-IN">Hindi</SelectItem>
                      <SelectItem value="ta-IN">Tamil</SelectItem>
                      <SelectItem value="te-IN">Telugu</SelectItem>
                      <SelectItem value="mr-IN">Marathi</SelectItem>
                      <SelectItem value="bn-IN">Bengali</SelectItem>
                      <SelectItem value="kn-IN">Kannada</SelectItem>
                      <SelectItem value="gu-IN">Gujarati</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Direction</Label>
                  <Select
                    value={direction}
                    onValueChange={(v) => setDirection(v as Direction)}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="outbound">Outbound</SelectItem>
                      <SelectItem value="inbound">Inbound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assigned Phone Number</Label>
                <Select
                  value={assignedNumberId}
                  onValueChange={setAssignedNumberId}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No phone number assigned</SelectItem>
                    {availableNumbers.map((num) => (
                      <SelectItem key={num.id} value={num.id}>
                        {num.phone_number} ({num.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Choose a caller-ID number to associate with this agent for placing calls.
                </p>
              </div>

              {!readOnly && (
                <div className="pt-2">
                  <Button
                    onClick={save}
                    disabled={saving || !dirty || !name.trim()}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        {!roleLoading && isOwner && (
          <Card className="mt-6 border-destructive/40 p-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-destructive">
              Danger zone
            </h2>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Delete agent</div>
                <div className="text-xs text-muted-foreground">
                  Permanently deletes this agent and all its flows. This cannot be undone.
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{original.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes the agent and every flow inside it. This
                      action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        deleteAgent();
                      }}
                      disabled={deleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {deleting ? "Deleting…" : "Delete agent"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
