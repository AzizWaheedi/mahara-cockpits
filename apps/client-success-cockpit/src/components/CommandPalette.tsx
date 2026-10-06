import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { LINK_GROUPS } from "@/lib/csmLinks";
import { TEMPLATE_TITLES } from "@/lib/csmTemplates";
import { displayLabel } from "@/lib/format";
import { matchScore, onOpenSearch } from "@/lib/search";
import { api } from "../../convex/_generated/api";

/**
 * The search box: Ctrl/Cmd + K, or "/", from any page (Aziz, 2026-10-06).
 *
 * It finds a client, a place inside a client, a page, a key link or an
 * action, typed in English or Arabic, and every result says where it leads.
 * Everything it searches is already in the cockpit, so it needs no new
 * connection and cannot break when another tool does.
 */

/** A snapshot row: untyped by design, like the rest of the CSM screens. */
type Client = any;

type Kind = "Client" | "In client" | "Page" | "Link" | "Action";
type Hit = {
  value: string;
  label: string;
  sub?: string;
  kind: Kind;
  href: string;
  external?: boolean;
  keywords: string[];
};

/** The places in the cockpit, with the names they used to have. */
const PAGES: Hit[] = [
  {
    href: "/dashboard",
    label: "Today",
    sub: "Who needs you, calls, tasks, the day plan",
    old: "start of day task list tasks commitments loose ends day plan",
  },
  {
    href: "/inbox",
    label: "Inbox",
    sub: "WhatsApp waiting on a reply",
    old: "whatsapp messages meetings and messages replies send for review",
  },
  {
    href: "/clients",
    label: "Clients",
    sub: "Every client, onboarding and live",
    old: "clients and touchpoints client list management onboarding",
  },
  {
    href: "/clients?view=results",
    label: "Client results",
    sub: "Every client's numbers for a period",
    old: "client performance numbers leads booked closed report",
  },
  {
    href: "/money?tab=billing",
    label: "Billing",
    sub: "Money · who pays next",
    old: "invoice payment past due late paused card",
  },
  {
    href: "/money?tab=hot",
    label: "Hot list",
    sub: "Money · upsells, reviews, referrals",
    old: "growth upsell referral review four rs",
  },
  {
    href: "/money?tab=projections",
    label: "Projections",
    sub: "Money · this week and the renewal window",
    old: "renewal renewals resell blood stretch gold standard",
  },
  {
    href: "/money?tab=churn",
    label: "Churn",
    sub: "Money · departures and the churn rate",
    old: "churn tracker departure cancelled left lost",
  },
  {
    href: "/money?tab=mine",
    label: "My money",
    sub: "Money · your target and pay",
    old: "pay commission target bonus retention",
  },
  {
    href: "/links",
    label: "Key links",
    sub: "Booking links, forms, SOPs",
    old: "links sops forms booking",
  },
  {
    href: "/eod",
    label: "End of day",
    sub: "File your end of day report",
    old: "eod file my eod end of day report plan tomorrow",
  },
  {
    href: "/backlog",
    label: "Data fixes",
    sub: "Clients missing a sheet, a CRM account or a call",
    old: "data backlog gaps missing sheet",
  },
  {
    href: "/settings",
    label: "Settings",
    sub: "Your account",
    old: "settings account",
  },
].map(p => ({
  value: `page:${p.href}`,
  label: p.label,
  sub: p.sub,
  kind: "Page" as const,
  href: p.href,
  keywords: [p.label, p.sub, p.old],
}));

/** Actions that need a client: picking one asks which client, then opens it there. */
const ACTIONS: { act: string; label: string; ask: string; keywords: string }[] =
  [
    {
      act: "book",
      label: "Book a call",
      ask: "Book a call for which client?",
      keywords:
        "book call booking onboarding blueprint launch check in highlevel calendar",
    },
    {
      act: "message",
      label: "Send a message (SOP template)",
      ask: "Message which client?",
      keywords: `message template whatsapp sop draft ${TEMPLATE_TITLES.join(" ")}`,
    },
    {
      act: "log",
      label: "Log a call or a message",
      ask: "Log it for which client?",
      keywords: "log call summary touchpoint note logged",
    },
    {
      act: "update",
      label: "Update the board",
      ask: "Update which client?",
      keywords: "stage status happiness service dfy dwy board clickup",
    },
    {
      act: "task",
      label: "Add a task or raise a ticket",
      ask: "Add it for which client?",
      keywords: "task ticket team portal request tech creative call centre",
    },
    {
      act: "leave",
      label: "Leave a client for later",
      ask: "Leave which client?",
      keywords: "leave snooze later remind",
    },
  ];

/** Inside one client, by tab. */
const CLIENT_TABS: { tab: string; label: string; keywords: string }[] = [
  {
    tab: "results",
    label: "Results",
    keywords: "results numbers leads booked closed report period print doc",
  },
  {
    tab: "onboarding",
    label: "Onboarding & files",
    keywords:
      "onboarding files forms kickoff recordings contract drive links handover",
  },
  {
    tab: "money",
    label: "Money",
    keywords: "money billing payment invoice renewal upsell pause extension",
  },
];

const LINKS: Hit[] = LINK_GROUPS.flatMap(g =>
  g.rows.map(r => ({
    value: `link:${r.url}|${r.label}`,
    label: r.label,
    sub: r.note ?? g.title,
    kind: "Link" as const,
    href: r.url,
    external: true,
    keywords: [r.label, r.note ?? "", g.title],
  })),
);

const RECENT_KEY = "cs-search-recent";

function readRecent(): Hit[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as Hit[]) : [];
    return Array.isArray(list) ? list.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function remember(hit: Hit): void {
  try {
    const list = [hit, ...readRecent().filter(h => h.value !== hit.value)];
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    // A private window has no storage; recent results are only a convenience.
  }
}

/** True when the key press is someone typing into a field. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? "")
  );
}

function clientHit(c: Client): Hit {
  return {
    value: `client:${c.taskId}`,
    label: String(c.name),
    sub: [displayLabel(c.stage), c.csmAssigned].filter(Boolean).join(" · "),
    kind: "Client",
    href: `/clients/${c.taskId}`,
    keywords: [
      String(c.name),
      String(c.stage ?? ""),
      String(c.bucket ?? ""),
      String(c.csmAssigned ?? ""),
      String(c.taskId ?? ""),
    ],
  };
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickFor, setPickFor] = useState<(typeof ACTIONS)[number] | null>(null);
  const [recent, setRecent] = useState<Hit[]>([]);
  // The client list is read only while the box is on screen, its closing
  // fade included, so a closed box costs the database nothing.
  const [reading, setReading] = useState(false);
  const navigate = useNavigate();
  const snap = useQuery(api.csm.snapshot, reading ? {} : "skip");
  const clients: Client[] = useMemo(() => snap?.clients ?? [], [snap]);

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
    if (next) {
      setRecent(readRecent());
      setSearch("");
      setPickFor(null);
    }
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
  }, [open, show]);

  const go = (hit: Hit) => {
    remember({ ...hit });
    show(false);
    if (hit.external) window.open(hit.href, "_blank", "noopener,noreferrer");
    else navigate(hit.href);
  };

  const typed = search.trim().length > 0;
  const needYou = clients
    .filter(c => c.rank < 40 && c.level !== "green")
    .slice(0, 6);
  const clientHits = (typed ? clients : needYou).map(clientHit);
  const insideHits: Hit[] = typed
    ? clients.flatMap(c =>
        CLIENT_TABS.map(t => ({
          value: `client:${c.taskId}:${t.tab}`,
          label: `${c.name} · ${t.label}`,
          kind: "In client" as const,
          href: `/clients/${c.taskId}?tab=${t.tab}`,
          keywords: [String(c.name), t.label, t.keywords],
        })),
      )
    : [];

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
      description="Find a client, a page, a link or an action"
      className="sm:max-w-xl"
      // cmdk's own scorer wants letters in order, which reads Arabic and
      // typos badly: every typed word has to appear, letter forms folded.
      filter={(_value, typed, keywords) =>
        matchScore((keywords ?? []).join(" "), typed)
      }
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={
          pickFor
            ? "Type the client's name"
            : "Search clients, links, pages and actions"
        }
        onKeyDown={e => {
          if (pickFor && e.key === "Backspace" && !search) setPickFor(null);
        }}
      />
      <CommandList className="max-h-[min(60dvh,420px)]">
        <CommandEmpty>
          {open && snap === undefined
            ? "Reading your clients…"
            : "Nothing matches. Try part of a name, in English or Arabic."}
        </CommandEmpty>

        {pickFor ? (
          <CommandGroup heading={pickFor.ask}>
            <CommandItem
              value="pick:back"
              keywords={["back"]}
              onSelect={() => setPickFor(null)}
              className="text-muted-foreground"
            >
              <ArrowLeft aria-hidden />
              Back to everything
            </CommandItem>
            {clients.map(c => {
              const hit = clientHit(c);
              return row({
                ...hit,
                value: `pick:${c.taskId}`,
                href: `/clients/${c.taskId}?act=${pickFor.act}`,
                sub: pickFor.label,
              });
            })}
          </CommandGroup>
        ) : (
          <>
            {!typed && recent.length ? (
              <CommandGroup heading="Recent">
                {recent.map(h => row({ ...h, value: `recent:${h.value}` }))}
              </CommandGroup>
            ) : null}
            {clientHits.length ? (
              <CommandGroup heading={typed ? "Clients" : "Who needs you"}>
                {clientHits.map(row)}
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Actions">
              {ACTIONS.map(a => (
                <CommandItem
                  key={a.act}
                  value={`act:${a.act}`}
                  keywords={[a.label, a.keywords]}
                  onSelect={() => {
                    setPickFor(a);
                    setSearch("");
                  }}
                  className="items-start gap-3"
                >
                  <span className="min-w-0 flex-1 font-medium">{a.label}</span>
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                    Action
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Pages">{PAGES.map(row)}</CommandGroup>
            {typed ? (
              <>
                <CommandGroup heading="Inside a client">
                  {insideHits.map(row)}
                </CommandGroup>
                <CommandGroup heading="Key links">
                  {LINKS.map(row)}
                </CommandGroup>
              </>
            ) : null}
          </>
        )}
      </CommandList>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>↑ ↓ to move · Enter to open · Esc to close</span>
        <span className="max-sm:hidden">English or العربية</span>
      </div>
    </CommandDialog>
  );
}
