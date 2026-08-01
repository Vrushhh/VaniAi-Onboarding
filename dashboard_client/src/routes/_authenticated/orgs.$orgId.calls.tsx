import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  Clock,
  User,
  Calendar,
  Play,
  PlayCircle,
  FileText,
  Filter,
  RefreshCw,
  Search,
  MessageSquare,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/calls")({
  component: CallsPage,
});

type CallRow = {
  id: string;
  direction: "outbound" | "inbound";
  phone_number: string;
  status: "in_progress" | "completed" | "failed" | "missed" | "no_answer";
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: any; // array of { role: 'agent'|'customer', text: string }
  outcome: string | null;
  started_at: string;
  ended_at: string | null;
  agent_id: string | null;
  agents?: {
    name: string;
  };
};

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses", variant: "outline" as const },
  { value: "in_progress", label: "In Progress", variant: "secondary" as const },
  { value: "completed", label: "Completed", variant: "secondary" as const },
  { value: "failed", label: "Failed", variant: "destructive" as const },
  { value: "missed", label: "Missed", variant: "outline" as const },
  { value: "no_answer", label: "No Answer", variant: "outline" as const },
];

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function maskPhoneNumber(num: string) {
  if (!num) return "—";
  const cleaned = num.trim();
  if (cleaned.length <= 4) return cleaned;
  return cleaned.substring(0, cleaned.length - 4).replace(/\d/g, "•") + cleaned.substring(cleaned.length - 4);
}

function CallsPage() {
  const { orgId } = Route.useParams() as any;

  // Data states
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchPhone, setSearchPhone] = useState("");

  // Detail panel state
  const [selectedCall, setSelectedCall] = useState<CallRow | null>(null);

  async function loadAgents() {
    try {
      const { data, error } = await (supabase as any)
        .from("agents")
        .select("id, name")
        .eq("org_id", orgId)
        .order("name", { ascending: true });
      if (!error && data) {
        setAgents(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadCalls() {
    setLoading(true);
    try {
      let query = (supabase as any)
        .from("calls")
        .select(`
          id,
          direction,
          phone_number,
          status,
          duration_seconds,
          recording_url,
          transcript,
          outcome,
          started_at,
          ended_at,
          agent_id,
          agents(name)
        `)
        .eq("org_id", orgId)
        .order("started_at", { ascending: false });

      if (selectedAgentId !== "all") {
        query = query.eq("agent_id", selectedAgentId);
      }
      if (selectedStatus !== "all") {
        query = query.eq("status", selectedStatus);
      }
      if (searchPhone.trim()) {
        query = query.ilike("phone_number", `%${searchPhone.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setCalls((data as CallRow[]) || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, [orgId]);

  useEffect(() => {
    loadCalls();
  }, [orgId, selectedAgentId, selectedStatus, searchPhone]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 font-sans space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            Call Logs
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audit ongoing, completed, and missed voice calls along with transcript recordings.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadCalls}
          disabled={loading}
          className="h-8 text-xs font-semibold"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Filter Row */}
      <Card className="p-4 border-border/60 bg-card/60 backdrop-blur flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>Filters:</span>
          </div>

          {/* Search Phone */}
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search phone number..."
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              className="pl-8 h-8 text-xs border-border/80"
            />
          </div>

          {/* Agent Filter */}
          <div className="w-48">
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger className="h-8 border-border/80 text-xs">
                <SelectValue placeholder="All Agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Agents</SelectItem>
                {agents.map((ag) => (
                  <SelectItem key={ag.id} value={ag.id} className="text-xs">
                    {ag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div className="w-40">
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-8 border-border/80 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Table Card */}
      <Card className="border-border/60 shadow-sm overflow-hidden bg-card/60 backdrop-blur">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <div className="text-center py-16">
            <PhoneCall className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-xs font-semibold text-foreground">No call logs found</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Connect a telephony provider and assign a number to capture live call analytics.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto text-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
                  <th className="px-4 py-2.5">Phone Number</th>
                  <th className="px-4 py-2.5">Agent</th>
                  <th className="px-4 py-2.5">Direction</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {calls.map((call) => {
                  const statusOpt = STATUS_OPTIONS.find((o) => o.value === call.status) || {
                    label: call.status,
                    variant: "outline" as const,
                  };
                  return (
                    <tr
                      key={call.id}
                      onClick={() => setSelectedCall(call)}
                      className="hover:bg-muted/15 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 text-xs font-semibold text-foreground font-mono">
                        {maskPhoneNumber(call.phone_number)}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground font-medium">
                        {call.agents?.name || "Unknown Agent"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                          {call.direction === "inbound" ? (
                            <>
                              <PhoneIncoming className="h-3.5 w-3.5 text-emerald-500" />
                              <span>Inbound</span>
                            </>
                          ) : (
                            <>
                              <PhoneForwarded className="h-3.5 w-3.5 text-blue-500" />
                              <span>Outbound</span>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <Badge variant={statusOpt.variant as any} className="text-[10px] py-0.5">
                          {statusOpt.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {formatDuration(call.duration_seconds)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {new Date(call.started_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Call Details Side Sheet */}
      <Sheet open={selectedCall !== null} onOpenChange={(open) => !open && setSelectedCall(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto space-y-6">
          {selectedCall && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base font-bold font-display tracking-tight text-foreground">
                  Call Details Audit
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Review complete transcription dialogs and recorded calls metadata.
                </SheetDescription>
              </SheetHeader>

              {/* Call Overview Data Card */}
              <Card className="p-4 border-border/60 bg-muted/10 space-y-3.5 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Phone Number</span>
                    <p className="font-semibold text-foreground font-mono">{maskPhoneNumber(selectedCall.phone_number)}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Agent</span>
                    <p className="font-semibold text-foreground">{selectedCall.agents?.name || "Unknown"}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Duration</span>
                    <p className="font-semibold text-foreground font-mono flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{formatDuration(selectedCall.duration_seconds)} ({selectedCall.duration_seconds || 0}s)</span>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">Direction</span>
                    <p className="font-semibold text-foreground capitalize">{selectedCall.direction}</p>
                  </div>
                </div>

                {selectedCall.outcome && (
                  <div className="pt-2 border-t border-border/40">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground block mb-1">Outcome Summary</span>
                    <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 font-sans font-medium">
                      {selectedCall.outcome}
                    </Badge>
                  </div>
                )}
              </Card>

              {/* Audio recording player */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground font-semibold block">Recording Player</span>
                {selectedCall.recording_url ? (
                  <div className="p-3 border border-border/60 rounded-lg bg-card shadow-sm flex flex-col gap-2">
                    <audio src={selectedCall.recording_url} controls className="w-full h-8" />
                  </div>
                ) : (
                  <div className="text-xs p-3 rounded-lg border border-dashed border-border/65 text-muted-foreground italic text-center">
                    No recording captured for this call.
                  </div>
                )}
              </div>

              {/* Call Transcript Bubbles */}
              <div className="space-y-3">
                <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground font-semibold block">
                  Dialogue Transcript
                </span>
                
                {Array.isArray(selectedCall.transcript) && selectedCall.transcript.length > 0 ? (
                  <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1 border border-border/50 rounded-lg p-3 bg-muted/5">
                    {selectedCall.transcript.map((item: any, idx: number) => {
                      const isAgent = item.role === "agent";
                      return (
                        <div
                          key={idx}
                          className={`flex flex-col space-y-1 text-xs max-w-[85%] ${
                            isAgent ? "mr-auto items-start" : "ml-auto items-end"
                          }`}
                        >
                          <span className="text-[10px] font-mono text-muted-foreground font-semibold uppercase tracking-wider">
                            {isAgent ? (selectedCall.agents?.name || "Agent") : "Customer"}
                          </span>
                          <div
                            className={`p-3 rounded-lg leading-relaxed ${
                              isAgent
                                ? "bg-primary/10 text-primary font-medium border border-primary/20 rounded-tl-none"
                                : "bg-card text-foreground border border-border/80 rounded-tr-none shadow-sm"
                            }`}
                          >
                            {item.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs p-8 rounded-lg border border-dashed border-border/65 text-muted-foreground italic text-center">
                    <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground/40 mb-1.5" />
                    <span>No transcript dialogs captured for this call.</span>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
