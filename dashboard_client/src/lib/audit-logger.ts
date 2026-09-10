import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  | "member.invited"
  | "member.role_changed"
  | "member.removed"
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "flow.published"
  | "flow.draft_saved"
  | "org.settings_updated"
  | "webhook.created"
  | "webhook.updated"
  | "webhook.deleted"
  | "notification_prefs.updated";

export async function logAuditEvent(
  orgId: string,
  action: AuditAction,
  targetType?: string,
  targetId?: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    const { error } = await supabase.rpc("log_audit_event", {
      p_org_id: orgId,
      p_action: action,
      p_target_type: targetType || null,
      p_target_id: targetId || null,
      p_metadata: metadata || {},
    });

    if (error) {
      // Fallback direct insert if RPC not present in local dev schema
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("audit_log" as any).insert({
        org_id: orgId,
        actor_user_id: userData.user?.id,
        actor_email: userData.user?.email,
        action,
        target_type: targetType,
        target_id: targetId,
        metadata: metadata || {},
      });
    }
  } catch (err) {
    console.warn("Audit log call failed silently:", err);
  }
}
