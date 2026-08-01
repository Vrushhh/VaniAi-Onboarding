import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  MessageSquare,
  Key,
  Plus,
  Trash2,
  AlertCircle,
  ArrowLeft,
  FileText,
  Mail,
  Send,
  PlusCircle,
  HelpCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/messaging")({
  component: MessagingPage,
});

type TemplateRow = {
  id: string;
  name: string;
  template: string;
  variables: string | null;
  created_at: string;
};

function MessagingPage() {
  const { orgId } = Route.useParams();
  const { role, isOwner, canEdit, loading: roleLoading } = useOrgRole(orgId);

  // Messaging Config States
  const [provider, setProvider] = useState("exotel_sms");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [senderId, setSenderId] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  // Test Message States
  const [testTo, setTestTo] = useState("");
  const [testBody, setTestBody] = useState("Hi {{name}}, your order #{{order_id}} is confirmed.");
  const [sendingTest, setSendingTest] = useState(false);

  // Template States
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [newTemplateVars, setNewTemplateVars] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  async function loadConfig() {
    setConfigLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("get_messaging_config", {
        _org_id: orgId,
      });

      if (error) throw error;
      const res = data as any;
      if (res && res.found) {
        setProvider(res.provider);
        setSenderId(res.sender_id || "");
        setWhatsappEnabled(res.whatsapp_enabled || false);
        setApiKey(""); // Write-only
        setApiSecret("");
        setIsConfigured(true);
      } else {
        setIsConfigured(false);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setConfigLoading(false);
    }
  }

  async function loadTemplates() {
    setTemplatesLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("messaging_templates")
        .select("id, name, template, variables, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load templates");
    } finally {
      setTemplatesLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
    loadTemplates();
  }, [orgId]);

  async function handleSaveConfig() {
    if (!isOwner) {
      toast.error("Only organization owners can modify messaging credentials.");
      return;
    }
    if (!apiKey.trim() && !isConfigured) {
      toast.error("Please enter API Key");
      return;
    }

    setSavingConfig(true);
    try {
      const targetKey = !apiKey.trim() ? "__UNCHANGED__" : apiKey.trim();
      const targetSecret = !apiSecret.trim() ? "__UNCHANGED__" : apiSecret.trim();

      const { data, error } = await (supabase as any).rpc("set_messaging_config", {
        _org_id: orgId,
        _provider: provider,
        _api_key: targetKey,
        _api_secret: targetSecret,
        _sender_id: senderId.trim() || null,
        _whatsapp_enabled: whatsappEnabled,
      });

      if (error) throw error;
      const res = data as any;
      if (!res.success) {
        throw new Error(res.message || "Failed to save messaging credentials");
      }

      toast.success("Messaging configuration saved successfully.");
      setIsConfigured(true);
      setApiKey("");
      setApiSecret("");
    } catch (err: any) {
      toast.error(err.message || "Failed to save config");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSendTest() {
    if (!testTo.trim()) {
      toast.error("Please enter a recipient number.");
      return;
    }
    if (!testBody.trim()) {
      toast.error("Please enter a test message body.");
      return;
    }

    setSendingTest(true);
    try {
      const body = !apiKey.trim()
        ? { orgId, to: testTo.trim(), message: testBody.trim() }
        : {
            provider,
            apiKey: apiKey.trim(),
            apiSecret: apiSecret.trim(),
            senderId: senderId.trim(),
            whatsappEnabled,
            to: testTo.trim(),
            message: testBody.trim(),
          };

      const res = await fetch("/api/messaging/send-test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.ok) {
        toast.success(data.message || "Test message sent successfully!");
      } else {
        toast.error(`Send failed: ${data.error}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send test message");
    } finally {
      setSendingTest(false);
    }
  }

  async function handleCreateTemplate() {
    if (!canEdit) {
      toast.error("You do not have permission to add templates.");
      return;
    }
    if (!newTemplateName.trim()) {
      toast.error("Please enter a template name.");
      return;
    }
    if (!newTemplateBody.trim()) {
      toast.error("Please enter the template body text.");
      return;
    }

    setSavingTemplate(true);
    try {
      const { error } = await (supabase as any)
        .from("messaging_templates")
        .insert({
          org_id: orgId,
          name: newTemplateName.trim(),
          template: newTemplateBody.trim(),
          variables: newTemplateVars.trim() || null,
        });

      if (error) throw error;
      toast.success("Template created successfully.");
      setNewTemplateName("");
      setNewTemplateBody("");
      setNewTemplateVars("");
      setAddTemplateOpen(false);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to create template");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(id: string, name: string) {
    if (!canEdit) {
      toast.error("You do not have permission to delete templates.");
      return;
    }

    try {
      const { error } = await (supabase as any)
        .from("messaging_templates")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast.success(`Template "${name}" deleted.`);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete template");
    }
  }

  const readOnly = !isOwner;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 font-sans space-y-8">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="sm" className="rounded-lg h-9">
          <Link to="/orgs/$orgId/settings" params={{ orgId }}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            <span>Settings</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            Messaging Configuration
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure SMS & WhatsApp provider accounts and manage reusable message templates.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Credentials Form */}
        <Card className="p-6 border-border/60 shadow-sm md:col-span-5 space-y-6 h-fit bg-card/60 backdrop-blur">
          <div className="flex gap-3.5 items-start">
            <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Credentials</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Configure API keys securely.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={provider}
                onValueChange={setProvider}
                disabled={readOnly || configLoading}
              >
                <SelectTrigger className="h-9 border-border/80 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exotel_sms">Exotel SMS</SelectItem>
                  <SelectItem value="gupshup_whatsapp">Gupshup WhatsApp</SelectItem>
                  <SelectItem value="twilio">Twilio</SelectItem>
                  <SelectItem value="custom">Custom Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="apiKey">API Key / Auth Token</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={isConfigured ? "••••••••••••••••" : "Enter API Key..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={readOnly || configLoading}
                className="h-9 border-border/80 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="apiSecret">API Secret (optional)</Label>
              <Input
                id="apiSecret"
                type="password"
                placeholder={isConfigured ? "••••••••••••••••" : "Enter API Secret..."}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                disabled={readOnly || configLoading}
                className="h-9 border-border/80 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="senderId">Sender ID / From Name</Label>
              <Input
                id="senderId"
                placeholder="e.g. KZUNO, +14155552671"
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                disabled={readOnly || configLoading}
                className="h-9 border-border/80 text-sm"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <Label htmlFor="whatsapp" className="text-xs">Enable WhatsApp channel</Label>
                <p className="text-[10px] text-muted-foreground">Allow sending templates via WhatsApp</p>
              </div>
              <Switch
                id="whatsapp"
                checked={whatsappEnabled}
                onCheckedChange={setWhatsappEnabled}
                disabled={readOnly || configLoading}
              />
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            {!readOnly && (
              <Button
                onClick={handleSaveConfig}
                disabled={savingConfig || configLoading || (!apiKey.trim() && !isConfigured)}
                className="flex-1 bg-primary hover:bg-primary/95 text-white text-xs h-9 font-medium shadow-sm"
              >
                {savingConfig ? "Saving..." : "Save Config"}
              </Button>
            )}
          </div>

          {/* Test connection / message */}
          <div className="pt-4 border-t border-border/40 space-y-3.5">
            <h3 className="text-xs font-semibold text-foreground">Send Test Message</h3>
            <div className="space-y-2">
              <Input
                placeholder="Recipient number (e.g. +9199...)"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                className="h-9 border-border/85 text-xs"
                disabled={sendingTest}
              />
              <Textarea
                placeholder="Message body text..."
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                className="text-xs border-border/85"
                rows={2}
                disabled={sendingTest}
              />
              <Button
                variant="outline"
                onClick={handleSendTest}
                disabled={sendingTest || !testTo.trim() || !testBody.trim()}
                className="w-full text-xs h-9 border-border/60 hover:bg-muted/40 font-medium flex items-center justify-center gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{sendingTest ? "Sending..." : "Send Test Message"}</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* Templates List */}
        <Card className="p-6 border-border/60 shadow-sm md:col-span-7 space-y-6 bg-card/60 backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex gap-3.5 items-start">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Message Templates</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Reusable SMS and WhatsApp template structures.
                </p>
              </div>
            </div>

            {canEdit && (
              <Dialog open={addTemplateOpen} onOpenChange={setAddTemplateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-8 text-xs font-semibold cursor-pointer gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create Template</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create Message Template</DialogTitle>
                    <DialogDescription className="text-xs">
                      {"Define a template body with placeholders like {{customer_name}}."}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="tpl-name">Template Name</Label>
                      <Input
                        id="tpl-name"
                        placeholder="e.g. Order Confirmation, Cart Reminder"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        className="h-9 border-border/80 text-sm font-medium"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="tpl-body">Template Text Body</Label>
                      <Textarea
                        id="tpl-body"
                        placeholder="Hi {{name}}, your order {{order_id}} is confirmed."
                        value={newTemplateBody}
                        onChange={(e) => setNewTemplateBody(e.target.value)}
                        className="border-border/80 text-xs"
                        rows={3}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="tpl-vars">Variables (comma separated)</Label>
                      <Input
                        id="tpl-vars"
                        placeholder="name, order_id"
                        value={newTemplateVars}
                        onChange={(e) => setNewTemplateVars(e.target.value)}
                        className="h-9 border-border/80 text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        List each variable in order of template occurrence.
                      </p>
                    </div>
                  </div>

                  <DialogFooter className="pt-2 gap-2 sm:gap-0">
                    <Button
                      variant="outline"
                      onClick={() => setAddTemplateOpen(false)}
                      disabled={savingTemplate}
                      className="h-9 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateTemplate}
                      disabled={savingTemplate || !newTemplateName.trim() || !newTemplateBody.trim()}
                      className="h-9 text-xs bg-primary hover:bg-primary/95 text-white"
                    >
                      {savingTemplate ? "Creating..." : "Create Template"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Templates list */}
          {templatesLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border/60 rounded-lg bg-muted/5">
              <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
              <p className="text-xs font-semibold text-foreground">No templates saved yet</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Templates are used to place notification campaigns after calls.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-4 rounded-lg border border-border/50 bg-muted/10 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-xs">{tpl.name}</p>
                      {tpl.variables && (
                        <div className="flex flex-wrap gap-1">
                          {tpl.variables.split(",").map((v, i) => (
                            <Badge key={i} variant="outline" className="text-[9px] px-1 py-px bg-background/50 font-mono">
                              {v.trim()}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-foreground/80 leading-relaxed bg-background/30 p-2 rounded border border-border/30 whitespace-pre-line font-sans">
                      {tpl.template}
                    </p>
                  </div>

                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                      className="h-7 w-7 p-0 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-md cursor-pointer shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
