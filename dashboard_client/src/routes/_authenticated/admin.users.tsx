import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, User, Calendar, Mail, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  org_members: {
    role: "owner" | "editor" | "viewer";
    organizations: {
      id: string;
      name: string;
    } | null;
  }[];
};

function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  async function loadUsers() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          id,
          name,
          email,
          created_at,
          org_members(
            role,
            organizations(
              id,
              name
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers((data as unknown as UserRow[]) ?? []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  // Filter users by name or email
  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter((user) => {
      const name = (user.name || "").toLowerCase();
      const email = (user.email || "").toLowerCase();
      const query = searchQuery.toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [users, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between">
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 border-border/80"
          />
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          Showing {filteredUsers.length} users
        </div>
      </div>

      {/* List / Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded-lg bg-muted/40 border border-border/30"
            />
          ))}
        </div>
      ) : filteredUsers.length === 0 ? (
        <Card className="p-8 text-center border-border/60">
          <User className="mx-auto h-8 w-8 text-muted-foreground opacity-60 mb-2" />
          <p className="text-sm font-semibold text-foreground">No users found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase font-mono tracking-wider">
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Organizations & Roles</th>
                  <th className="px-5 py-3">Registered Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredUsers.map((user) => {
                  const initial = (user.name || user.email || "U")
                    .charAt(0)
                    .toUpperCase();

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-primary font-semibold text-sm border border-border/30 shrink-0">
                            {initial}
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">
                              {user.name || "No name set"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {user.org_members && user.org_members.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 max-w-md">
                            {user.org_members.map((member, idx) => {
                              const orgName =
                                member.organizations?.name || "Unknown Org";
                              return (
                                <Badge
                                  key={idx}
                                  variant="outline"
                                  className="text-[11px] px-2 py-0.5 gap-1 text-foreground/80 border-border/80"
                                >
                                  <span>{orgName}</span>
                                  <span className="text-[10px] text-muted-foreground lowercase">
                                    ({member.role})
                                  </span>
                                </Badge>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/60 italic">
                            No organizations joined
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
