import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Phone,
  Settings,
  Key,
  ShieldCheck,
  Building,
  Plus,
  Trash2,
  AlertCircle,
  HelpCircle,
  Activity,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/telephony")({
  component: TelephonyPage,
});

type Provider = "exotel" | "plivo";

type TelephonyConfig = {
  provider: Provider;
  account_sid: string;
  exophone: string;
  auth_token_masked?: string;
};

type PhoneRow = {
  id: string;
  phone_number: string;
  provider: Provider;
  assigned_agent_id: string | null;
  status: "active" | "inactive";
  agents?: {
    id: string;
    name: string;
  } | null;
};

type AgentOption = {
  id: string;
  name: string;
};

function TelephonyPage() {
  const { orgId } = Route.useParams();
  const { role, isOwner, canEdit, loading: roleLoading } = useOrgRole(orgId);

  // Telephony Creds State
  const [provider, setProvider] = useState<Provider>("exotel");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [exophone, setExophone] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Phone Numbers State
  const [numbers, setNumbers] = useState<PhoneRow[]>([]);
  const [numbersLoading, setNumbersLoading] = useState(true);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  
  // Add number modal
  const [addOpen, setAddOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newNumberProvider, setNewNumberProvider] = useState<Provider>("exotel");
  const [savingNumber, setSavingNumber] = useState(false);

  async function loadConfig() {
    setConfigLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("get_telephony_config", {
        _org_id: orgId,
      });

      if (error) throw error;
      const res = data as any;
      if (res && res.found) {
        setProvider(res.provider);
        setAccountSid(res.account_sid);
        setExophone(res.exophone || "");
        setAuthToken(""); // Never pre-fill Auth Token
        setIsConfigured(true);
      } else {
        setIsConfigured(false);
      }
    } catch (err: any) {
      console.error("Failed to load telephony configuration:", err);
    } finally {
      setConfigLoading(false);
    }
  }

  async function loadNumbers() {
    setNumbersLoading(true);
    try {
      const [numbersRes, agentsRes] = await Promise.all([
        (supabase as any)
          .from("phone_numbers")
          .select("id, phone_number, provider, assigned_agent_id, status, agents(id, name)")
          .eq("org_id", orgId),
        supabase
          .from("agents")
          .select("id, name")
          .eq("org_id", orgId)
      ]);

      if (numbersRes.error) throw numbersRes.error;
      if (agentsRes.error) throw agentsRes.error;

      setNumbers((numbersRes.data as unknown as PhoneRow[]) || []);
      setAgents((agentsRes.data as unknown as AgentOption[]) || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load phone numbers");
    } finally {
      setNumbersLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
    loadNumbers();
  }, [orgId]);

  async function handleTestConnection() {
    if (!accountSid.trim()) {
      toast.error("Please enter Account SID to test connection.");
      return;
    }

    setTestingConnection(true);
    try {
      // If auth token is blank (unchanged), use the saved DB credentials
      const body = !authToken.trim()
        ? { orgId }
        : { provider, accountSid: accountSid.trim(), authToken: authToken.trim() };

      const res = await fetch("/api/telephony/test-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.ok) {
        toast.success("Connection test successful! Valid credentials.");
      } else {
        toast.error(`Connection test failed: ${data.error || "Invalid credentials."}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to test connection.");
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleSaveConfig() {
    if (!isOwner) {
      toast.error("Only organization owners can modify telephony credentials.");
      return;
    }
    if (!accountSid.trim()) {
      toast.error("Please enter Account SID");
      return;
    }
    
    // Auth token is required if this is the first config
    if (!isConfigured && !authToken.trim()) {
      toast.error("Please enter Auth Token");
      return;
    }

    setSavingConfig(true);
    try {
      // If auth token is blank, we need to pass a special flag or fetch it first.
      // But set_telephony_config expects a token. We can fetch it first if we had a select policy, 
      // but we do not. So if token is blank, we load it server side in the RPC or keep old token.
      // Wait, let's look at the set_telephony_config RPC:
      // it inserts or updates. If authToken is blank, it will overwrite it with blank!
      // So in the UI, if authToken is blank, we can either block saving or pass the token.
      // Wait! How can we pass the token if the token is masked?
      // If the user didn't change the token, we can pass a dummy value or modify the RPC to support optional tokens.
      // Wait, let's look at the RPC set_telephony_config:
      // If the token is empty, we don't want to overwrite it!
      // Let's modify our RPC to check: if token is empty and a record already exists, do NOT update auth_token.
      // Let's add that check in the RPC or write it in the client side.
      // Wait, since we wrote the migration, let's make sure that if the token is empty, the client can skip it, 
      // or we can pass a special marker like "__UNCHANGED__" to let the RPC know not to update it!
      // That's an extremely smart client-server pattern!
      const targetToken = !authToken.trim() ? "__UNCHANGED__" : authToken.trim();

      const { data, error } = await (supabase as any).rpc("set_telephony_config", {
        _org_id: orgId,
        _provider: provider,
        _account_sid: accountSid.trim(),
        _auth_token: targetToken,
        _exophone: exophone.trim() || null,
      });

      if (error) throw error;
      const res = data as any;
      if (!res.success) {
        throw new Error(res.message || "Failed to save configuration");
      }

      toast.success("Telephony configuration saved successfully.");
      setIsConfigured(true);
      setAuthToken(""); // Reset form input
    } catch (err: any) {
      toast.error(err.message || "Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleAddNumber() {
    if (!canEdit) {
      toast.error("You do not have permission to add phone numbers.");
      return;
    }
    if (!newNumber.trim()) {
      toast.error("Please enter a phone number.");
      return;
    }

    setSavingNumber(true);
    try {
      const { error } = await (supabase as any).from("phone_numbers").insert({
        org_id: orgId,
        phone_number: newNumber.trim(),
        provider: newNumberProvider,
        status: "active",
      });

      if (error) throw error;

      toast.success("Phone number added successfully.");
      setNewNumber("");
      setAddOpen(false);
      loadNumbers();
    } catch (err: any) {
      toast.error(err.message || "Failed to add phone number");
    } finally {
      setSavingNumber(false);
    }
  }

  async function handleAssignAgent(numberRow: PhoneRow, agentId: string | null) {
    if (!canEdit) {
      toast.error("You do not have permission to assign phone numbers.");
      return;
    }

    try {
      const { error } = await (supabase as any)
        .from("phone_numbers")
        .update({ assigned_agent_id: agentId })
        .eq("id", numberRow.id);

      if (error) throw error;

      toast.success(
        agentId
          ? "Number assigned to agent successfully."
          : "Number unassigned successfully."
      );
      loadNumbers();
    } catch (err: any) {
      toast.error(err.message || "Failed to update assignment");
    }
  }

  async function handleDeleteNumber(id: string, phone: string) {
    if (!canEdit) {
      toast.error("You do not have permission to delete phone numbers.");
      return;
    }

    try {
      const { error } = await (supabase as any).from("phone_numbers").delete().eq("id", id);
      if (error) throw error;

      toast.success(`Phone number ${phone} deleted.`);
      setNumbers((prev) => prev.filter((n) => n.id !== id));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete number");
    }
  }

  const readOnly = !isOwner;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 font-sans space-y-8">
      {/* Breadcrumb / Top Row */}
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm" className="rounded-lg h-9">
          <Link to="/orgs/$orgId/settings" params={{ orgId }}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            <span>Settings</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            Telephony Settings
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure Exotel/Plivo calling credentials and assign phone numbers.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Credentials Form Card */}
        <Card className="p-6 border-border/60 shadow-sm md:col-span-5 space-y-6 h-fit bg-card/60 backdrop-blur">
          <div className="flex gap-3.5 items-start">
            <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Credentials</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Auth tokens are safely encrypted on the server.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as Provider)}
                disabled={readOnly || configLoading}
              >
                <SelectTrigger className="h-9 border-border/80 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exotel">Exotel</SelectItem>
                  <SelectItem value="plivo">Plivo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sid">Account SID</Label>
              <Input
                id="sid"
                placeholder={provider === "exotel" ? "e.g. exotel_sid" : "e.g. plivo_auth_id"}
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                disabled={readOnly || configLoading}
                className="h-9 border-border/80 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="token">Auth Token</Label>
              <Input
                id="token"
                type="password"
                placeholder={isConfigured ? "••••••••••••••••" : "Enter auth token..."}
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                disabled={readOnly || configLoading}
                className="h-9 border-border/80 text-sm"
              />
              {isConfigured && (
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Token is currently configured. Re-type values here to update credentials.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="exophone">Exophone / Caller-ID</Label>
              <Input
                id="exophone"
                placeholder="e.g. +919876543210"
                value={exophone}
                onChange={(e) => setExophone(e.target.value)}
                disabled={readOnly || configLoading}
                className="h-9 border-border/80 text-sm"
              />
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            {!readOnly && (
              <Button
                onClick={handleSaveConfig}
                disabled={savingConfig || configLoading || !accountSid.trim()}
                className="flex-1 bg-primary hover:bg-primary/95 text-white text-xs h-9 font-medium shadow-sm"
              >
                {savingConfig ? "Saving..." : "Save Config"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testingConnection || configLoading || !accountSid.trim()}
              className="flex-1 text-xs h-9 border-border/60 hover:bg-muted/40 font-medium"
            >
              {testingConnection ? "Testing..." : "Test Connection"}
            </Button>
          </div>
        </Card>

        {/* Phone Numbers List Card */}
        <Card className="p-6 border-border/60 shadow-sm md:col-span-7 space-y-6 bg-card/60 backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex gap-3.5 items-start">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Phone Numbers</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Caller-ID phone numbers used to place outbound calls.
                </p>
              </div>
            </div>

            {canEdit && (
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-8 text-xs font-semibold cursor-pointer gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Number</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Add Phone Number</DialogTitle>
                    <DialogDescription className="text-xs">
                      Enter the phone number registered in your telephony provider.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="num-provider">Provider</Label>
                      <Select
                        value={newNumberProvider}
                        onValueChange={(v) => setNewNumberProvider(v as Provider)}
                      >
                        <SelectTrigger className="h-9 border-border/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exotel">Exotel</SelectItem>
                          <SelectItem value="plivo">Plivo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="new-number">Phone Number</Label>
                      <Input
                        id="new-number"
                        placeholder="e.g. +918047096644"
                        value={newNumber}
                        onChange={(e) => setNewNumber(e.target.value)}
                        className="h-9 border-border/80"
                      />
                    </div>
                  </div>

                  <DialogFooter className="pt-2 gap-2 sm:gap-0">
                    <Button
                      variant="outline"
                      onClick={() => setAddOpen(false)}
                      disabled={savingNumber}
                      className="h-9 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddNumber}
                      disabled={savingNumber || !newNumber.trim()}
                      className="h-9 text-xs bg-primary hover:bg-primary/95 text-white"
                    >
                      {savingNumber ? "Adding..." : "Add Number"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Numbers list */}
          {numbersLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : numbers.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-border/60 rounded-lg bg-muted/5">
              <Phone className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
              <p className="text-xs font-semibold text-foreground">No phone numbers added</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Configure credentials and click "Add Number" above.
              </p>
            </div>
          ) : (
            <div className="border border-border/40 rounded-lg overflow-hidden text-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20 text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
                    <th className="px-4 py-2.5">Phone Number</th>
                    <th className="px-4 py-2.5">Provider</th>
                    <th className="px-4 py-2.5">Assigned Agent</th>
                    {canEdit && <th className="px-4 py-2.5 text-right">Delete</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {numbers.map((num) => (
                    <tr key={num.id} className="hover:bg-muted/5 transition-colors">
                      <td className="px-4 py-3 font-semibold font-mono text-xs">
                        {num.phone_number}
                      </td>
                      <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                        {num.provider}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={num.assigned_agent_id || "unassigned"}
                          onValueChange={(val) =>
                            handleAssignAgent(
                              num,
                              val === "unassigned" ? null : val
                            )
                          }
                          disabled={!canEdit}
                        >
                          <SelectTrigger className="h-7 border-border/60 text-xs py-0.5 px-2 bg-background/40 max-w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {agents.map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {agent.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteNumber(num.id, num.phone_number)}
                            className="h-7 w-7 p-0 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-md cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
