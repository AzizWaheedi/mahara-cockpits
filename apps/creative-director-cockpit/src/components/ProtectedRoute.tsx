import { Navigate, Outlet, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
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

function AppSkeleton() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 px-2 py-1">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-5 w-16" />
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
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <Skeleton className="size-7 rounded-md" />
          <div className="flex-1" />
        </header>
        <main className="flex-1 p-4 lg:p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
            <Skeleton className="h-32 rounded-lg" />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

/** The Blueprint call's notes popup (520 x 820): no cockpit shell in it. */
export const isNotesPopup = (pathname: string) =>
  /^\/blueprint\/[A-Za-z0-9_-]{1,40}\/notes\/?$/.test(pathname);

/** The popup's one line while the sign-in and the seat are checked. */
export function NotesOpening() {
  return (
    <div
      role="status"
      className="grid min-h-dvh place-content-center bg-background text-sm text-muted-foreground"
    >
      Opening the notes…
    </div>
  );
}

export function ProtectedRoute() {
  const { ready, session, isAuthenticated } = useCockpitAuth();
  const location = useLocation();

  if (!ready) {
    return isNotesPopup(location.pathname) ? <NotesOpening /> : <AppSkeleton />;
  }

  if (!session || !isAuthenticated) {
    const wanted = `${location.pathname}${location.search}`;
    const next = wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  return <Outlet />;
}
