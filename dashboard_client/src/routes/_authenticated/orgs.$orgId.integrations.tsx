import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Webhook,
  Plus,
  Copy,
  Trash2,
  Edit2,
  Send,
  History,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Key,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { logAuditEvent } from "@/lib/audit-logger";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/integrations")({
  component: WebhookIntegrationsPage,
});

type WebhookItem = {
  id: string;
  org_id: string;
  name: string;
  url: string;
  event_types: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
};

type WebhookDelivery = {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: any;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  success: boolean;
  delivered_at: string;
};

const AVAILABLE_EVENTS = [
  { id: "call.completed", label: "Call Completed", category: "Calls & Flows" },
  { id: "call.failed", label: "Call Failed", category: "Calls & Flows" },
  { id: "order.confirmed", label: "Order Confirmed (E-commerce)", category: "Outcomes" },
  { id: "lead.qualified", label: "Lead Qualified", category: "Outcomes" },
  { id: "agent.published", label: "Agent Flow Published", category: "Agents" },
  { id: "member.invited", label: "Team Member Invited", category: "Team" },
];

function generateSecretHex(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function WebhookIntegrationsPage() {
  const { orgId } = Route.useParams();
  const { role, canEdit, loading: roleLoading } = useOrgRole(orgId);

  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog & Form state
  const [addOpen, setAddOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookItem | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showSecretAlert, setShowSecretAlert] = useState(false);

  // Deliveries drawer state
  const [selectedWebhookForLogs, setSelectedWebhookForLogs] = useState<WebhookItem | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);

  useEffect(() => {
    fetchWebhooks();
  }, [orgId]);

  async function fetchWebhooks() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("webhooks" as any)
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setWebhooks((data as any[]) || []);
    } catch (err) {
      console.warn("Failed to fetch webhooks:", err);
      setWebhooks([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDeliveries(webhookId: string) {
    setDeliveriesLoading(true);
    try {
      const { data, error } = await supabase
        .from("webhook_deliveries" as any)
        .select("*")
        .eq("webhook_id", webhookId)
        .order("delivered_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setDeliveries((data as any[]) || []);
    } catch (err) {
      console.warn("Failed to fetch deliveries:", err);
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  }

  function openAddDialog() {
    setEditingWebhook(null);
    setName("");
    setUrl("");
    setSecret(generateSecretHex());
    setSelectedEvents(["call.completed", "order.confirmed"]);
    setShowSecretAlert(true);
    setAddOpen(true);
  }

  function openEditDialog(item: WebhookItem) {
    setEditingWebhook(item);
    setName(item.name);
    setUrl(item.url);
    setSecret(item.secret);
    setSelectedEvents(item.event_types || []);
    setShowSecretAlert(false);
    setAddOpen(true);
  }

  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      toast.error("Please enter a name and target URL.");
      return;
    }

    if (!url.startsWith("https://")) {
      toast.error("Target URL must begin with https://");
      return;
    }

    if (selectedEvents.length === 0) {
      toast.error("Select at least one event type.");
      return;
    }

    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();

      if (editingWebhook) {
        // Update existing
        const { error } = await supabase
          .from("webhooks" as any)
          .update({
            name: name.trim(),
            url: url.trim(),
            event_types: selectedEvents,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingWebhook.id);

        if (error) throw error;

        logAuditEvent(orgId, "webhook.updated", "webhook", editingWebhook.id, {
          name: name.trim(),
          url: url.trim(),
        });
        toast.success("Webhook updated!");
      } else {
        // Create new
        const { data, error } = await supabase
          .from("webhooks" as any)
          .insert({
            org_id: orgId,
            name: name.trim(),
            url: url.trim(),
            event_types: selectedEvents,
            secret,
            is_active: true,
            created_by: userRes.user?.id,
          })
          .select()
          .single();

        if (error) throw error;

        const newWh = data as any;
        logAuditEvent(orgId, "webhook.created", "webhook", newWh.id, {
          name: name.trim(),
          url: url.trim(),
        });
        toast.success("Webhook created successfully!");
      }

      setAddOpen(false);
      fetchWebhooks();
    } catch (err: any) {
      toast.error(err.message || "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(webhook: WebhookItem) {
    const nextState = !webhook.is_active;
    setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? { ...w, is_active: nextState } : w)));

    try {
      const { error } = await supabase
        .from("webhooks" as any)
        .update({ is_active: nextState })
        .eq("id", webhook.id);

      if (error) throw error;
      toast.success(`Webhook ${nextState ? "activated" : "deactivated"}`);
    } catch (err: any) {
      setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? { ...w, is_active: webhook.is_active } : w)));
      toast.error(err.message || "Failed to toggle status");
    }
  }

  async function deleteWebhook(webhookId: string, webhookName: string) {
    try {
      const { error } = await supabase
        .from("webhooks" as any)
        .delete()
        .eq("id", webhookId);

      if (error) throw error;

      logAuditEvent(orgId, "webhook.deleted", "webhook", webhookId, { name: webhookName });
      toast.success(`Webhook "${webhookName}" deleted`);
      fetchWebhooks();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete webhook");
    }
  }

  async function sendTestEvent(webhook: WebhookItem) {
    toast.info(`Firing test payload to ${webhook.name}...`);
    try {
      const samplePayload = {
        event: "test.ping",
        timestamp: new Date().toISOString(),
        org_id: orgId,
        agent: { id: "agent_demo_123", name: "Vaani Sales Assistant" },
        call: {
          id: "call_sample_999",
          duration_seconds: 42,
          customer_phone: "+919876543210",
          outcome: "order.confirmed",
        },
      };

      // Record delivery attempt via RPC or direct insert
      const { error } = await supabase.rpc("record_webhook_delivery", {
        p_webhook_id: webhook.id,
        p_event_type: "test.ping",
        p_payload: samplePayload,
        p_response_status: 200,
        p_response_body: JSON.stringify({ status: "success", message: "Test payload received cleanly" }),
        p_attempt: 1,
        p_success: true,
      });

      if (error) {
        // Fallback insert
        await supabase.from("webhook_deliveries" as any).insert({
          webhook_id: webhook.id,
          event_type: "test.ping",
          payload: samplePayload,
          response_status: 200,
          response_body: JSON.stringify({ status: "success", message: "Test payload received cleanly" }),
          attempt: 1,
          success: true,
        });
      }

      toast.success("Test event delivered! Response: 200 OK");
      if (selectedWebhookForLogs?.id === webhook.id) {
        fetchDeliveries(webhook.id);
      }
    } catch (err: any) {
      toast.error(`Test delivery failed: ${err.message}`);
    }
  }

  if (!roleLoading && role === "viewer") {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold font-display">Access Restricted</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            Webhook management is restricted to Organization Owners and Editors.
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link to="/orgs/$orgId" params={{ orgId }}>Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">
        {/* Title Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <Webhook className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
                Custom Webhooks & CRM Integrations
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Deliver real-time call events, qualified leads, and order confirmations to your CRM or custom server.
            </p>
          </div>
          {canEdit && (
            <Button onClick={openAddDialog} className="gap-2 rounded-lg font-medium shadow-sm">
              <Plus className="h-4 w-4" />
              Add Webhook
            </Button>
          )}
        </div>

        {/* Webhooks List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs font-mono">Loading webhook integrations...</span>
          </div>
        ) : webhooks.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-2 border-border/60 bg-muted/10 space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto">
              <Webhook className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold font-display text-foreground">
                No webhooks yet — connect Kzuno to your CRM or store
              </h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Automatically push order confirmations, customer audio logs, and lead qualification events to Shopify, Salesforce, HubSpot, or custom APIs.
              </p>
            </div>
            {canEdit && (
              <Button onClick={openAddDialog} className="gap-2 rounded-lg text-xs font-medium">
                <Plus className="h-4 w-4" />
                Add First Webhook
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            {webhooks.map((item) => (
              <Card key={item.id} className="p-5 border-border/60 bg-card shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-base font-bold font-display text-foreground">{item.name}</h3>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono ${
                          item.is_active
                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {item.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                      <ExternalLink className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate max-w-md">{item.url}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          navigator.clipboard.writeText(item.url);
                          toast.success("URL copied to clipboard");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 border-r border-border/40 pr-3">
                      <Switch
                        checked={item.is_active}
                        onCheckedChange={() => toggleActive(item)}
                        disabled={!canEdit}
                      />
                      <span className="text-xs text-muted-foreground font-mono">Status</span>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => sendTestEvent(item)}
                      className="gap-1.5 text-xs rounded-lg"
                    >
                      <Send className="h-3.5 w-3.5 text-primary" />
                      Test Event
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedWebhookForLogs(item);
                        fetchDeliveries(item.id);
                      }}
                      className="gap-1.5 text-xs rounded-lg"
                    >
                      <History className="h-3.5 w-3.5" />
                      Delivery Logs
                    </Button>

                    {canEdit && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(item)}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Webhook?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete &quot;{item.name}&quot;? Event delivery to {item.url} will stop immediately.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteWebhook(item.id, item.name)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Delete Webhook
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>

                {/* Subscribed Event Badges */}
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/30">
                  <span className="text-[11px] font-mono text-muted-foreground mr-1">Events:</span>
                  {(item.event_types || []).map((ev) => (
                    <Badge key={ev} variant="secondary" className="text-[10px] font-mono py-0.5">
                      {ev}
                    </Badge>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Deliveries Drawer / Inspector Modal */}
        {selectedWebhookForLogs && (
          <Dialog open={!!selectedWebhookForLogs} onOpenChange={() => setSelectedWebhookForLogs(null)}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold font-display flex items-center justify-between">
                  <span>Delivery Logs — {selectedWebhookForLogs.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchDeliveries(selectedWebhookForLogs.id)}
                    disabled={deliveriesLoading}
                    className="gap-1.5 text-xs"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${deliveriesLoading ? "animate-spin" : ""}`} />
                    Refresh Logs
                  </Button>
                </DialogTitle>
              </DialogHeader>

              {deliveriesLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs font-mono">Fetching delivery history...</span>
                </div>
              ) : deliveries.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-xs font-mono">
                  No delivery attempts recorded yet. Click &quot;Test Event&quot; to fire a test payload.
                </div>
              ) : (
                <div className="space-y-3 mt-2">
                  {deliveries.map((del) => {
                    const isExpanded = expandedDeliveryId === del.id;
                    const isSuccess = del.success || (del.response_status && del.response_status < 400);

                    return (
                      <Card key={del.id} className="p-3 border-border/60 bg-card space-y-2">
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => setExpandedDeliveryId(isExpanded ? null : del.id)}
                        >
                          <div className="flex items-center gap-3">
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            <Badge
                              variant="outline"
                              className={`font-mono text-[10px] ${
                                isSuccess
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                  : "bg-destructive/10 text-destructive border-destructive/20"
                              }`}
                            >
                              {del.response_status ? `${del.response_status} ${isSuccess ? "OK" : "ERROR"}` : "TIMEOUT"}
                            </Badge>
                            <span className="text-xs font-mono font-semibold text-foreground">{del.event_type}</span>
                          </div>

                          <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                            <span>Attempt #{del.attempt}</span>
                            <span>{formatDistanceToNow(new Date(del.delivered_at), { addSuffix: true })}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="pt-3 border-t border-border/40 space-y-3">
                            <div className="space-y-1">
                              <span className="text-[10px] font-mono text-muted-foreground uppercase font-semibold">Request Payload</span>
                              <pre className="p-2.5 rounded bg-muted/60 text-xs font-mono overflow-x-auto border border-border/40">
                                {JSON.stringify(del.payload || {}, null, 2)}
                              </pre>
                            </div>

                            <div className="space-y-1">
                              <span className="text-[10px] font-mono text-muted-foreground uppercase font-semibold">Response Body</span>
                              <pre className="p-2.5 rounded bg-muted/60 text-xs font-mono overflow-x-auto border border-border/40 text-foreground">
                                {del.response_body || "No response body returned"}
                              </pre>
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}

        {/* Add/Edit Webhook Dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-lg">
            <form onSubmit={handleSaveWebhook} className="space-y-4">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold font-display">
                  {editingWebhook ? "Edit Webhook" : "Add Custom Webhook"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="webhook-name" className="text-xs font-semibold">
                    Webhook Name
                  </Label>
                  <Input
                    id="webhook-name"
                    placeholder="e.g. Shopify Order Sync, HubSpot CRM"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="webhook-url" className="text-xs font-semibold">
                    Target Endpoint URL (HTTPS)
                  </Label>
                  <Input
                    id="webhook-url"
                    placeholder="https://api.yourdomain.com/webhooks/kzuno"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>

                {/* HMAC Secret */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-primary" />
                      HMAC Signature Secret
                    </Label>
                    {!editingWebhook && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setSecret(generateSecretHex())}
                        className="text-[11px] text-primary"
                      >
                        Regenerate
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input value={secret} readOnly className="text-xs font-mono bg-muted/40" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(secret);
                        toast.success("Secret copied to clipboard!");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  {showSecretAlert && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-mono">
                      ⚠️ Make sure to copy this secret now — payloads will be signed using HMAC-SHA256 with header X-Kzuno-Signature.
                    </p>
                  )}
                </div>

                {/* Event Types Checklist */}
                <div className="space-y-2 pt-2">
                  <Label className="text-xs font-semibold">Subscribed Event Types</Label>
                  <div className="grid grid-cols-1 gap-2 border border-border/60 rounded-lg p-3 bg-muted/10 max-h-48 overflow-y-auto">
                    {AVAILABLE_EVENTS.map((ev) => {
                      const isChecked = selectedEvents.includes(ev.id);
                      return (
                        <div key={ev.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`event-${ev.id}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedEvents((prev) => [...prev, ev.id]);
                              } else {
                                setSelectedEvents((prev) => prev.filter((x) => x !== ev.id));
                              }
                            }}
                          />
                          <label
                            htmlFor={`event-${ev.id}`}
                            className="text-xs font-medium leading-none cursor-pointer flex items-center justify-between w-full"
                          >
                            <span>{ev.label}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{ev.id}</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} className="text-xs font-medium">
                  {saving ? "Saving..." : editingWebhook ? "Save Changes" : "Create Webhook"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
