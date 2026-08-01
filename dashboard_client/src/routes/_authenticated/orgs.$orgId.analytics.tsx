import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { toast } from "sonner";
import {
  BarChart3,
  Calendar,
  Clock,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/analytics")({
  component: AnalyticsPage,
});

type CallData = {
  started_at: string;
  status: string;
  duration_seconds: number | null;
  agent_id: string | null;
};

type AgentStat = {
  name: string;
  total: number;
  completed: number;
  avgDuration: number;
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function AnalyticsPage() {
  const { orgId } = Route.useParams() as any;

  const [timeframe, setTimeframe] = useState<"7d" | "30d">("7d");
  const [loading, setLoading] = useState(true);
  
  const [calls, setCalls] = useState<CallData[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);

  async function loadData() {
    setLoading(true);
    try {
      const days = timeframe === "7d" ? 7 : 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [callsRes, agentsRes] = await Promise.all([
        (supabase as any)
          .from("calls")
          .select("started_at, status, duration_seconds, agent_id")
          .eq("org_id", orgId)
          .gte("started_at", startDate.toISOString()),
        (supabase as any)
          .from("agents")
          .select("id, name")
          .eq("org_id", orgId)
      ]);

      if (callsRes.error) throw callsRes.error;
      if (agentsRes.error) throw agentsRes.error;

      setCalls(callsRes.data || []);
      setAgents(agentsRes.data || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [orgId, timeframe]);

  // 1. Process Trend Chart Data
  const daysCount = timeframe === "7d" ? 7 : 30;
  const trendChartData = Array.from({ length: daysCount }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return {
      date: label,
      Calls: 0,
      Completed: 0,
      rawDate: d,
    };
  }).reverse();

  calls.forEach((c) => {
    const cDate = new Date(c.started_at);
    const matched = trendChartData.find(
      (item) =>
        item.rawDate.getFullYear() === cDate.getFullYear() &&
        item.rawDate.getMonth() === cDate.getMonth() &&
        item.rawDate.getDate() === cDate.getDate()
    );
    if (matched) {
      matched.Calls += 1;
      if (c.status === "completed") {
        matched.Completed += 1;
      }
    }
  });

  // 2. Process Status Pie Chart
  const statusCounts = {
    completed: 0,
    failed: 0,
    missed: 0,
    no_answer: 0,
    in_progress: 0,
  };

  calls.forEach((c) => {
    const statusKey = c.status === "in_progress" ? "in_progress" : c.status;
    if (statusKey in statusCounts) {
      statusCounts[statusKey as keyof typeof statusCounts]++;
    }
  });

  const pieData = [
    { name: "Completed", value: statusCounts.completed, color: "#10b981" },
    { name: "Failed", value: statusCounts.failed, color: "#ef4444" },
    { name: "Missed", value: statusCounts.missed, color: "#f59e0b" },
    { name: "No Answer", value: statusCounts.no_answer, color: "#6b7280" },
    { name: "In Progress", value: statusCounts.in_progress, color: "#3b82f6" },
  ].filter((item) => item.value > 0);

  // If no slices are > 0, provide a single dummy slice representing "No Calls"
  const finalPieData = pieData.length > 0 ? pieData : [{ name: "No Calls", value: 1, color: "#e5e7eb" }];

  // 3. Process Agent Performance Table
  const agentStats: AgentStat[] = agents.map((a) => {
    const agentCalls = calls.filter((c) => c.agent_id === a.id);
    const completed = agentCalls.filter((c) => c.status === "completed");
    const totalDuration = completed.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
    const avgDuration = completed.length ? Math.round(totalDuration / completed.length) : 0;
    return {
      name: a.name,
      total: agentCalls.length,
      completed: completed.length,
      avgDuration,
    };
  });

  // High-level KPI aggregations
  const totalCalls = calls.length;
  const completedCalls = calls.filter((c) => c.status === "completed").length;
  const rateValue = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;
  const completedDurations = calls.filter((c) => c.status === "completed" && c.duration_seconds !== null);
  const avgDurationSeconds = completedDurations.length
    ? Math.round(completedDurations.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / completedDurations.length)
    : 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 font-sans space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            Analytics & Insights
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor trend lines, conversion rates, and agent dialogue durations over time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={timeframe}
            onValueChange={(v: any) => setTimeframe(v)}
            disabled={loading}
          >
            <SelectTrigger className="w-32 h-8 border-border/80 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d" className="text-xs">Last 7 Days</SelectItem>
              <SelectItem value="30d" className="text-xs">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-8 text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 space-y-2 bg-card/60 backdrop-blur border-border/60">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Total Calls</span>
            <PhoneCall className="h-4 w-4 text-banyan" />
          </div>
          <p className="text-2xl font-bold text-foreground font-display">{totalCalls}</p>
          <p className="text-[10px] text-muted-foreground">Inbound + outbound triggers</p>
        </Card>

        <Card className="p-5 space-y-2 bg-card/60 backdrop-blur border-border/60">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Completed Runs</span>
            <CheckCircle2 className="h-4 w-4 text-teal" />
          </div>
          <p className="text-2xl font-bold text-foreground font-display">{completedCalls}</p>
          <p className="text-[10px] text-muted-foreground">Successful flow finishes</p>
        </Card>

        <Card className="p-5 space-y-2 bg-card/60 backdrop-blur border-border/60">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Completion Rate</span>
            <TrendingUp className="h-4 w-4 text-indigo" />
          </div>
          <p className="text-2xl font-bold text-foreground font-display">{rateValue}%</p>
          <p className="text-[10px] text-muted-foreground">Percentage of total calls</p>
        </Card>

        <Card className="p-5 space-y-2 bg-card/60 backdrop-blur border-border/60">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Avg Duration</span>
            <Clock className="h-4 w-4 text-terra" />
          </div>
          <p className="text-2xl font-bold text-foreground font-display">{formatDuration(avgDurationSeconds)}</p>
          <p className="text-[10px] text-muted-foreground">Average connected dialogue time</p>
        </Card>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trend line chart */}
        <Card className="p-6 border-border/60 bg-card/60 backdrop-blur lg:col-span-8 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Call Volume Trends</h2>
          <div className="h-64 w-full text-xs">
            {loading ? (
              <div className="w-full h-full animate-pulse bg-muted/40 rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData}>
                  <XAxis dataKey="date" stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#888888" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#1f2937", border: "none", borderRadius: "8px", color: "#f9fafb" }} />
                  <Line type="monotone" dataKey="Calls" stroke="#b45309" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="Completed" stroke="#0f766e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Status Distribution Pie Chart */}
        <Card className="p-6 border-border/60 bg-card/60 backdrop-blur lg:col-span-4 space-y-4 flex flex-col justify-between">
          <h2 className="text-sm font-semibold text-foreground">Status Distribution</h2>
          <div className="h-48 w-full flex items-center justify-center text-xs">
            {loading ? (
              <div className="w-32 h-32 animate-pulse bg-muted/40 rounded-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={finalPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {finalPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Agent Performance Table */}
      <Card className="p-6 border-border/60 bg-card/60 backdrop-blur space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Agent Performance</h2>
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        ) : agentStats.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground italic">
            No agents found. Create agents under the "Agents" section to see performance logs.
          </div>
        ) : (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20 text-muted-foreground font-semibold uppercase tracking-wider font-mono">
                  <th className="px-4 py-2.5">Agent Name</th>
                  <th className="px-4 py-2.5">Total Calls</th>
                  <th className="px-4 py-2.5">Completed Runs</th>
                  <th className="px-4 py-2.5">Success Rate</th>
                  <th className="px-4 py-2.5">Avg Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {agentStats.map((stat, idx) => {
                  const rate = stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 0;
                  return (
                    <tr key={idx} className="hover:bg-muted/5 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground">{stat.name}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">{stat.total}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">{stat.completed}</td>
                      <td className="px-4 py-3 font-semibold text-foreground font-mono">{rate}%</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">{formatDuration(stat.avgDuration)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
