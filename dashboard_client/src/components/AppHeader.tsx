import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { Mic, LogOut, ChevronRight, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function AppHeader({
  breadcrumbs,
}: {
  breadcrumbs?: { label: string; to?: string; params?: Record<string, string> }[];
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    if (typeof window !== "undefined") {
      const isDark = document.documentElement.classList.contains("dark");
      setTheme(isDark ? "light" : "dark");
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initial = email ? email.charAt(0).toUpperCase() : "U";

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur-md border-border/40 transition-colors">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3.5 text-sm">
          <Link to="/" className="flex items-center gap-2 group">
            <img src="/images/kzuno_splash_logo.png" alt="KZUNO" className="h-8 w-auto dark:brightness-0 dark:invert transition-transform group-hover:scale-105" />
          </Link>
          {breadcrumbs?.map((b, i) => (
            <span key={i} className="flex items-center gap-2 text-muted-foreground animate-in slide-in-from-left-2 duration-200">
              <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              {b.to ? (
                <Link
                  to={b.to as any}
                  params={b.params as any}
                  className="hover:text-foreground hover:underline underline-offset-4 transition-colors font-medium"
                >
                  {b.label}
                </Link>
              ) : (
                <span className="text-foreground/90 font-medium truncate max-w-[120px] sm:max-w-none">{b.label}</span>
              )}
            </span>
          ))}
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="rounded-full hover:bg-muted transition-colors h-8 w-8 text-muted-foreground hover:text-foreground relative"
            title="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          <Link
            to="/profile"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/60 hover:bg-muted/60 transition-all text-xs font-medium text-muted-foreground hover:text-foreground"
            title={email}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-primary font-semibold text-[10px] border border-border/40">
              {initial}
            </div>
            <span className="hidden sm:inline truncate max-w-[150px]">{email || "Profile"}</span>
          </Link>
          
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={signOut}
            className="rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors h-8 w-8"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
