import type { ReactNode } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark } from "@/components/Wordmark";
import "@/components/tasks/tasks.css";

/** A group of rail rows, one per real item, under a label block. */
function RailGroup({ rows }: { rows: number }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Skeleton className="h-3 w-20 max-w-full" />
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {Array.from({ length: rows }, (_, index) => (
            <SidebarMenuItem key={index}>
              <SidebarMenuSkeleton showIcon />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The app shell as a picture: the same rail, search slot, header, footer and
 * page area the real layout draws, with every changeable part held back.
 * The whole picture is decorative, so a screen reader hears only the page's
 * own loading label from RouteSkeleton.
 */
export function ShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <SidebarProvider aria-hidden="true">
      <Sidebar collapsible="icon" variant="floating">
        <SidebarHeader className="border-b border-sidebar-border flex-row items-center justify-between">
          <div className="flex items-center px-2 py-2">
            <Wordmark size="sm" />
          </div>
          <div className="rounded-lg border p-2">
            <Skeleton className="size-4" />
          </div>
        </SidebarHeader>
        <div className="px-2 pt-2">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <SidebarContent>
          <RailGroup rows={4} />
          <RailGroup rows={4} />
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex items-center gap-2 p-2">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-24 max-w-full" />
                  <Skeleton className="h-3 w-32 max-w-full" />
                </div>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 sm:px-6 sm:pt-[max(1.5rem,env(safe-area-inset-top))] lg:px-8 lg:pt-8 lg:pb-12">
          {/* AppLayout draws the alerts row above every page. Held here so the
              page does not start higher than the loaded one. */}
          <div className="tk-bell-bar" aria-hidden>
            <Skeleton className="h-8 w-[86px] rounded-[0.625rem]" />
          </div>
          {children}
        </main>
        <div
          aria-hidden
          className="fixed inset-x-0 bottom-0 z-40 min-h-14 border-t border-sidebar-border bg-sidebar/95 pb-safe lg:hidden"
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
