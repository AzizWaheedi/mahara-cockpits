import { Outlet } from "react-router";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";

export function AppLayout() {
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
          <Outlet />
        </main>
        <HermesChat />
      </SidebarInset>
    </SidebarProvider>
  );
}
