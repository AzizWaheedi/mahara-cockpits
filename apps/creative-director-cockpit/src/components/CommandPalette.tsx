import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { type ClientRosterResult, fetchClientRoster } from "@/lib/clients";
import { LINK_GROUPS } from "@/lib/creativeLinks";
import { matchScore, onOpenSearch } from "@/lib/search";

/**
 * The search box: Ctrl/Cmd + K from any page (Aziz, 2026-10-06; the same box
 * as the other cockpits'). It finds a client (their page, or a tab on it),
 * every page under its old names too, and every key link. Every result says
 * where it leads. The client list is read only while the box is on screen.
 *
 * Not "/": Ideation already uses that key for its own search.
 */

type Kind = "Client" | "In client" | "Page" | "Link";
type Hit = {
  value: string;
  label: string;
  sub?: string;
  kind: Kind;
  href: string;
  external?: boolean;
  keywords: string[];
};

const PAGES: Hit[] = [
  [
    "/dashboard",
    "Today",
    "Late work, checks, scripting, videos, touchpoints",
    "start of day morning checklist",
  ],
  [
    "/dashboard#scripting",
    "Scripting calendar",
    "Today · the sweep, the calendar, Brand DNA and script requests",
    "middle of the day work calendar scripting plan brand dna onboarding",
  ],
  [
    "/dashboard#videos",
    "Video pipeline",
    "Today · every video and who owes what",
    "videos editors pipeline",
  ],
  [
    "/dashboard#touchpoints",
    "Client touchpoints",
    "Today · who is owed a message, with the SOP templates",
    "touchpoints messages templates owed sop",
  ],
  [
    "/review",
    "Send for review",
    "One link for the client",
    "review send cut approve",
  ],
  ["/eod", "End of day", "File your end of day", "eod report"],
  [
    "/meetings",
    "Meetings and messages",
    "Today's meetings, check-ins and WhatsApp threads",
    "meetings messages calendar google whatsapp check-in",
  ],
  ["/clients", "Clients", "Every live client", "clients database list"],
  [
    "/clients?view=worst",
    "Clients, worst first",
    "Clients · each client's onboarding, numbers and touchpoints",
    "profiles worst late stale creative picture",
  ],
  [
    "/what-works",
    "What works",
    "Library · the GCC playbook and winning ads",
    "library playbook winners",
  ],
  [
    "/scripting",
    "Scripting database",
    "Library · proven ads to script from",
    "library scripting proven ads",
  ],
  [
    "/scripts",
    "Scripts we made",
    "Library · every script",
    "library scripts written",
  ],
  [
    "/ideation",
    "Ideation",
    "Library · ideas from the radar",
    "library ideas radar",
  ],
  [
    "/swipe",
    "Swipe file",
    "Library · ads saved from Foreplay",
    "library swipe foreplay",
  ],
  [
    "/social",
    "Social media",
    "The one calendar for every client's posts",
    "social posts instagram calendar",
  ],
  [
    "/funnels",
    "Funnels and forms",
    "Every client funnel",
    "funnels forms landing pages",
  ],
  ["/links", "Key links", "The SOPs and forms", "links sops forms"],
  ["/settings", "Settings", "Your account", "settings account"],
].map(([href, label, sub, old]) => ({
  value: `page:${href}`,
  label,
  sub,
  kind: "Page" as const,
  href,
  keywords: [label, sub, old],
}));

/** A client's page, by tab. */
const CLIENT_TABS: { tab: string; label: string; keywords: string }[] = [
  { tab: "funnel", label: "Their funnel", keywords: "funnel landing form" },
  {
    tab: "flight",
    label: "Work in flight",
    keywords: "in flight work videos scripts",
  },
  {
    tab: "made",
    label: "Everything we made",
    keywords: "made ads videos archive",
  },
  {
    tab: "talk",
    label: "Talk to them",
    keywords: "talk message whatsapp touchpoint",
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

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState(false);
  const navigate = useNavigate();
  const auth = useCockpitAuth();
  const [roster, setRoster] = useState<ClientRosterResult | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRoster(undefined);
    setError(null);
    if (!reading || !auth.client) return;
    let cancelled = false;
    void fetchClientRoster(auth.client, auth.clients).then(
      result => {
        if (!cancelled) setRoster(result);
      },
      reason => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reading, auth.client, auth.clients]);

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
      }
    };
    window.addEventListener("keydown", onKey);
    const off = onOpenSearch(() => show(true));
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [open, show]);

  const clients: { name: string; clientStatus?: string }[] = useMemo(
    () => roster?.clients ?? [],
    [roster],
  );
  const typed = search.trim().length > 0;
  const clientHits: Hit[] = (typed ? clients : clients.slice(0, 6)).map(c => ({
    value: `client:${c.name}`,
    label: c.name,
    sub: c.clientStatus,
    kind: "Client",
    href: `/clients/${encodeURIComponent(c.name)}`,
    keywords: [c.name, c.clientStatus ?? "", "client"],
  }));
  const insideHits: Hit[] = typed
    ? clients.flatMap(c =>
        CLIENT_TABS.map(t => ({
          value: `client:${c.name}:${t.tab}`,
          label: `${c.name} · ${t.label}`,
          kind: "In client" as const,
          href: `/clients/${encodeURIComponent(c.name)}?tab=${t.tab}`,
          keywords: [c.name, t.label, t.keywords],
        })),
      )
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
      description="Find a client, a page or a link"
      className="sm:max-w-xl"
      // Every typed word has to appear; Arabic letter forms count as one.
      filter={(_value, query, keywords) =>
        matchScore((keywords ?? []).join(" "), query)
      }
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search clients, pages and links"
      />
      <CommandList className="max-h-[min(60dvh,420px)]">
        {error ? (
          <p role="alert" className="px-3 py-2 text-sm text-destructive">
            Could not read clients: {error}. Close search and reopen it to try
            again.
          </p>
        ) : null}
        <CommandEmpty>
          {open && roster === undefined && !error
            ? "Reading your clients…"
            : "Nothing matches. Try part of a name, in English or Arabic."}
        </CommandEmpty>
        {clientHits.length ? (
          <CommandGroup heading="Clients">{clientHits.map(row)}</CommandGroup>
        ) : null}
        <CommandGroup heading="Pages">{PAGES.map(row)}</CommandGroup>
        {typed ? (
          <>
            <CommandGroup heading="Inside a client">
              {insideHits.map(row)}
            </CommandGroup>
            <CommandGroup heading="Key links">{LINKS.map(row)}</CommandGroup>
          </>
        ) : null}
      </CommandList>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>↑ ↓ to move · Enter to open · Esc to close</span>
        <span className="max-sm:hidden">English or العربية</span>
      </div>
    </CommandDialog>
  );
}
