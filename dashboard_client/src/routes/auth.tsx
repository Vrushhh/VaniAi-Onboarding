import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Mic, CheckCircle2, Sparkles, PhoneCall, Eye, EyeOff, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { WaveBackground } from "@/components/WaveBackground";

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
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const toggleTheme = () => {
    if (typeof window !== "undefined") {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "light" : "dark");
    }
  };

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
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 bg-background font-sans relative">
      {/* Theme Toggle Button */}
      <div className="absolute top-5 right-5 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          className="rounded-full bg-background/80 backdrop-blur-md border border-border/60 hover:bg-muted transition-all h-9 w-9 text-foreground shadow-sm hover:scale-105"
          title="Toggle theme"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-emerald-400" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>

      {/* Brand panel - left column */}
      <div className="hidden md:flex md:col-span-6 lg:col-span-7 bg-[#EAF4EE] dark:bg-[#05110c] text-foreground dark:text-white flex-col justify-between p-12 relative overflow-hidden border-r border-border/40 transition-colors duration-300">
        <WaveBackground />
        {/* Glow bubbles */}
        <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[80%] rounded-full bg-primary/10 blur-[120px] animate-gradient-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[80%] h-[80%] rounded-full bg-terra/5 blur-[120px] animate-gradient-pulse" style={{ animationDelay: "-4s" }} />

        {/* Logo/Name */}
        <div className="flex items-center gap-2.5 z-10">
          <img src="/brand/kzuno_logo_green.png" alt="KZUNO" className="h-12 sm:h-14 md:h-16 w-auto object-contain transition-transform duration-200 hover:scale-105 dark:hidden" />
          <img src="/brand/kzuno_logo_white.png" alt="KZUNO" className="h-12 sm:h-14 md:h-16 w-auto object-contain transition-transform duration-200 hover:scale-105 hidden dark:block" />
        </div>

        {/* Hero Section */}
        <div className="my-auto space-y-10 z-10 max-w-lg">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium font-mono">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Next-Gen Voice-AI platform</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold font-display tracking-tight leading-[1.1] bg-gradient-to-b from-neutral-900 to-neutral-700 dark:from-white dark:to-neutral-400 bg-clip-text text-transparent">
              Voice-AI Control Plane for D2C Brands.
            </h1>
            <p className="text-neutral-700 dark:text-neutral-400 text-base leading-relaxed">
              Design, build, and deploy low-latency conversational voice agents that automatically resolve support tickets, recover abandoned checkouts, and boost customer satisfaction.
            </p>
          </div>

          {/* Sound Wave Animation Visualizer */}
          <div className="flex items-center gap-3 h-20 px-6 rounded-2xl bg-white/80 dark:bg-neutral-900/60 backdrop-blur-md border border-primary/20 dark:border-white/10 shadow-md dark:shadow-inner transition-colors duration-300">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 dark:bg-emerald-950/60 border border-primary/20 dark:border-emerald-500/30 text-primary dark:text-emerald-400 shrink-0">
              <PhoneCall className="h-5 w-5 animate-pulse" />
            </div>
            <div className="flex items-end justify-between h-10 pl-3 flex-1 gap-[3px] overflow-hidden">
              {[
                0.5, 0.3, 0.7, 0.4, 0.8, 0.5, 0.9, 0.3, 0.6, 0.8, 0.4, 0.7, 0.9, 0.5, 0.3, 0.8,
                0.6, 0.4, 0.7, 0.5, 0.9, 0.4, 0.8, 0.3, 0.6, 0.7, 0.5, 0.9, 0.4, 0.8, 0.6, 0.3,
                0.7, 0.5, 0.8, 0.4, 0.6, 0.3
              ].map((h, i) => (
                <div
                  key={i}
                  className="w-1 bg-[#0F5B38] dark:bg-[#34D399] rounded-full animate-voice-wave shrink-0 dark:shadow-[0_0_8px_rgba(52,211,153,0.45)]"
                  style={{
                    height: `${h * 100}%`,
                    animationDelay: `${i * 0.05}s`,
                    animationDuration: `${0.7 + (i % 5) * 0.2}s`
                  }}
                />
              ))}
            </div>
          </div>

          {/* Feature List */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 group">
              <div className="mt-0.5 rounded-full p-0.5 text-primary bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Dynamic Flow Orchestration</h4>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">Visually design agent reasoning and branching logics.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 group">
              <div className="mt-0.5 rounded-full p-0.5 text-primary bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Localized Indian Accent Models</h4>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">Engage customers in natural-sounding English and local Indian languages.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs text-neutral-600 dark:text-neutral-500 z-10 font-mono">
          &copy; {new Date().getFullYear()} Kzuno. All rights reserved.
        </div>
      </div>

      {/* Auth panel - right column */}
      <div className="flex col-span-12 md:col-span-6 lg:col-span-5 items-center justify-center p-8 bg-background relative transition-colors duration-300">
        {/* Decorative background shape for mobile screens */}
        <div className="absolute top-10 right-10 w-48 h-48 rounded-full bg-primary/5 blur-3xl md:hidden pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-48 h-48 rounded-full bg-terra/5 blur-3xl md:hidden pointer-events-none" />

        <div className="w-full max-w-md space-y-6">
          {/* Logo on mobile only */}
          <div className="flex items-center justify-center md:hidden mb-4">
            <img src="/brand/kzuno_logo_green.png" alt="KZUNO" className="h-12 sm:h-14 w-auto object-contain dark:hidden" />
            <img src="/brand/kzuno_logo_white.png" alt="KZUNO" className="h-12 sm:h-14 w-auto object-contain hidden dark:block" />
          </div>

          <Card className="p-8 border-border/40 shadow-xl shadow-muted/5 bg-background/90 backdrop-blur-md transition-all duration-300">
            <div className="mb-6">
              <div className="text-[10px] font-mono uppercase tracking-widest font-semibold text-primary">Kzuno Platform</div>
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
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="••••••••"
                        minLength={8}
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
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
