import { Search } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { openSearch } from "@/lib/search";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "./CommandPalette";
import { HermesChat } from "./HermesChat";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { SyncStrip } from "./SyncStrip";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { Wordmark } from "./Wordmark";

export function AppLayout() {
  const { client } = useCockpitAuth();

  const handleReport = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: error boundary param
    async (r: any) => {
      if (!client) return;
      try {
        const { error } = await client.rpc("cockpit_submit_issue_report", {
          p_app: "client-success",
          p_page: window.location.pathname,
          p_text: `${r?.title ?? ""}\n${r?.detail ?? ""}`.trim() || "App error",
          p_role: "csm",
        });
        if (error) throw error;
      } catch (err) {
        console.error("Failed to report issue:", err);
      }
    },
    [client],
  );

  // A new page opens at its top; a tab or a period on the same page does not jump.
  const { pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new address is the trigger
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Below 1024px a slim bar holds the menu and the search, clear of the
            phone's status bar in the installed app (pt-safe, Aziz 2026-09-21).
            From 1024px up the rail is always there, so there is no bar at all;
            the theme lives in the account menu at the foot of the rail. */}
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-2 pt-safe backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2">
            <SidebarTrigger className="size-10" />
            <Wordmark size="sm" />
            <span className="text-sm text-muted-foreground">
              Client success
            </span>
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search"
              className="ml-auto inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Search aria-hidden className="size-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12">
          <SyncStrip only="stale" />
          <RouteErrorBoundary report={handleReport}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <CommandPalette />
        <HermesChat />
      </SidebarInset>
    </SidebarProvider>
  );
}
