import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bell, Shield, Users, Bot, CreditCard, Server, RefreshCw } from "lucide-react";
import { logAuditEvent } from "@/lib/audit-logger";

type NotificationCategory = {
  name: string;
  icon: React.ElementType;
  description: string;
  adminOnly?: boolean;
  events: {
    key: string;
    label: string;
    description: string;
  }[];
};

const CATEGORIES: NotificationCategory[] = [
  {
    name: "Account & Security",
    icon: Shield,
    description: "Security alerts and sign-in notifications for your user account",
    events: [
      { key: "password_changed", label: "Password Changed", description: "Receive alert when account password is updated" },
      { key: "new_login", label: "New Device Login", description: "Receive alert when account is accessed from a new IP/device" },
    ],
  },
  {
    name: "Team & Access",
    icon: Users,
    description: "Team member invitations and role changes",
    events: [
      { key: "member.invited", label: "Member Invited", description: "Notify when a new team member invitation is sent" },
      { key: "member.role_changed", label: "Role Changed", description: "Notify when a member's role is updated" },
      { key: "member.removed", label: "Member Removed", description: "Notify when a member is removed from organization" },
    ],
  },
  {
    name: "Agents & Calls",
    icon: Bot,
    description: "Agent deployments, flow publications, and call execution results",
    events: [
      { key: "agent.published", label: "Flow Published", description: "Notify when an agent flow version is published to production" },
      { key: "call.failed", label: "Call Failed / Error", description: "Notify when a voice AI call experiences a failure" },
      { key: "call.completed", label: "Call Completed", description: "Receive summary notification on call completion" },
    ],
  },
  {
    name: "Billing & Subscriptions",
    icon: CreditCard,
    description: "Payment receipts, invoice generation, and failure alerts",
    events: [
      { key: "billing.payment_failed", label: "Payment Failed", description: "Alert when a recurring subscription payment fails" },
      { key: "billing.invoice_generated", label: "Invoice Generated", description: "Notify when a monthly invoice is generated" },
    ],
  },
  {
    name: "System & Infrastructure",
    icon: Server,
    description: "Platform health status and dependency outages (Platform Admins)",
    adminOnly: true,
    events: [
      { key: "system.degraded", label: "System Degraded / Outage", description: "Alert when platform dependencies experience downtime" },
    ],
  },
];

type PreferenceMap = Record<string, boolean>;

export function NotificationPreferencesTab({
  orgId,
  isPlatformAdmin,
}: {
  orgId: string;
  isPlatformAdmin: boolean;
}) {
  const [preferences, setPreferences] = useState<PreferenceMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPreferences();
  }, [orgId]);

  async function fetchPreferences() {
    setLoading(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return;

      const { data, error } = await supabase
        .from("notification_preferences" as any)
        .select("event_type, enabled")
        .eq("org_id", orgId)
        .eq("user_id", userRes.user.id);

      if (error) throw error;

      // Build default enabled state for all event types
      const initialMap: PreferenceMap = {};
      CATEGORIES.forEach((cat) => {
        cat.events.forEach((ev) => {
          initialMap[ev.key] = true; // Default enabled
        });
      });

      if (data && data.length > 0) {
        data.forEach((row: any) => {
          initialMap[row.event_type] = row.enabled;
        });
      }

      setPreferences(initialMap);
    } catch (err) {
      console.warn("Failed to fetch notification preferences:", err);
    } finally {
      setLoading(false);
    }
  }

  async function togglePreference(eventType: string, currentEnabled: boolean) {
    const nextEnabled = !currentEnabled;

    // Optimistic UI update
    setPreferences((prev) => ({ ...prev, [eventType]: nextEnabled }));

    try {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) return;

      const { error } = await supabase
        .from("notification_preferences" as any)
        .upsert(
          {
            org_id: orgId,
            user_id: userRes.user.id,
            event_type: eventType,
            channel: "email",
            enabled: nextEnabled,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "org_id,user_id,event_type,channel" }
        );

      if (error) throw error;

      logAuditEvent(orgId, "notification_prefs.updated", "notification_pref", undefined, {
        event_type: eventType,
        enabled: nextEnabled,
      });

      toast.success("Preferences updated", {
        description: `Email notifications for ${eventType} ${nextEnabled ? "enabled" : "disabled"}.`,
      });
    } catch (err: any) {
      // Revert optimistic update on failure
      setPreferences((prev) => ({ ...prev, [eventType]: currentEnabled }));
      toast.error("Failed to save preference", {
        description: err.message || "Please check your network connection.",
      });
    }
  }

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <span className="text-xs font-mono">Loading notification preferences...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border/40 pb-4">
        <div>
          <h2 className="text-lg font-bold font-display text-foreground flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notification Preferences
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure email alert triggers and event notifications for your account in this organization.
          </p>
        </div>
        <Badge variant="outline" className="text-xs font-mono border-primary/20 text-primary">
          Auto-saved
        </Badge>
      </div>

      {CATEGORIES.map((category) => {
        if (category.adminOnly && !isPlatformAdmin) return null;
        const CategoryIcon = category.icon;

        return (
          <Card key={category.name} className="p-5 border-border/60 bg-card shadow-sm space-y-4">
            <div className="flex items-start gap-3 border-b border-border/40 pb-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <CategoryIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold font-display text-foreground flex items-center gap-2">
                  {category.name}
                  {category.adminOnly && (
                    <Badge variant="secondary" className="text-[10px] py-0 font-mono">
                      Platform Admin
                    </Badge>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{category.description}</p>
              </div>
            </div>

            <div className="divide-y divide-border/30">
              {category.events.map((event) => {
                const isChecked = preferences[event.key] ?? true;

                return (
                  <div
                    key={event.key}
                    className="flex items-center justify-between py-3 px-1 hover:bg-muted/20 rounded-lg transition-colors"
                  >
                    <div className="space-y-0.5 pr-4">
                      <Label className="text-xs font-semibold text-foreground cursor-pointer">
                        {event.label}
                      </Label>
                      <p className="text-[11px] text-muted-foreground">{event.description}</p>
                    </div>

                    <Switch
                      checked={isChecked}
                      onCheckedChange={() => togglePreference(event.key, isChecked)}
                      aria-label={`Toggle ${event.label}`}
                    />
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
