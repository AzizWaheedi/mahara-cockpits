import { Outlet } from "react-router";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { SyncStrip } from "./SyncStrip";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center px-4 md:hidden">
          <SidebarTrigger />
        </header>
        <main className="flex-1 p-4 lg:p-6">
          <SyncStrip />
          <Outlet />
        </main>
        <HermesChat />
      </SidebarInset>
    </SidebarProvider>
  );
}
