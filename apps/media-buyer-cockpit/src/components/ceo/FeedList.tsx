import {
  Activity,
  Bot,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  DollarSign,
  Gavel,
  type LucideIcon,
  MapPin,
  Megaphone,
  MessageSquare,
  Phone,
  Rocket,
  ToggleRight,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FeedItem } from "../../../convex/ceo/payloads";
import { EmptyState } from "./EmptyState";
import { dateTime, relative } from "./format";
import { Hint } from "./Hint";

// Kinds are free text from the backend, so match on words rather than exact values.
const KIND_ICONS: [RegExp, LucideIcon][] = [
  [/hermes|bot|agent|auto/i, Bot],
  [/budget|spend/i, DollarSign],
  [/payment|cash|deal|refund|invoice|money/i, Wallet],
  [/toggle|pause|status|board/i, ToggleRight],
  [/launch|build/i, Rocket],
  [/decision|verdict|rule/i, Gavel],
  [/eod|checklist|plan/i, ClipboardCheck],
  [/call|dial|maqsam/i, Phone],
  [/meeting|booking|calendar|appointment/i, CalendarCheck],
  [/city|cities|geo/i, MapPin],
  [/\bads?\b|creative|campaign/i, Megaphone],
  [/client|stage/i, Building2],
  [/comment|update|note|message|whatsapp/i, MessageSquare],
];

/** The icon for a feed kind; unknown kinds get a neutral activity icon. */
export function feedKindIcon(kind: string): LucideIcon {
  for (const [re, icon] of KIND_ICONS) if (re.test(kind)) return icon;
  return Activity;
}

/** Newest-first activity: kind icon, the text, who did it, and when. */
export function FeedList({
  items,
  now,
  limit,
  kindIcon = feedKindIcon,
  emptyText = "No activity yet today.",
  className,
}: {
  /** Feed items, newest first. */
  items: FeedItem[];
  /** Current time for "today" and relative times (useNow()). */
  now: number;
  /** Show only the first N items. */
  limit?: number;
  /** Icon for a kind, to override the built-in word matching. */
  kindIcon?: (kind: string) => LucideIcon;
  /** Text when there are no items. */
  emptyText?: string;
  className?: string;
}) {
  const rows = limit ? items.slice(0, limit) : items;
  if (rows.length === 0)
    return <EmptyState icon={Activity} title={emptyText} compact />;
  return (
    <ol className={cn("min-w-0", className)}>
      {rows.map((item, i) => {
        const Icon = kindIcon(item.kind);
        const who = item.actor ?? item.role ?? "Unattributed";
        const role = item.actor && item.role ? item.role : null;
        return (
          <li
            key={`${item.at}-${i}`}
            className="flex min-w-0 gap-3 border-b border-[color:var(--ceo-grid)] py-2.5 first:pt-0 last:border-0 last:pb-0"
          >
            <span
              className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              title={item.kind}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="sr-only">{item.kind}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] leading-5 text-foreground">
                {item.text}
              </p>
              <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">{who}</span>
                {role ? <span>{role}</span> : null}
                {item.subject ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="min-w-0 truncate">{item.subject}</span>
                  </>
                ) : null}
              </p>
            </div>
            <Hint content={relative(item.at, now)} side="left">
              <time
                dateTime={new Date(item.at).toISOString()}
                className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-muted-foreground tabular-nums"
              >
                {dateTime(item.at, now)}
              </time>
            </Hint>
          </li>
        );
      })}
    </ol>
  );
}
