import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert,
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  FilterX,
  History,
  User,
  Clock,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/audit-log")({
  component: AuditLogPage,
});

type AuditRecord = {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
};

const ACTION_CATEGORIES: Record<string, string[]> = {
  All: [],
  Team: ["member.invited", "member.role_changed", "member.removed"],
  Agents: ["agent.created", "agent.updated", "agent.deleted"],
  Flows: ["flow.published", "flow.draft_saved"],
  Organization: ["org.settings_updated"],
  Webhooks: ["webhook.created", "webhook.updated", "webhook.deleted"],
  Notifications: ["notification_prefs.updated"],
};

function getBadgeVariant(action: string) {
  if (action.includes("created") || action.includes("invited")) {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  }
  if (action.includes("updated") || action.includes("role_changed")) {
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  }
  if (action.includes("deleted") || action.includes("removed")) {
    return "bg-destructive/10 text-destructive border-destructive/20";
  }
  if (action.includes("published")) {
    return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
  }
  return "bg-muted text-muted-foreground border-border";
}

function AuditLogPage() {
  const { orgId } = Route.useParams();
  const { role, loading: roleLoading } = useOrgRole(orgId);

  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedActor, setSelectedActor] = useState<string>("All");
  const [dateRange, setDateRange] = useState<string>("7d");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState<number>(50);

  useEffect(() => {
    fetchAuditLogs();
  }, [orgId]);

  async function fetchAuditLogs() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("audit_log" as any)
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRecords((data as any[]) || []);
    } catch (err) {
      console.warn("Failed to fetch audit log:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  // Filter distinct actors for actor dropdown
  const actors = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.actor_email) set.add(r.actor_email);
    });
    return Array.from(set);
  }, [records]);

  // Filtered records based on controls
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // Date filter
      if (dateRange !== "all") {
        const recordDate = new Date(r.created_at).getTime();
        const now = Date.now();
        const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 1;
        if (now - recordDate > days * 24 * 60 * 60 * 1000) return false;
      }

      // Category filter
      if (selectedCategory !== "All") {
        const allowedActions = ACTION_CATEGORIES[selectedCategory] || [];
        if (!allowedActions.includes(r.action)) return false;
      }

      // Actor filter
      if (selectedActor !== "All" && r.actor_email !== selectedActor) {
        return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchAction = r.action.toLowerCase().includes(q);
        const matchActor = (r.actor_email || "").toLowerCase().includes(q);
        const matchTarget = (r.target_type || "").toLowerCase().includes(q) || (r.target_id || "").toLowerCase().includes(q);
        const matchMetadata = JSON.stringify(r.metadata || {}).toLowerCase().includes(q);

        if (!matchAction && !matchActor && !matchTarget && !matchMetadata) {
          return false;
        }
      }

      return true;
    });
  }, [records, dateRange, selectedCategory, selectedActor, searchQuery]);

  function exportCSV() {
    if (!filteredRecords.length) return;

    const headers = ["Timestamp", "Actor Email", "Action", "Target Type", "Target ID", "Metadata"];
    const rows = filteredRecords.map((r) => [
      format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss"),
      r.actor_email || "",
      r.action,
      r.target_type || "",
      r.target_id || "",
      JSON.stringify(r.metadata || {}).replace(/"/g, '""'),
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((x) => `"${x}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `kzuno_audit_log_${format(new Date(), "yyyyMMdd_HHmmss")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function clearFilters() {
    setSearchQuery("");
    setSelectedCategory("All");
    setSelectedActor("All");
    setDateRange("7d");
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
            Audit logs are only accessible to Organization Owners and Editors.
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
              <History className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">Audit Log</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Trace administrative events, team actions, security changes, and system modifications.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAuditLogs}
              disabled={loading}
              className="gap-2 rounded-lg"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={!filteredRecords.length}
              className="gap-2 rounded-lg border-primary/20 text-primary hover:bg-primary/10"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filter Controls */}
        <Card className="p-4 border-border/60 bg-card shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            {/* Search Input */}
            <div className="lg:col-span-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search actor, action, or metadata..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs rounded-lg"
              />
            </div>

            {/* Category Filter */}
            <div className="lg:col-span-3">
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="text-xs rounded-lg">
                  <SelectValue placeholder="Filter Category" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(ACTION_CATEGORIES).map((cat) => (
                    <SelectItem key={cat} value={cat} className="text-xs">
                      {cat === "All" ? "All Categories" : cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actor Filter */}
            <div className="lg:col-span-3">
              <Select value={selectedActor} onValueChange={setSelectedActor}>
                <SelectTrigger className="text-xs rounded-lg">
                  <SelectValue placeholder="Filter Actor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="text-xs">All Actors</SelectItem>
                  {actors.map((email) => (
                    <SelectItem key={email} value={email} className="text-xs">
                      {email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="lg:col-span-2">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="text-xs rounded-lg">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d" className="text-xs">Last 7 days</SelectItem>
                  <SelectItem value="30d" className="text-xs">Last 30 days</SelectItem>
                  <SelectItem value="all" className="text-xs">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Audit Log Table */}
        <Card className="border-border/60 bg-card shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs font-mono">Loading audit history...</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
                <FilterX className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold font-display">No audit events match your filters</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Try widening your date range or clearing search keywords.
              </p>
              <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4 gap-2 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-border/40">
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="text-xs font-semibold">Timestamp</TableHead>
                    <TableHead className="text-xs font-semibold">Actor</TableHead>
                    <TableHead className="text-xs font-semibold">Action</TableHead>
                    <TableHead className="text-xs font-semibold">Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.slice(0, displayCount).map((record) => {
                    const isExpanded = expandedRow === record.id;
                    const initial = record.actor_email ? record.actor_email.charAt(0).toUpperCase() : "U";

                    return (
                      <>
                        <TableRow
                          key={record.id}
                          className="hover:bg-muted/30 transition-colors border-border/30 cursor-pointer text-xs"
                          onClick={() => setExpandedRow(isExpanded ? null : record.id)}
                        >
                          <TableCell className="py-3 pl-4">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>

                          <TableCell className="py-3 whitespace-nowrap text-muted-foreground font-mono" title={format(new Date(record.created_at), "yyyy-MM-dd HH:mm:ss.SSS")}>
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 opacity-60" />
                              <span>{formatDistanceToNow(new Date(record.created_at), { addSuffix: true })}</span>
                            </div>
                          </TableCell>

                          <TableCell className="py-3 whitespace-nowrap font-medium text-foreground">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 rounded-full bg-accent text-primary text-[10px] font-bold flex items-center justify-center border border-border/40 shrink-0">
                                {initial}
                              </div>
                              <span className="truncate max-w-[180px]">{record.actor_email || "System"}</span>
                            </div>
                          </TableCell>

                          <TableCell className="py-3 whitespace-nowrap">
                            <Badge variant="outline" className={`font-mono text-[11px] px-2 py-0.5 rounded-md border ${getBadgeVariant(record.action)}`}>
                              {record.action}
                            </Badge>
                          </TableCell>

                          <TableCell className="py-3 whitespace-nowrap text-muted-foreground font-mono">
                            {record.target_type ? (
                              <span>
                                <strong className="text-foreground font-sans font-medium capitalize">{record.target_type}</strong>
                                {record.target_id && <span className="opacity-75"> ({record.target_id.slice(0, 8)})</span>}
                              </span>
                            ) : (
                              <span className="text-muted-foreground opacity-50">—</span>
                            )}
                          </TableCell>
                        </TableRow>

                        {/* Inline Metadata Inspector */}
                        {isExpanded && (
                          <TableRow key={`${record.id}-details`} className="bg-muted/20 border-border/30">
                            <TableCell colSpan={5} className="p-4 pl-12">
                              <div className="rounded-lg bg-card p-3 border border-border/60 space-y-2">
                                <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest font-semibold flex items-center justify-between">
                                  <span>Event Metadata & Details</span>
                                  <span>ID: {record.id}</span>
                                </div>
                                <pre className="p-3 rounded-md bg-muted/60 text-foreground font-mono text-xs overflow-x-auto border border-border/40 leading-relaxed">
                                  {JSON.stringify(record.metadata || {}, null, 2)}
                                </pre>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination Footer */}
          {filteredRecords.length > displayCount && (
            <div className="p-4 border-t border-border/40 flex justify-center bg-muted/20">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisplayCount((prev) => prev + 50)}
                className="text-xs gap-2"
              >
                Load more events ({filteredRecords.length - displayCount} remaining)
              </Button>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
