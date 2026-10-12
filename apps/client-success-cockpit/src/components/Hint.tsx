import { type ReactNode, useSyncExternalStore } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// One query for the whole page; every hint listens to the same list.
const coarseQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)")
    : null;

function subscribeCoarse(onChange: () => void) {
  coarseQuery?.addEventListener("change", onChange);
  return () => coarseQuery?.removeEventListener("change", onChange);
}

/** True on a touch-first screen (a phone, an iPad), where nothing is ever hovered. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => coarseQuery?.matches ?? false,
    () => false,
  );
}

// The popover surface: a hairline border on the card colour, and a shadow
// only on the light theme (elevation on Deep Space is never a grey shadow).
const SURFACE =
  "max-w-72 rounded-md border bg-popover px-3 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-sm dark:shadow-none";

/**
 * A quiet hint in the popover surface (the app's default tooltip is a teal
 * fill, too loud for this page). With a mouse it is a tooltip on hover and
 * focus. On a touch screen a tooltip never opens, so there the same trigger
 * opens it as a popover on tap, and a tap anywhere else closes it. Carries
 * its own provider so it works anywhere.
 */
export function Hint({
  content,
  children,
  side = "top",
  tap = true,
  className,
}: {
  /** What the hint says; nothing renders the children bare. */
  content: ReactNode;
  /** The trigger; must be a single element that can hold a ref and focus. */
  children: ReactNode;
  /** Preferred side of the trigger. */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Open on tap on a touch screen (default). Pass false when the trigger has
   * its own action (a filter chip, a link): the tap then does only that, and
   * the hint stays a hover tooltip.
   */
  tap?: boolean;
  /** Extra classes for the hint bubble. */
  className?: string;
}) {
  const coarse = useCoarsePointer();
  if (content === null || content === undefined || content === "")
    return <>{children}</>;
  if (coarse && tap)
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          side={side}
          sideOffset={6}
          collisionPadding={12}
          // A hint is read, not typed into: keep the focus (and the page) still.
          onOpenAutoFocus={e => e.preventDefault()}
          className={cn("w-auto", SURFACE, className)}
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          collisionPadding={12}
          className={cn(SURFACE, className)}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
