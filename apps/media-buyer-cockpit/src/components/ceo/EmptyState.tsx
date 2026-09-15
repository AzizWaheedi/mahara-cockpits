import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A quiet empty state inside a card: never a broken axis or a zero. */
export function EmptyState({
  title,
  text,
  icon: Icon = Inbox,
  action,
  compact = false,
  className,
}: {
  /** One short sentence, e.g. "No targets set for September". */
  title: string;
  /** Optional second line that says why or what fills it. */
  text?: ReactNode;
  /** Icon above the title. */
  icon?: LucideIcon;
  /** A button, e.g. the refresh button. */
  action?: ReactNode;
  /** Less vertical room, for small cards and chart bodies. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg text-center",
        compact ? "px-3 py-6" : "px-4 py-10",
        className,
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {text ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {text}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
