import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppHeader } from "@/components/AppHeader";
import { useOrgRole } from "@/hooks/useOrgRole";
import { Users, ArrowLeft, MoreVertical, Check, AlertCircle, Copy, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/orgs/$orgId/members")({
  component: OrgMembersPage,
});

type Profile = {
  id: string;
  name: string | null;
  email: string | null;
};

type OrgMember = {
  user_id: string;
  role: "owner" | "editor" | "viewer";
  profiles: Profile | null;
};

type OrgInvite = {
  id: string;
  org_id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  token: string;
  invited_by: string;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
};

type Org = {
  id: string;
  name: string;
};

const ROLE_PRIORITY = {
  owner: 1,
  editor: 2,
  viewer: 3,
};

function OrgMembersPage() {
  const { orgId } = Route.useParams();
  const { role, isOwner, loading: roleLoading } = useOrgRole(orgId);
  
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Invite states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "editor" | "viewer">("editor");
  const [inviting, setInviting] = useState(false);
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Pending invites state
  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [invitesLoading, setInvitesLoading] = useState(false);

  // Page level AlertDialog removal target
  const [memberToRemove, setMemberToRemove] = useState<OrgMember | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const [orgRes, membersRes, userRes] = await Promise.all([
        supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle(),
        supabase
          .from("org_members")
          .select("user_id, role, profiles(id, email, name)")
          .eq("org_id", orgId),
        supabase.auth.getUser(),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (membersRes.error) throw membersRes.error;
      if (userRes.error) throw userRes.error;

      setOrg(orgRes.data);
      setMembers((membersRes.data as unknown as OrgMember[]) ?? []);
      setCurrentUserId(userRes.data.user?.id ?? null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  async function loadInvites() {
    if (!isOwner) return;
    setInvitesLoading(true);
    try {
      const { data, error } = await supabase
        .from("org_invites")
        .select("*")
        .eq("org_id", orgId)
        .eq("status", "pending");
      if (error) throw error;
      setInvites((data as unknown as OrgInvite[]) ?? []);
    } catch (err: any) {
      console.error("Failed to load invites:", err);
    } finally {
      setInvitesLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (isOwner) {
      loadInvites();
    } else {
      setInvites(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, orgId]);

  const ownerCount = useMemo(() => {
    if (!members) return 0;
    return members.filter((m) => m.role === "owner").length;
  }, [members]);

  const sortedMembers = useMemo(() => {
    if (!members) return [];
    return [...members].sort((a, b) => {
      const pA = ROLE_PRIORITY[a.role] ?? 99;
      const pB = ROLE_PRIORITY[b.role] ?? 99;
      if (pA !== pB) return pA - pB;
      const nameA = a.profiles?.name || a.profiles?.email || "";
      const nameB = b.profiles?.name || b.profiles?.email || "";
      return nameA.localeCompare(nameB);
    });
  }, [members]);

  async function changeRole(targetUserId: string, newRole: OrgMember["role"]) {
    setUpdatingUserId(targetUserId);
    const { error } = await supabase
      .from("org_members")
      .update({ role: newRole })
      .eq("org_id", orgId)
      .eq("user_id", targetUserId);
    setUpdatingUserId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Role updated");
    setMembers((prev) => {
      if (!prev) return null;
      return prev.map((m) =>
        m.user_id === targetUserId ? { ...m, role: newRole } : m
      );
    });
  }

  async function removeMember(targetUserId: string, name: string) {
    setUpdatingUserId(targetUserId);
    const { error } = await supabase
      .from("org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", targetUserId);
    setUpdatingUserId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${name} removed`);
    setMembers((prev) => {
      if (!prev) return null;
      return prev.filter((m) => m.user_id !== targetUserId);
    });
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentUserId) return;
    setInviting(true);
    try {
      const { data, error } = await supabase
        .from("org_invites")
        .insert({
          org_id: orgId,
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          invited_by: currentUserId,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;

      const newInvite = data as unknown as OrgInvite;
      setCreatedInviteToken(newInvite.token);
      toast.success("Invitation created!");
      setInviteEmail("");
      loadInvites();
    } catch (err: any) {
      toast.error(err.message || "Failed to create invitation");
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(inviteId: string, email: string) {
    try {
      const { error } = await supabase
        .from("org_invites")
        .update({ status: "revoked" })
        .eq("id", inviteId);

      if (error) throw error;
      toast.success(`Invitation for ${email} revoked`);
      setInvites((prev) => (prev ? prev.filter((inv) => inv.id !== inviteId) : null));
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke invitation");
    }
  }

  const getInitials = (name?: string | null, email?: string | null) => {
    const key = name || email || "";
    return key ? key.charAt(0).toUpperCase() : "?";
  };

  const getRoleBadgeVariant = (role: OrgMember["role"]) => {
    if (role === "owner") return "default";
    if (role === "editor") return "secondary";
    return "outline";
  };

  const getCapitalizedRole = (role: OrgMember["role"]) => {
    if (role === "owner") return "Owner";
    if (role === "editor") return "Editor";
    return "Viewer";
  };

  if (loading || roleLoading) {
    return (
      <>
        <main className="mx-auto max-w-5xl px-6 py-10">
          <div className="space-y-4">
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
            <div className="mt-8 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-5xl px-6 py-10 font-sans">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="h-9 w-9">
              <Link to="/orgs/$orgId/agents" params={{ orgId }}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Members</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                People with access to this organization.
              </p>
            </div>
          </div>

          {isOwner && (
            <Dialog
              open={inviteOpen}
              onOpenChange={(open) => {
                setInviteOpen(open);
                if (!open) {
                  setCreatedInviteToken(null);
                  setInviteEmail("");
                  setInviteRole("editor");
                }
              }}
            >
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white font-medium rounded-lg">
                  Invite member
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-xl">
                <DialogHeader>
                  <DialogTitle>Invite Member</DialogTitle>
                  <DialogDescription>
                    Send an invitation link to invite someone to join your organization.
                  </DialogDescription>
                </DialogHeader>

                {createdInviteToken ? (
                  <div className="space-y-4 py-4 animate-in fade-in duration-300">
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-950 bg-emerald-50/5 p-4 text-sm text-emerald-800 dark:text-emerald-300 flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500 mt-0.5" />
                      <div>
                        <p className="font-semibold">Invitation generated!</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Share the link below with the user to invite them.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-link">Invite Link</Label>
                      <div className="flex gap-2">
                        <Input
                          id="invite-link"
                          readOnly
                          value={`${window.location.origin}/invite/${createdInviteToken}`}
                          className="rounded-lg bg-muted text-xs select-all"
                        />
                        <Button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/invite/${createdInviteToken}`
                            );
                            setInviteCopied(true);
                            toast.success("Invite link copied!");
                            setTimeout(() => setInviteCopied(false), 2000);
                          }}
                          variant="secondary"
                          className="shrink-0 rounded-lg"
                        >
                          {inviteCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    <DialogFooter>
                      <Button onClick={() => setInviteOpen(false)} className="w-full">
                        Close
                      </Button>
                    </DialogFooter>
                  </div>
                ) : (
                  <form onSubmit={handleInvite} className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email Address</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        required
                        placeholder="collaborator@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="rounded-lg"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="invite-role">Organization Role</Label>
                      <Select
                        value={inviteRole}
                        onValueChange={(val: any) => setInviteRole(val)}
                      >
                        <SelectTrigger id="invite-role" className="w-full rounded-lg">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="editor">Editor (Default)</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <DialogFooter className="pt-2">
                      <Button
                        type="submit"
                        disabled={inviting || !inviteEmail.trim()}
                        className="w-full bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white rounded-lg"
                      >
                        {inviting ? "Generating Link…" : "Generate Invite Link"}
                      </Button>
                    </DialogFooter>
                  </form>
                )}
              </DialogContent>
            </Dialog>
          )}
        </div>

        {loadError ? (
          <Card className="p-8 text-center border-rose-200 dark:border-rose-950 bg-rose-50/5">
            <div className="flex flex-col items-center gap-3">
              <AlertCircle className="h-8 w-8 text-rose-500" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Couldn't load members</h3>
                <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
              </div>
              <Button onClick={loadData} variant="outline" size="sm" className="mt-2">
                Retry
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {sortedMembers.length} member{sortedMembers.length === 1 ? "" : "s"}
              </span>
            </div>

            <Card className="overflow-hidden border-border/60">
              <div className="divide-y divide-border/40">
                {sortedMembers.map((member) => {
                  const isYou = member.user_id === currentUserId;
                  const name = member.profiles?.name;
                  const email = member.profiles?.email;

                  const boldText = name || email || "Unknown User";
                  const subText = name ? email : null;
                  const initials = getInitials(name, email);

                  const disableOwnerActions = isYou && member.role === "owner" && ownerCount === 1;

                  return (
                    <div
                      key={member.user_id}
                      className="flex items-center justify-between p-4 transition-colors hover:bg-muted/10"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 text-sm font-bold">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {boldText}
                            </span>
                            {isYou && (
                              <span className="text-xs text-muted-foreground font-normal">
                                (You)
                              </span>
                            )}
                            {disableOwnerActions && (
                              <div
                                className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium ml-2 border border-amber-200 dark:border-amber-900 bg-amber-500/5 px-2 py-0.5 rounded-full"
                                title="You're the only owner — promote someone else first."
                              >
                                <AlertCircle className="h-3 w-3 shrink-0" />
                                <span>Sole Owner</span>
                              </div>
                            )}
                          </div>
                          {subText && (
                            <p className="text-xs text-muted-foreground mt-0.5">{subText}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {getCapitalizedRole(member.role)}
                        </Badge>

                        {isOwner ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hover:bg-muted/80"
                                disabled={updatingUserId !== null}
                              >
                                <MoreVertical className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1.5">
                                Change role
                              </DropdownMenuLabel>

                              <DropdownMenuItem
                                disabled={member.role === "owner" || updatingUserId !== null}
                                onClick={() => changeRole(member.user_id, "owner")}
                                className="flex items-center justify-between text-xs cursor-pointer"
                              >
                                <span>Make Owner</span>
                                {member.role === "owner" && <Check className="h-3.5 w-3.5 text-violet-600" />}
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                disabled={
                                  member.role === "editor" || disableOwnerActions || updatingUserId !== null
                                }
                                onClick={() => changeRole(member.user_id, "editor")}
                                className="flex items-center justify-between text-xs cursor-pointer"
                                title={
                                  disableOwnerActions
                                    ? "You're the only owner — promote someone else first."
                                    : ""
                                }
                              >
                                <span className="flex items-center gap-1">
                                  Make Editor
                                  {disableOwnerActions && (
                                    <AlertCircle className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </span>
                                {member.role === "editor" && <Check className="h-3.5 w-3.5 text-violet-600" />}
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                disabled={
                                  member.role === "viewer" || disableOwnerActions || updatingUserId !== null
                                }
                                onClick={() => changeRole(member.user_id, "viewer")}
                                className="flex items-center justify-between text-xs cursor-pointer"
                                title={
                                  disableOwnerActions
                                    ? "You're the only owner — promote someone else first."
                                    : ""
                                }
                              >
                                <span className="flex items-center gap-1">
                                  Make Viewer
                                  {disableOwnerActions && (
                                    <AlertCircle className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </span>
                                {member.role === "viewer" && <Check className="h-3.5 w-3.5 text-violet-600" />}
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                disabled={disableOwnerActions || updatingUserId !== null}
                                onClick={() => setMemberToRemove(member)}
                                className="text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/30 text-xs cursor-pointer"
                                title={
                                  disableOwnerActions
                                    ? "You're the only owner — promote someone else first."
                                    : ""
                                }
                              >
                                <span className="flex items-center gap-1">
                                  Remove from organization
                                  {disableOwnerActions && (
                                    <AlertCircle className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <div className="w-8 shrink-0" />
                        )}
                      </div>
                    </div>
                  );
                })}

                {sortedMembers.length === 0 && (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Users className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
                    No members found.
                  </div>
                )}
              </div>
            </Card>

            {/* Pending invites list */}
            {isOwner && invites && invites.length > 0 && (
              <div className="mt-8 space-y-3">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Pending Invites</h2>
                <Card className="overflow-hidden border-border/60">
                  <div className="divide-y divide-border/40">
                    {invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between p-4 transition-colors hover:bg-muted/10"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{inv.email}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Invited on {new Date(inv.created_at).toLocaleDateString()} · Expires {new Date(new Date(inv.created_at).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant={getRoleBadgeVariant(inv.role)}>
                            {getCapitalizedRole(inv.role)}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revokeInvite(inv.id, inv.email)}
                            className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xs rounded-lg px-2.5 h-8 font-medium cursor-pointer"
                          >
                            Revoke
                          </Button>
                          {/* Spacer matching layout */}
                          <div className="w-8 shrink-0" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </>
        )}

        {/* Single Page-level Delete Confirmation AlertDialog */}
        <AlertDialog
          open={!!memberToRemove}
          onOpenChange={(open) => !open && setMemberToRemove(null)}
        >
          <AlertDialogContent className="rounded-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {memberToRemove?.profiles?.name || memberToRemove?.profiles?.email || "this member"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                They'll lose all access to this organization. This can't be undone (you'd need to re-invite them).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (memberToRemove) {
                    removeMember(
                      memberToRemove.user_id,
                      memberToRemove.profiles?.name || memberToRemove.profiles?.email || "User"
                    );
                    setMemberToRemove(null);
                  }
                }}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </>
  );
}
