import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { COCKPIT_SOP } from "@/lib/cockpits";
import { matchScore, onOpenSearch } from "@/lib/search";
import { useMediaBuyerSnapshot } from "@/lib/useMediaBuyerSnapshot";

/**
 * The search box: Ctrl/Cmd + K, or "/", from any page (Aziz, 2026-10-06; the
 * same box as the client success cockpit's). On Ideation "/" stays with its
 * own search box, so only Ctrl/Cmd + K opens this one there.
 *
 * For a media buyer it finds a client (their page on Ads), a campaign (open
 * on its client's page), and every page; anyone else finds the pages their
 * seat opens. Every result says where it leads. The campaign list is read
 * only while the box is on screen, and only for a media buyer.
 */

type Campaign = {
  campaignName: string;
  clientName?: string;
  accountName?: string;
  spend7d?: number;
  internal?: boolean;
};

type Kind = "Client" | "Campaign" | "Page";
type Hit = {
  value: string;
  label: string;
  sub?: string;
  kind: Kind;
  href: string;
  /** Opens in a new tab: a page outside the cockpit, such as the SOP. */
  external?: boolean;
  keywords: string[];
};

/** The places, with the names they used to have and who may open them. */
const PAGES: (Hit & { role?: "media_buyer" | "admin" | "ceo" })[] = [
  {
    href: "/dashboard",
    label: "Today",
    sub: "Morning sprint, watch list, tasks, touchpoints",
    old: "start of day task list tasks touchpoints clickup change log",
    role: "media_buyer",
  },
  {
    href: "/ads",
    label: "Ads",
    sub: "Every campaign, and each client's page",
    old: "ads management board campaigns accounts",
    role: "media_buyer",
  },
  {
    href: "/playbook",
    label: "What works",
    sub: "Library · the winners and why",
    old: "playbook winners library",
    role: "media_buyer",
  },
  {
    href: "/ideation",
    label: "Ideation",
    sub: "Library · ideas from the radar",
    old: "ideas radar outliers library",
    role: "media_buyer",
  },
  {
    href: "/swipe",
    label: "Swipe file",
    sub: "Library · ads saved from Foreplay",
    old: "swipe foreplay saved ads library",
    role: "media_buyer",
  },
  {
    href: "/eod",
    label: "End of day",
    sub: "File your end of day report",
    old: "eod report plan tomorrow",
    role: "media_buyer",
  },
  {
    href: COCKPIT_SOP.media_buyer,
    label: "How to use this cockpit",
    sub: "The media buyer's SOP, in ClickUp",
    old: "sop guide help how to use the day steps",
    role: "media_buyer",
  },
  {
    href: "/team",
    label: "Team meetings",
    sub: "Agendas and notes",
    old: "meetings team agenda",
  },
  {
    href: "/settings",
    label: "Settings",
    sub: "Your account",
    old: "settings account",
  },
  {
    href: "/admin",
    label: "Admin",
    sub: "People and access",
    old: "admin access members",
    role: "admin",
  },
  {
    href: "/ceo",
    label: "CEO",
    sub: "The company's numbers",
    old: "ceo money delivery",
    role: "ceo",
  },
].map(p => ({
  value: `page:${p.href}`,
  label: p.label,
  sub: p.sub,
  kind: "Page" as const,
  href: p.href,
  external: p.href.startsWith("http"),
  keywords: [p.label, p.sub ?? "", p.old],
  role: p.role as "media_buyer" | "admin" | "ceo" | undefined,
}));

const clientOf = (c: Campaign) =>
  String(c?.clientName ?? c?.accountName ?? "Unassigned");

/** True when the key press is someone typing into a field. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? "")
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const me = useCockpitAuth();
  const buyer = me.roles.includes("media_buyer");
  // The native snapshot enforces the media buyer's seat on the server.
  const result = useMediaBuyerSnapshot(
    reading && buyer ? me.client : null,
    me.clients,
  );
  const snap = reading && buyer ? result.snap : undefined;

  useEffect(() => {
    if (open) {
      setReading(true);
      return;
    }
    const t = setTimeout(() => setReading(false), 400);
    return () => clearTimeout(t);
  }, [open]);

  // Each opening starts clean; closing leaves the list as it was, so the
  // fade does not flash the unfiltered list.
  const show = useCallback((next: boolean) => {
    if (next) setSearch("");
    setOpen(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        show(!open);
      } else if (
        e.key === "/" &&
        !open &&
        pathname !== "/ideation" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !typing(e.target)
      ) {
        e.preventDefault();
        show(true);
      }
    };
    window.addEventListener("keydown", onKey);
    const off = onOpenSearch(() => show(true));
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [open, show, pathname]);

  const campaigns: Campaign[] = useMemo(
    () => ((snap?.campaigns ?? []) as Campaign[]).filter(c => !c.internal),
    [snap],
  );
  /** One row per client, biggest 7-day spend first. */
  const clients = useMemo(() => {
    const by = new Map<string, { name: string; spend: number; n: number }>();
    for (const c of campaigns) {
      const name = clientOf(c);
      const row = by.get(name) ?? { name, spend: 0, n: 0 };
      row.spend += Number(c.spend7d ?? 0);
      row.n += 1;
      by.set(name, row);
    }
    return [...by.values()].sort((a, b) => b.spend - a.spend);
  }, [campaigns]);

  const typed = search.trim().length > 0;
  const pages = PAGES.filter(
    p =>
      !p.role ||
      (p.role === "media_buyer" && buyer) ||
      (p.role === "admin" && me?.isAdmin) ||
      (p.role === "ceo" && me?.isCeo),
  );
  const clientHits: Hit[] = (typed ? clients : clients.slice(0, 6)).map(c => ({
    value: `client:${c.name}`,
    label: c.name,
    sub: `${c.n} campaign${c.n === 1 ? "" : "s"} · $${Math.round(c.spend)} in 7 days`,
    kind: "Client",
    href: `/ads?account=${encodeURIComponent(c.name)}`,
    keywords: [c.name, "client account"],
  }));
  const campaignHits: Hit[] = typed
    ? campaigns.map(c => ({
        value: `campaign:${c.campaignName}`,
        label: String(c.campaignName),
        sub: clientOf(c),
        kind: "Campaign",
        href: `/ads?account=${encodeURIComponent(clientOf(c))}&campaign=${encodeURIComponent(String(c.campaignName))}`,
        keywords: [String(c.campaignName), clientOf(c), "campaign"],
      }))
    : [];

  const go = (hit: Hit) => {
    show(false);
    if (hit.external) window.open(hit.href, "_blank", "noopener,noreferrer");
    else navigate(hit.href);
  };

  const row = (hit: Hit) => (
    <CommandItem
      key={hit.value}
      value={hit.value}
      keywords={hit.keywords}
      onSelect={() => go(hit)}
      className="items-start gap-3"
    >
      <span className="min-w-0 flex-1">
        {/* Arabic names read right to left but line up with the rest. */}
        <span className="block truncate text-left font-medium" dir="auto">
          {hit.label}
        </span>
        {hit.sub ? (
          <span className="block truncate text-xs text-muted-foreground">
            {hit.sub}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {hit.kind}
      </span>
    </CommandItem>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={show}
      title="Search"
      description="Find a client, a campaign or a page"
      className="sm:max-w-xl"
      // Every typed word has to appear; Arabic letter forms count as one.
      filter={(_value, query, keywords) =>
        matchScore((keywords ?? []).join(" "), query)
      }
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={
          buyer
            ? "Search clients, campaigns and pages"
            : "Search the pages you can open"
        }
      />
      <CommandList className="max-h-[min(60dvh,420px)]">
        {buyer && result.error ? (
          <p role="alert" className="px-3 py-2 text-sm text-destructive">
            Could not read campaigns: {result.error.message}. Close search and
            reopen it to try again.
          </p>
        ) : null}
        <CommandEmpty>
          {buyer && open && snap === undefined && !result.error
            ? "Reading your campaigns…"
            : "Nothing matches. Try part of a name, in English or Arabic."}
        </CommandEmpty>
        {clientHits.length ? (
          <CommandGroup heading={typed ? "Clients" : "Biggest spend this week"}>
            {clientHits.map(row)}
          </CommandGroup>
        ) : null}
        {campaignHits.length ? (
          <CommandGroup heading="Campaigns">
            {campaignHits.map(row)}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Pages">{pages.map(row)}</CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>↑ ↓ to move · Enter to open · Esc to close</span>
        <span className="max-sm:hidden">English or العربية</span>
      </div>
    </CommandDialog>
  );
}
