import { Link, useParams, useMatches, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useUserOrgs, type UserOrg } from "@/hooks/useUserOrgs";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useTheme } from "@/lib/theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  BarChart3,
  Bot,
  GitBranch,
  BookOpen,
  Megaphone,
  Phone,
  Users,
  CreditCard,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Plus,
  LogOut,
  User,
  Palette,
  Mic,
  Sun,
  Moon,
  Monitor,
  Check,
  History,
  Webhook,
  Activity,
} from "lucide-react";

// ─── Nav config ───────────────────────────────────────────

type NavItem = {
  label: string;
  icon: React.ElementType;
  to?: string;
  disabled?: boolean;
  comingSoon?: boolean;
  matchPrefix?: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

function getNavGroups(orgId: string, role?: string, isPlatformAdmin?: boolean): NavGroup[] {
  const orgItems: NavItem[] = [
    {
      label: "Team",
      icon: Users,
      to: "/orgs/$orgId/members",
      matchPrefix: `/orgs/${orgId}/members`,
    },
  ];

  if (role !== "viewer") {
    orgItems.push({
      label: "Audit Log",
      icon: History,
      to: "/orgs/$orgId/audit-log",
      matchPrefix: `/orgs/${orgId}/audit-log`,
    });
    orgItems.push({
      label: "Integrations",
      icon: Webhook,
      to: "/orgs/$orgId/integrations",
      matchPrefix: `/orgs/${orgId}/integrations`,
    });
  }

  if (isPlatformAdmin) {
    orgItems.push({
      label: "System Health",
      icon: Activity,
      to: "/orgs/$orgId/system-health",
      matchPrefix: `/orgs/${orgId}/system-health`,
    });
  }

  orgItems.push(
    {
      label: "Billing",
      icon: CreditCard,
      disabled: true,
      comingSoon: true,
    },
    {
      label: "Settings",
      icon: Settings,
      to: "/orgs/$orgId/settings",
      matchPrefix: `/orgs/${orgId}/settings`,
    }
  );

  return [
    {
      title: "Overview",
      items: [
        {
          label: "Dashboard",
          icon: LayoutDashboard,
          to: "/orgs/$orgId",
          matchPrefix: `/orgs/${orgId}`,
        },
        {
          label: "Analytics",
          icon: BarChart3,
          to: "/orgs/$orgId/analytics",
          matchPrefix: `/orgs/${orgId}/analytics`,
        },
      ],
    },
    {
      title: "Build",
      items: [
        {
          label: "Agents",
          icon: Bot,
          to: "/orgs/$orgId/agents",
          matchPrefix: `/orgs/${orgId}/agents`,
        },
        {
          label: "Knowledge Base",
          icon: BookOpen,
          to: "/orgs/$orgId/knowledge",
          matchPrefix: `/orgs/${orgId}/knowledge`,
        },
      ],
    },
    {
      title: "Run",
      items: [
        {
          label: "Campaigns",
          icon: Megaphone,
          disabled: true,
          comingSoon: true,
        },
        {
          label: "Calls",
          icon: Phone,
          to: "/orgs/$orgId/calls",
          matchPrefix: `/orgs/${orgId}/calls`,
        },
      ],
    },
    {
      title: "Organization",
      items: orgItems,
    },
  ];
}

// ─── Sidebar component ───────────────────────────────────

type AppSidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const navigate = useNavigate();
  const { orgId } = useParams({ strict: false }) as { orgId?: string };
  const { orgs, loading: orgsLoading } = useUserOrgs();
  const { role } = useOrgRole(orgId);
  const { theme, setTheme } = useTheme();
  const matches = useMatches();
  const [email, setEmail] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [orgSwitcherOpen, setOrgSwitcherOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      if (data.user) {
        (supabase as any)
          .from("profiles")
          .select("is_platform_admin")
          .eq("id", data.user.id)
          .maybeSingle()
          .then(({ data: profile }: any) => {
            setIsPlatformAdmin(profile?.is_platform_admin ?? false);
          });
      }
    });
  }, []);

  const currentOrg = orgs.find((o) => o.org_id === orgId);
  const navGroups = orgId ? getNavGroups(orgId, role, isPlatformAdmin) : [];
  const initial = email ? email.charAt(0).toUpperCase() : "U";

  // Check if a nav item is active by matching against current route
  function isActive(item: NavItem): boolean {
    if (!item.matchPrefix) return false;
    // The dashboard route should be exact match only
    const currentPath = matches[matches.length - 1]?.pathname ?? "";
    if (item.label === "Dashboard") {
      // Active only for the exact dashboard path: /orgs/$orgId or /orgs/$orgId/
      return currentPath === `/orgs/${orgId}` || currentPath === `/orgs/${orgId}/`;
    }
    return currentPath.startsWith(item.matchPrefix);
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-card border-r border-border/60 transition-all duration-200 ease-out overflow-hidden",
        collapsed ? "w-16" : "w-[260px]"
      )}
    >
      {/* ── Org Switcher ── */}
      <div className="p-3">
        <Popover open={orgSwitcherOpen} onOpenChange={setOrgSwitcherOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 hover:bg-muted/60 transition-colors text-left",
                collapsed && "justify-center px-0"
              )}
            >
              <span className="grid place-items-center w-8 h-8 rounded-[10px] bg-primary/10 border border-primary/20 shadow-sm shrink-0 overflow-hidden p-1">
                <img src="/brand/kzuno_icon_green.png" alt="" className="h-6 w-6 object-contain dark:hidden" />
                <img src="/brand/kzuno_icon_white.png" alt="" className="h-6 w-6 object-contain hidden dark:block" />
              </span>
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">
                      {currentOrg?.org_name ?? "Select org"}
                    </div>
                    {role && (
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {role}
                      </div>
                    )}
                  </div>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="right"
            className="w-64 p-2"
          >
            <div className="text-eyebrow px-2 py-1.5 mb-1">Organizations</div>
            <div className="space-y-0.5 max-h-52 overflow-y-auto">
              {orgsLoading ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Loading…
                </div>
              ) : (
                orgs.map((org) => (
                  <Link
                    key={org.org_id}
                    to="/orgs/$orgId"
                    params={{ orgId: org.org_id }}
                    onClick={() => setOrgSwitcherOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/60",
                      org.org_id === orgId && "bg-banyan-tint text-banyan font-semibold"
                    )}
                  >
                    <span className="grid place-items-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold shrink-0">
                      {org.org_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate">{org.org_name}</span>
                    <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                      {org.role}
                    </Badge>
                    {org.org_id === orgId && (
                      <Check className="h-3.5 w-3.5 text-banyan shrink-0" />
                    )}
                  </Link>
                ))
              )}
            </div>
            <Separator className="my-2" />
            <Link
              to="/orgs"
              onClick={() => setOrgSwitcherOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create organization
            </Link>
          </PopoverContent>
        </Popover>
      </div>

      <Separator className="mx-3" />

      {/* ── Nav Groups ── */}
      <ScrollArea className="flex-1 py-2">
        <nav className="px-2 space-y-4">
          {navGroups.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <div className="text-eyebrow px-2.5 py-1.5">{group.title}</div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item);
                  const Icon = item.icon;

                  if (item.disabled || item.comingSoon) {
                    const inner = (
                      <span
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground/50 cursor-not-allowed",
                          collapsed && "justify-center px-0"
                        )}
                      >
                        <Icon className="h-4.5 w-4.5 shrink-0" />
                        {!collapsed && (
                          <span className="flex-1">{item.label}</span>
                        )}
                        {!collapsed && item.comingSoon && (
                          <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                            Soon
                          </span>
                        )}
                      </span>
                    );

                    if (collapsed) {
                      return (
                        <TooltipProvider key={item.label} delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>{inner}</TooltipTrigger>
                            <TooltipContent side="right">
                              {item.label}
                              {item.comingSoon && " (Coming soon)"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    }
                    return <div key={item.label}>{inner}</div>;
                  }

                  const linkContent = (
                    <Link
                      to={item.to as any}
                      params={{ orgId: orgId! } as any}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-banyan-tint text-banyan font-semibold nav-active-bar"
                          : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                        collapsed && "justify-center px-0"
                      )}
                    >
                      <Icon className="h-4.5 w-4.5 shrink-0" />
                      {!collapsed && <span className="flex-1">{item.label}</span>}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <TooltipProvider key={item.label} delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  }
                  return <div key={item.label}>{linkContent}</div>;
                })}
              </div>
            </div>
          ))}
          {isPlatformAdmin && (
            <div className="pt-2 border-t border-border/40">
              {!collapsed && (
                <div className="text-eyebrow px-2.5 py-1.5 text-amber-600 dark:text-amber-400">Admin</div>
              )}
              <div className="space-y-0.5">
                <Link
                  to="/admin/orgs"
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors text-amber-600 dark:text-amber-400 hover:bg-amber-500/10",
                    collapsed && "justify-center px-0"
                  )}
                >
                  <Settings className="h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  {!collapsed && <span className="flex-1">Admin Portal</span>}
                </Link>
              </div>
            </div>
          )}
        </nav>
      </ScrollArea>

      <Separator className="mx-3" />

      {/* ── Account + Collapse ── */}
      <div className="p-3 space-y-2">
        <Popover open={accountOpen} onOpenChange={setAccountOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2.5 w-full rounded-lg px-2 py-2 hover:bg-muted/60 transition-colors text-left",
                collapsed && "justify-center px-0"
              )}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-primary font-semibold text-xs border border-border/40 shrink-0">
                {initial}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate max-w-[150px]">
                    {email || "Account"}
                  </div>
                </div>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="right"
            className="w-56 p-2"
          >
            <Link
              to="/profile"
              onClick={() => setAccountOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/60 transition-colors"
            >
              <User className="h-4 w-4" />
              Profile
            </Link>

            {isPlatformAdmin && (
              <Link
                to="/admin/orgs"
                onClick={() => setAccountOpen(false)}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/60 transition-colors text-amber-600 dark:text-amber-400 font-semibold animate-pulse-slow"
              >
                <Settings className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Admin Portal
              </Link>
            )}

            {/* Theme sub-section */}
            <div className="px-2 py-1.5">
              <div className="text-eyebrow mb-1.5">Theme</div>
              <div className="flex items-center gap-1">
                {(
                  [
                    { key: "light", icon: Sun, label: "Light" },
                    { key: "dark", icon: Moon, label: "Dark" },
                    { key: "system", icon: Monitor, label: "System" },
                  ] as const
                ).map(({ key, icon: ThemeIcon, label }) => (
                  <button
                    key={key}
                    onClick={() => setTheme(key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors flex-1 justify-center",
                      theme === key
                        ? "bg-banyan-tint text-banyan font-semibold"
                        : "hover:bg-muted/60 text-muted-foreground"
                    )}
                  >
                    <ThemeIcon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <Separator className="my-1" />
            <button
              onClick={() => {
                setAccountOpen(false);
                signOut();
              }}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors w-full text-left"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </PopoverContent>
        </Popover>

        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className={cn(
            "w-full rounded-lg text-muted-foreground hover:text-foreground",
            collapsed && "px-0"
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4 mr-2" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
