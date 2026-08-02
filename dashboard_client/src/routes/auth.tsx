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

  const [activeLang, setActiveLang] = useState<string>("Hindi");
  const [isPlaying, setIsPlaying] = useState<boolean>(true);

  const langSample: Record<string, { voice: string; text: string }> = {
    Hindi: { voice: "Vaani (AI)", text: "नमस्ते! आपकी EMI कल ड्यू है — reminder के लिए कॉल किया है।" },
    Tamil: { voice: "Vaani (AI)", text: "வணக்கம்! உங்கள் COD ஆர்டர் உறுதிப்படுத்த தயவுசெய்து உறுதிப்படுத்தவும்." },
    Gujarati: { voice: "Vaani (AI)", text: "નમસ્તે! તમારી ઓર્ડર કન્ફર્મેશન માટે KZUNO એજન્ટ કૉલ કરી રહ્યા છે." },
    Marathi: { voice: "Vaani (AI)", text: "नमस्कार! तुमच्या ऑर्डर कन्फर्मेशनसाठी कॉल केला आहे." },
    Bengali: { voice: "Vaani (AI)", text: "নমস্কার! আপনার অর্ডারের তথ্যের জন্য KZUNO থেকে কল করা হয়েছে।" },
    English: { voice: "Vaani (AI)", text: "Hello! Calling from KZUNO to confirm your order details." },
  };

  const title =
    mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset password";

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-12 bg-background font-sans">
      {/* Brand panel - left column */}
      <div className="hidden md:flex md:col-span-6 lg:col-span-7 bg-[#05110c] text-white flex-col justify-between p-10 lg:p-12 relative overflow-hidden border-r border-border/10">
        {/* Glow bubbles */}
        <div className="absolute top-[-20%] left-[-10%] w-[80%] h-[80%] rounded-full bg-primary/15 blur-[120px] animate-gradient-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[80%] h-[80%] rounded-full bg-emerald-500/10 blur-[120px] animate-gradient-pulse" style={{ animationDelay: "-4s" }} />

        {/* Logo/Name + Back to Homepage */}
        <div className="flex items-center justify-between z-10 w-full">
          <a href="/" className="flex items-center gap-3 group hover:opacity-90 transition-opacity">
            <img src="/images/kzuno_splash_logo.png" alt="KZUNO" className="h-9 w-auto brightness-0 invert transition-transform group-hover:scale-105" />
          </a>

          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-all shadow-md backdrop-blur-sm hover:scale-105"
          >
            ← Back to Homepage
          </a>
        </div>

        {/* Hero Section */}
        <div className="my-auto space-y-8 z-10 max-w-xl py-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold font-mono shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Next-Gen Voice-AI Control Plane</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold font-display tracking-tight leading-[1.1] bg-gradient-to-b from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
              The AI Voice Workforce, for Modern Businesses.
            </h1>
            <p className="text-neutral-400 text-sm lg:text-base leading-relaxed">
              Design, build, and deploy low-latency conversational voice agents that automatically resolve support tickets, recover abandoned checkouts, and boost customer satisfaction in 12+ Indian languages.
            </p>
          </div>

          {/* Interactive Voice Player & Waveform Visualizer */}
          <div className="p-5 rounded-2xl bg-neutral-900/60 backdrop-blur-xl border border-white/10 shadow-2xl space-y-4">
            {/* Top Bar: Play Toggle + Waveform + Latency Badge */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/30 transition-all active:scale-95 cursor-pointer shrink-0"
                  title={isPlaying ? "Pause visualizer" : "Play visualizer"}
                >
                  <PhoneCall className={`h-4.5 w-4.5 ${isPlaying ? "animate-pulse" : ""}`} />
                </button>
                <div className="text-left">
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <span>{langSample[activeLang].voice}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  </div>
                  <div className="text-[11px] text-emerald-400/90 font-mono">Live Demo Agent</div>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono shrink-0">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>12.5ms latency</span>
              </div>
            </div>

            {/* Bouncing Audio Bars */}
            <div className="flex items-end gap-[3px] h-9 px-2 bg-neutral-950/50 rounded-lg border border-white/5 py-1">
              {[0.6, 0.4, 0.8, 0.5, 0.9, 0.3, 0.7, 0.5, 0.9, 0.4, 0.8, 0.6, 0.4, 0.7, 0.3, 0.8, 0.5, 0.7, 0.4, 0.6, 0.8, 0.5, 0.9, 0.4, 0.7].map((h, i) => (
                <div
                  key={i}
                  className={`w-full rounded-full transition-all duration-300 ${isPlaying ? "bg-emerald-400 animate-voice-wave" : "bg-neutral-700"}`}
                  style={{
                    height: isPlaying ? `${h * 100}%` : "20%",
                    animationDelay: `${i * 0.06}s`,
                    animationDuration: `${0.7 + h * 0.7}s`
                  }}
                />
              ))}
            </div>

            {/* Simulated Dynamic Transcript Bubble */}
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-200 font-sans transition-all duration-300">
              <span className="font-semibold text-emerald-400">{langSample[activeLang].voice}:</span> "{langSample[activeLang].text}"
            </div>

            {/* Interactive Language Selector Pills */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-neutral-400 mr-1 font-mono uppercase">Languages:</span>
              {Object.keys(langSample).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setActiveLang(lang)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    activeLang === lang
                      ? "bg-primary text-white shadow-md shadow-primary/20 scale-105"
                      : "bg-white/5 hover:bg-white/10 text-neutral-300 border border-white/10"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Feature List */}
          <div className="space-y-3.5 pt-2">
            <div className="flex items-start gap-3.5 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/30 transition-all group hover:translate-x-1">
              <div className="mt-0.5 rounded-lg p-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 group-hover:scale-110 transition-transform shrink-0">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Dynamic Flow Orchestration</h4>
                <p className="text-xs text-neutral-400 mt-0.5">Visually design agent reasoning and branching logics.</p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/30 transition-all group hover:translate-x-1">
              <div className="mt-0.5 rounded-lg p-1.5 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 group-hover:scale-110 transition-transform shrink-0">
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
        <div className="text-xs text-neutral-500 z-10 font-mono flex items-center justify-between">
          <span>&copy; {new Date().getFullYear()} KZUNO. All rights reserved.</span>
          <span className="text-emerald-500/80 font-semibold">24×7 Active Workforce</span>
        </div>
      </div>

      {/* Auth panel - right column */}
      <div className="flex col-span-12 md:col-span-6 lg:col-span-5 items-center justify-center p-8 bg-muted/10 relative">
        {/* Decorative background shape for mobile screens */}
        <div className="absolute top-10 right-10 w-48 h-48 rounded-full bg-primary/5 blur-3xl md:hidden pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-48 h-48 rounded-full bg-terra/5 blur-3xl md:hidden pointer-events-none" />

        <div className="w-full max-w-md space-y-6">
          {/* Logo on mobile only */}
          <div className="flex items-center justify-center md:hidden mb-4">
            <a href="/" className="flex items-center hover:opacity-90 transition-opacity">
              <img src="/images/kzuno_splash_logo.png" alt="KZUNO" className="h-8 w-auto dark:brightness-0 dark:invert" />
            </a>
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
