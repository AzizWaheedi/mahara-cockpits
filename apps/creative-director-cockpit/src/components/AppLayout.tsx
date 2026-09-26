import { useMutation } from "convex/react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import { useLayoutEffect, useRef } from "react";
import { useLocation, useOutlet } from "react-router";
import { api } from "../../convex/_generated/api";
import { AppSidebar } from "./AppSidebar";
import { HermesChat } from "./HermesChat";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { Wordmark } from "./Wordmark";

export function AppLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <SidebarProvider>
        <LayoutContent />
      </SidebarProvider>
    </MotionConfig>
  );
}

function LayoutContent() {
  const queue = useMutation(api.clients.queueAction);
  const outlet = useOutlet();
  const location = useLocation();
  const reduced = useReducedMotion();
  const { open, isMobile } = useSidebar();
  const inset = useRef<HTMLDivElement>(null);
  const previousOpen = useRef(open);
  useLayoutEffect(() => {
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    const element = inset.current;
    if (!element || isMobile || reduced) return;
    const liveTransform = getComputedStyle(element).transform;
    const currentX =
      liveTransform === "none" ? 0 : new DOMMatrixReadOnly(liveTransform).m41;
    element.getAnimations().forEach(animation => {
      animation.cancel();
    });
    element.animate(
      [
        { transform: `translateX(${currentX + (open ? -160 : 160)}px)` },
        { transform: "translateX(0)" },
      ],
      { duration: 150, easing: "cubic-bezier(.4,0,.2,1)" },
    );
  }, [open, isMobile, reduced]);
  return (
    <>
      <AppSidebar />
      <SidebarInset ref={inset}>
        {/* Below 1024px a slim bar holds the menu, clear of the status bar
            in the installed app. From 1024px up the rail is always there,
            so there is no bar at all; the theme lives in the account menu. */}
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-2 pt-safe backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2">
            <SidebarTrigger className="size-10" />
            <Wordmark size="sm" />
            <span className="text-sm text-muted-foreground">
              Creative director
            </span>
          </div>
        </header>
        <main className="flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 lg:pb-12">
          <RouteErrorBoundary
            report={r => queue({ kind: "issue", payload: r })}
          >
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: reduced ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  y: reduced ? 0 : -2,
                  pointerEvents: "none",
                }}
                transition={{
                  duration: reduced ? 0 : 0.16,
                  ease: [0.2, 0.8, 0.2, 1],
                }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </RouteErrorBoundary>
        </main>
        <HermesChat />
      </SidebarInset>
    </>
  );
}
