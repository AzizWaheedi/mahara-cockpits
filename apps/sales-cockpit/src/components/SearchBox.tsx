import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { COCKPIT_SOP } from "../lib/cockpits";
import { useLeadSearch } from "../lib/data";
import { PAGES } from "../lib/pages";
import { matchScore, onOpenSearch } from "../lib/search";
import { Dialog } from "./ui/dialog";

/**
 * The search box: Ctrl/Cmd + K from any page (Aziz, 2026-10-06; the same box
 * as the other cockpits'). It finds a lead by name, phone, email or company,
 * and every page by its name or the words people use for it. Every result
 * says where it leads. Leads are read only while the box is open, once the
 * typing pauses.
 *
 * Not on the pitch deck: the deck covers the screen and answers Escape by
 * leaving, so a box over it would end the pitch.
 */

type Kind = "Lead" | "Page";
type Hit = {
  key: string;
  label: string;
  sub?: string;
  kind: Kind;
  href: string;
  /** Opens in a new tab: the SOP lives in ClickUp. */
  external?: boolean;
};

const SOP: Hit & { text: string } = {
  key: "page:sop",
  label: "How to use this cockpit",
  sub: "The sales SOP, in ClickUp: the setter's and the closer's day",
  kind: "Page",
  href: COCKPIT_SOP.sales,
  external: true,
  text: "how to use this cockpit sop guide help setter closer day steps",
};

const OWED: Hit & { text: string } = {
  key: "page:owed",
  label: "Calls owed a mark",
  sub: "Calendar · the calls still waiting for their outcome",
  kind: "Page",
  href: "/calendar?view=owed",
  text: "calls owed a mark outcome calendar",
};

export function SearchBox({ isManager }: { isManager: boolean }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const onDeck = pathname === "/deck";
  useEffect(() => {
    if (onDeck) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    const off = onOpenSearch(() => setOpen(true));
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [onDeck]);
  return (
    <Dialog open={open && !onDeck} onOpenChange={setOpen}>
      {/* Mounted only while open, so leads are read only then. */}
      {open && !onDeck ? (
        <Results isManager={isManager} onClose={() => setOpen(false)} />
      ) : null}
    </Dialog>
  );
}

/** The typed words, once the typing has paused for a moment. */
function useSettled(value: string, ms = 250): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function Results({
  isManager,
  onClose,
}: {
  isManager: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const term = useSettled(q.trim());
  const found = useLeadSearch(term);
  const typed = q.trim().length > 0;

  const hits = useMemo(() => {
    const pages = [
      ...PAGES.filter(p => !p.managerOnly || isManager).map(p => ({
        key: `page:${p.to}`,
        label: p.label,
        kind: "Page" as const,
        href: p.to,
        text: `${p.label} ${p.words ?? ""}`,
      })),
      OWED,
      SOP,
    ];
    if (!typed) return pages as Hit[];
    const leads: Hit[] =
      term.length >= 2
        ? (found.data ?? []).map(l => ({
            key: `lead:${l.contact_id}`,
            label: l.name || l.phone || l.email || "A lead",
            sub: [l.company, l.stage_name ?? l.lead_stage, l.phone]
              .filter(Boolean)
              .join(" · "),
            kind: "Lead",
            href: `/lead/${l.contact_id}`,
          }))
        : [];
    const pageHits = pages
      .map(p => ({ p, s: matchScore(p.text, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.p as Hit);
    return [...leads, ...pageHits];
  }, [q, term, typed, found.data, isManager]);

  // A new search starts at the top of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: typing is the trigger
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-at="${at}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const go = (h: Hit) => {
    onClose();
    if (h.external) window.open(h.href, "_blank", "noopener,noreferrer");
    else navigate(h.href);
  };

  const waiting = typed && (term !== q.trim() || found.loading);
  const empty = waiting
    ? "Looking for leads…"
    : "No lead or page matches. Try part of a name, a phone number or an email.";

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xl">
      <div className="flex items-center gap-2 border-b px-3">
        <Search
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.8}
        />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt(i => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt(i => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && hits[at]) {
              e.preventDefault();
              go(hits[at]);
            }
          }}
          placeholder="Search leads and pages"
          aria-label="Search leads and pages"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={hits[at] ? `search-${at}` : undefined}
          dir="auto"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div
        id="search-results"
        ref={list}
        role="listbox"
        aria-label="Results"
        className="max-h-[min(60dvh,420px)] overflow-y-auto p-1"
      >
        {found.error ? (
          <p role="alert" className="px-3 py-2 text-sm text-destructive">
            The lead search did not answer ({found.error}). Close search and
            reopen it to try again.
          </p>
        ) : null}
        {hits.length === 0 && !found.error ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          hits.map((h, i) => (
            <div
              key={h.key}
              id={`search-${i}`}
              data-at={i}
              role="option"
              aria-selected={i === at}
              onMouseEnter={() => setAt(i)}
              onMouseDown={e => {
                e.preventDefault();
                go(h);
              }}
              className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 ${
                i === at ? "bg-muted" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-left text-sm font-medium"
                  dir="auto"
                >
                  {h.label}
                </span>
                {h.sub ? (
                  <span
                    className="block truncate text-xs text-muted-foreground"
                    dir="auto"
                  >
                    {h.sub}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {h.kind}
              </span>
            </div>
          ))
        )}
        {typed && hits.length > 0 && waiting ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Looking for leads…
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>↑ ↓ to move · Enter to open · Esc to close</span>
        <span className="max-sm:hidden">English or العربية</span>
      </div>
    </div>
  );
}
