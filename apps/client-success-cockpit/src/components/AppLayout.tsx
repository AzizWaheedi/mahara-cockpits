import { useMutation } from "convex/react";
import { Outlet } from "react-router";
import { api } from "../../convex/_generated/api";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { SyncStrip } from "./SyncStrip";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { Wordmark } from "./Wordmark";

export function AppLayout() {
  const report = useMutation(api.csm.reportIssue);
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Below 1024px a slim bar holds the menu, clear of the phone's
            status bar in the installed app (pt-safe, Aziz 2026-09-21). From
            1024px up the rail is always there, so there is no bar at all;
            the theme lives in the account menu at the foot of the rail. */}
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-2 pt-safe backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2">
            <SidebarTrigger className="size-10" />
            <Wordmark size="sm" />
            <span className="text-sm text-muted-foreground">
              Client success
            </span>
          </div>
        </header>
        <main className="flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12">
          <SyncStrip />
          <RouteErrorBoundary
            report={r =>
              report({
                page: window.location.pathname,
                text: `${r.title}\n${r.detail}`,
              })
            }
          >
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <HermesChat />
      </SidebarInset>
    </SidebarProvider>
  );
}
