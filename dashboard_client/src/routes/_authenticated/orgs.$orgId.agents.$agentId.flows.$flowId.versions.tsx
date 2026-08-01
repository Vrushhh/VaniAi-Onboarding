import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { NODE_TYPE_MAP, normalizeDraft } from "@/lib/flow-types";

export const Route = createFileRoute(
  "/_authenticated/orgs/$orgId/agents/$agentId/flows/$flowId/versions",
)({
  component: VersionHistory,
});

type Version = {
  id: string;
  version_number: number;
  published_at: string;
  published_by: string | null;
  json: unknown;
};

function VersionHistory() {
  const { orgId, agentId, flowId } = Route.useParams();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [flowName, setFlowName] = useState<string>("");
  const [agentName, setAgentName] = useState<string>("");
  const [publisherEmails, setPublisherEmails] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<Version | null>(null);
  const [restoring, setRestoring] = useState(false);

  async function load() {
    const [vRes, fRes] = await Promise.all([
      supabase
        .from("flow_versions")
        .select("id, version_number, published_at, published_by, json")
        .eq("flow_id", flowId)
        .order("version_number", { ascending: false }),
      supabase
        .from("flows")
        .select("name, agent_id")
        .eq("id", flowId)
        .maybeSingle(),
    ]);
    if (vRes.error) toast.error(vRes.error.message);
    setVersions(vRes.data ?? []);
    if (fRes.data) {
      setFlowName(fRes.data.name);
      const a = await supabase
        .from("agents")
        .select("name")
        .eq("id", fRes.data.agent_id)
        .maybeSingle();
      setAgentName(a.data?.name ?? "");
    }
    // Look up publisher emails via members in this org (best-effort; RLS limits us to same-org users)
    const ids = Array.from(
      new Set((vRes.data ?? []).map((v) => v.published_by).filter(Boolean) as string[]),
    );
    if (ids.length) {
      const m = await supabase
        .from("org_members")
        .select("user_id")
        .in("user_id", ids);
      // We can't read auth.users directly. Fall back to user id short form.
      if (m.data) {
        const map: Record<string, string> = {};
        for (const id of ids) map[id] = id.slice(0, 8) + "…";
        setPublisherEmails(map);
      }
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  async function restore(v: Version) {
    if (
      !confirm(
        `Restore v${v.version_number} into your draft? This replaces the current draft. The published version is unchanged.`,
      )
    ) {
      return;
    }
    setRestoring(true);
    const { error } = await supabase
      .from("flows")
      .update({ draft_json: v.json as never })
      .eq("id", flowId);
    setRestoring(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Restored v${v.version_number} into draft`);
    navigate({
      to: "/orgs/$orgId/agents/$agentId/flows/$flowId",
      params: { orgId, agentId, flowId },
    });
  }

  return (
    <>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Version history</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Immutable snapshots from each publish. View any version, or restore one
              into the draft for editing.
            </p>
          </div>
          <Button asChild variant="ghost">
            <Link
              to="/orgs/$orgId/agents/$agentId/flows/$flowId"
              params={{ orgId, agentId, flowId }}
            >
              Back to editor
            </Link>
          </Button>
        </div>

        <div className="mt-8 space-y-2">
          {versions === null && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
          {versions && versions.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No published versions yet.
            </Card>
          )}
          {versions?.map((v) => (
            <Card key={v.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">v{v.version_number}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Published {new Date(v.published_at).toLocaleString()}
                  {v.published_by && (
                    <> by {publisherEmails[v.published_by] ?? "a teammate"}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setViewing(v)}>
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restore(v)}
                  disabled={restoring}
                >
                  Restore to draft
                </Button>
              </div>
            </Card>
          ))}
        </div>

        {viewing && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setViewing(null)}
          >
            <Card
              className="max-h-[85vh] w-full max-w-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-5 py-3">
                <div className="font-medium">
                  v{viewing.version_number} (read-only)
                </div>
                <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>
                  Close
                </Button>
              </div>
              <div className="max-h-[70vh] overflow-auto p-5">
                <ReadOnlySummary json={viewing.json} />
              </div>
            </Card>
          </div>
        )}
      </main>
    </>
  );
}

function ReadOnlySummary({ json }: { json: unknown }) {
  const draft = normalizeDraft(json, "", "");
  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">
        {draft.direction} · {draft.language} · {draft.nodes.length} steps
      </div>
      <ol className="space-y-2">
        {draft.nodes.map((n, i) => (
          <li key={n.id} className="rounded border p-3">
            <div className="text-xs text-muted-foreground">Step {i + 1}</div>
            <div className="font-medium">{NODE_TYPE_MAP[n.type]?.label ?? n.type}</div>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {JSON.stringify(n.config, null, 2)}
            </pre>
          </li>
        ))}
      </ol>
    </div>
  );
}
