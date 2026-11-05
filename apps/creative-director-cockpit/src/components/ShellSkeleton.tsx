import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from "./ui/sidebar";
import { Wordmark } from "./Wordmark";

/** The six places in the rail, then the four rows under the line. */
const NAV_ROWS = 6;
const PORTAL_ROWS = 4;

/**
 * The cockpit shell as a picture: the same rail, header, content wrapper and
 * phone bar as AppLayout, with the page's own skeleton where the page draws.
 */
export function ShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <SidebarProvider aria-hidden="true">
      <Sidebar collapsible="icon" variant="floating">
        <SidebarHeader className="border-b border-sidebar-border flex-row items-center justify-between">
          <div className="flex items-center px-2 py-2">
            <Wordmark size="sm" />
          </div>
          <Skeleton className="size-8 rounded-lg" />
        </SidebarHeader>
        <div className="px-2 pt-2">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {Array.from({ length: NAV_ROWS }, (_, i) => (
                  <SidebarMenuItem key={`nav-${i}`}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="mt-auto border-t border-sidebar-border">
            <SidebarGroupContent>
              <SidebarMenu>
                {Array.from({ length: PORTAL_ROWS }, (_, i) => (
                  <SidebarMenuItem key={`portal-${i}`}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex h-12 items-center gap-2 rounded-md p-2">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-col items-start gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-2 pt-safe backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2">
            <Skeleton className="size-10 rounded-lg" />
            <Wordmark size="sm" />
            <Skeleton className="h-4 w-28" />
            <span className="ml-auto">
              <Skeleton className="size-10 rounded-lg" />
            </span>
            <Skeleton className="size-10 rounded-lg" />
          </div>
        </header>
        <div className="flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12">
          <div className="hidden lg:block">
            <Skeleton className="h-8 w-48 rounded-lg" />
          </div>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
