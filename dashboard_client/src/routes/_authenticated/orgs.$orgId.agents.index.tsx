import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Settings, Users } from "lucide-react";
import { LiveCallWidget } from "@/components/LiveCallWidget";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/agents/")({
  component: AgentsList,
});

type Agent = {
  id: string;
  name: string;
  language: string;
  direction: string;
  created_at: string;
};

type Org = { id: string; name: string };

const AGENT_TEMPLATES = [
  {
    tag: "ORDERS",
    title: "Order Confirmation",
    desc: "Recover abandoned carts & confirm cash-on-delivery orders.",
    sample: "नमस्ते शर्मा जी, मैं कृज़ूनो से बात कर रही हूँ...",
    name: "Order Confirmation Agent"
  },
  {
    tag: "COLLECTIONS",
    title: "Payment Collection",
    desc: "Gentle automated payment reminders for outstanding invoices.",
    sample: "हेलो सर, आपके बकाया भुगतान के बारे में सूचित करने के लिए...",
    name: "Collections Agent"
  },
  {
    tag: "FEEDBACK",
    title: "Voice of Customer",
    desc: "Post-delivery satisfaction surveys and NPS scoring.",
    sample: "नमस्ते, आपका फीडबैक हमारे लिए बहुत महत्वपूर्ण है...",
    name: "NPS Survey Agent"
  }
];

function AgentsList() {
  const { orgId } = Route.useParams();
  const { canEdit, loading: roleLoading } = useOrgRole(orgId);
  const [org, setOrg] = useState<Org | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [creating, setCreating] = useState(false);

  async function load() {
    const [orgRes, agentsRes] = await Promise.all([
      supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle(),
      supabase
        .from("agents")
        .select("id, name, language, direction, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
    ]);
    if (orgRes.error) toast.error(orgRes.error.message);
    if (agentsRes.error) toast.error(agentsRes.error.message);
    setOrg(orgRes.data);
    setAgents(agentsRes.data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function createAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.from("agents").insert({
      org_id: orgId,
      name: name.trim(),
      language,
      direction,
    }).select("id").maybeSingle();
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    logAuditEvent(orgId, "agent.created", "agent", data?.id, { name: name.trim(), language, direction });
    setOpen(false);
    setName("");
    load();
  }

  return (
    <>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Voice agents in this organization. Pick one to manage its flows.
            </p>
          </div>
          <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" title="Organization members">
            <Link to="/orgs/$orgId/members" params={{ orgId }}>
              <Users className="h-4 w-4 mr-2" />
              Members
            </Link>
          </Button>
          <Button asChild variant="outline" size="icon" title="Organization settings">
            <Link to="/orgs/$orgId/settings" params={{ orgId }}>
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          {!roleLoading && canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New agent</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create agent</DialogTitle>
              </DialogHeader>
              <form onSubmit={createAgent} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input
                    id="agent-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Order Recovery Bot"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider font-mono text-primary">Pre-seed from Job Pack Template</Label>
                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                    {AGENT_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.tag}
                        type="button"
                        onClick={() => {
                          setName(tpl.name);
                        }}
                        className="text-left p-3 rounded-lg border border-border bg-card hover:border-primary/50 transition-all hover:translate-y-[-1px] hover:shadow-sm cursor-pointer group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9px] text-primary tracking-wider font-semibold">{tpl.tag}</span>
                          <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">{tpl.title}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-normal">{tpl.desc}</p>
                        <div className="mt-2 text-[10px] bg-accent/40 text-foreground px-2 py-1 rounded font-sans italic truncate">
                          {tpl.sample}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select value={language} onValueChange={setLanguage}>
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
                      onValueChange={(v) => setDirection(v as "outbound" | "inbound")}
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

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow-label">Overview</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {agents === null && <div className="text-sm text-muted-foreground">Loading…</div>}
              {agents && agents.length === 0 && (
                <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
                  No agents yet. Create your first one.
                </Card>
              )}
              {agents?.map((a) => (
                <Link
                  key={a.id}
                  to="/orgs/$orgId/agents/$agentId"
                  params={{ orgId, agentId: a.id }}
                  className="block h-full group"
                >
                  <Card className="p-5 h-full transition-all duration-300 hover:scale-[1.01] hover:border-primary/50 hover:shadow-md cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{a.name}</div>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                        {a.direction}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground font-mono">
                      {a.language} · {new Date(a.created_at).toLocaleDateString()}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow-label eyebrow-label-terra">Live Call Simulator</span>
            </div>
            <LiveCallWidget />
          </div>
        </div>
      </main>
    </>
  );
}
