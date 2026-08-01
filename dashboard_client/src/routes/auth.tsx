import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Mic, CheckCircle2, Sparkles, PhoneCall } from "lucide-react";

type SearchParams = {
  redirect?: string;
};

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    return {
      redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    };
  },
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: search.redirect || "/" });
  },
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectUrl } = Route.useSearch();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        
        if (data.user && !data.session) {
          toast.info("Please verify your email before signing in.");
          navigate({ to: "/verify-email" });
        } else {
          toast.success("Account created. You can sign in now.");
          setMode("signin");
        }
      } else if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        if (data.user && !data.user.email_confirmed_at) {
          navigate({ to: "/verify-email" });
        } else {
          navigate({ to: redirectUrl || "/" });
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth/reset-password",
        });
        if (error) throw error;
        setSentTo(email);
        toast.success("Check your email — we've sent a reset link.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset password";

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 bg-background font-sans">
      {/* Brand panel - left column */}
      <div className="hidden md:flex md:col-span-6 lg:col-span-7 bg-[#05110c] text-white flex-col justify-between p-12 relative overflow-hidden border-r border-border/10">
        {/* Glow bubbles */}
        <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[80%] rounded-full bg-primary/10 blur-[120px] animate-gradient-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[80%] h-[80%] rounded-full bg-terra/5 blur-[120px] animate-gradient-pulse" style={{ animationDelay: "-4s" }} />

        {/* Logo/Name + Back to Homepage */}
        <div className="flex items-center justify-between z-10 w-full">
          <a href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight font-display bg-clip-text text-transparent bg-gradient-to-r from-white to-neutral-300">
              Kzuno
            </span>
          </a>

          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-all shadow-md backdrop-blur-sm"
          >
            ← Back to Homepage
          </a>
        </div>

        {/* Hero Section */}
        <div className="my-auto space-y-10 z-10 max-w-lg">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium font-mono">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Next-Gen Voice-AI platform</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold font-display tracking-tight leading-[1.1] bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-transparent">
              Voice-AI Control Plane for D2C Brands.
            </h1>
            <p className="text-neutral-400 text-base leading-relaxed">
              Design, build, and deploy low-latency conversational voice agents that automatically resolve support tickets, recover abandoned checkouts, and boost customer satisfaction.
            </p>
          </div>

          {/* Sound Wave Animation Visualizer */}
          <div className="flex items-center gap-2 h-20 px-6 rounded-2xl bg-neutral-900/40 backdrop-blur-md border border-white/5 shadow-inner">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-neutral-800 border border-white/5 text-primary shrink-0">
              <PhoneCall className="h-5 w-5 animate-pulse" />
            </div>
            <div className="flex items-end gap-[3px] h-10 px-4 flex-1">
              {[0.6, 0.4, 0.8, 0.5, 0.9, 0.3, 0.7, 0.5, 0.9, 0.4, 0.8, 0.6, 0.4, 0.7, 0.3, 0.8, 0.5, 0.7, 0.4, 0.6].map((h, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary rounded-full animate-voice-wave"
                  style={{
                    height: `${h * 100}%`,
                    animationDelay: `${i * 0.08}s`,
                    animationDuration: `${0.8 + h * 0.8}s`
                  }}
                />
              ))}
            </div>
            <span className="text-xs font-mono text-neutral-400 select-none">12.5ms latency</span>
          </div>

          {/* Feature List */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 group">
              <div className="mt-0.5 rounded-full p-0.5 text-primary bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Dynamic Flow Orchestration</h4>
                <p className="text-xs text-neutral-400 mt-0.5">Visually design agent reasoning and branching logics.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 group">
              <div className="mt-0.5 rounded-full p-0.5 text-primary bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Localized Indian Accent Models</h4>
                <p className="text-xs text-neutral-400 mt-0.5">Engage customers in natural-sounding English and local Indian languages.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs text-neutral-500 z-10 font-mono">
          &copy; {new Date().getFullYear()} Kzuno. All rights reserved.
        </div>
      </div>

      {/* Auth panel - right column */}
      <div className="flex col-span-12 md:col-span-6 lg:col-span-5 items-center justify-center p-8 bg-muted/10 relative">
        {/* Decorative background shape for mobile screens */}
        <div className="absolute top-10 right-10 w-48 h-48 rounded-full bg-primary/5 blur-3xl md:hidden pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-48 h-48 rounded-full bg-terra/5 blur-3xl md:hidden pointer-events-none" />

        <div className="w-full max-w-md space-y-6">
          {/* Logo on mobile only */}
          <div className="flex items-center gap-2.5 md:hidden justify-center mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-md">
              <Mic className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-lg font-bold font-display tracking-tight text-foreground">Kzuno</span>
          </div>

          <Card className="p-8 border-border/40 shadow-xl shadow-muted/5 bg-background/90 backdrop-blur-md transition-all duration-300">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase tracking-widest font-semibold text-primary">Kzuno Platform</div>
                <a href="/" className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                  ← Back to Homepage
                </a>
              </div>
              <h1 className="mt-1.5 text-2xl font-bold font-display tracking-tight">{title}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {mode === "forgot"
                  ? "Enter your email and we'll send you a reset link."
                  : "Voice-AI control plane for D2C teams."}
              </p>
            </div>

            {mode === "forgot" && sentTo ? (
              <div className="space-y-4 animate-in fade-in-50 duration-200">
                <div className="rounded-xl border border-border bg-accent/30 p-4 text-sm text-muted-foreground">
                  We sent a password reset link to <span className="font-semibold text-foreground">{sentTo}</span>.
                  Check your inbox and follow the link to set a new password.
                </div>
                <Button
                  variant="outline"
                  className="w-full rounded-lg hover:bg-muted"
                  onClick={() => {
                    setSentTo(null);
                    setMode("signin");
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4 animate-in fade-in-50 duration-300">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-xs font-medium">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="name@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {mode !== "forgot" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-xs font-medium">Password</Label>
                      {mode === "signin" && (
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline font-medium underline-offset-4"
                          onClick={() => setMode("forgot")}
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <Input
                      id="password"
                      type="password"
                      required
                      placeholder="••••••••"
                      minLength={8}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? (
                    <div className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Processing...</span>
                    </div>
                  ) : mode === "signin" ? (
                    "Sign in"
                  ) : mode === "signup" ? (
                    "Create account"
                  ) : (
                    "Send reset link"
                  )}
                </Button>
              </form>
            )}

            <div className="mt-6 text-center text-sm text-muted-foreground border-t border-border/40 pt-4">
              {mode === "signin" && (
                <>
                  New to Kzuno?{" "}
                  <button
                    className="text-primary hover:underline font-semibold underline-offset-4"
                    onClick={() => setMode("signup")}
                  >
                    Create an account
                  </button>
                </>
              )}
              {mode === "signup" && (
                <>
                  Already have an account?{" "}
                  <button
                    className="text-primary hover:underline font-semibold underline-offset-4"
                    onClick={() => setMode("signin")}
                  >
                    Sign in
                  </button>
                </>
              )}
              {mode === "forgot" && !sentTo && (
                <button
                  className="text-primary hover:underline font-semibold underline-offset-4"
                  onClick={() => setMode("signin")}
                >
                  Back to sign in
                </button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
