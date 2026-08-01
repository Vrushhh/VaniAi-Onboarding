import { Outlet } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

const SIDEBAR_STORAGE_KEY = "kz-sidebar-collapsed";

export function AppShell() {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Persist collapse preference
  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  // On mobile, always show the Sheet version
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <AppTopbar
          showMenuButton
          onMenuClick={() => setMobileOpen(true)}
        />
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0 w-[280px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AppSidebar
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      className="grid h-screen bg-background transition-all duration-200 ease-out"
      style={{
        gridTemplateColumns: `${collapsed ? "64px" : "260px"} 1fr`,
        gridTemplateRows: "64px 1fr",
      }}
    >
      {/* Sidebar: spans both rows */}
      <div className="row-span-2 overflow-hidden">
        <AppSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
      </div>

      {/* Topbar: row 1, col 2 */}
      <div className="overflow-hidden">
        <AppTopbar />
      </div>

      {/* Main content: row 2, col 2 */}
      <main className="overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
