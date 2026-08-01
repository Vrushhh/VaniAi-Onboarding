import { Link, useParams, useMatches } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Menu,
  Search,
  Sun,
  Moon,
  Mic,
} from "lucide-react";

type AppTopbarProps = {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
};

/** Builds breadcrumbs from TanStack Router matches */
function useBreadcrumbs() {
  const matches = useMatches();
  const crumbs: { label: string; to?: string; params?: Record<string, string> }[] = [];

  for (const m of matches) {
    const id = m.routeId;
    // Skip layout/wrapper routes
    if (id === "__root__" || id === "/_authenticated" || id === "/_authenticated/orgs") continue;
    // Skip $orgId layout passthrough
    if (id === "/_authenticated/orgs/$orgId") continue;

    // Determine label and link for each segment
    if (id === "/_authenticated/orgs/$orgId/agents") continue; // layout, skip
    if (id === "/_authenticated/orgs/$orgId/agents/$agentId") continue; // layout
    if (id === "/_authenticated/orgs/$orgId/agents/$agentId/flows/$flowId") continue;

    // Index routes
    if (id.endsWith("/")) {
      // These are index routes like orgs/ (index)
      if (id === "/_authenticated/orgs/") {
        crumbs.push({ label: "Organizations" });
        continue;
      }
    }

    const params = (m as any).params ?? {};

    // Map route IDs to breadcrumbs
    if (id.includes("orgs/$orgId") && (id.endsWith("/") || id.endsWith("$orgId")) && !id.includes("agents") && !id.includes("members") && !id.includes("settings")) {
      crumbs.push({ label: "Dashboard" });
    } else if (id.includes("agents") && id.endsWith("index")) {
      if (id.includes("$agentId")) {
        crumbs.push({ label: "Agent", to: "/orgs/$orgId/agents/$agentId", params });
      } else {
        crumbs.push({ label: "Agents", to: "/orgs/$orgId/agents", params });
      }
    } else if (id.includes("members")) {
      crumbs.push({ label: "Team" });
    } else if (id.includes("settings") && !id.includes("agentId")) {
      crumbs.push({ label: "Settings" });
    } else if (id.includes("$agentId") && id.includes("settings")) {
      crumbs.push({ label: "Agent Settings" });
    } else if (id.includes("flows") && id.includes("$flowId") && id.endsWith("index")) {
      crumbs.push({ label: "Flow Editor" });
    } else if (id.includes("flows") && id.includes("versions")) {
      crumbs.push({ label: "Versions" });
    } else if (id.includes("profile")) {
      crumbs.push({ label: "Profile" });
    }
  }

  return crumbs;
}

export function AppTopbar({ onMenuClick, showMenuButton }: AppTopbarProps) {
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const crumbs = useBreadcrumbs();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const toggleTheme = () => {
    if (typeof window === "undefined") return;
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  };

  const initial = email ? email.charAt(0).toUpperCase() : "U";

  return (
    <header className="flex items-center justify-between h-16 px-5 border-b border-border/40 bg-background/70 backdrop-blur-md">
      {/* Left: menu + breadcrumbs */}
      <div className="flex items-center gap-3 text-sm min-w-0">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="h-8 w-8 rounded-lg lg:hidden"
          >
            <Menu className="h-4.5 w-4.5" />
          </Button>
        )}

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 animate-in slide-in-from-left-2 duration-200">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 opacity-50 shrink-0" />}
              {c.to ? (
                <Link
                  to={c.to as any}
                  params={c.params as any}
                  className="hover:text-foreground transition-colors font-medium truncate"
                >
                  {c.label}
                </Link>
              ) : (
                <span className="text-foreground/90 font-medium truncate">
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Right: search + homepage link + theme + avatar */}
      <div className="flex items-center gap-2.5">
        <a
          href="/"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
          title="Return to KZUNO Main Landing Page"
        >
          <span>← Back to Homepage</span>
        </a>

        {/* Search pill (visual only) */}
        <button
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/60 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
          onClick={() => {
            /* TODO: ⌘K command palette */
          }}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
          <kbd className="text-[10px] bg-muted rounded px-1 py-0.5 font-mono">⌘K</kbd>
        </button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground relative"
          title="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {/* Avatar link */}
        <Link
          to="/profile"
          className="flex items-center gap-2 px-2 py-1 rounded-full border border-border/60 hover:bg-muted/60 transition-all text-xs font-medium text-muted-foreground hover:text-foreground"
          title={email}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-primary font-semibold text-[10px] border border-border/40">
            {initial}
          </div>
          <span className="hidden sm:inline truncate max-w-[120px]">{email || "Profile"}</span>
        </Link>
      </div>
    </header>
  );
}
