import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
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
import { Skeleton } from "./ui/skeleton";

/**
 * The app shell drawn with no data, so the first picture of a page is the
 * page it becomes. It mirrors AppLayout: the same rail, top area and main
 * padding. Every shape is decorative and the page's own skeleton goes where
 * the page goes.
 */
export function ShellSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div aria-hidden="true">
      <SidebarProvider>
        <Sidebar collapsible="icon" variant="floating">
          <SidebarHeader className="flex-row items-center justify-between border-b border-sidebar-border">
            <div className="flex items-center px-2 py-2">
              <Wordmark size="sm" />
            </div>
            <Skeleton className="mr-1 size-8 rounded-lg" />
          </SidebarHeader>
          <div className="px-2 pt-2">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {[0, 1, 2, 3, 4].map(row => (
                    <SidebarMenuItem key={`nav-${row}`}>
                      <SidebarMenuSkeleton showIcon />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup className="mt-auto border-t border-sidebar-border">
              <SidebarGroupContent>
                <SidebarMenu>
                  {[0, 1, 2, 3].map(row => (
                    <SidebarMenuItem key={`door-${row}`}>
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
                <div className="flex h-12 items-center gap-2 px-2">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
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
              <Skeleton className="h-4 w-24" />
              <span className="ml-auto">
                <Skeleton className="size-10 rounded-lg" />
              </span>
              <Skeleton className="size-10 rounded-lg" />
            </div>
          </header>
          <main className="flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12">
            <div className="hidden lg:block">
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
