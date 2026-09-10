import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FlowDraft,
  FlowNode,
  NodeType,
  NODE_TYPES,
  NODE_TYPE_MAP,
  createNode,
  draftsEqual,
  normalizeDraft,
  nodeSummary,
} from "@/lib/flow-types";
import { StepConfig } from "@/components/flow-editor/StepConfig";
import { FlowSimulationDrawer } from "@/components/FlowSimulationDrawer";
import { ChevronDown, ChevronUp, Trash2, ArrowUp, ArrowDown, Plus, GitBranch, AlertCircle, AlertTriangle, CheckCircle2, Play } from "lucide-react";
import { useOrgRole } from "@/hooks/useOrgRole";

export const Route = createFileRoute(
  "/_authenticated/orgs/$orgId/agents/$agentId/flows/$flowId/",
)({
  component: FlowEditor,
});

type FlowRow = {
  id: string;
  name: string;
  agent_id: string;
  draft_json: unknown;
  published_version_id: string | null;
};

type PublishedVersion = { id: string; version_number: number; json: unknown };

function FlowEditor() {
  const { orgId, agentId, flowId } = Route.useParams();
  const { role, canEdit, loading: roleLoading } = useOrgRole(orgId);

  const [flow, setFlow] = useState<FlowRow | null>(null);
  const [agentName, setAgentName] = useState<string>("");
  const [draft, setDraft] = useState<FlowDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<FlowDraft | null>(null);
  const [publishedJson, setPublishedJson] = useState<unknown | null>(null);
  const [publishedVersionNumber, setPublishedVersionNumber] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [flowMapOpen, setFlowMapOpen] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);

  const getFlowMapNodes = (draft: FlowDraft): { node: FlowNode; index: number }[] => {
    return draft.nodes.map((node, index) => ({ node, index }));
  };

  const validationErrors = useMemo(() => {
    const errors: { nodeId?: string; message: string }[] = [];
    const warnings: { nodeId?: string; message: string }[] = [];

    if (!draft) return { errors, warnings };

    if (!draft.entry_node) {
      errors.push({ message: "No entry step is set for the flow." });
    } else if (!draft.nodes.some(n => n.id === draft.entry_node)) {
      errors.push({ message: "Selected entry step does not exist." });
    }

    draft.nodes.forEach((node, idx) => {
      const meta = NODE_TYPE_MAP[node.type];
      if (meta) {
        meta.outcomes.forEach(o => {
          const targetId = node.next[o.key];
          if (!targetId) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Outcome "${o.label}" is not connected.`
            });
          } else if (!draft.nodes.some(n => n.id === targetId)) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Connected step does not exist.`
            });
          }
        });
        
        const config = node.config as Record<string, any>;
        if (node.type === "disclosure") {
          if (!config.disclosure_text?.trim()) {
            warnings.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Disclosure text is empty.`
            });
          }
        } else if (node.type === "agent_speaks") {
          if (!config.prompt_text?.trim()) {
            warnings.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Prompt text is empty.`
            });
          }
        } else if (node.type === "listen") {
          if (!config.variable_name?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Variable name is required.`
            });
          }
        } else if (node.type === "decision") {
          if (!config.condition?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Condition is required.`
            });
          }
        } else if (node.type === "lookup") {
          if (!config.endpoint?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Endpoint URL is required.`
            });
          }
        } else if (node.type === "knowledge") {
          if (!config.query_source?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Query source is required.`
            });
          }
        } else if (node.type === "followup") {
          if (!config.template?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Message template is required.`
            });
          }
        } else if (node.type === "handoff") {
          if (!config.destination?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Handoff destination is required.`
            });
          }
        } else if (node.type === "switch_language") {
          if (!config.target_language?.trim()) {
            errors.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Target language is required.`
            });
          }
        } else if (node.type === "end_call") {
          if (!config.closing_line?.trim()) {
            warnings.push({
              nodeId: node.id,
              message: `Step ${idx + 1} (${meta.label}): Closing line is empty.`
            });
          }
        }
      }
    });

    return { errors, warnings };
  }, [draft]);

  const dirty = useMemo(
    () => !!draft && !!savedDraft && !draftsEqual(draft, savedDraft),
    [draft, savedDraft],
  );
  const draftDifferentFromPublished = useMemo(() => {
    if (!draft) return false;
    if (!publishedJson) return true; // never published
    return !draftsEqual(draft, publishedJson);
  }, [draft, publishedJson]);

  async function load() {
    const { data: flowRow, error } = await supabase
      .from("flows")
      .select("id, name, agent_id, draft_json, published_version_id")
      .eq("id", flowId)
      .maybeSingle();
    if (error || !flowRow) {
      toast.error(error?.message ?? "Flow not found");
      return;
    }
    setFlow(flowRow);
    const agent = await supabase
      .from("agents")
      .select("name, language")
      .eq("id", flowRow.agent_id)
      .maybeSingle();
    setAgentName(agent.data?.name ?? "");
    const d = normalizeDraft(flowRow.draft_json, flowRow.agent_id, agent.data?.language);
    setDraft(d);
    setSavedDraft(d);
    if (flowRow.published_version_id) {
      const pv = await supabase
        .from("flow_versions")
        .select("id, version_number, json")
        .eq("id", flowRow.published_version_id)
        .maybeSingle();
      if (pv.data) {
        setPublishedJson(pv.data.json);
        setPublishedVersionNumber(pv.data.version_number);
      }
    } else {
      setPublishedJson(null);
      setPublishedVersionNumber(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  // Warn on navigate-away with unsaved draft
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function updateDraft(updater: (d: FlowDraft) => FlowDraft) {
    setDraft((d) => (d ? updater(d) : d));
  }

  function getNodeChipStyle(type: NodeType): { dotClass: string; bgClass: string; textClass: string; label: string } {
    switch (type) {
      case "disclosure":
        return { dotClass: "bg-banyan", bgClass: "bg-banyan-tint/40 border-banyan/20", textClass: "text-banyan", label: "consent" };
      case "decision":
        return { dotClass: "bg-banyan", bgClass: "bg-banyan-tint/40 border-banyan/20", textClass: "text-banyan", label: "condition" };
      case "agent_speaks":
        return { dotClass: "bg-teal", bgClass: "bg-teal-tint/40 border-teal/20", textClass: "text-teal", label: "say" };
      case "lookup":
        return { dotClass: "bg-teal", bgClass: "bg-teal-tint/40 border-teal/20", textClass: "text-teal", label: "api_call" };
      case "listen":
        return { dotClass: "bg-terra", bgClass: "bg-terra-tint/40 border-terra/20", textClass: "text-terra", label: "collect_input" };
      case "knowledge":
        return { dotClass: "bg-terra", bgClass: "bg-terra-tint/40 border-terra/20", textClass: "text-terra", label: "kb_lookup" };
      case "handoff":
        return { dotClass: "bg-error", bgClass: "bg-error-tint/40 border-error/20", textClass: "text-error", label: "transfer" };
      case "followup":
        return { dotClass: "bg-error", bgClass: "bg-error-tint/40 border-error/20", textClass: "text-error", label: "send_message" };
      case "switch_language":
        return { dotClass: "bg-warning", bgClass: "bg-warning-tint/40 border-warning/20", textClass: "text-warning", label: "language_switch" };
      case "end_call":
        return { dotClass: "bg-[var(--ink-faint)]", bgClass: "bg-muted border-border/40", textClass: "text-[var(--ink-soft)]", label: "end" };
      default:
        return { dotClass: "bg-[var(--ink-faint)]", bgClass: "bg-muted border-border/40", textClass: "text-[var(--ink-soft)]", label: "unknown" };
    }
  }

  function addStep(type: NodeType) {
    const node = createNode(type);
    updateDraft((d) => ({
      ...d,
      nodes: [...d.nodes, node],
      entry_node: d.entry_node ?? node.id,
    }));
    setCollapsed((c) => ({ ...c, [node.id]: false }));
    setPicking(false);
  }

  function updateNode(updated: FlowNode) {
    updateDraft((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === updated.id ? updated : n)),
    }));
  }

  function removeNode(id: string) {
    updateDraft((d) => {
      const nodes = d.nodes
        .filter((n) => n.id !== id)
        .map((n) => ({
          ...n,
          next: Object.fromEntries(
            Object.entries(n.next).map(([k, v]) => [k, v === id ? null : v]),
          ),
        }));
      return {
        ...d,
        nodes,
        entry_node: d.entry_node === id ? (nodes[0]?.id ?? null) : d.entry_node,
      };
    });
  }

  function moveNode(id: string, dir: -1 | 1) {
    updateDraft((d) => {
      const idx = d.nodes.findIndex((n) => n.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= d.nodes.length) return d;
      const nodes = [...d.nodes];
      [nodes[idx], nodes[target]] = [nodes[target], nodes[idx]];
      return { ...d, nodes };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    const { error } = await supabase
      .from("flows")
      .update({ draft_json: draft as never })
      .eq("id", flowId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSavedDraft(draft);
    logAuditEvent(orgId, "flow.draft_saved", "flow", flowId, { name: flow?.name });
    toast.success("Draft saved");
  }

  async function publish() {
    if (!draft) return;
    if (dirty) {
      toast.error("Save your draft first before publishing.");
      return;
    }
    if (validationErrors.errors.length > 0) {
      toast.error("Cannot publish. Please resolve all validation errors first.");
      return;
    }
    setPublishing(true);
    try {
      // Determine next version number
      const { data: latest, error: lerr } = await supabase
        .from("flow_versions")
        .select("version_number")
        .eq("flow_id", flowId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lerr) throw lerr;
      const nextVersion = (latest?.version_number ?? 0) + 1;
      const { data: user } = await supabase.auth.getUser();
      const userId = user.user?.id;
      const { data: created, error: ierr } = await supabase
        .from("flow_versions")
        .insert({
          flow_id: flowId,
          version_number: nextVersion,
          json: draft as never,
          published_by: userId,
        })
        .select("id, version_number, json")
        .single();
      if (ierr) throw ierr;
      const { error: uerr } = await supabase
        .from("flows")
        .update({ published_version_id: created.id })
        .eq("id", flowId);
      if (uerr) throw uerr;
      setPublishedJson(draft);
      setPublishedVersionNumber(created.version_number);
      logAuditEvent(orgId, "flow.published", "flow", flowId, { name: flow?.name, version_number: created.version_number });
      toast.success(`Published v${created.version_number}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  if (!draft || !flow) {
    return (
      <>
        <main className="mx-auto max-w-5xl px-6 py-10 text-sm text-muted-foreground font-sans">
          Loading…
        </main>
      </>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-4xl px-6 py-8 font-sans">
        {role === "viewer" && (
          <div className="mb-4 rounded-md border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            You have view-only access to this flow.
          </div>
        )}
        {/* Header bar */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{flow.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {publishedVersionNumber ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Published v{publishedVersionNumber}
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                  Never published
                </span>
              )}
              {draftDifferentFromPublished && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  Draft has unpublished changes
                </span>
              )}
              {dirty && (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                  Unsaved edits
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSimulationOpen(true)}
              className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Play className="h-3.5 w-3.5 fill-primary" />
              Simulate
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/orgs/$orgId/agents/$agentId/flows/$flowId/versions"
                params={{ orgId, agentId, flowId }}
              >
                Version history
              </Link>
            </Button>
            {!roleLoading && canEdit && (
              <>
                <Button variant="outline" onClick={saveDraft} disabled={saving || !dirty}>
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button
                  onClick={publish}
                  disabled={publishing || dirty || !draftDifferentFromPublished}
                  title={
                    dirty
                      ? "Save your draft first"
                      : !draftDifferentFromPublished
                        ? "Nothing new to publish"
                        : ""
                  }
                >
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Interactive Flow Simulation Drawer */}
        {draft && (
          <FlowSimulationDrawer
            isOpen={simulationOpen}
            onClose={() => setSimulationOpen(false)}
            draft={draft}
            onSelectNodeOnCanvas={(nodeId) => {
              setCollapsed((c) => ({ ...c, [nodeId]: false }));
            }}
          />
        )}

        {/* Flow-level config */}
        <Card className="mt-6 p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Direction
              </Label>
              <Select
                value={draft.direction}
                onValueChange={(v) =>
                  updateDraft((d) => ({ ...d, direction: v as "outbound" | "inbound" }))
                }
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
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Language
              </Label>
              <Input
                value={draft.language}
                onChange={(e) =>
                  updateDraft((d) => ({ ...d, language: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Entry step
              </Label>
              <Select
                value={draft.entry_node ?? ""}
                onValueChange={(v) =>
                  updateDraft((d) => ({ ...d, entry_node: v || null }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="First step" />
                </SelectTrigger>
                <SelectContent>
                  {draft.nodes.map((n, i) => (
                    <SelectItem key={n.id} value={n.id}>
                      Step {i + 1}: {NODE_TYPE_MAP[n.type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Flow Map & Validation Summary */}
        {draft && draft.nodes.length > 0 && (
          <div className="mt-6 space-y-4">
            {/* Flow Map Summary */}
            <Card className="border border-border bg-card rounded-lg shadow-sm overflow-hidden">
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/10 transition-colors"
                onClick={() => setFlowMapOpen(!flowMapOpen)}
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4.5 w-4.5 text-primary" />
                  <div className="flex flex-col items-start leading-none">
                    <span className="eyebrow-label text-[9px] mb-0.5">FLOW MAP</span>
                    <h2 className="text-sm font-semibold tracking-tight text-foreground font-display">Flow Map</h2>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  {flowMapOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              {flowMapOpen && (
                <div className="p-4 pt-0 border-t border-border/40 bg-muted/5 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="space-y-2.5 font-mono text-[12px] leading-relaxed pt-3">
                    {getFlowMapNodes(draft).map(({ node, index }) => {
                      const isEntry = draft.entry_node === node.id;
                      const meta = NODE_TYPE_MAP[node.type];
                      const hasNodeError = validationErrors.errors.some(err => err.nodeId === node.id);
                      const hasNodeWarning = validationErrors.warnings.some(warn => warn.nodeId === node.id);

                      return (
                        <div 
                          key={node.id} 
                          className={`flex items-start flex-wrap gap-1 py-1.5 px-2.5 rounded-md border ${
                            isEntry 
                              ? 'border-primary/30 bg-[var(--banyan-tint)]' 
                              : 'border-transparent'
                          } ${hasNodeError ? 'bg-rose-50/5 border-rose-300/30' : ''}`}
                        >
                          <div className="flex items-center gap-1.5 min-w-[220px]">
                            {isEntry && (
                              <span className="text-primary font-bold shrink-0">Entry →</span>
                            )}
                            <span className={`font-semibold ${hasNodeError ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
                              Step {index + 1} ({meta.label})
                            </span>
                            {hasNodeError && (
                              <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0 animate-pulse" title="Has errors" />
                            )}
                            {hasNodeWarning && !hasNodeError && (
                              <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" title="Has warnings" />
                            )}
                          </div>
                          {meta.terminal ? (
                            <div className="text-muted-foreground flex items-center gap-1">
                              <span>→</span>
                              <span className="text-[11px] italic font-sans">(call ends)</span>
                            </div>
                          ) : (
                            <div className="flex items-center flex-wrap gap-1">
                              <span className="text-muted-foreground mr-1">→</span>
                              {meta.outcomes.map(o => {
                                const targetId = node.next[o.key];
                                const targetIdx = targetId ? draft.nodes.findIndex(x => x.id === targetId) : -1;
                                const targetLabel = targetIdx !== -1 ? `Step ${targetIdx + 1}` : "(call ends)";
                                return (
                                  <span 
                                    key={o.key} 
                                    className="inline-flex items-center bg-muted dark:bg-muted/40 px-1.5 py-0.5 rounded text-[10px] border border-border/40"
                                  >
                                    <span className="text-muted-foreground">{o.label}</span>
                                    <span className="mx-1 text-primary">→</span>
                                    <span className={`font-medium ${targetIdx !== -1 ? 'text-foreground' : 'text-muted-foreground font-sans italic'}`}>{targetLabel}</span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* Validation panel */}
            <Card className={`p-5 border transition-colors ${
              validationErrors.errors.length > 0
                ? 'border-rose-200 bg-rose-50/10 dark:border-rose-950 dark:bg-rose-950/5'
                : validationErrors.warnings.length > 0
                  ? 'border-amber-200 bg-amber-50/10 dark:border-amber-950 dark:bg-amber-950/5'
                  : 'border-emerald-200 bg-emerald-50/10 dark:border-emerald-950 dark:bg-emerald-950/5'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {validationErrors.errors.length > 0 ? (
                    <>
                      <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 animate-bounce" />
                      <span className="font-semibold text-rose-600 dark:text-rose-400 font-display">
                        Flow is invalid ({validationErrors.errors.length} error{validationErrors.errors.length > 1 ? 's' : ''})
                      </span>
                    </>
                  ) : validationErrors.warnings.length > 0 ? (
                    <>
                      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="font-semibold text-amber-600 dark:text-amber-400 font-display">
                        Flow is valid with warnings ({validationErrors.warnings.length} warning{validationErrors.warnings.length > 1 ? 's' : ''})
                      </span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-display">
                        Flow is valid and ready to publish
                      </span>
                    </>
                  )}
                </div>
              </div>

              {(validationErrors.errors.length > 0 || validationErrors.warnings.length > 0) && (
                <div className="space-y-3 font-mono">
                  {validationErrors.errors.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Errors (Blocks publishing)</div>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        {validationErrors.errors.map((err, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-600 dark:bg-rose-400 shrink-0" />
                            <span>{err.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {validationErrors.warnings.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Warnings (Review suggested)</div>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        {validationErrors.warnings.map((warn, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400 shrink-0" />
                            <span>{warn.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Steps */}
        {draft && (
          <>
            {draft.nodes.length === 0 ? (
              <div className="mt-8 flex flex-col items-center justify-center p-12 text-center bg-[var(--banyan-tint)]/40 border border-dashed border-border rounded-md">
                <GitBranch className="h-10 w-10 text-muted-foreground/60 mb-4" />
                <h3 className="text-sm font-semibold text-foreground font-display">No steps yet</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Add your first step to start the conversation flow.
                </p>
                
                {!roleLoading && canEdit && (
                  <div className="mt-6">
                    <Dialog open={picking} onOpenChange={setPicking}>
                      <DialogTrigger asChild>
                        <Button className="shadow-sm">
                          <Plus className="mr-2 h-4 w-4" />
                          Add a step
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl rounded-xl">
                        <DialogHeader>
                          <DialogTitle className="text-base font-bold font-display">Add Step to Flow</DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mt-2">
                          {NODE_TYPES.map((t) => (
                            <button
                              key={t.type}
                              onClick={() => addStep(t.type)}
                              className="group rounded-xl border border-border/80 p-4 text-left transition-all duration-300 hover:border-primary/50 hover:bg-[var(--banyan-tint)]/40 hover:shadow-md cursor-pointer"
                            >
                              <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{t.label}</div>
                              <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                                {t.description}
                              </div>
                            </button>
                          ))}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </div>
            ) : (
              <ol className="mt-8 space-y-3">
                {draft.nodes.map((node, i) => {
                  const meta = NODE_TYPE_MAP[node.type];
                  const isCollapsed = collapsed[node.id] ?? false;
                  const hasNodeError = validationErrors.errors.some(err => err.nodeId === node.id);
                  const hasNodeWarning = validationErrors.warnings.some(warn => warn.nodeId === node.id);
                  const hasProblem = hasNodeError || hasNodeWarning;
                  const chipStyle = getNodeChipStyle(node.type);

                  return (
                    <li key={node.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${i * 0.05}s` }}>
                      <Card className={`relative overflow-hidden transition-all duration-300 hover:border-primary/50 hover:shadow-sm ${
                        draft.entry_node === node.id 
                          ? 'border-primary/50 dark:border-primary/30 shadow-sm shadow-primary/5' 
                          : 'border-border/60'
                      } ${
                        hasNodeError 
                          ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50/5' 
                          : hasNodeWarning 
                            ? 'border-amber-300 dark:border-amber-900/50 bg-amber-50/5' 
                            : ''
                      } ${
                        node.type === "end_call"
                          ? 'border-l-4 border-l-[var(--ink-faint)]'
                          : ''
                      }`}>
                        {/* Left accent bar for entry step */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 transition-all ${draft.entry_node === node.id ? 'bg-primary' : 'bg-transparent'}`} />
                        
                        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-all cursor-grab active:cursor-grabbing ${
                            draft.entry_node === node.id 
                              ? 'bg-primary text-white shadow-md shadow-primary/20' 
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground flex-wrap">
                              <span className="font-display font-bold">{meta.label}</span>
                              
                              {/* Node-type chip */}
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-semibold border ${chipStyle.bgClass} ${chipStyle.textClass}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${chipStyle.dotClass}`} />
                                {chipStyle.label}
                              </span>

                              {draft.entry_node === node.id && (
                                <span className="rounded bg-primary text-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                  ENTRY
                                </span>
                              )}
                              {hasProblem && (
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider animate-pulse flex items-center gap-1 shrink-0 ${
                                  hasNodeError
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                }`}>
                                  <AlertCircle className="h-3 w-3" />
                                  {hasNodeError ? "Error" : "Warning"}
                                </span>
                              )}
                            </div>
                            {isCollapsed && (
                              <div className="mt-0.5 truncate text-xs text-muted-foreground font-mono">
                                {nodeSummary(node)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={i === 0}
                              onClick={() => moveNode(node.id, -1)}
                              title="Move up"
                              className="h-8 w-8 hover:bg-[var(--banyan-tint)] hover:text-primary dark:hover:bg-[var(--banyan-tint)]/25"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={i === draft.nodes.length - 1}
                              onClick={() => moveNode(node.id, 1)}
                              title="Move down"
                              className="h-8 w-8 hover:bg-[var(--banyan-tint)] hover:text-primary dark:hover:bg-[var(--banyan-tint)]/25"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeNode(node.id)}
                              title="Delete step"
                              className="h-8 w-8 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setCollapsed((c) => ({ ...c, [node.id]: !isCollapsed }))
                              }
                              title={isCollapsed ? "Expand" : "Collapse"}
                              className="h-8 w-8"
                            >
                              {isCollapsed ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronUp className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        {!isCollapsed && (
                          <div className="p-5 bg-muted/5 animate-in fade-in slide-in-from-top-1 duration-200">
                            <StepConfig node={node} draft={draft} onChange={updateNode} />
                          </div>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* Add step (for non-empty flow state) */}
            {draft.nodes.length > 0 && !roleLoading && canEdit && (
              <div className="mt-6 flex justify-center">
                <Dialog open={picking} onOpenChange={setPicking}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="lg"
                      className="rounded-full border-dashed border-2 hover:border-primary hover:text-primary hover:bg-[var(--banyan-tint)]/30 transition-all duration-300 font-medium active:scale-95 cursor-pointer"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add a step
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl rounded-xl">
                    <DialogHeader>
                      <DialogTitle className="text-base font-bold font-display">Add Step to Flow</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mt-2">
                      {NODE_TYPES.map((t) => (
                        <button
                          key={t.type}
                          onClick={() => addStep(t.type)}
                          className="group rounded-xl border border-border/80 p-4 text-left transition-all duration-300 hover:border-primary/50 hover:bg-[var(--banyan-tint)]/40 hover:shadow-md cursor-pointer"
                        >
                          <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors font-display">{t.label}</div>
                          <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                            {t.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
