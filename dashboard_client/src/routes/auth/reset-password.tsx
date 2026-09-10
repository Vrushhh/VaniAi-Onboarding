import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Mic, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/auth/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Supabase JS auto-parses the recovery hash and fires PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setStatus("ready");
      }
    });

    // Fallback: if a session already exists on mount (hash already processed).
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setStatus((s) => (s === "checking" ? "ready" : s));
      else {
        // Give onAuthStateChange a beat to fire from the hash, then mark invalid.
        setTimeout(() => {
          if (!cancelled) setStatus((s) => (s === "checking" ? "invalid" : s));
        }, 1500);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated — you're signed in");
      navigate({ to: "/orgs" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/10 relative px-4 font-sans">
      {/* Decorative background gradients */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/5 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand header */}
        <div className="flex items-center justify-center mb-2">
          <img src="/brand/kzuno_logo_green.png" alt="KZUNO" className="h-12 sm:h-14 w-auto object-contain dark:hidden" />
          <img src="/brand/kzuno_logo_white.png" alt="KZUNO" className="h-12 sm:h-14 w-auto object-contain hidden dark:block" />
        </div>

        <Card className="p-8 border-border/40 shadow-xl shadow-muted/10 bg-background/90 backdrop-blur-md">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest font-semibold text-violet-600 dark:text-violet-400">Security</div>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight">Set a new password</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Please enter your new password below.
            </p>
          </div>

          {status === "checking" && (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
              <p className="text-sm text-muted-foreground">Verifying your reset link…</p>
            </div>
          )}

          {status === "invalid" && (
            <div className="space-y-4 animate-in fade-in-50 duration-200">
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive dark:text-red-400">
                This reset link has expired or has already been used.
              </div>
              <Button asChild className="w-full rounded-lg">
                <Link to="/auth" className="flex items-center justify-center gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  <span>Request a new link</span>
                </Link>
              </Button>
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={onSubmit} className="space-y-4 animate-in fade-in-50 duration-300">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border-border/80 focus-visible:ring-violet-500 focus-visible:border-violet-500 transition-colors"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  placeholder="••••••••"
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="rounded-lg border-border/80 focus-visible:ring-violet-500 focus-visible:border-violet-500 transition-colors"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white font-medium shadow-md shadow-violet-500/10 hover:shadow-lg hover:shadow-violet-500/20 active:scale-[0.98] transition-all"
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Updating...</span>
                  </div>
                ) : (
                  "Set new password"
                )}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
