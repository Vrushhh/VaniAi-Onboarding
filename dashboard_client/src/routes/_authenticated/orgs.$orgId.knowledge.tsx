import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  BookOpen,
  Plus,
  Trash2,
  Search,
  Upload,
  AlertCircle,
  FileText,
  HelpCircle,
  Play,
  Database,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/knowledge")({
  component: KnowledgePage,
});

type SourceRow = {
  id: string;
  name: string;
  created_at: string;
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  knowledge_chunks: { id: string }[];
};

type ChunkResult = {
  content: string;
  similarity: number;
};

function KnowledgePage() {
  const { orgId } = Route.useParams();
  const { role, isOwner, canEdit, loading: roleLoading } = useOrgRole(orgId);

  // States
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  // Upload states
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Query states
  const [testQueryText, setTestQueryText] = useState("");
  const [queryResults, setQueryResults] = useState<ChunkResult[] | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  async function loadSources() {
    setSourcesLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("knowledge_sources")
        .select("id, name, created_at, status, error_message, knowledge_chunks(id)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[Knowledge] Knowledge sources table error:", error.message);
        setSources([]);
      } else {
        setSources((data as SourceRow[]) || []);
      }
    } catch (err: any) {
      console.error("[Knowledge] Error loading knowledge sources:", err);
    } finally {
      setSourcesLoading(false);
    }
  }

  useEffect(() => {
    loadSources();
  }, [orgId]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) {
      toast.error("You do not have permission to upload documents.");
      return;
    }
    if (!uploadFile) {
      toast.error("Please select a file to upload.");
      return;
    }
    const finalName = uploadName.trim() || uploadFile.name;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("orgId", orgId);
      formData.append("name", finalName);
      formData.append("file", uploadFile);

      const res = await fetch("/api/knowledge/upload-document", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!res.ok || !result.ok) {
        throw new Error(result.error || "Failed to process document.");
      }

      toast.success(`Ingested "${finalName}". Processing started.`);
      setUploadName("");
      setUploadFile(null);
      loadSources();

      // Poll source status until it is ready or failed
      const interval = setInterval(async () => {
        const { data } = await (supabase as any)
          .from("knowledge_sources")
          .select("status")
          .eq("id", result.sourceId)
          .single();

        if (data && data.status !== "processing") {
          clearInterval(interval);
          loadSources();
        }
      }, 3000);

    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteSource(source: SourceRow) {
    if (!canEdit) {
      toast.error("You do not have permission to delete sources.");
      return;
    }

    try {
      const { error } = await (supabase as any)
        .from("knowledge_sources")
        .delete()
        .eq("id", source.id);

      if (error) throw error;
      toast.success(`Knowledge source "${source.name}" deleted.`);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete source");
    }
  }

  async function handleTestQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!testQueryText.trim()) return;

    setQueryLoading(true);
    setQueryResults(null);
    try {
      // 1. Get embedding
      const embedRes = await fetch("/api/knowledge/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: testQueryText.trim() }),
      });

      const embedResult = await embedRes.json();
      if (!embedRes.ok || !embedResult.ok) {
        throw new Error(embedResult.error || "Failed to embed search query.");
      }

      // 2. Perform Cosine Search
      const { data, error } = await (supabase as any).rpc("search_knowledge", {
        _org_id: orgId,
        _query_embedding: embedResult.embedding,
        _top_k: 3,
      });

      if (error) throw error;
      setQueryResults((data as ChunkResult[]) || []);
    } catch (err: any) {
      toast.error(err.message || "Search failed");
    } finally {
      setQueryLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 font-sans space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
          Knowledge Base (RAG)
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ingest returns policies, catalogs, and FAQs to supply facts to voice agents dynamically.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Upload Column */}
        <div className="lg:col-span-5 space-y-6">
          {/* Upload card */}
          {canEdit ? (
            <Card className="p-6 border-border/60 shadow-sm bg-card/60 backdrop-blur space-y-5">
              <div className="flex gap-3.5 items-start">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Ingest Document</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Supports TXT and PDF file formats.
                  </p>
                </div>
              </div>

              <form onSubmit={handleUpload} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="source-name">Source Name (optional)</Label>
                  <Input
                    id="source-name"
                    placeholder="e.g. Shipping policy, FAQ catalog"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    className="h-9 border-border/80 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label>File Selection</Label>
                  <div className="border border-dashed border-border/65 hover:border-primary/50 transition-colors rounded-lg p-6 text-center space-y-2 relative bg-muted/5">
                    <input
                      type="file"
                      accept=".txt,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setUploadFile(file);
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      disabled={uploading}
                    />
                    <FileText className="mx-auto h-7 w-7 text-muted-foreground/60" />
                    <div className="text-xs text-muted-foreground">
                      {uploadFile ? (
                        <span className="font-semibold text-foreground font-mono text-[11px]">
                          {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                        </span>
                      ) : (
                        <span>Drag & drop or click to select file</span>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  className="w-full text-xs h-9 bg-primary hover:bg-primary/95 text-white font-medium shadow-sm"
                >
                  {uploading ? "Ingesting & Embedding..." : "Ingest & Chunk File"}
                </Button>
              </form>
            </Card>
          ) : (
            <Card className="p-6 border-border/60 text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground/60 mb-2" />
              <h2 className="text-xs font-semibold text-foreground">Upload Restricted</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Only editors and owners can upload knowledge base documents.
              </p>
            </Card>
          )}

          {/* Test query box */}
          <Card className="p-6 border-border/60 shadow-sm bg-card/60 backdrop-blur space-y-4">
            <div className="flex gap-3.5 items-start">
              <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Test Retrieval Query</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Sanity-check retrieved segments and similarity outcomes.
                </p>
              </div>
            </div>

            <form onSubmit={handleTestQuery} className="flex gap-2">
              <Input
                placeholder="Ask something to retrieve facts..."
                value={testQueryText}
                onChange={(e) => setTestQueryText(e.target.value)}
                className="h-9 border-border/80 text-xs flex-1"
                disabled={queryLoading}
              />
              <Button
                type="submit"
                disabled={queryLoading || !testQueryText.trim()}
                className="h-9 text-xs font-medium cursor-pointer"
              >
                Search
              </Button>
            </form>

            {/* Retrieval Results */}
            {queryLoading && (
              <div className="space-y-2 pt-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-10 w-full animate-pulse rounded bg-muted/40" />
                ))}
              </div>
            )}

            {queryResults !== null && (
              <div className="space-y-3 pt-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Retrieved Segment Matches ({queryResults.length})
                </div>
                {queryResults.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic py-2 text-center border border-dashed border-border/60 rounded">
                    Nothing matched this search query.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {queryResults.map((res, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-border/50 bg-muted/15 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                          <span>Match #{idx + 1}</span>
                          <Badge variant="secondary" className="text-[9px] py-px border border-primary/20 text-primary bg-primary/5">
                            {(res.similarity * 100).toFixed(1)}% match
                          </Badge>
                        </div>
                        <p className="leading-relaxed text-foreground/90 whitespace-pre-line">
                          {res.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Sources List Column */}
        <div className="lg:col-span-7">
          <Card className="p-6 border-border/60 shadow-sm bg-card/60 backdrop-blur space-y-4 min-h-[300px]">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Database className="h-4.5 w-4.5 text-muted-foreground" />
                <span>Knowledge Sources</span>
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadSources}
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {sourcesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 w-full animate-pulse rounded bg-muted/40" />
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-border/60 rounded-lg bg-muted/5">
                <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
                <p className="text-xs font-semibold text-foreground">No knowledge sources yet</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Upload returns policy, FAQ docs, or shipping info.
                </p>
              </div>
            ) : (
              <div className="border border-border/40 rounded-lg overflow-hidden text-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/20 text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
                      <th className="px-4 py-2.5">Document</th>
                      <th className="px-4 py-2.5">Segments</th>
                      <th className="px-4 py-2.5">Status</th>
                      {canEdit && <th className="px-4 py-2.5 text-right">Delete</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {sources.map((src) => (
                      <tr key={src.id} className="hover:bg-muted/5 transition-colors">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          <div>
                            <p className="font-semibold text-foreground text-xs leading-tight">{src.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {new Date(src.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                          {src.knowledge_chunks?.length || 0}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={
                              src.status === "ready"
                                ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/5 text-[10px]"
                                : src.status === "failed"
                                  ? "border-destructive/30 text-destructive bg-destructive/5 text-[10px]"
                                  : "border-amber-500/30 text-amber-600 bg-amber-500/5 text-[10px]"
                            }
                          >
                            {src.status}
                          </Badge>
                          {src.error_message && (
                            <p className="text-[9px] text-destructive leading-tight mt-1 max-w-[150px] truncate">
                              {src.error_message}
                            </p>
                          )}
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteSource(src)}
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
    </div>
  );
}
