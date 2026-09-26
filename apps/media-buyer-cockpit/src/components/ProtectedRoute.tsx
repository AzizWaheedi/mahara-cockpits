import { useConvexAuth } from "convex/react";
import { Navigate, Outlet, useLocation } from "react-router";
import { BackendWait } from "./BackendWait";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from "./ui/sidebar";
import { Skeleton } from "./ui/skeleton";

/**
 * What a cold open of the installed app shows while the session is read:
 * the same shell the page then renders, so nothing jumps. The rail from
 * 1024px only, no top bar, the page's own padding, and the tab bar below
 * 1024px.
 */
function AppSkeleton() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="floating">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Skeleton className="h-5 w-24" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="p-2">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <div className="flex items-center gap-3 p-2">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 sm:px-6 sm:pt-[max(1.5rem,env(safe-area-inset-top))] lg:px-8 lg:pt-8 lg:pb-12">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          </div>
        </main>
        <div
          aria-hidden
          className="fixed inset-x-0 bottom-0 z-40 min-h-14 border-t border-sidebar-border bg-sidebar/95 pb-safe lg:hidden"
        />
      </SidebarInset>
    </SidebarProvider>
  );
}

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <BackendWait>
        <AppSkeleton />
      </BackendWait>
    );
  }

  if (!isAuthenticated) {
    // Carry the page asked for, so a hand-off to another cockpit (/go/...)
    // or a deep link resumes right after the one sign-in (Aziz, 2026-09-21).
    const wanted = `${location.pathname}${location.search}`;
    const next = wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  return <Outlet />;
}
