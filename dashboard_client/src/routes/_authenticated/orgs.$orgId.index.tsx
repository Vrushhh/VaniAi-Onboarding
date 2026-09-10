import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveCallWidget } from "@/components/LiveCallWidget";
import {
  Phone,
  CheckCircle,
  ShoppingCart,
  Clock,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  GitBranch,
  Megaphone,
  Bot,
  TrendingUp,
  PhoneCall,
  PhoneOff,
  PhoneMissed,
} from "lucide-react";

import { maskPhoneNumber } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/")({
  component: Dashboard,
});

// ─── Types ──────────────────────────────────────────────

type Org = { id: string; name: string };

type KPI = {
  label: string;
  value: string;
  delta: string;
  deltaType: "up" | "down" | "neutral";
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
};

type RecentCall = {
  id: string;
  phone: string;
  agentName: string;
  status: "completed" | "failed" | "in-progress" | "missed";
  duration: string;
  time: string;
};

// ─── Helpers ────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const STATUS_MAP: Record<RecentCall["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ElementType }> = {
  completed: { label: "Completed", variant: "secondary", icon: PhoneCall },
  failed: { label: "Failed", variant: "destructive", icon: PhoneOff },
  "in-progress": { label: "Live", variant: "default", icon: Phone },
  missed: { label: "Missed", variant: "outline", icon: PhoneMissed },
};

// ─── Dashboard component ────────────────────────────────

function Dashboard() {
  const { orgId } = Route.useParams() as any;
  const { role, canEdit, loading: roleLoading } = useOrgRole(orgId);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [profileName, setProfileName] = useState("");
  
  const [kpis, setKpis] = useState<{
    calls_today: number;
    completed_today: number;
    avg_duration_seconds: number;
  }>({ calls_today: 0, completed_today: 0, avg_duration_seconds: 0 });
  
  const [recentCalls, setRecentCalls] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      const [orgRes, userRes, kpiRes, callsRes] = await Promise.all([
        supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle(),
        supabase.auth.getUser(),
        (supabase as any).rpc("get_dashboard_kpis", { _org_id: orgId }),
        (supabase as any)
          .from("calls")
          .select("id, phone_number, status, duration_seconds, started_at, agents(name)")
          .eq("org_id", orgId)
          .order("started_at", { ascending: false })
          .limit(5)
      ]);
      if (!active) return;
      setOrg(orgRes.data);
      if (kpiRes.data) {
        setKpis(kpiRes.data);
      }
      if (callsRes.data) {
        setRecentCalls(callsRes.data);
      }
      const user = userRes.data.user;
      if (user) {
        setEmail(user.email ?? "");
        const { data: profile } = await supabase
          .from("profiles")
          .select("name")
          .eq("id", user.id)
          .maybeSingle();
        if (active && profile?.name) {
          setProfileName(profile.name);
        }
      }
      setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [orgId]);

  const getDisplayName = () => {
    if (profileName.trim()) {
      const first = profileName.trim().split(" ")[0];
      return first.charAt(0).toUpperCase() + first.slice(1);
    }
    if (email) {
      const handle = email.split("@")[0].split(".")[0];
      return handle.charAt(0).toUpperCase() + handle.slice(1);
    }
    return "there";
  };

  const displayName = getDisplayName();
  const greeting = getGreeting();

  // Loading state
  if (loading || roleLoading) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
        {/* Header skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-5 w-48" />
        </div>
        {/* KPI skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5">
              <div className="space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            </Card>
          ))}
        </div>
        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* ── Page Head ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-display font-bold text-foreground tracking-tight">
            {greeting}, {displayName} 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here's what's happening at{" "}
            <span className="font-medium text-foreground">{org?.name ?? "your org"}</span>{" "}
            today
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Link to="/orgs/$orgId/agents" params={{ orgId }}>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                New agent
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {(() => {
          const kpiItems: KPI[] = [
            {
              label: "Calls today",
              value: String(kpis.calls_today),
              delta: "—",
              deltaType: "neutral",
              icon: Phone,
              iconColor: "text-banyan",
              iconBg: "bg-banyan-tint",
            },
            {
              label: "COD confirmed",
              value: String(kpis.completed_today),
              delta: "—",
              deltaType: "neutral",
              icon: CheckCircle,
              iconColor: "text-teal",
              iconBg: "bg-teal-tint",
            },
            {
              label: "Completion Rate",
              value: kpis.calls_today > 0 ? Math.round((kpis.completed_today / kpis.calls_today) * 100) + '%' : '0%',
              delta: "—",
              deltaType: "neutral",
              icon: TrendingUp,
              iconColor: "text-indigo",
              iconBg: "bg-indigo-tint",
            },
            {
              label: "Avg response",
              value: kpis.avg_duration_seconds > 0 ? `${kpis.avg_duration_seconds}s` : "0s",
              delta: "—",
              deltaType: "neutral",
              icon: Clock,
              iconColor: "text-terra",
              iconBg: "bg-terra-tint",
            },
          ];
          return kpiItems;
        })().map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card
              key={kpi.label}
              className="p-5 hover:shadow-md transition-shadow duration-200 group"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-caption">{kpi.label}</p>
                  <p className="text-stat text-foreground">{kpi.value}</p>
                  <div className="flex items-center gap-1">
                    {kpi.deltaType === "up" && (
                      <ArrowUpRight className="h-3.5 w-3.5 text-success" />
                    )}
                    {kpi.deltaType === "down" && (
                      <ArrowDownRight className="h-3.5 w-3.5 text-error" />
                    )}
                    <span
                      className={`text-xs font-medium ${
                        kpi.deltaType === "up"
                          ? "text-success"
                          : kpi.deltaType === "down"
                            ? "text-error"
                            : "text-muted-foreground"
                      }`}
                    >
                      {kpi.delta}
                    </span>
                    <span className="text-xs text-muted-foreground">vs yesterday</span>
                  </div>
                </div>
                <div
                  className={`grid place-items-center w-10 h-10 rounded-xl ${kpi.iconBg} ${kpi.iconColor} group-hover:scale-105 transition-transform duration-200`}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ── Live Call + Quick Actions (2-col) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Live Call Card */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span className="text-sm font-semibold text-foreground">Live Call</span>
            </div>
          </div>
          <div className="p-4">
            <LiveCallWidget />
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {canEdit && (
              <Link
                to="/orgs/$orgId/agents"
                params={{ orgId }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors group"
              >
                <div className="grid place-items-center w-9 h-9 rounded-lg bg-banyan-tint text-banyan">
                  <Bot className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Create an agent</p>
                  <p className="text-caption truncate">Set up a new voice AI agent</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            )}

            <Link
              to="/orgs/$orgId/agents"
              params={{ orgId }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors group"
            >
              <div className="grid place-items-center w-9 h-9 rounded-lg bg-teal-tint text-teal">
                <GitBranch className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Edit a flow</p>
                <p className="text-caption truncate">Open the visual flow editor</p>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>

            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 opacity-50 cursor-not-allowed">
              <div className="grid place-items-center w-9 h-9 rounded-lg bg-terra-tint text-terra">
                <Megaphone className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Launch campaign</p>
                <p className="text-caption truncate">Coming soon</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Recent Calls Table ── */}
      <Card>
        <div className="p-4 border-b border-border/40 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Recent Calls</h3>
          <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1">
            <Link to="/orgs/$orgId/calls" params={{ orgId }}>
              <TrendingUp className="h-3.5 w-3.5" />
              View all
            </Link>
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30">
                <th className="text-eyebrow text-left px-4 py-2.5 font-semibold">Phone</th>
                <th className="text-eyebrow text-left px-4 py-2.5 font-semibold">Agent</th>
                <th className="text-eyebrow text-left px-4 py-2.5 font-semibold">Status</th>
                <th className="text-eyebrow text-left px-4 py-2.5 font-semibold">Duration</th>
                <th className="text-eyebrow text-left px-4 py-2.5 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-xs text-muted-foreground italic">
                    No calls yet — once your telephony is connected and campaigns run, calls will show up here.
                  </td>
                </tr>
              ) : (
                recentCalls.map((call) => {
                  const cleanedStatus = call.status === "in_progress" ? "in-progress" : call.status;
                  const st = STATUS_MAP[cleanedStatus as "completed" | "failed" | "in-progress" | "missed"] || {
                    label: call.status,
                    variant: "outline",
                    icon: PhoneCall,
                  };
                  const StatusIcon = st.icon;

                  return (
                    <tr
                      key={call.id}
                      className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-3 text-data text-foreground font-semibold font-mono">
                        {maskPhoneNumber(call.phone_number)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground font-medium">
                        {call.agents?.name || "Unknown Agent"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={st.variant} className="gap-1 text-[10px] py-0.5">
                          <StatusIcon className="h-3 w-3" />
                          {st.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-data text-muted-foreground font-mono">
                        {call.duration_seconds !== null ? `${Math.floor(call.duration_seconds / 60)}:${(call.duration_seconds % 60).toString().padStart(2, "0")}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-caption font-mono">
                        {new Date(call.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
