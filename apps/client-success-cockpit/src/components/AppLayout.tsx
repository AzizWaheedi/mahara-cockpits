import { useCallback } from "react";
import { Outlet } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { SyncStrip } from "./SyncStrip";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";

export function AppLayout() {
  const { client } = useCockpitAuth();

  const handleReport = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: error boundary param
    async (r: any) => {
      if (!client) return;
      try {
        await client.rpc("cockpit_report_issue", {
          p_app: "csm",
          p_page: window.location.pathname,
          p_text: `${r?.title ?? ""}\n${r?.detail ?? ""}`.trim() || "App error",
          p_role: "csm",
        });
      } catch (err) {
        console.error("Failed to report issue:", err);
      }
    },
    [client],
  );

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* pt-safe keeps the menu button below the phone's status bar in the installed app (Aziz, 2026-09-21). */}
        <div className="pt-safe">
          <header className="flex h-12 items-center justify-between px-4">
            <SidebarTrigger className="md:hidden" />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
        </div>
        <main className="flex-1 p-4 lg:p-6">
          <SyncStrip />
          <RouteErrorBoundary report={handleReport}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <HermesChat />
      </SidebarInset>
    </SidebarProvider>
  );
}
