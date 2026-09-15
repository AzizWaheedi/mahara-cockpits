import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A quiet tooltip in the popover surface (the app's default tooltip is a teal
 * fill, too loud for this page). Carries its own provider so it works anywhere.
 */
export function Hint({
  content,
  children,
  side = "top",
  className,
}: {
  /** What the tooltip says; nothing renders the children bare. */
  content: ReactNode;
  /** The trigger; must be a single element that can hold a ref and focus. */
  children: ReactNode;
  /** Preferred side of the trigger. */
  side?: "top" | "bottom" | "left" | "right";
  /** Extra classes for the tooltip bubble. */
  className?: string;
}) {
  if (content === null || content === undefined || content === "")
    return <>{children}</>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className={cn(
            "max-w-72 border bg-popover text-popover-foreground shadow-md",
            className,
          )}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
