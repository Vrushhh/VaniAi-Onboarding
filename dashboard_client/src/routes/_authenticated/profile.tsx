import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Sun, Moon, Monitor } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [userId, setUserId] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        navigate({ to: "/auth" });
        return;
      }
      const u = userData.user;
      if (cancelled) return;
      setUserId(u.id);
      setEmail(u.email ?? "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", u.id)
        .maybeSingle();
      if (cancelled) return;
      setName(profile?.name ?? "");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSavingName(true);
    try {
      // Upsert in case the profile row wasn't backfilled.
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: userId, name: name.trim() || null }, { onConflict: "id" });
      if (error) throw error;
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSavingName(false);
    }
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <main className="mx-auto max-w-2xl px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-2xl font-semibold">
            {initial}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Your profile</h1>
            <p className="text-sm text-muted-foreground">
              Manage your personal details and password.
            </p>
          </div>
        </div>

        <Card className="p-6">
          <h2 className="text-lg font-semibold">Personal details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is how your name appears across Kzuno.
          </p>
          <form onSubmit={onSaveName} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={name}
                disabled={loading}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled className="opacity-70" />
              <p className="text-xs text-muted-foreground">
                To change your email, contact support.
              </p>
            </div>
            <div>
              <Button type="submit" disabled={savingName || loading}>
                {savingName ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use at least 8 characters. You'll stay signed in on this device.
          </p>
          <form onSubmit={onChangePassword} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <Input
                id="new"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div>
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? "Updating…" : "Update password"}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Appearance</h2>
            <p className="text-sm text-muted-foreground">
              Choose how Kzuno looks on this account.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-4">
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(val) => {
                if (val) setTheme(val as any);
              }}
              className="justify-start bg-muted p-1 rounded-lg w-fit"
            >
              <ToggleGroupItem value="light" className="gap-2 px-4 rounded-md">
                <Sun className="h-4 w-4" />
                <span>Light</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="gap-2 px-4 rounded-md">
                <Moon className="h-4 w-4" />
                <span>Dark</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="system" className="gap-2 px-4 rounded-md">
                <Monitor className="h-4 w-4" />
                <span>System</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              System follows your device setting.
            </p>
          </div>
        </Card>
      </main>
    </div>
  );
}
