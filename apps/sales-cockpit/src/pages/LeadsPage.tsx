import {
  ChevronLeft,
  ChevronRight,
  Search,
  SearchX,
  UserSearch,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import {
  button,
  EmptyState,
  Failed,
  field,
  StatusChip,
  type Tone,
} from "../components/kit";
import {
  type LeadFilter,
  PAGE,
  useLeads,
  useNow,
  useStages,
} from "../lib/data";
import { ago, classLabel, day, plainStage } from "../lib/format";
import type { Lead } from "../lib/types";

/**
 * Every contact in the sales sub-account, searchable. The search, the
 * filters and the page all live in the address, so Back from a lead comes
 * back to the same list and a filtered list can be sent to someone.
 */

const CLASSES: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "qualified", label: "Qualified" },
  { key: "unqualified", label: "Unqualified" },
  { key: "unprepared", label: "Not ready" },
  { key: "none", label: "No lead tag" },
];

const WINDOWS: { days: number; label: string }[] = [
  { days: 7, label: "Created in the last 7 days" },
  { days: 30, label: "Created in the last 30 days" },
  { days: 90, label: "Created in the last 90 days" },
  { days: 365, label: "Created in the last year" },
  { days: 0, label: "Created any time" },
];

const DEFAULT_DAYS = 90;

const CLASS_TONE: Record<string, Tone> = {
  qualified: "good",
  unqualified: "neutral",
  unprepared: "warning",
};

/** The table's columns: four from sm, all six once there is room for them. */
const GRID =
  "gap-3 sm:grid-cols-[minmax(0,1.4fr)_6.5rem_7.5rem_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.6fr)_6.5rem_7.5rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.7fr)]";

const CHIP_ON = {
  background: "color-mix(in oklch, var(--primary) 14%, transparent)",
  borderColor: "color-mix(in oklch, var(--primary) 55%, transparent)",
};

function readFilter(p: URLSearchParams): LeadFilter {
  const cls = p.get("class") ?? "";
  const d = p.get("days");
  const days =
    d === "all"
      ? 0
      : WINDOWS.some(w => w.days > 0 && String(w.days) === d)
        ? Number(d)
        : DEFAULT_DAYS;
  return {
    q: p.get("q") ?? "",
    leadClass: CLASSES.some(c => c.key === cls) ? cls : "",
    stage: p.get("stage") ?? "",
    days,
    page: Math.max(1, Math.floor(Number(p.get("page")) || 1)) - 1,
  };
}

export default function LeadsPage() {
  const now = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const f = readFilter(params);
  const leads = useLeads(f);
  const stages = useStages();
  const top = useRef<HTMLElement>(null);

  const update = useCallback(
    (patch: Record<string, string | null>, replace = false) =>
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          // A new search or filter starts again from the first page.
          if (!("page" in patch)) next.delete("page");
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  // The box answers every key; the list follows 300 ms after the last one.
  // `sent` is the search the address holds, so a change from outside it
  // (Back, Forward, Clear) can be told apart from this box's own typing.
  const [text, setText] = useState(f.q);
  const sent = useRef(f.q);
  useEffect(() => {
    if (f.q === sent.current) return;
    sent.current = f.q;
    setText(f.q);
  }, [f.q]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const v = text.trim();
      if (v === sent.current) return;
      sent.current = v;
      update({ q: v || null }, true);
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, update]);

  const stageOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of stages.data ?? [])
      if (s.stage_id && !seen.has(s.stage_id))
        seen.set(s.stage_id, plainStage(s.stage_name) || "Unnamed stage");
    const list = [...seen].map(([id, label]) => ({ id, label }));
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [stages.data]);
  const stageKnown = !f.stage || stageOptions.some(o => o.id === f.stage);

  const rows = leads.data ?? [];
  const filtered = Boolean(
    f.q.trim() || f.leadClass || f.stage || f.days !== DEFAULT_DAYS,
  );
  const first = f.page * PAGE + 1;
  const more = rows.length >= PAGE;

  const go = (page: number) => {
    update({ page: page > 0 ? String(page + 1) : null });
    top.current?.scrollIntoView({ block: "start" });
  };
  const clear = () => {
    sent.current = "";
    setText("");
    setParams(new URLSearchParams());
  };

  let shownLine = "";
  if (leads.data)
    shownLine = rows.length
      ? `Showing ${first.toLocaleString("en-US")}–${(first + rows.length - 1).toLocaleString("en-US")} · `
      : "No leads shown · ";

  let body: ReactNode;
  if (leads.error)
    body = <Failed what="The leads" error={leads.error} retry={leads.reload} />;
  else if (!leads.data)
    body = <p className="muted text-sm">Reading the leads…</p>;
  else if (rows.length)
    body = (
      <section
        aria-busy={leads.loading}
        className={`panel min-w-0 overflow-hidden transition-opacity ${leads.loading ? "opacity-60" : ""}`}
      >
        <div
          aria-hidden
          className={`muted hidden border-b hairline px-4 py-2 text-xs font-medium sm:grid ${GRID}`}
        >
          <span>Name</span>
          <span>Created</span>
          <span>Class</span>
          <span>Stage</span>
          <span className="hidden lg:block">Revenue band</span>
          <span className="hidden lg:block">Country</span>
        </div>
        <ul className="divide-y hairline">
          {rows.map(l => (
            <LeadRow key={l.contact_id} lead={l} now={now} />
          ))}
        </ul>
        {f.page > 0 || more ? (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t hairline px-4 py-2.5">
            <span className="muted text-xs">Page {f.page + 1}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={button}
                disabled={f.page === 0}
                onClick={() => go(f.page - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden />
                Previous
              </button>
              <button
                type="button"
                className={button}
                disabled={!more}
                onClick={() => go(f.page + 1)}
              >
                Next
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          </footer>
        ) : null}
      </section>
    );
  else if (f.page > 0)
    body = (
      <section className="panel">
        <EmptyState
          title="No more leads"
          text="The page before this one was the last."
          action={
            <button
              type="button"
              className={button}
              onClick={() => go(f.page - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </button>
          }
        />
      </section>
    );
  else if (filtered)
    body = (
      <section className="panel">
        <EmptyState
          icon={SearchX}
          title="No leads match"
          text="Nothing in the sales sub-account matches this search and these filters. Clear them, or widen when the lead was created."
          action={
            <button type="button" className={button} onClick={clear}>
              Clear search and filters
            </button>
          }
        />
      </section>
    );
  else
    body = (
      <section className="panel">
        <EmptyState
          icon={UserSearch}
          title="No leads created in the last 90 days"
          text="Leads appear here within a few minutes of filling the form."
          action={
            <button
              type="button"
              className={button}
              onClick={() => update({ days: "all" })}
            >
              Show leads from any time
            </button>
          }
        />
      </section>
    );

  return (
    <main
      ref={top}
      className="mx-auto w-full max-w-6xl scroll-mt-14 space-y-5 px-4 py-6 md:scroll-mt-0 md:px-6"
    >
      <header className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
        <p className="muted text-sm">
          {shownLine}Leads are HighLevel contacts in the sales sub-account,
          copied from B2B every three minutes.
        </p>
      </header>

      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row">
          <label className="relative block min-w-0 lg:flex-1">
            <span className="sr-only">Search leads</span>
            <Search
              className="muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <input
              type="search"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Name, email, company or phone"
              className={`${field} pl-9`}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              dir="auto"
            />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:shrink-0">
            <select
              aria-label="Stage"
              value={f.stage}
              onChange={e => update({ stage: e.target.value || null })}
              className={`${field} lg:w-52`}
              title={
                stages.error
                  ? `The stages could not be read: ${stages.error}`
                  : undefined
              }
            >
              <option value="">Any stage</option>
              {stageKnown ? null : (
                <option value={f.stage}>
                  {stages.loading
                    ? "Reading the stages…"
                    : "A stage with no recent leads"}
                </option>
              )}
              {stageOptions.map(o => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Created"
              value={String(f.days)}
              onChange={e => {
                const d = Number(e.target.value);
                update({
                  days: d === DEFAULT_DAYS ? null : d === 0 ? "all" : String(d),
                });
              }}
              className={`${field} lg:w-56`}
            >
              {WINDOWS.map(w => (
                <option key={w.days} value={w.days}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Lead class"
        >
          {CLASSES.map(c => {
            const on = f.leadClass === c.key;
            return (
              <button
                key={c.key || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => update({ class: c.key || null })}
                className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs ${
                  on
                    ? "font-medium"
                    : "muted hairline hover:bg-[color:var(--secondary)]"
                }`}
                style={on ? CHIP_ON : undefined}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {body}
    </main>
  );
}

function ClassChip({ c }: { c: Lead["lead_class"] }) {
  return (
    <StatusChip
      tone={c ? (CLASS_TONE[c] ?? "neutral") : "neutral"}
      label={classLabel(c)}
    />
  );
}

function LeadRow({ lead: l, now }: { lead: Lead; now: number }) {
  const to = `/lead/${encodeURIComponent(l.contact_id)}`;
  const name = l.name?.trim() || "Unnamed lead";
  const company = l.company?.trim() || "";
  const revenue = l.revenue?.trim() || "";
  const country = l.country?.trim() || "";
  const created = l.lead_created_at ? ago(l.lead_created_at, now) : "--";
  const when = day(l.lead_created_at);
  // No stage id means the lead sits in no stage; an id the copy could not
  // name is not known, which is a dash rather than "No stage".
  const named = plainStage(l.stage_name);
  const stage = named || (l.stage_id ? "--" : "No stage");
  const dash = <span className="muted">--</span>;
  return (
    <li>
      {/* Phones: one stacked row. */}
      <Link
        to={to}
        className="flex flex-col gap-1 px-4 py-3 hover:bg-[color:var(--secondary)] sm:hidden"
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium" dir="auto">
            {name}
          </span>
          <ClassChip c={l.lead_class} />
        </span>
        {company || revenue ? (
          // The first part is plain text so dir="auto" takes the line's
          // direction from it (text inside <bdi> is skipped); a long line
          // then loses its tail, never its start.
          <span className="muted truncate text-xs" dir="auto">
            {company || revenue}
            {company && revenue ? (
              <>
                {" · "}
                <bdi>{revenue}</bdi>
              </>
            ) : null}
          </span>
        ) : null}
        <span className="muted text-xs">
          <bdi>{stage}</bdi>
          {" · "}
          <span title={when}>{created}</span>
          {country ? (
            <>
              {" · "}
              <bdi>{country}</bdi>
            </>
          ) : null}
        </span>
      </Link>

      {/* From sm up: a row of the table. Cells keep one left edge so a
          column reads straight down; dir="auto" still orders Arabic words. */}
      <Link
        to={to}
        className={`hidden items-center px-4 py-2.5 hover:bg-[color:var(--secondary)] sm:grid ${GRID}`}
      >
        <span className="min-w-0">
          <span
            className="block truncate text-left text-sm font-medium"
            dir="auto"
          >
            {name}
          </span>
          {company || revenue || country ? (
            <span className="muted block truncate text-left text-xs" dir="auto">
              {company}
              {/* Revenue band and country get their own columns from lg.
                  As on phones, the first part sets the direction. */}
              <span className="lg:hidden">
                {[revenue, country].filter(Boolean).map((part, i) =>
                  company || i ? (
                    <Fragment key={i}>
                      {" · "}
                      <bdi>{part}</bdi>
                    </Fragment>
                  ) : (
                    <Fragment key={i}>{part}</Fragment>
                  ),
                )}
              </span>
            </span>
          ) : null}
        </span>
        <span className="muted truncate text-sm" title={when}>
          {created}
        </span>
        <span className="min-w-0">
          <ClassChip c={l.lead_class} />
        </span>
        <span
          className={`truncate text-left text-sm ${named ? "" : "muted"}`}
          dir="auto"
        >
          {stage}
        </span>
        <span className="hidden truncate text-left text-sm lg:block" dir="auto">
          {revenue || dash}
        </span>
        <span className="hidden truncate text-left text-sm lg:block" dir="auto">
          {country || dash}
        </span>
      </Link>
    </li>
  );
}
