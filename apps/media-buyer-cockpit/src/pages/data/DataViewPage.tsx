import { Download, RefreshCw, Search } from "lucide-react";
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router";
import { toast as notify } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { CeoTabs, panelId, tabId } from "@/components/ceo/CeoTabs";
import { FilterChips } from "@/components/ceo/FilterChips";
import type { StatusTone } from "@/components/ceo/StatusChip";
import { CompareTab } from "@/components/data/LineageStrip";
import { RecordDrawer } from "@/components/data/RecordDrawer";
import {
  ALL_COUNT,
  notSyncedCount,
  SheetGrid,
} from "@/components/data/SheetGrid";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  APPT_ALL,
  type ApptRow,
  fmtDayString,
  fmtN,
  type Kind,
  LEAD_ALL,
  type LeadRow,
  ms,
  type PerClient,
  rel,
  type Summary,
  toCsv,
  ymd,
} from "@/lib/dataView";
import {
  fetchExport,
  prefetchRows,
  type RowQuery,
  useRows,
  useSummary,
} from "@/lib/dataViewClient";
import { useNow } from "@/lib/useNow";
// The CEO kit (tabs, chips, status colours) reads its tokens from .ceo-root.
import "@/components/ceo/ceo.css";
import "./dataView.css";

type Tab = Kind | "compare";
type Filter = {
  key: string;
  label: string;
  tone?: "warn" | "bad" | "info";
  count: (s: Summary) => number;
};
/** The cockpit's status colours for the filter dots (StatusChip). */
const TONE: Record<NonNullable<Filter["tone"]>, StatusTone> = {
  warn: "warning",
  bad: "critical",
  info: "neutral",
};

/*
 * Filters, named the way you would ask the question. Counts come from the
 * summary; a chip with nothing behind it hides (FilterChips).
 */
const FILTERS: Record<Kind, Filter[]> = {
  leads: [
    { key: "all", label: "All leads", count: s => s.leads.all },
    { key: "meta", label: "From Facebook ads", count: s => s.leads.meta },
    { key: "other", label: "From other channels", count: s => s.leads.other },
    { key: "booked", label: "Booked a meeting", count: s => s.leads.booked },
    {
      key: "no_ad",
      label: "Ad unknown",
      tone: "warn",
      count: s => s.leads.no_ad,
    },
    { key: "deleted", label: "Deleted in GHL", count: s => s.leads.deleted },
  ],
  appointments: [
    { key: "all", label: "All appointments", count: s => s.appointments.all },
    { key: "upcoming", label: "Upcoming", count: s => s.appointments.upcoming },
    { key: "showed", label: "Showed up", count: s => s.appointments.showed },
    {
      key: "not_counted",
      label: "Cockpit did not count",
      tone: "bad",
      count: s => s.appointments.not_counted,
    },
    {
      key: "twice",
      label: "Counted twice",
      tone: "bad",
      count: s => s.appointments.twice,
    },
    {
      key: "no_result",
      label: "Result not recorded",
      tone: "warn",
      count: s => s.appointments.no_result,
    },
    {
      key: "calendar",
      label: "Calendar events",
      tone: "warn",
      count: s => s.appointments.calendar,
    },
  ],
};
const DAYS = [7, 30, 90] as const;

type Problem = {
  tone: "bad" | "warn" | "info";
  title: string;
  why: string;
  where: ReactNode;
  cta: string;
  go: () => void;
};

/** "Mostly Ocean Home (13), then ARCWANI (5)." from the per-client counts. */
function whereSentence(
  per: PerClient[],
  pick: (c: PerClient) => number,
): ReactNode {
  const top = per
    .map(c => [c.client, pick(c)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!top.length) return null;
  if (top.length === 1)
    return (
      <>
        All from{" "}
        <b>
          <bdi>{top[0][0]}</bdi>
        </b>
        .
      </>
    );
  return (
    <>
      Mostly{" "}
      <b>
        <bdi>{top[0][0]}</bdi>
      </b>{" "}
      ({fmtN(top[0][1])}), then <bdi>{top[1][0]}</bdi> ({fmtN(top[1][1])})
      {top.length > 2 ? ` and ${top.length - 2} more` : ""}.
    </>
  );
}

function problemsFor(
  s: Summary,
  go: (tab: Tab, filter?: string) => void,
): Problem[] {
  const P: Problem[] = [];
  const per = s.per_client;
  const failing = [
    ...s.freshness.leads.failing,
    ...s.freshness.appointments.failing,
  ];
  if (failing.length)
    P.push({
      tone: "bad",
      title: `Copying from GHL failed for ${failing.length} location${failing.length > 1 ? "s" : ""}`,
      why: "Their newest leads or appointments are missing here until the next copy works.",
      where: failing
        .map(f => f.error ?? f.status ?? "No error text")
        .slice(0, 2)
        .join(" "),
      cta: "See the client table",
      go: () => go("compare"),
    });
  if (s.lineage.never_reached) {
    const days = s.gap_days;
    P.push({
      tone: "bad",
      title: `Meta counted ${fmtN(s.lineage.never_reached)} more Facebook leads than GHL received`,
      why: "On these days GHL got 3 or more fewer leads than Meta counted. Usually the lead form connection stopped working.",
      where: (
        <>
          {[...new Set(days.map(d => d.client))].slice(0, 3).map((c, i) => (
            <span key={c}>
              {i ? ", " : ""}
              <b>
                <bdi>{c}</bdi>
              </b>
            </span>
          ))}
          , on {days.length} day{days.length > 1 ? "s" : ""}.
        </>
      ),
      cta: "See the days",
      go: () => go("compare"),
    });
  }
  if (s.appointments.not_counted)
    P.push({
      tone: "bad",
      title: `${fmtN(s.appointments.not_counted)} bookings are missing from the cockpit`,
      why: "These Facebook leads booked in GHL, but the cockpit bookings card does not count them, so it shows too few.",
      where: whereSentence(per, c => c.not_counted),
      cta: "Show these bookings",
      go: () => go("appointments", "not_counted"),
    });
  if (s.appointments.twice)
    P.push({
      tone: "bad",
      title: `${fmtN(s.appointments.twice)} bookings are counted twice`,
      why: "From 8 to 27 Sep the old system and the new sync both stored these bookings. The cockpit adds both, so bookings look higher.",
      where: whereSentence(per, c => c.twice),
      cta: "Show these bookings",
      go: () => go("appointments", "twice"),
    });
  if (s.appointments.calendar)
    P.push({
      tone: "warn",
      title: `${fmtN(s.appointments.calendar)} bookings are calendar events, not leads`,
      why: `Google Calendar two-way sync copied them into GHL. The cockpit counts ${fmtN(s.appointments.calendar_counted)} of them as bookings.`,
      where: whereSentence(per, c => c.calendar),
      cta: "Show these events",
      go: () => go("appointments", "calendar"),
    });
  if (s.leads.no_ad)
    P.push({
      tone: "warn",
      title: `${fmtN(s.leads.no_ad)} Facebook leads have an unknown ad`,
      why: "GHL did not receive the ad id, so we cannot tell which ad brought them. Cost per lead by ad leaves them out.",
      where: whereSentence(per, c => c.no_ad),
      cta: "Show these leads",
      go: () => go("leads", "no_ad"),
    });
  if (s.meta_unmapped?.leads)
    P.push({
      tone: "warn",
      title: `${fmtN(s.meta_unmapped.leads)} Meta leads are not tied to a client`,
      why: "Their campaign uses an ad account that is not linked to exactly one client, so client comparisons leave them out.",
      where: (
        <>
          Campaign <b>{s.meta_unmapped.campaigns.join(", ")}</b>.
        </>
      ),
      cta: "See the comparison",
      go: () => go("compare"),
    });
  if (s.appointments.no_result)
    P.push({
      tone: "info",
      title: `${fmtN(s.appointments.no_result)} meetings have no result`,
      why: 'The meeting time passed, but nobody marked "showed" or "no-show" in GHL. Show-up rates stay uncertain until someone does.',
      where: whereSentence(per, c => c.no_result),
      cta: "Show these meetings",
      go: () => go("appointments", "no_result"),
    });
  return P;
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Every lead and appointment, admin only (Muhammed, 2026-10-11): is this
 * number right, and where did it break? Summary first, then filters, then
 * one person's story on request. Plan: docs/superpowers/plans/2026-10-11-data-layers.md.
 */
export function DataViewPage() {
  const auth = useCockpitAuth();
  const client = auth.client;
  const actor = auth.session?.user.id ?? null;
  const now = useNow(60_000);
  const [params, setParams] = useSearchParams();

  const location = params.get("client") || null;
  const daysParam = Number(params.get("days"));
  const days = (DAYS as readonly number[]).includes(daysParam) ? daysParam : 30;
  const tabParam = params.get("tab");
  const tab: Tab =
    tabParam === "appointments" || tabParam === "compare" ? tabParam : "leads";
  const kind: Kind = tab === "appointments" ? "appointments" : "leads";
  const filterParam = params.get("filter") ?? "all";
  const filter = FILTERS[kind].some(f => f.key === filterParam)
    ? filterParam
    : "all";
  // Like the cockpit's own tabs (useTabParam): the address bar follows the
  // view, and the page never scrolls because of it.
  const set = (next: Record<string, string | null>) =>
    setParams(
      prior => {
        const p = new URLSearchParams(prior);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === "") p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true, preventScrollReset: true },
    );

  // Search stays out of the address bar: it often holds a phone number.
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const [view, setView] = useState<"key" | "all">("key");
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  // The pill moves at once; the sheet redraws in the background, like the
  // CEO kit's DataTable search, so the click never waits for the cells.
  const gridView = useDeferredValue(view);
  const gridDensity = useDeferredValue(density);
  const [selected, setSelected] = useState<string | null>(null);

  const summary = useSummary(client, actor, { location, days });
  const rowQuery = useMemo(
    () =>
      tab === "compare"
        ? null
        : { kind, location, days, filter, search: query },
    [tab, kind, location, days, filter, query],
  );
  const rows = useRows(client, actor, rowQuery);
  const s = summary.data;

  // The client success page links here with its ClickUp id (?task=...).
  // Swap it for the client's GHL location once the client list is in.
  const task = params.get("task");
  const clientList = s?.clients;
  const [taskMissing, setTaskMissing] = useState(false);
  useEffect(() => {
    if (!task || !clientList) return;
    const match = clientList.find(c => c.clickup_id === task);
    setParams(
      prior => {
        const p = new URLSearchParams(prior);
        p.delete("task");
        if (match) p.set("client", match.location_id);
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
    setTaskMissing(!match);
  }, [task, clientList, setParams]);

  // The other tab's "All" first, then the other chips of this tab, fetched
  // once the table on screen has its rows, so the next click swaps in place.
  const settled = !rows.loading && !summary.stale;
  useEffect(() => {
    if (!client || !actor || !s || !settled || tab === "compare" || query)
      return;
    const other: Kind = kind === "leads" ? "appointments" : "leads";
    const ahead: RowQuery[] = [
      { kind: other, location, days, filter: "all", search: "" },
      ...FILTERS[kind]
        .filter(f => f.key !== filter && f.count(s) > 0)
        .map(f => ({ kind, location, days, filter: f.key, search: "" })),
    ];
    let stop = false;
    const t = window.setTimeout(
      () => void prefetchRows(client, actor, ahead, () => stop),
      300,
    );
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [client, actor, s, settled, tab, query, kind, location, days, filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".dv-pop"))
        setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (next: Tab, nextFilter?: string) => {
    set({
      tab: next === "leads" ? null : next,
      filter: nextFilter && nextFilter !== "all" ? nextFilter : null,
    });
    window.setTimeout(
      () =>
        document
          .getElementById(next === "compare" ? "dv-gapdays" : "dv-tabs")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  };
  const problems = s ? problemsFor(s, go) : [];
  // The numbers on screen can be the last scope's while a new one loads.
  const scopeName = summary.location
    ? (s?.clients.find(c => c.location_id === summary.location)?.name ??
      "this client")
    : "all clients";

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (!client || !actor || !rowQuery) return;
    setExporting(true);
    try {
      const out = await fetchExport(client, actor, rowQuery);
      const csv =
        kind === "leads"
          ? toCsv(LEAD_ALL, out.rows as LeadRow[])
          : toCsv(APPT_ALL, out.rows as ApptRow[]);
      download(
        `${kind}-${location ? scopeName.replace(/[^\w]+/g, "-") : "all-clients"}-${days}d-${ymd(Date.now())}.csv`,
        csv,
      );
      notify(
        out.truncated
          ? `Exported the newest ${fmtN(out.rows.length)} of ${fmtN(out.total)} rows. Narrow the filter for the rest.`
          : `Exported ${fmtN(out.rows.length)} rows with all sheet columns`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "The export failed. Try again.",
      );
    } finally {
      setExporting(false);
    }
  };

  const fresh = s?.freshness;
  const leadsAt = ms(fresh?.leads.newest);
  const apptsAt = ms(fresh?.appointments.newest);
  const oldestSync = Math.min(
    ms(fresh?.leads.oldest) ?? now,
    ms(fresh?.appointments.oldest) ?? now,
  );
  const stale = now - oldestSync > 3 * 3600e3;
  const activeFilter = FILTERS[kind].find(f => f.key === filter);
  const allCount = s ? FILTERS[kind][0].count(s) : null;
  const ns = notSyncedCount(kind, view);
  const rowsBusy = rows.stale && rows.rows.length > 0;

  return (
    <div
      className={`ceo-root dv-root mx-auto w-full min-w-0 max-w-[1440px] space-y-6 pb-10${selected ? " panel-open" : ""}`}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground sm:text-sm">
            Admin only. Times are Riyadh time.
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground sm:text-[28px] sm:leading-9">
            Leads and appointments
          </h1>
        </div>
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={exporting || tab === "compare"}
          title={
            tab === "compare"
              ? "Open Leads or Appointments to export"
              : undefined
          }
        >
          <Download className="size-4" />
          {exporting ? "Exporting" : "Export CSV"}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <AnimatedSelect
          aria-label="Client"
          value={location ?? ""}
          onChange={e => set({ client: e.target.value || null })}
          className="w-full text-sm sm:w-64"
        >
          <option value="">All clients</option>
          {location && !s?.clients.some(c => c.location_id === location) ? (
            <option value={location}>Loading client</option>
          ) : null}
          {s?.clients.map(c => (
            <option key={c.location_id} value={c.location_id}>
              {c.name}
              {c.status && !["Active", "Launching"].includes(c.status)
                ? ` (${c.status})`
                : ""}
            </option>
          ))}
        </AnimatedSelect>
        <FilterChips
          ariaLabel="Date range"
          className="w-auto"
          value={String(days)}
          onChange={d => set({ days: d === "30" ? null : d })}
          options={DAYS.map(d => ({ key: String(d), label: `${d} days` }))}
        />
        <label className="relative flex min-w-0 flex-1 items-center sm:max-w-72">
          <span className="sr-only">Search</span>
          <Search
            className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            placeholder="Find a name, phone or campaign"
            onChange={e => {
              setSearch(e.target.value);
              if (tab === "compare") set({ tab: null, filter: null });
            }}
            className="h-9 w-full rounded-md border bg-background pl-8 pr-2.5 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </label>
      </div>

      <div
        className="dv-overview"
        data-busy={summary.stale && s ? "" : undefined}
      >
        {summary.error ? (
          <div className="dv-alert">
            <span>{summary.error}</span>
            <button
              type="button"
              className="dv-btn small"
              onClick={() => void summary.refetch()}
            >
              <RefreshCw className="size-3.5" /> Try again
            </button>
          </div>
        ) : !s ? (
          <div aria-busy="true">
            <div className="dv-skel" style={{ width: "60%", height: 22 }} />
            <div className="dv-skel" style={{ width: "40%", marginTop: 12 }} />
          </div>
        ) : (
          <>
            {taskMissing ? (
              <div className="dv-alert">
                This client has no GHL location in our data yet, so the page
                shows all clients. Pick the client from the list if it has
                another name.
              </div>
            ) : null}
            <p className="dv-headline">
              In the last {s.days} days, for <bdi>{scopeName}</bdi>:{" "}
              <b>{fmtN(s.leads.all)} leads</b> came in and{" "}
              <b>{fmtN(s.appointments.all)} appointments</b> were booked.{" "}
              {problems.length ? (
                <span className="need">
                  {problems.length} thing{problems.length > 1 ? "s" : ""} need
                  {problems.length > 1 ? "" : "s"} a look.
                </span>
              ) : (
                "Nothing needs a look."
              )}
            </p>
            <div className="dv-freshline">
              <span className={`dv-dot${stale ? " warn" : ""}`} />
              <span>
                {leadsAt
                  ? `Leads were copied from GHL ${rel(leadsAt, now)}`
                  : "Leads have no copy record"}
                {apptsAt
                  ? ` and appointments ${rel(apptsAt, now)}.`
                  : ". Appointments have no copy record."}{" "}
                {fresh?.meta_last_day
                  ? `Meta numbers run up to ${fmtDayString(fresh.meta_last_day)}`
                  : "Meta numbers are not available"}
                {fresh?.bookings_last_day
                  ? `, cockpit bookings up to ${fmtDayString(fresh.bookings_last_day)}.`
                  : "."}
              </span>
            </div>
            <details className="dv-howto">
              <summary>How to read this page</summary>
              <ol>
                <li>
                  <b>Start with the cards below.</b> Each card names a problem,
                  says why it matters, and has a button that shows the exact
                  rows.
                </li>
                <li>
                  <b>Click any row</b> to see that person's story, from the
                  first message to the meeting result.
                </li>
                <li>
                  <b>Click the i next to a column name</b> to see what it means,
                  where it comes from, and what an empty cell means.
                </li>
                <li>
                  <b>"Compare with Meta and the cockpit"</b> shows where the
                  counts stop matching between systems.
                </li>
                <li>
                  <b>"—" means GHL has no value.</b> Striped cells mean the
                  field is not copied to our database yet.
                </li>
              </ol>
            </details>
            {problems.length ? (
              <div className="dv-problems">
                {problems.map(p => (
                  <article key={p.title} className={`dv-problem ${p.tone}`}>
                    <div className="pt">{p.title}</div>
                    <div className="pd">{p.why}</div>
                    {p.where ? <div className="pw">{p.where}</div> : null}
                    <button type="button" className="dv-link" onClick={p.go}>
                      {p.cta}
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="dv-okline">
              <span className="dv-dot" />
              <span>
                Checked and fine:{" "}
                {[
                  !s.freshness.leads.failing.length &&
                  !s.freshness.appointments.failing.length
                    ? `every GHL location copied without errors (${s.freshness.leads.ok} of ${s.freshness.leads.locations})`
                    : null,
                  !s.appointments.not_counted
                    ? "every Facebook booking is in the cockpit"
                    : null,
                  !s.lineage.never_reached
                    ? "no day lost leads between Meta and GHL"
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "nothing else to report"}
                .
                {s.leads.deleted
                  ? ` ${fmtN(s.leads.deleted)} lead${s.leads.deleted > 1 ? "s were" : " was"} deleted in GHL and left out of the counts.`
                  : ""}
              </span>
            </div>
          </>
        )}
      </div>

      <div id="dv-tabs" className="scroll-mt-4">
        <CeoTabs
          ariaLabel="Data"
          value={tab}
          onChange={key =>
            set({ tab: key === "leads" ? null : key, filter: null })
          }
          tabs={[
            { key: "leads", label: "Leads", count: s?.leads.all },
            {
              key: "appointments",
              label: "Appointments",
              count: s?.appointments.all,
            },
            { key: "compare", label: "Compare with Meta and the cockpit" },
          ]}
        />
      </div>

      <div
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        className="min-w-0"
      >
        {tab === "compare" ? (
          s ? (
            <CompareTab
              summary={s}
              go={(t, f) => go(t, f)}
              onClient={loc => {
                set({ client: loc, tab: null, filter: null });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ) : (
            <div className="dv-skel" style={{ height: 200 }} />
          )
        ) : (
          <>
            <div className="dv-toolrow">
              <FilterChips
                ariaLabel="Show"
                value={filter}
                onChange={key => set({ filter: key === "all" ? null : key })}
                options={FILTERS[kind].map(f => ({
                  key: f.key,
                  label: f.label,
                  count: s ? f.count(s) : undefined,
                  tone: f.tone ? TONE[f.tone] : undefined,
                }))}
              />
              <div className="dv-viewctl">
                <FilterChips
                  ariaLabel="Columns"
                  className="w-auto"
                  value={view}
                  onChange={setView}
                  options={[
                    { key: "key", label: "Key columns" },
                    {
                      key: "all",
                      label: `All ${ALL_COUNT[kind]} sheet columns`,
                    },
                  ]}
                />
                <FilterChips
                  ariaLabel="Row size"
                  className="w-auto"
                  value={density}
                  onChange={setDensity}
                  options={[
                    { key: "comfortable", label: "Roomy" },
                    { key: "compact", label: "Compact" },
                  ]}
                />
              </div>
            </div>
            {/* Always one line, so changing the filter never moves the table. */}
            <div className="dv-active-filter">
              {filter !== "all" || query.trim() ? (
                <>
                  <span>
                    Filtered to <b>{activeFilter?.label}</b>
                    {query.trim() ? (
                      <>
                        {" "}
                        and "<b>{query.trim()}</b>"
                      </>
                    ) : null}
                    .{" "}
                    {rows.total !== null
                      ? `${fmtN(rows.total)}${allCount !== null ? ` of ${fmtN(allCount)}` : ""} rows.`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="dv-link"
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                      set({ filter: null });
                    }}
                  >
                    Show all
                  </button>
                </>
              ) : (
                <span>
                  Every {kind === "leads" ? "lead" : "appointment"} in the
                  range, newest first.
                </span>
              )}
            </div>
            <div
              className="dv-sheet"
              data-busy={rowsBusy ? "" : undefined}
              aria-busy={rows.loading}
            >
              <div className="dv-busybar" aria-hidden />
              {rows.error ? (
                <div className="dv-alert" style={{ margin: 14 }}>
                  <span>{rows.error}</span>
                  <button
                    type="button"
                    className="dv-btn small"
                    onClick={() => void rows.refetch()}
                  >
                    <RefreshCw className="size-3.5" /> Try again
                  </button>
                </div>
              ) : rows.rows.length ? (
                <SheetGrid
                  key={rows.key ?? "none"}
                  kind={rows.kind}
                  view={gridView}
                  density={gridDensity}
                  rows={rows.rows}
                  now={now}
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : rows.loading ? (
                <div className="dv-sheet-wait">
                  {[70, 55, 62, 48, 66, 52].map(w => (
                    <div
                      key={w}
                      className="dv-skel"
                      style={{ width: `${w}%`, marginTop: 14 }}
                    />
                  ))}
                </div>
              ) : (
                <div className="dv-sheet-wait dv-empty muted">
                  <b>Nothing matches.</b>
                  Clear the search or pick another filter. You can also choose a
                  longer date range.
                </div>
              )}
              <div className="dv-sheet-foot">
                <span>
                  {rows.total !== null
                    ? `Showing ${fmtN(rows.rows.length)} of ${fmtN(rows.total)}.`
                    : "Loading rows."}
                </span>
                <span className="dv-legend">
                  <span>— GHL has no value</span>
                  {ns ? (
                    <span>
                      <i className="ns-cell" />
                      Not copied to the database yet ({ns}{" "}
                      {ns === 1 ? "column" : "columns"})
                    </span>
                  ) : null}
                </span>
                {rows.next ? (
                  <button
                    type="button"
                    className="dv-btn small"
                    disabled={rows.loading}
                    onClick={() => void rows.loadMore()}
                  >
                    {rows.loading
                      ? "Loading"
                      : `Show ${fmtN(Math.min(150, (rows.total ?? 0) - rows.rows.length))} more`}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <RecordDrawer
        id={selected}
        client={client}
        actor={actor}
        now={now}
        onClose={() => setSelected(null)}
        toast={text => notify(text)}
      />
    </div>
  );
}
