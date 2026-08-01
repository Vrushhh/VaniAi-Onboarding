import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, ArrowRight, Building, Users, Bot } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

type Step = 1 | 2 | 3;

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);

  // Step 1: Org details
  const [orgName, setOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  // Step 2: Agent details
  const [agentName, setAgentName] = useState("");
  const [agentLang, setAgentLang] = useState("hi-IN");
  const [agentDirection, setAgentDirection] = useState<"outbound" | "inbound">("outbound");
  const [creatingAgent, setCreatingAgent] = useState(false);

  // Check if they already have organizations
  async function checkExistingOrgs() {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", userData.user.id);

      if (error) throw error;

      // If they already have an organization, redirect them to dashboard
      if (data && data.length > 0) {
        navigate({ to: "/orgs/$orgId/agents", params: { orgId: data[0].org_id } });
        return;
      }
    } catch (err: any) {
      console.error("Error checking existing organizations:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkExistingOrgs();
  }, []);

  async function handleCreateOrg() {
    if (!orgName.trim()) {
      toast.error("Please enter an organization name.");
      return;
    }
    setCreatingOrg(true);
    try {
      // Call create_organization secure RPC
      const { data, error } = await supabase.rpc("create_organization", {
        _name: orgName.trim(),
      });

      if (error) throw error;

      const createdOrg = data as { id: string; name: string };
      setCreatedOrgId(createdOrg.id);
      toast.success(`Organization "${createdOrg.name}" created successfully!`);
      setStep(2);
    } catch (err: any) {
      toast.error(err.message || "Failed to create organization");
    } finally {
      setCreatingOrg(false);
    }
  }

  async function handleCreateAgent() {
    if (!agentName.trim()) {
      toast.error("Please enter an agent name.");
      return;
    }
    if (!createdOrgId) {
      toast.error("No organization context found. Please restart onboarding.");
      setStep(1);
      return;
    }

    setCreatingAgent(true);
    try {
      const { error } = await supabase.from("agents").insert({
        org_id: createdOrgId,
        name: agentName.trim(),
        language: agentLang,
        direction: agentDirection,
      });

      if (error) throw error;

      toast.success(`Voice agent "${agentName.trim()}" created successfully!`);
      setStep(3);
    } catch (err: any) {
      toast.error(err.message || "Failed to create agent");
    } finally {
      setCreatingAgent(false);
    }
  }

  function handleSkipAgent() {
    setStep(3);
  }

  function handleFinish() {
    if (createdOrgId) {
      navigate({ to: "/orgs/$orgId/agents", params: { orgId: createdOrgId } });
    } else {
      navigate({ to: "/" });
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground font-mono uppercase tracking-wider text-[11px]">Loading wizard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12 font-sans">
      {/* Wizard Header Stepper */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold font-display tracking-tight text-foreground text-center">
          Let's set up Kzuno
        </h1>
        <p className="text-sm text-muted-foreground text-center mt-1.5">
          Get your workspace ready in less than a minute.
        </p>

        {/* Stepper Indicators */}
        <div className="flex items-center justify-center gap-2 mt-8">
          <div className="flex items-center gap-2">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step >= 1
                  ? "bg-primary text-white"
                  : "bg-surface-muted text-muted-foreground border border-border"
              }`}
            >
              1
            </div>
            <span
              className={`text-xs font-medium ${
                step >= 1 ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              Workspace
            </span>
          </div>

          <div className="w-8 h-[1px] bg-border" />

          <div className="flex items-center gap-2">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step >= 2
                  ? "bg-primary text-white"
                  : "bg-surface-muted text-muted-foreground border border-border"
              }`}
            >
              2
            </div>
            <span
              className={`text-xs font-medium ${
                step >= 2 ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              First Agent
            </span>
          </div>

          <div className="w-8 h-[1px] bg-border" />

          <div className="flex items-center gap-2">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step >= 3
                  ? "bg-primary text-white"
                  : "bg-surface-muted text-muted-foreground border border-border"
              }`}
            >
              3
            </div>
            <span
              className={`text-xs font-medium ${
                step >= 3 ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              Ready
            </span>
          </div>
        </div>
      </div>

      {/* Stepper Content */}
      <Card className="p-8 border-border/60 shadow-lg bg-card/60 backdrop-blur">
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex gap-4 items-start">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Building className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground font-display">Create your organization</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Organizations group your voice agents, call analytics, and team members together.
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="org-name" className="text-sm font-medium text-foreground">
                Organization Name
              </Label>
              <Input
                id="org-name"
                placeholder="e.g. Acme Corp"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
                className="h-10 border-border/80"
                autoFocus
              />
            </div>

            <div className="pt-2">
              <Button
                onClick={handleCreateOrg}
                disabled={creatingOrg || !orgName.trim()}
                className="w-full bg-primary hover:bg-primary/95 text-white h-10 shadow-md font-medium"
              >
                {creatingOrg ? "Creating..." : "Continue"}
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="flex gap-4 items-start">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground font-display">Create your first AI agent</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set up a voice agent to automate your outbound or inbound calls.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name" className="text-sm font-medium text-foreground">
                  Agent Name
                </Label>
                <Input
                  id="agent-name"
                  placeholder="e.g. Sales Confirmations"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateAgent()}
                  className="h-10 border-border/80"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select value={agentLang} onValueChange={setAgentLang}>
                    <SelectTrigger className="h-10 border-border/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-IN">English (India)</SelectItem>
                      <SelectItem value="hi-IN">Hindi (हिन्दी)</SelectItem>
                      <SelectItem value="ta-IN">Tamil (தமிழ்)</SelectItem>
                      <SelectItem value="te-IN">Telugu (తెలుగు)</SelectItem>
                      <SelectItem value="mr-IN">Marathi (मराठी)</SelectItem>
                      <SelectItem value="bn-IN">Bengali (বাংলা)</SelectItem>
                      <SelectItem value="kn-IN">Kannada (ಕನ್ನಡ)</SelectItem>
                      <SelectItem value="gu-IN">Gujarati (ગુજરાતી)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Direction</Label>
                  <Select
                    value={agentDirection}
                    onValueChange={(v) => setAgentDirection(v as "outbound" | "inbound")}
                  >
                    <SelectTrigger className="h-10 border-border/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="outbound">Outbound</SelectItem>
                      <SelectItem value="inbound">Inbound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button
                onClick={handleCreateAgent}
                disabled={creatingAgent || !agentName.trim()}
                className="w-full bg-primary hover:bg-primary/95 text-white h-10 shadow-md font-medium"
              >
                {creatingAgent ? "Creating..." : "Create Agent & Continue"}
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
              <Button
                onClick={handleSkipAgent}
                variant="ghost"
                className="w-full text-xs text-muted-foreground hover:bg-muted/40 h-9 font-medium"
              >
                Skip this step for now
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 text-center py-4 flex flex-col items-center">
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2 animate-bounce">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div className="space-y-2 max-w-sm">
              <h2 className="text-lg font-bold text-foreground font-display">Setup completed successfully!</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your workspace is ready. You can now design conversational flows, run simulations, or invite team members.
              </p>
            </div>

            <div className="pt-4 w-full">
              <Button
                onClick={handleFinish}
                className="w-full bg-primary hover:bg-primary/95 text-white h-10 shadow-md font-medium"
              >
                <span>Go to Dashboard</span>
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
