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
import { ThemeToggle } from "./ThemeToggle";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";

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
        <div className="sticky top-2.5 z-40 px-3 md:px-4 pt-safe">
          <header className="flex h-11 items-center justify-between rounded-full border border-border/60 bg-card/80 px-3.5 shadow-xs backdrop-blur-md transition-all">
            <SidebarTrigger className="md:hidden" />
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
            </div>
          </header>
        </div>
        <main className="flex-1 p-4 lg:p-6">
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
