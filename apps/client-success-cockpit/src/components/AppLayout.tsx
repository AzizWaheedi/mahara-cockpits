import { useMutation } from "convex/react";
import { Outlet } from "react-router";
import { api } from "../../convex/_generated/api";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { SyncStrip } from "./SyncStrip";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";

export function AppLayout() {
  const report = useMutation(api.csm.reportIssue);
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
