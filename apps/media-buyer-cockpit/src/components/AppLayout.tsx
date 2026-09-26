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
import { MobileTabBar } from "./MobileTabBar";
import { OfflineBanner } from "./OfflineBanner";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { SidebarInset, SidebarProvider, useSidebar } from "./ui/sidebar";

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
  const report = useMutation(api.issues.report);
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
        {/* No top bar: the rail holds the navigation, the theme and the
            account, and below 1024px the tab bar's More opens the same rail,
            so the page starts at the top of the screen. The top padding keeps
            it clear of the status bar in the installed app; the bottom keeps
            it clear of the tab bar. */}
        <main className="flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 sm:px-6 sm:pt-[max(1.5rem,env(safe-area-inset-top))] lg:px-8 lg:pt-8 lg:pb-12">
          <OfflineBanner />
          <RouteErrorBoundary report={r => report(r)}>
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
        <MobileTabBar />
      </SidebarInset>
    </>
  );
}
