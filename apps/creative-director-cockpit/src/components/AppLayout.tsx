import { useMutation } from "convex/react";
import { Outlet } from "react-router";
import { api } from "../../convex/_generated/api";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";

export function AppLayout() {
  const queue = useMutation(api.clients.queueAction);
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center justify-between px-4">
          <SidebarTrigger className="md:hidden" />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          <RouteErrorBoundary
            report={r => queue({ kind: "issue", payload: r })}
          >
            <Outlet />
          </RouteErrorBoundary>
        </main>
        <HermesChat />
      </SidebarInset>
    </SidebarProvider>
  );
}
