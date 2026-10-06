import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { COCKPIT_SOP } from "../lib/cockpits";
import { useAllAssets, useJobs } from "../lib/data";
import { portalUrl } from "../lib/portal";
import { matchScore, onOpenSearch } from "../lib/search";
import { Dialog } from "./ui/dialog";

/**
 * The search box: Ctrl/Cmd + K from any page (Aziz, 2026-10-06; the same box
 * as the other cockpits', without their library). It finds a job by its
 * client, its title or its editor, a clip across every job by its file name
 * or what is said in it, and every page. Every result says where it leads.
 * The clips are read only while the box is open.
 *
 * Not "/": Ideation already uses that key for its own search.
 */

type Kind = "Job" | "Clip" | "Page";
type Hit = {
  key: string;
  label: string;
  sub?: string;
  kind: Kind;
  href: string;
  external?: boolean;
  /** Opens beside the desk instead of leaving it. */
  newTab?: boolean;
  text: string;
};

const PAGES: Hit[] = [
  ["/", "Jobs", "Every job on the Video Pipeline", "home today ready waiting"],
  [
    "/?view=board",
    "Jobs by stage",
    "The board, one column per status",
    "pipeline board kanban stage status",
  ],
  [
    "/videos",
    "Footage",
    "Every clip, across all jobs",
    "videos clips files transcripts",
  ],
  [
    "/send-review",
    "Send for review",
    "One link for the client, several cuts",
    "review link client approve",
  ],
  [
    "/winners",
    "What works",
    "Library · winning ads",
    "library winners best ads",
  ],
  [
    "/ideas",
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
    "/meetings",
    "Meetings",
    "Recordings, and the team schedule",
    "fathom recordings calls agenda",
  ],
  ["/eod", "End of day", "File your end of day", "eod report"],
].map(([href, label, sub, words]) => ({
  key: `page:${href}`,
  label,
  sub,
  kind: "Page" as const,
  href,
  text: `${label} ${sub} ${words}`,
}));

export function SearchBox() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
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
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Mounted only while open, so the clips are read only then. */}
      {open ? <Results onClose={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function Results({ onClose }: { onClose: () => void }) {
  const jobs = useJobs();
  const assets = useAllAssets();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => {
    const typed = q.trim().length > 0;
    const live = (jobs.data ?? []).filter(j => j.state !== "gone");
    const jobHits: Hit[] = live.map(j => ({
      key: `job:${j.task_id}`,
      label: j.name ?? j.client ?? "A job",
      sub: [j.client, j.status, j.editor].filter(Boolean).join(" · "),
      kind: "Job",
      href: `/job/${j.task_id}`,
      text: [j.name, j.client, ...(j.clients ?? []), j.editor, j.status]
        .filter(Boolean)
        .join(" "),
    }));
    const clientOf = new Map(live.map(j => [j.task_id, j.client ?? ""]));
    const clipHits: Hit[] = typed
      ? (assets.data ?? [])
          .filter(a => !a.error)
          .map(a => ({
            key: `clip:${a.id}`,
            label: a.name ?? "A clip",
            sub: [clientOf.get(a.task_id), a.transcript?.slice(0, 80)]
              .filter(Boolean)
              .join(" · "),
            kind: "Clip" as const,
            href: `/job/${a.task_id}`,
            text: [a.name, clientOf.get(a.task_id), a.transcript]
              .filter(Boolean)
              .join(" "),
          }))
      : [];
    const team: Hit = {
      key: "page:team",
      label: "Team meetings",
      sub: "The team's schedule and agendas, in the portal",
      kind: "Page",
      href: `${portalUrl()}/team`,
      external: true,
      text: "team meetings schedule agenda portal",
    };
    const sop: Hit = {
      key: "page:sop",
      label: "How to use this desk",
      sub: "The editors' SOP, in ClickUp",
      kind: "Page",
      href: COCKPIT_SOP.editor,
      external: true,
      newTab: true,
      text: "how to use this desk sop guide help the day steps",
    };
    const all = [...jobHits, ...clipHits, ...PAGES, team, sop];
    if (!typed) return [...jobHits.slice(0, 6), ...PAGES, team, sop];
    return all
      .map(h => ({ h, s: matchScore(h.text, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map(x => x.h);
  }, [q, jobs.data, assets.data]);

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
    if (h.newTab) window.open(h.href, "_blank", "noopener,noreferrer");
    else if (h.external) window.location.href = h.href;
    else navigate(h.href);
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg,16px)] border bg-card shadow-xl">
      <div className="flex items-center gap-2 border-b px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
          placeholder="Search jobs, clips and pages"
          aria-label="Search jobs, clips and pages"
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
        {hits.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {jobs.loading || assets.loading
              ? "Reading the jobs and clips…"
              : "Nothing matches. Try part of a name, in English or Arabic."}
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
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        <span>↑ ↓ to move · Enter to open · Esc to close</span>
        <span className="max-sm:hidden">English or العربية</span>
      </div>
    </div>
  );
}
