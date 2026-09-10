import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Mic, Mail, ArrowRight, ShieldAlert, CheckCircle2, LogOut } from "lucide-react";

export const Route = createFileRoute("/verify-email")({
  ssr: false,
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  async function checkSession() {
    setLoading(true);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      navigate({ to: "/auth" });
      return;
    }
    if (data.user.email_confirmed_at) {
      navigate({ to: "/" });
      return;
    }
    setEmail(data.user.email || "");
    setLoading(false);
  }

  useEffect(() => {
    checkSession();
  }, []);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;

      toast.success("Verification email resent!");
      setCooldown(60); // 60 seconds cooldown
    } catch (err: any) {
      toast.error(err.message || "Failed to resend verification email");
    } finally {
      setResending(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-muted/10 font-sans">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Checking verification status…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background relative px-4 font-sans overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-terra/5 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        <div className="flex items-center justify-center mb-2">
          <img src="/brand/kzuno_logo_green.png" alt="KZUNO" className="h-12 sm:h-14 w-auto object-contain dark:hidden" />
          <img src="/brand/kzuno_logo_white.png" alt="KZUNO" className="h-12 sm:h-14 w-auto object-contain hidden dark:block" />
        </div>

        <Card className="p-8 border-border/40 shadow-xl shadow-muted/5 bg-card/90 backdrop-blur-md text-center flex flex-col items-center gap-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">Verify your email</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              We have sent a verification link to <strong className="text-foreground">{email}</strong>.
              Please click the link in the email to confirm your account.
            </p>
          </div>
          
          <div className="w-full mt-4 space-y-3">
            <Button
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-md transition-all h-10"
            >
              {resending
                ? "Sending…"
                : cooldown > 0
                ? `Resend Email (${cooldown}s)`
                : "Resend Verification Email"}
            </Button>
            
            <Button
              onClick={handleSignOut}
              variant="outline"
              className="w-full rounded-lg text-sm flex items-center justify-center gap-2 h-10 border-border/60 hover:bg-muted/40"
            >
              <LogOut className="h-4 w-4" />
              <span>Back to Sign In</span>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
