import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { CallCentreSection } from "@/components/CallCentreSection";
import { ClientCheckIn } from "@/components/ClientCheckIn";
import { ClientUpdates } from "@/components/ClientUpdates";
import { DosDontsCard } from "@/components/DosDonts";
import {
  Chip,
  ExtLink,
  Kicker,
  PageHeader,
  Pill,
  PillRow,
  StatTile,
} from "@/components/kit";
import { PortalTasksButton } from "@/components/PortalTasks";
import { ReportIssue } from "@/components/ReportIssue";
import {
  ResultsNav,
  type ResultsPart,
  ResultsParts,
  ResultsSection,
} from "@/components/ResultsLayout";
import {
  bucketDays,
  completeDays,
  costJudge,
  pairedFromRecord,
  partialBucket,
  ratioHead,
  ratioHeadline,
  TrendChart,
  type TrendPoint,
} from "@/components/TrendChart";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { type SourceHealth, staleSentence } from "@/lib/csmCalls";
import { type Constraint, diagnose, sheetCoverage } from "@/lib/csmDiagnosis";
import { serviceModel } from "@/lib/csmTemplates";
import { displayLabel, plural, shortDay } from "@/lib/format";
import {
  CPB_BAD,
  CPB_GATE,
  CPL_GATE,
  SHOW_RATE_AIM,
  SHOW_RATE_GOOD,
} from "@/lib/kpi";
import { cleanLostNote } from "@/lib/lostNotes";
import { publishOpenClient } from "@/lib/openClient";
import {
  addTask,
  fetchClientProfile,
  fetchPerformanceOverview,
  fetchPerformancePeriod,
  fetchTasksAdded,
  requestReportDoc,
} from "@/lib/performance";

import {
  AD_TABLE_LIMIT,
  byAdIn,
  type CardChange,
  changesIn,
  dayLabel,
  kuwaitDay,
  type Period,
  type PeriodKey,
  periodNumbers,
  periodOf,
  shiftDay,
  withSheetMonth,
} from "@/lib/reportPeriod";
import { cn } from "@/lib/utils";

/**
 * Client performance: the high-level board, then one client in full.
 *
 * Every number on this screen comes off the client's own performance sheet, so it is the
 * same truth the client sees. Blank is shown as blank — an appointment nobody updated is
 * never counted as a no-show, it is put on the chase list instead, because guessing here
 * would quietly turn admin debt into a bad report.
 */

// biome-ignore lint/suspicious/noExplicitAny: profile payloads are untyped by design
type Any = any;

const num = (v: unknown) => (typeof v === "number" ? v : 0);
/** A count, or "-" when the source did not say: missing is never zero. */
const count = (v: unknown) => (typeof v === "number" ? v : "-");

function Cell({ v, muted }: { v: unknown; muted?: boolean }) {
  const text = v === null || v === undefined || v === "" ? "-" : String(v);
  return (
    <td
      className={`px-3 py-2 text-sm tabular-nums first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6 ${muted ? "text-muted-foreground" : ""}`}
    >
      {text}
    </td>
  );
}

/** The mono column label every table on this screen uses. */
function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-normal whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-6 sm:last:pr-6">
      {children}
    </th>
  );
}

/** A section heading inside the client profile. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-semibold">{children}</h3>;
}

/**
 * Each link's source of truth, so a missing one says where to add it. One
 * name per link everywhere in the cockpit (the client page's header uses it).
 */
export const LINK_LABELS: {
  key: string;
  label: string;
  hint: string;
  missing: string;
}[] = [
  {
    key: "sheet",
    label: "Performance sheet",
    hint: "leads, appointments, outcomes",
    missing: "not in the Database sheet (Client Data) yet",
  },
  {
    key: "drive",
    label: "Client drive",
    hint: "raw and finished creative, sheets",
    missing: "not in the Database sheet (Client Data) yet",
  },
  {
    key: "ghl",
    label: "GHL sub-account",
    hint: "app.maharamedia.com",
    missing: "no GHL row matched in the Database sheet",
  },
  {
    key: "adAccount",
    label: "Ad account",
    hint: "Meta Ads Manager",
    missing:
      "no Meta account found: not shared with Mahara, and not in Client Data",
  },
  {
    key: "clickup",
    label: "ClickUp record",
    hint: "stage, dates, fields",
    missing: "no ClickUp card",
  },
  {
    key: "contract",
    label: "Contract",
    hint: "signed agreement",
    missing: "not on their ClickUp record yet",
  },
];

export function ClientLinks({ links }: { links: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {LINK_LABELS.map(l => {
        const href = links?.[l.key];
        return href ? (
          <a
            key={l.key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group min-w-0 rounded-2xl border bg-card px-4 py-3 transition-colors hover:border-primary/40"
          >
            <div className="flex items-start gap-1 text-sm font-medium">
              <span className="min-w-0">{l.label}</span>
              <ArrowUpRight
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
              />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{l.hint}</div>
          </a>
        ) : (
          <div
            key={l.key}
            className="min-w-0 rounded-2xl border border-dashed px-4 py-3"
          >
            <div className="text-sm font-medium text-muted-foreground">
              {l.label}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {l.missing}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A printable one-pager for the reporting period. Opened in a new tab; Cmd/Ctrl+P saves it as a PDF. */
function reportHtml(p: Any, per: Period, fig: Figures): string {
  const perf = p.performance ?? {};
  const m = fig.m ?? {};
  const l = fig.l ?? {};
  const rows = (perf.stale ?? []) as Any[];
  const staleTotal = Number(perf.staleCount ?? rows.length);
  // Done with you clients book their own appointments, so their report is leads and cost
  // per lead. Printing empty booking and close rows would just look like failure.
  const dwy = serviceModel(p.service).dwy;
  const esc = (t: unknown) =>
    String(t ?? "").replace(
      /[&<>]/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
    );
  const line = (label: string, a: unknown, b: unknown) =>
    `<tr><td>${label}</td><td class="n">${a ?? "-"}</td><td class="n">${b ?? "-"}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(
    p.clientName,
  )}, performance</title><style>
    body{font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#091333;margin:40px;max-width:820px}
    h1{font-size:24px;margin:0 0 4px} h2{font-size:15px;margin:28px 0 8px;color:#00A7A2}
    .sub{color:#6b7280;font-size:12px;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
    .n{text-align:right;font-variant-numeric:tabular-nums}
    .note{font-size:12px;color:#6b7280;margin-top:8px}
  </style></head><body>
  <h1>${esc(p.clientName)}</h1>
  <div class="sub">Performance report · ${esc(capital(per.label))} · ${esc(dayLabel(per.from))} to ${esc(dayLabel(upTo(per)))} · generated ${new Date().toISOString().slice(0, 10)} · source: the client's own performance sheet</div>
  <h2>${dwy ? "Lead volume" : "The funnel"}</h2>
  <table><tr><th>Metric</th><th class="n">${esc(capital(per.label))}</th><th class="n">${esc(per.prevLabel ? capital(per.prevLabel) : "")}</th></tr>
  ${line("Leads", m.leads, l.leads)}
  ${
    dwy
      ? ""
      : `${line("Appointments booked", m.booked, l.booked)}
  ${line("Attended", m.shows, l.shows)}
  ${line("Did not attend", m.noshows, l.noshows)}
  ${line("Quotations given", m.quotes, l.quotes)}
  ${line("Deals closed", m.closes, l.closes)}
  ${line("Attendance rate", m.showRate == null ? "-" : `${m.showRate}%`, l.showRate == null ? "-" : `${l.showRate}%`)}
  ${line("Outcome not filled in", m.unknownOutcome, l.unknownOutcome)}`
  }
  </table>
  ${dwy ? '<div class="note">Done with you: the client books and tracks their own appointments, so this report covers lead volume and cost per lead.</div>' : ""}
  ${dwy ? "" : `<h2>Appointments with no outcome on the sheet (${staleTotal})</h2>${staleTotal > rows.length ? `<div class="note">The first ${rows.length} are listed; the rest are on the client's sheet.</div>` : ""}`}
  ${
    dwy
      ? ""
      : rows.length
        ? `<table><tr><th>Name</th><th>Added</th><th>Appointment</th><th>Missing</th><th class="n">Days</th></tr>${rows
            .slice(0, 40)
            .map(
              r =>
                `<tr><td>${esc(r.name)}</td><td>${esc(r.added)}</td><td>${esc(r.appDate)}</td><td>${esc(r.missing)}</td><td class="n">${esc(r.days ?? r.appDaysAgo ?? r.ageDays)}</td></tr>`,
            )
            .join("")}</table>
      <div class="note">Each unfilled row reads as a loss in every report. These are the rows to chase.</div>`
        : '<div class="note">Nothing outstanding, every appointment has an outcome.</div>'
  }
  <h2>Live advertising</h2>
  ${
    (p.ads ?? []).length
      ? `<table><tr><th>Campaign</th><th>Status</th><th class="n">Leads 7d</th><th class="n">Cost per lead</th>${dwy ? "" : '<th class="n">Bookings 7d</th>'}</tr>${(
          p.ads as Any[]
        )
          .map(
            a =>
              `<tr><td>${esc(a.campaign)}</td><td>${esc(a.status)}</td><td class="n">${esc(a.leads7d)}</td><td class="n">${a.cpl ? `$${Number(a.cpl).toFixed(2)}` : "-"}</td>${dwy ? "" : `<td class="n">${esc(a.bookings7d)}</td>`}</tr>`,
          )
          .join("")}</table>`
      : '<div class="note">No live campaigns are synced for this client.</div>'
  }
  </body></html>`;
}

function openReport(p: Any, per: Period, fig: Figures) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(reportHtml(p, per, fig));
  w.document.close();
}

/**
 * One constraint, with the fix checklist and the message that goes with it.
 *
 * The checklist is the point: the CSM walks into the call with steps, not with "how are
 * things going". Ticks are local to the session on purpose — this is a thinking aid for
 * the next 20 minutes, not another tracker to keep up to date.
 */
function ConstraintCard({ c, first }: { c: Constraint; first?: boolean }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [open, setOpen] = useState(Boolean(first));
  const layer =
    c.layer === "macro"
      ? "Whole system"
      : c.layer === "admin"
        ? "Our admin"
        : "One leak";
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card",
        first ? "border-primary/40" : "",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left sm:px-6 sm:py-4"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {first ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-foreground ring-1 ring-inset ring-primary/40">
                Fix this first
              </span>
            ) : null}
            <Chip
              tone={
                c.layer === "macro"
                  ? "bad"
                  : c.layer === "admin"
                    ? "warn"
                    : "neutral"
              }
            >
              {layer}
            </Chip>
            {c.owner ? (
              <span className="text-xs text-muted-foreground">
                Owner: {c.owner}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-semibold">{c.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {c.evidence}
          </div>
        </div>
        <ChevronDown
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-4 border-t px-4 py-4 sm:px-6">
          <p className="text-sm">{c.diagnosis}</p>
          <div className="space-y-2">
            <Kicker>What to do</Kicker>
            {c.fixes.map((f, i) => (
              <label
                key={f}
                className="flex cursor-pointer items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={Boolean(done[i])}
                  onChange={e =>
                    setDone(d => ({ ...d, [i]: e.target.checked }))
                  }
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span
                  className={
                    done[i] ? "text-muted-foreground line-through" : ""
                  }
                >
                  {f}
                </span>
              </label>
            ))}
          </div>
          {c.say ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Kicker>What to say</Kicker>
                <div className="flex gap-1">
                  {(["en", "ar"] as const).map(l => (
                    <Pill
                      key={l}
                      active={lang === l}
                      onClick={() => setLang(l)}
                    >
                      {l === "ar" ? "العربية" : "English"}
                    </Pill>
                  ))}
                </div>
              </div>
              <Textarea
                rows={6}
                readOnly
                value={c.say[lang]}
                dir={lang === "ar" ? "rtl" : "ltr"}
              />
              <Button
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(c.say?.[lang] ?? "");
                  toast.success("Copied, paste it into their WhatsApp group");
                }}
              >
                Copy the message
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Before the call: one block that makes the CSM walk in with solutions.
 *
 * The company rule is that the CSM always brings solutions. That is a preparation problem, not a
 * character problem, so this assembles what a good call needs from data already on the profile:
 * where the client stands, the first thing holding them back with its fix and its message (the
 * diagnosis below), and the ask that is owed. It was two blocks, "Prep for this call" and the
 * diagnosis, and the first repeated the second's top card (the simplification audit,
 * 2026-10-06). Nothing here is invented: when a number is missing it says what to ask for.
 */
function BeforeTheCall({ p, withBrief }: { p: Any; withBrief?: boolean }) {
  const perf = (p.performance ?? {}) as Any;
  const m = (perf.month ?? {}) as Any;
  const l = (perf.lastMonth ?? {}) as Any;
  const useLast = Number(m.leads ?? 0) === 0 && Number(l.leads ?? 0) > 0;
  const n = useLast ? l : m;
  const label = useLast
    ? (perf.lastMonthLabel ?? "last month")
    : (perf.monthLabel ?? "this month");
  const stale = Number(perf.staleCount ?? 0);
  const facts = [
    `${label}: ${Number(n.leads ?? 0)} enquiries, ${Number(n.booked ?? 0)} booked, ${Number(n.shows ?? 0)} attended, ${Number(n.closes ?? 0)} closed`,
    stale
      ? `${stale} appointments still have no outcome on their sheet`
      : "Every appointment has an outcome, their tracking is clean",
    p.liveDays != null
      ? `Live ${p.liveDays} days, stage ${displayLabel(p.stage) || "unknown"}`
      : `Stage ${displayLabel(p.stage) || "unknown"}`,
    p.happiness
      ? `Their own happiness rating: ${displayLabel(p.happiness)}`
      : "No happiness rating on their record, ask for one",
  ];
  const nudge = p.reportNudge as Any;
  return (
    <section className="space-y-5 rounded-2xl border border-primary/30 bg-card p-4 sm:p-6">
      {nudge?.url ? (
        <div className="callout-warn rounded-xl p-4 text-sm">
          <p className="font-medium">
            This week's report reminder is waiting for your approval
          </p>
          <p className="mt-1 text-xs">
            {plural(Number(nudge.missing ?? 0), "appointment")} with no outcome.
            Nothing reaches the client until you open this and press send.
          </p>
          <Button size="sm" className="mt-3" asChild>
            <a href={String(nudge.url)} target="_blank" rel="noreferrer">
              Review and send
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
        </div>
      ) : null}
      <div>
        <h3 className="text-[15px] font-semibold">
          {withBrief ? "The numbers" : "Before the call"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {withBrief
            ? "Where they stand this month and the first thing holding them back."
            : "Read this once before you dial. Lead with the first thing holding them back, offer its fix, then make the ask."}
        </p>
      </div>
      <div className="text-sm">
        <p className="font-medium">Where they stand</p>
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
          {facts.map(f => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <DiagnosisSection p={p} />
      <div className="text-sm">
        <p className="font-medium">Before you hang up</p>
        <p className="mt-1 text-muted-foreground">
          {stale
            ? "Agree who fills the missing outcomes and by when. Get a name, not a nod."
            : "Book the next check-in on the call, and ask for the review or the referral while they are happy."}
        </p>
      </div>
    </section>
  );
}

/**
 * The lines the diagnosis judges against, said from the gates themselves so
 * the footer cannot drift from them. The show rate aim is said, never judged.
 */
const DIAGNOSIS_LINES = `Lines: cost per lead under $${CPL_GATE} · cost per booking under $${CPB_GATE} · a quarter of leads booked · show rate (we aim for ${SHOW_RATE_AIM}%; ${SHOW_RATE_GOOD}% is the line, under it is a watch, not a fix) · a fifth of attended closed.`;

function DiagnosisSection({ p }: { p: Any }) {
  const d = diagnose(p);
  return (
    <section className="space-y-4">
      <div>
        <SectionTitle>What is holding this client back</SectionTitle>
        <p className="mt-1 text-sm">{d.headline}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Judged on {d.basis}.
        </p>
      </div>
      {d.healthy ? null : (
        <div className="space-y-3">
          {d.top ? <ConstraintCard c={d.top} first /> : null}
          {d.rest.map(c => (
            <ConstraintCard key={c.id} c={c} />
          ))}
        </div>
      )}
      {d.watch.map(w => (
        <p key={w.id} className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Watch:</span> {w.title}.{" "}
          {w.diagnosis} {w.fixes[0]}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        {DIAGNOSIS_LINES} Fixes come from Diagnosing &amp; Fixing Acquisition
        Constraints, one leak at a time.
      </p>
    </section>
  );
}

/** Report an issue to write the report as an editable Google Doc, then show the link. */
/**
 * The fixed report template, and the parts the CSM can add on top of it.
 *
 * The template itself is never a choice: every client report has the same four sections so
 * the client learns to read it. The extras are the "do you want more in this one" answer,
 * and the keys must match EXTRAS in scripts/csm_report_doc.py.
 */
const REPORT_TEMPLATE = [
  "Performance snapshot: enquiries, appointments, attended, closed, spend and cost per lead",
  "Pipeline health: what the numbers mean and what we are doing next",
  "What we need from you: the appointments nobody has filled in",
];

const REPORT_EXTRAS: { key: string; label: string }[] = [
  {
    key: "appointments",
    label: "Appointment log, lead by lead with the outcome",
  },
  {
    key: "byAd",
    label: "Ad performance: leads, booked, attended, closed per ad",
  },
  { key: "lost", label: "Why leads were marked lost, in their own words" },
  { key: "ads", label: "What is running right now" },
];

function ReportSection({ p, per, fig }: { p: Any; per: Period; fig: Figures }) {
  const auth = useCockpitAuth();
  const [note, setNote] = useState("");
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState(false);
  const [extras, setExtras] = useState<string[]>(REPORT_EXTRAS.map(e => e.key));
  const reports: Any[] = p.reports ?? [];
  const pending = reports.find((r: Any) => !r.builtAt);
  const ready = reports.filter((r: Any) => r.builtAt);
  return (
    <ResultsSection
      id="results-report"
      title="Client report"
      lede={`A Google Doc you can edit before it goes anywhere, for ${per.label}${per.prevLabel ? `, compared with ${per.prevLabel}` : ""}. Same template every time, so the client learns to read it.`}
    >
      <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(["en", "ar"] as const).map(l => (
              <Pill key={l} active={lang === l} onClick={() => setLang(l)}>
                {l === "ar" ? "العربية" : "English"}
              </Pill>
            ))}
          </div>
          <Button
            size="sm"
            disabled={busy || !auth.client}
            onClick={async () => {
              if (!auth.client) return;
              setBusy(true);
              try {
                await requestReportDoc(auth.client, {
                  clientName: p.clientName,
                  month: per.month,
                  from: per.from,
                  to: upTo(per),
                  label: capital(per.label),
                  language: lang,
                  note: note.trim() || undefined,
                  extras,
                });
                toast.success("Report created. Refresh to see its link.");
                setNote("");
              } catch (e) {
                toast.error(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Write the Google Doc
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openReport(p, per, fig)}
          >
            Print a one-pager
          </Button>
          <button
            type="button"
            aria-expanded={options}
            onClick={() => setOptions(v => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground sm:ml-auto"
          >
            What goes in it
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                options && "rotate-180",
              )}
            />
          </button>
        </div>
        {options ? (
          <div className="space-y-4 rounded-xl bg-muted/40 p-4 text-sm">
            <div>
              <p className="font-medium">Always in the report</p>
              <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
                {REPORT_TEMPLATE.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Want anything else in this one?</p>
              <div className="mt-2 space-y-1.5">
                {REPORT_EXTRAS.map(e => (
                  <label
                    key={e.key}
                    className="flex cursor-pointer items-start gap-2 text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={extras.includes(e.key)}
                      onChange={() =>
                        setExtras(v =>
                          v.includes(e.key)
                            ? v.filter(k => k !== e.key)
                            : [...v, e.key],
                        )
                      }
                    />
                    <span>{e.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Textarea
              rows={2}
              value={note}
              placeholder="Anything to put in it? For example the new creative, or that they paused for Ramadan"
              onChange={e => setNote(e.target.value)}
            />
          </div>
        ) : null}
        {pending ? (
          <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Writing {pending.month} now, the link lands here on the next sync.
            {pending.error ? ` Last attempt failed: ${pending.error}` : ""}
          </div>
        ) : null}
        {ready.length ? (
          <ul className="divide-y text-sm">
            {ready.map((r: Any) => (
              <li
                key={r._id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <ExtLink href={r.docUrl} className="font-medium">
                  {r.month} report
                </ExtLink>
                <span className="text-xs text-muted-foreground">
                  Editable Google Doc
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ResultsSection>
  );
}

/**
 * Every recent lead, with the ad that produced it and what happened to them.
 *
 * The point is ad-level lead quality: two ads can both deliver ten leads and only one of
 * them brings people who turn up and buy. Outcome is shown exactly as the sheet has it —
 * blank stays blank, because "nobody filled it in" is not the same as "they did not turn
 * up", and pretending otherwise makes a good ad look bad.
 */
/**
 * Why this client's leads were marked lost, read from their own GHL sub-account.
 *
 * The stage name in the Lost Leads pipeline is the reason, and the note is what the caller
 * actually heard. Together they turn "your leads are bad" into a specific, answerable
 * conversation, which is the whole job on a check-in call.
 */
/**
 * Provisionally booked: appointments the call centre holds on the
 * sub-account's "Not Confirmed" calendar. They never reach the stat sheet
 * until confirmed, so the CSM sees them here.
 */
function Provisional({ pv }: { pv: Any }) {
  if (!pv || (!pv.count && !pv.callbacks)) return null;
  return (
    <ResultsSection
      id="results-provisional"
      title="Provisionally booked"
      count={pv.count}
      lede={`${pv.count} appointment${pv.count === 1 ? "" : "s"} on the Not Confirmed calendar${pv.callbacks ? `, ${pv.callbacks} callback${pv.callbacks === 1 ? "" : "s"} scheduled` : ""}. Not on the stat sheet until confirmed.`}
    >
      {pv.upcoming?.length ? (
        <ul className="divide-y rounded-2xl border bg-card text-sm">
          {pv.upcoming.map((e: Any, i: number) => (
            <li
              key={`${e.at}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:px-6"
            >
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {e.at}
              </span>
              <span className="font-medium">{e.name || "(no name)"}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {e.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </ResultsSection>
  );
}

const TEAMS: [string, string][] = [
  ["", "Me (Client Success list)"],
  ["creative", "Media / Creative"],
  ["tech", "Operations / Tech"],
  ["call_center", "Call centre"],
  ["media_buyer", "Media buyer (Marketing / ADs)"],
];

/**
 * Add a task for this client: a reminder for me, or a request to another
 * team. It reaches ClickUp within five minutes with the client's tag on it.
 */
export function AddTask({
  taskId,
  clientName,
  inline = false,
}: {
  taskId: string;
  clientName: string;
  /** Inside the client page's "Add a task" panel: the form is already open. */
  inline?: boolean;
}) {
  const auth = useCockpitAuth();
  const [added, setAdded] = useState<Any[] | undefined>(undefined);
  const [open, setOpen] = useState(inline);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [team, setTeam] = useState("");
  const [due, setDue] = useState("");

  const reloadTasks = useCallback(() => {
    if (!auth.client) return;
    fetchTasksAdded(auth.client, taskId).then(setAdded).catch(console.error);
  }, [auth.client, taskId]);

  useEffect(() => {
    reloadTasks();
  }, [reloadTasks]);

  const submit = async () => {
    if (!title.trim() || !auth.client) return;
    await addTask(auth.client, auth.email, {
      taskId,
      clientName,
      title: title.trim(),
      note: note.trim() || undefined,
      department: team || undefined,
      due: due ? Date.parse(`${due}T12:00:00+03:00`) : undefined,
    });
    toast.success(
      team
        ? `Sent to ${TEAMS.find(t => t[0] === team)?.[1] ?? team}, in ClickUp within 5 minutes`
        : "Added to your Client Success list, in ClickUp within 5 minutes",
    );
    setTitle("");
    setNote("");
    setDue("");
    if (!inline) setOpen(false);
    reloadTasks();
  };
  return (
    <div className="space-y-3">
      {inline ? null : (
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        >
          {open ? "Close" : "Add a task for this client"}
        </Button>
      )}
      {open ? (
        <form
          className="space-y-3 rounded-2xl border bg-card p-4 text-sm sm:p-6"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            className="h-9 w-full rounded-lg border bg-background px-3"
            placeholder="What needs doing"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-lg border bg-background px-3 py-2"
            rows={2}
            placeholder="Detail, optional"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <AnimatedSelect
              value={team}
              onChange={e => setTeam(e.target.value)}
            >
              {TEAMS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </AnimatedSelect>
            <DateInput
              className="rounded-lg border bg-background px-3 py-1.5"
              value={due}
              onChange={e => setDue(e.target.value)}
              aria-label="Due date"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!title.trim()}
              className="ml-auto"
            >
              Add task
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tagged "{clientName.toLowerCase()}" in ClickUp, so the board
            attributes it to this client.
          </p>
        </form>
      ) : null}
      {added?.length ? (
        <ul className="divide-y rounded-2xl border bg-card text-sm">
          {added.map(t => (
            <li
              key={t.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3 sm:px-6"
            >
              <span className="font-medium">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                {t.department
                  ? (TEAMS.find(x => x[0] === t.department)?.[1] ??
                    t.department)
                  : "My list"}
              </span>
              <span className="ml-auto text-xs">
                {t.url ? (
                  <ExtLink href={t.url}>In ClickUp</ExtLink>
                ) : t.error ? (
                  <span className="txt-bad">Failed: {t.error}</span>
                ) : (
                  <span className="text-muted-foreground">Queued</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecentCalls({ calls, brief }: { calls: Any[]; brief?: string }) {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  if (!calls?.length)
    return (
      <section className="space-y-2">
        <SectionTitle>Recent calls</SectionTitle>
        <p className="text-sm text-muted-foreground">
          No recorded call mentions this client in Fathom. Recordings by a CSM
          show here only when they are shared with the team. The client page's
          Calls list has every booked, logged and recorded call.
        </p>
      </section>
    );
  const when = (at: string) =>
    at
      ? new Date(at).toLocaleString("en-GB", {
          timeZone: "Asia/Kuwait",
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  return (
    <section className="space-y-3">
      <div>
        <SectionTitle>Recent calls</SectionTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Recorded calls this client came up in, with what was said about them.
        </p>
      </div>
      <div className="rounded-2xl border bg-card">
        {brief ? (
          <div className="border-b px-4 py-4 text-sm sm:px-6">
            <Kicker className="mb-2">Where things stand</Kicker>
            <p className="whitespace-pre-wrap" dir="auto">
              {brief}
            </p>
          </div>
        ) : null}
        <ul className="divide-y">
          {calls.map((c, i) => (
            <li
              key={`${c.url ?? c.title}-${i}`}
              className="space-y-1.5 px-4 py-3 text-sm sm:px-6"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 font-medium" dir="auto">
                  {String(c.title)}
                </span>
                {c.host ? (
                  <span className="text-xs text-muted-foreground">
                    Hosted by {String(c.host)}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground sm:ml-auto">
                  {when(String(c.at ?? ""))}
                </span>
                {c.url ? (
                  <ExtLink href={String(c.url)} className="text-xs">
                    Open recording
                  </ExtLink>
                ) : null}
              </div>
              {c.brief ? (
                <p className="whitespace-pre-wrap text-sm" dir="auto">
                  {String(c.brief)}
                </p>
              ) : null}
              {c.summary && !c.brief ? (
                <>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {openUrl === (c.url ?? c.title)
                      ? String(c.summary)
                      : `${String(c.summary).slice(0, 280)}${String(c.summary).length > 280 ? "…" : ""}`}
                  </p>
                  {String(c.summary).length > 280 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenUrl(v =>
                          v === (c.url ?? c.title) ? null : (c.url ?? c.title),
                        )
                      }
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {openUrl === (c.url ?? c.title)
                        ? "Show less"
                        : "Read the summary"}
                    </button>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Lost leads shown before "Show the other": enough to see the pattern. */
const LOST_SHOWN = 3;

/**
 * A lost lead's notes as the team wrote them. The profile joins a lead's
 * notes with " · ", and a power dialer note carries its system lines ("LOST:
 * Other", the Maqsam line, the "[mahara:…]" tag), which say nothing about
 * why. Each note goes through cleanLostNote, the media buyer's own rule
 * (lostNotes.ts, the same file in both cockpits). The dialer's "this does not
 * establish a verified Maqsam call" line is cut too, so it comes back as
 * `unverified` and the list says it in words (as the media buyer's does).
 */
export function teamNote(raw: unknown): { note: string; unverified: boolean } {
  const parts = String(raw ?? "")
    .split(" · ")
    .map(part => cleanLostNote(part))
    .filter(n => n !== null);
  return {
    note: parts.map(n => n.note).join(" · "),
    unverified: parts.some(n => n.unverified),
  };
}

/** The profile's lost pipeline has a reason or a lead to show. */
export function hasLostLeads(lost: Any): boolean {
  return Boolean(lost?.reasons?.length || lost?.leads?.length);
}

/** One grey line: how many sit in the lost pipeline, and how many are listed. */
export function lostLeadsLede(lost: Any): string {
  const leads = (lost?.leads ?? []) as Any[];
  return `${lost.total} leads sit in ${lost.pipeline || "their lost pipeline"}.${leads.length < lost.total ? ` These are the ${leads.length} most recent.` : ""}`;
}

/**
 * The reasons, then each lead with the team's note. Results and the Ads tab
 * show the same list, so a CSM reads why leads died next to the ads too.
 */
export function LostLeadsList({ lost }: { lost: Any }) {
  const [open, setOpen] = useState(false);
  const reasons = (lost?.reasons ?? []) as Any[];
  const leads = (lost?.leads ?? []) as Any[];
  if (!reasons.length && !leads.length) return null;
  const shown = open ? leads : leads.slice(0, LOST_SHOWN);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {reasons.map(r => (
          <span
            key={String(r.reason)}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
          >
            {String(r.reason).replace(/\s*\(Write why.*\)/i, "")}
            <span className="ml-1 font-semibold text-foreground">
              {r.count}
            </span>
          </span>
        ))}
      </div>
      <ul className="divide-y rounded-2xl border bg-card">
        {shown.map((l, i) => {
          const said = teamNote(l.note);
          return (
            <li key={i} className="space-y-1 px-4 py-3 text-sm sm:px-6">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium" dir="auto">
                  {String(l.name)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {String(l.reason).replace(/\s*\(Write why.*\)/i, "")}
                </span>
                {l.ad ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {String(l.ad)}
                  </span>
                ) : null}
                {l.movedAt ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {shortDay(String(l.movedAt))}
                  </span>
                ) : null}
              </div>
              {said.note ? (
                <p
                  className={cn(
                    "text-[13px] text-muted-foreground",
                    open ? null : "line-clamp-2",
                  )}
                  dir="auto"
                >
                  {said.note}
                </p>
              ) : null}
              {said.unverified ? (
                <p className="text-xs text-muted-foreground">
                  Logged by the agent without a matched Maqsam call.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {leads.length > LOST_SHOWN ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(v => !v)}>
          {open ? "Show fewer" : `Show the other ${leads.length - LOST_SHOWN}`}
        </Button>
      ) : null}
    </>
  );
}

function LostLeads({ lost }: { lost: Any }) {
  if (!hasLostLeads(lost)) return null;
  return (
    <ResultsSection
      id="results-lost"
      title="Why leads were marked lost"
      count={lost.total}
      lede={lostLeadsLede(lost)}
    >
      <LostLeadsList lost={lost} />
    </ResultsSection>
  );
}

function LeadsByAd({ rows }: { rows: Any[] }) {
  const [ad, setAd] = useState<string>("all");
  const ads = [...new Set(rows.map(r => r.ad || r.source || "not tagged"))];
  const shown = rows.filter(
    r => ad === "all" || (r.ad || r.source || "not tagged") === ad,
  );
  const outcome = (r: Any) => {
    if (
      String(r.closed ?? "")
        .trim()
        .toUpperCase()
        .startsWith("Y")
    )
      return { label: "Closed", tone: "txt-good font-medium" };
    if (
      String(r.show ?? "")
        .trim()
        .toUpperCase()
        .startsWith("Y")
    )
      return { label: "Attended", tone: "" };
    if (
      String(r.show ?? "")
        .trim()
        .toUpperCase()
        .startsWith("N")
    )
      return { label: "Did not attend", tone: "text-muted-foreground" };
    // An outcome is only missing once the appointment date has passed. Before that the
    // call has not happened, so nobody is late.
    if (r.appDate && r.appPast === false)
      return { label: "Appointment upcoming", tone: "text-muted-foreground" };
    if (!r.appDate)
      return { label: "No appointment booked", tone: "text-muted-foreground" };
    return { label: "Not filled in", tone: "txt-bad" };
  };
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        The latest leads, and the ad each came from
        <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
          {rows.length}
        </span>
      </h3>
      <PillRow>
        {["all", ...ads].map(a => (
          <Pill key={a} active={ad === a} onClick={() => setAd(a)}>
            {a === "all" ? `All (${rows.length})` : a}
          </Pill>
        ))}
      </PillRow>
      <div className="max-h-96 overflow-auto rounded-2xl border bg-card">
        <table className="w-full min-w-max">
          <thead className="sticky top-0 border-b bg-card">
            <tr>
              {[
                "Lead",
                "Came in",
                "Appointment",
                "Ad",
                "Type",
                "Caller",
                "Outcome",
              ].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r, i) => {
              const o = outcome(r);
              return (
                <tr key={`${r.name}-${r.added}-${i}`}>
                  <Cell v={r.name} />
                  <Cell v={shortDay(r.added)} muted />
                  <Cell v={shortDay(r.appDate)} muted />
                  <Cell v={r.ad || r.source || "not tagged"} />
                  <Cell v={r.type} muted />
                  <Cell v={r.caller} muted />
                  <td className={`px-3 py-2 pr-4 text-sm sm:pr-6 ${o.tone}`}>
                    {o.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Quick keys, a month "YYYY-MM", "all", or "custom:YYYY-MM-DD:YYYY-MM-DD". */
type RangeKey = PeriodKey;

const kuwaitToday = () => kuwaitDay();
const shiftDays = shiftDay;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** The last day the period has data for: never later than today. */
const upTo = (per: Period) => {
  const today = kuwaitToday();
  return per.to > today ? today : per.to;
};

/** [from, to, label] for a pick, by the shared period rules (lib/reportPeriod.ts). */
function rangeBounds(key: RangeKey, p?: Any): [string, string, string] {
  const per = periodOf(key, kuwaitToday(), firstDate(p));
  return [per.from, per.to, per.label];
}

/** The earliest day with any data, ads or sheet, for "all time" and the custom picker. */
export function firstDate(p: Any): string | undefined {
  let first: string | undefined;
  for (const d of p?.adLeads?.daily ?? [])
    if (!first || d.date < first) first = String(d.date);
  for (const r of p?.performance?.appointments ?? []) {
    const a = r.added ? String(r.added).slice(0, 10) : "";
    if (a && (!first || a < first)) first = a;
  }
  return first;
}

type Figures = { m: Any; l: Any | null; sheetMonth: boolean };

/**
 * The period's numbers and the ones it is compared with. "This month" keeps
 * the sheet's own month figures, which carry fields the daily rows do not;
 * every other period is summed from the daily rows, ads and sheet alike.
 */
function periodFigures(p: Any, per: Period): Figures {
  const perf = p?.performance ?? {};
  const appts = (perf.appointments ?? []) as Any[];
  const daily = (p?.adLeads?.daily ?? []) as Any[];
  const sum = (from?: string, to?: string) =>
    from && to ? periodNumbers(appts, daily, from, to) : null;
  if (per.key === "month" && perf.month)
    return {
      m: withSheetMonth(sum(per.from, per.to), perf.month) ?? {},
      l: perf.lastMonth
        ? withSheetMonth(sum(per.prevFrom, per.prevTo), perf.lastMonth)
        : sum(per.prevFrom, per.prevTo),
      sheetMonth: true,
    };
  return {
    m: sum(per.from, per.to) ?? {},
    l: sum(per.prevFrom, per.prevTo),
    sheetMonth: false,
  };
}

/** Months with any data, newest first, for the month picker. */
export function monthsAvailable(p: Any): string[] {
  const set = new Set<string>();
  for (const d of p.adLeads?.daily ?? []) set.add(String(d.date).slice(0, 7));
  for (const r of p.performance?.appointments ?? [])
    if (r.added) set.add(String(r.added).slice(0, 7));
  return [...set].sort().reverse();
}

/**
 * The client's own trends for the picked range: what the ads did per day,
 * and what came of it per day or per week (weekly once the span passes 45
 * days). Cost per booking divides ad spend by the bookings from leads that
 * came in during the bucket. The ratio cards headline the range's complete
 * days, sum over sum, day by day whatever the chart's buckets are, over the
 * days both sides are on record, and name them (2026-10-21, 2026-10-22).
 */
function ProfileTrends({
  p,
  from,
  to,
  changes,
  adsOnly,
}: {
  p: Any;
  from: string;
  to: string;
  /** The media buyer's changes in the period, marked on every chart. */
  changes: CardChange[];
  /** Done with you: the sheet's outcomes are not ours, so only the ad charts. */
  adsOnly?: boolean;
}) {
  const daily: Any[] = (p.adLeads?.daily ?? []).filter(
    (d: Any) => d.date >= from && d.date <= to,
  );
  const appts: Any[] = (p.performance?.appointments ?? [])
    .filter((r: Any) => r.added)
    .map((r: Any) => ({ ...r, date: String(r.added).slice(0, 10) }));
  const adBuckets = bucketDays(daily, from, to);
  const apptBuckets = bucketDays(appts, from, to);
  // Changes go in the same day or week buckets as the numbers they explain.
  const notes = new Map(
    bucketDays(
      changes.map(c => ({ date: c.day, text: c.action })),
      from,
      to,
    )
      .filter(b => b.rows.length)
      .map(b => [b.key, b.rows.map(r => r.text)]),
  );
  // A change on a day with nothing charted still gets its day on the axis,
  // so its mark shows.
  const weekly = (Date.parse(to) - Date.parse(from)) / 86400_000 > 45;
  const today = kuwaitToday();
  const marked = (points: TrendPoint[]) => {
    if (!points.length) return points;
    const have = new Set(points.map(pt => pt.x));
    return [
      ...points,
      ...[...notes.keys()]
        .filter(k => !have.has(k))
        .map(k => ({ x: k, y: null as number | null })),
    ]
      .sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0))
      .map(pt => ({
        ...pt,
        note: notes.get(pt.x),
        partial: partialBucket(pt.x, weekly, today),
      }));
  };
  const spendByKey = new Map(
    adBuckets.map(b => [
      b.key,
      b.rows.reduce((s, r) => s + Number(r.spend ?? 0), 0),
    ]),
  );
  const leads = adBuckets.map(b => ({
    x: b.key,
    y: b.rows.reduce((s, r) => s + Number(r.leads ?? 0), 0),
  }));
  const spend = adBuckets.map(b => ({
    x: b.key,
    y: Math.round(spendByKey.get(b.key) ?? 0),
  }));
  const cpl = adBuckets.map(b => {
    const l = b.rows.reduce((s, r) => s + Number(r.leads ?? 0), 0);
    const sp = spendByKey.get(b.key) ?? 0;
    return {
      x: b.key,
      y: l ? Math.round((sp / l) * 100) / 100 : null,
      num: sp,
      den: l,
    };
  });
  const booked = apptBuckets.map(b => ({
    x: b.key,
    y: b.rows.filter(r => r.booked).length,
  }));
  const showRate = apptBuckets.map(b => {
    const s = b.rows.filter(r => r.show === "y").length;
    const n = b.rows.filter(r => r.show === "n").length;
    return {
      x: b.key,
      y: s + n ? Math.round((100 * s) / (s + n)) : null,
      num: s,
      den: s + n,
    };
  });
  // Spend and bookings paired over every day either side has: on the sheet's
  // days alone, spend on a day nobody booked fell out of the cost per
  // booking. The headlines add up days, not the chart's buckets, over the
  // days both sides are on record: spend from its first day on record, the
  // sheet over the days it was read for. A sheet that was never read has no
  // bookings to count, not none (2026-10-21, 2026-10-22).
  const sheet = sheetCoverage(p.performance, p.performanceSyncedAt, today);
  const record: Any[] = p.adLeads?.daily ?? [];
  const spendOf = (rows: Any[]) =>
    rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
  const cplPair = pairedFromRecord<Any, Any>(
    record,
    record,
    from,
    to,
    today,
    spendOf,
    rows => rows.reduce((s, r) => s + Number(r.leads ?? 0), 0),
  );
  const showPair = pairedFromRecord<Any, Any>(
    sheet.read ? appts : [],
    sheet.read ? appts : [],
    from,
    to,
    today,
    rows => rows.filter(r => r.show === "y").length,
    rows => rows.filter(r => r.show === "y" || r.show === "n").length,
    sheet,
  );
  const cpb = pairedFromRecord<Any, Any>(
    record,
    sheet.read ? appts : [],
    from,
    to,
    today,
    spendOf,
    rows => rows.filter(r => r.booked).length,
    sheet.read ? sheet : {},
  );
  const spent = (n: number) =>
    n ? `$${Math.round(n).toLocaleString("en-US")} spent` : "";
  // What the sheet leaves out of a card that counts it, as a headline.
  const sheetGap = !sheet.read
    ? "Sheet not read"
    : sheet.lastRead
      ? `Sheet not read since ${dayLabel(sheet.lastRead)}`
      : "Bookings not on record";
  const sheetNotes = sheet.read
    ? [
        sheet.lastRead &&
        sheet.to &&
        cpb.days &&
        sheet.to < (completeDays(from, to, today)?.to ?? "")
          ? `The sheet was last read on ${dayLabel(sheet.lastRead)}, so the days from then on are left out.`
          : "",
        sheet.from && sheet.from > from
          ? `The sheet is read from its month tabs, so bookings before ${dayLabel(sheet.from)} are not on record.`
          : "",
      ]
    : [sheet.why ?? ""];
  // An unread sheet still names the days and the spend, never a booking count.
  const spendOnly = ratioHead(cpb, { unit: "$", none: "", parts: spent });
  const cpbHead = !sheet.read
    ? { text: spendOnly.basis ? sheetGap : "", basis: spendOnly.basis }
    : cpb.noBottom
      ? { text: sheetGap }
      : ratioHead(cpb, {
          unit: "$",
          none: "No bookings yet",
          noTop: "No spend found",
          parts: (n, d) =>
            [spent(n), plural(d, "booking")].filter(Boolean).join(" · "),
          judge: costJudge(CPB_GATE, CPB_BAD),
        });
  const per = weekly ? "per week" : "per day";
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
      <TrendChart title={`Leads ${per}`} points={marked(leads)} kind="bar" />
      <TrendChart title={`Spend ${per}`} points={marked(spend)} unit="$" />
      <TrendChart
        title="Cost per lead"
        points={marked(cpl)}
        unit="$"
        mode="avg"
        goodWhen="down"
        head={ratioHead(cplPair, {
          unit: "$",
          none: "No leads yet",
          noTop: "No spend found",
          // With no ad day on record the leads are unknown too, not 0.
          parts: (n, d) =>
            cplPair.noTop
              ? ""
              : [spent(n), plural(d, "lead")].filter(Boolean).join(" · "),
        })}
      />
      {adsOnly ? null : (
        <>
          <TrendChart
            title={`Booked ${per}`}
            points={marked(booked)}
            kind="bar"
          />
          <TrendChart
            title="Show rate"
            points={marked(showRate)}
            unit="%"
            mode="avg"
            head={
              !sheet.read || showPair.noBottom
                ? { text: showPair.days || showPair.noBottom ? sheetGap : "" }
                : ratioHead(showPair, {
                    unit: "%",
                    none: "No outcomes yet",
                    parts: (n, d) =>
                      d ? `${n} of ${d} with an outcome attended` : "",
                  })
            }
          />
          <TrendChart
            title="Cost per booking"
            points={marked(cpb.points)}
            unit="$"
            mode="avg"
            goodWhen="down"
            head={cpbHead}
            hint={[
              cpb.since
                ? `Spend before ${dayLabel(cpb.since)} is not on record, so the days before it are left out.`
                : "",
              ...sheetNotes,
              sheet.read
                ? `Bookings are dated by the day the lead came in. Each ${weekly ? "week" : "day"} on the chart is its own spend over its own bookings.`
                : "",
              // Where the two sides come from, so a gap against the Client
              // Performance board reads as two sources, not an error
              // (mergestudio 14-20 Oct: $19.24 here on the sheet's 7 bookings,
              // $16.84 on the board's 8 from GoHighLevel; 2026-10-22).
              sheet.read
                ? "Bookings are from the client's own sheet and spend is from the campaigns the cockpit still lists for them, so this can differ from the Client Performance board, which counts GoHighLevel bookings against the whole ad account."
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </>
      )}
    </div>
  );
}

/** What a decision was, in a word the CSM would use. A change needs no label. */
const DECISION: Record<string, string> = {
  touch: "Client told",
  rerouted: "Sent to a team",
  left: "Left as is",
  approved: "Decision",
  alternative: "Decision",
};

/** Changes listed before "Show the other": the latest week or so. */
const CHANGES_SHOWN = 5;

/**
 * Everything the media buyer did on this client's campaigns in the period:
 * the on/off switches, budgets, new ads and creatives, builds and decisions.
 * Each sits on the charts above on its day.
 */
function ChangesList({
  changes,
  per,
  stale,
}: {
  changes: CardChange[];
  per: Period;
  stale?: string | null;
}) {
  // The client's card carries the last 90 days of changes (csmSync).
  const kept = shiftDay(kuwaitToday(), -89);
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, CHANGES_SHOWN);
  return (
    <ResultsSection
      id="results-changes"
      title="What the media buyer changed"
      count={changes.length}
      lede={`${capital(per.label)}. The dotted lines on the charts are these days.`}
    >
      {stale ? (
        <p className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          {stale}
        </p>
      ) : null}
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {stale
            ? `No changes found in ${per.label} in the sources that are up to date.`
            : `Nothing was changed on their campaigns in ${per.label}. Every switch, budget and new ad, in the media buyer cockpit or in Meta, shows here.`}
        </p>
      ) : (
        <ol className="divide-y rounded-2xl border bg-card">
          {shown.map((c, i) => (
            <li
              key={`${c.day}-${c.at ?? ""}-${c.action}-${i}`}
              className="flex items-start gap-3 px-4 py-2.5 text-sm sm:px-6"
            >
              <span className="w-14 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
                {dayLabel(c.day)}
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto">{c.action}</span>
                {c.evidence ? (
                  <span
                    className="mt-0.5 block text-xs text-muted-foreground"
                    dir="auto"
                  >
                    {c.evidence}
                  </span>
                ) : null}
              </span>
              {DECISION[c.kind] ? (
                <Chip dot={false}>{DECISION[c.kind]}</Chip>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {changes.length > CHANGES_SHOWN ? (
        <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)}>
          {all
            ? "Show fewer"
            : `Show the other ${changes.length - CHANGES_SHOWN}`}
        </Button>
      ) : null}
      {per.from < kept ? (
        <p className="text-xs text-muted-foreground">
          Changes are kept for 90 days, so nothing before {dayLabel(kept)} is
          listed.
        </p>
      ) : null}
    </ResultsSection>
  );
}

/** The one control every number on a client's page follows. */
export function PeriodBar({
  per,
  value,
  onChange,
  months,
  earliest,
}: {
  per: Period;
  value: PeriodKey;
  onChange: (k: PeriodKey) => void;
  months: string[];
  earliest?: string;
}) {
  return (
    <div className="space-y-2 rounded-2xl border bg-card px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Kicker>Reporting period</Kicker>
        <span className="text-xs tabular-nums text-muted-foreground">
          {per.key === "all" && !earliest
            ? "Everything on record"
            : `${dayLabel(per.from)} to ${dayLabel(upTo(per))}`}
          {per.prevLabel ? `, compared with ${per.prevLabel}` : ""}
        </span>
      </div>
      <RangePicker
        value={value}
        onChange={onChange}
        months={months}
        earliest={earliest}
      />
    </div>
  );
}

/** The whole book, on the overview. */
function BookTrends({
  trend,
  weekly,
  label,
}: {
  trend: Any[];
  weekly: Any[];
  label: string;
}) {
  const today = kuwaitToday();
  // The two ratio cards headline the pool of their complete days or weeks,
  // named under it, since the title promises 90 days: one unnamed day under
  // it read as the 90 days' figure (2026-10-22). The read model counts from
  // 90 days before the read (csmReadModel.ts), so the first week can start
  // before its first day.
  const cplPoints: TrendPoint[] = (trend ?? []).map((r: Any) => ({
    x: r.date,
    y: r.cpl,
    partial: r.date >= today,
    num: r.spend,
    den: r.leads,
  }));
  const cplDone = cplPoints.filter(pt => !pt.partial);
  const cplPool = ratioHeadline(cplDone);
  const cplDays = cplDone.length
    ? { from: cplDone[0].x, to: cplDone[cplDone.length - 1].x }
    : undefined;
  const showPoints: TrendPoint[] = (weekly ?? []).map((w: Any) => ({
    x: w.week,
    y: w.showRate,
    partial: partialBucket(w.week, true, today),
    num: w.shows,
    den: typeof w.shows === "number" ? w.shows + w.noshows : undefined,
  }));
  const showDone = showPoints.filter(pt => !pt.partial && pt.den !== undefined);
  const showPool = ratioHeadline(showDone, 100);
  const since = new Date(Date.now() - 90 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const showDays = showDone.length
    ? {
        from: showDone[0].x < since ? since : showDone[0].x,
        to: shiftDays(showDone[showDone.length - 1].x, 6),
      }
    : undefined;
  if (!trend?.length && !weekly?.length)
    return (
      <p className="text-xs text-muted-foreground">
        No ad or sheet data for {label} clients in the last 90 days, so there is
        nothing to chart yet.
      </p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
      <TrendChart
        title={`Leads per day, ${label} clients, last 90 days`}
        points={trend.map((r: Any) => ({
          x: r.date,
          y: r.leads,
          partial: r.date >= today,
        }))}
        kind="bar"
      />
      <TrendChart
        title="Spend per day, last 90 days"
        points={trend.map((r: Any) => ({
          x: r.date,
          y: r.spend,
          partial: r.date >= today,
        }))}
        unit="$"
      />
      <TrendChart
        title="Cost per lead, last 90 days"
        points={cplPoints}
        unit="$"
        mode="avg"
        goodWhen="down"
        head={ratioHead(
          {
            days: cplDays,
            total: cplPool ? { num: cplPool.num, den: cplPool.den } : undefined,
          },
          {
            unit: "$",
            none: "No leads yet",
            noTop: "No spend found",
            parts: (n, d) =>
              [
                n ? `$${Math.round(n).toLocaleString("en-US")} spent` : "",
                plural(d, "lead"),
              ]
                .filter(Boolean)
                .join(" · "),
          },
        )}
      />
      <TrendChart
        title="Show rate per week, last 90 days"
        points={showPoints}
        unit="%"
        mode="avg"
        head={ratioHead(
          {
            days: showDays,
            total: showPool
              ? { num: showPool.num, den: showPool.den }
              : undefined,
          },
          {
            unit: "%",
            none: "No outcomes yet",
            parts: (n, d) => (d ? `${n} of ${d} with an outcome attended` : ""),
          },
        )}
      />
    </div>
  );
}

function RangePicker({
  value,
  onChange,
  months,
  earliest,
}: {
  value: RangeKey;
  onChange: (k: RangeKey) => void;
  months: string[];
  earliest?: string;
}) {
  const quick: [RangeKey, string][] = [
    ["3d", "3 days"],
    ["7d", "7 days"],
    ["30d", "30 days"],
    ["month", "This month"],
    ["lastMonth", "Last month"],
    ["all", "All time"],
  ];
  const isMonth = /^\d{4}-\d{2}$/.test(String(value));
  const isCustom = String(value).startsWith("custom:");
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(
    isCustom ? value.split(":")[1] : shiftDays(kuwaitToday(), -13),
  );
  const [to, setTo] = useState(isCustom ? value.split(":")[2] : kuwaitToday());
  const customOk =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from <= to;
  // One row that scrolls sideways on a phone: eight controls wrapped onto
  // three lines before. The custom range opens underneath it.
  return (
    <div className="min-w-0 space-y-2">
      <PillRow>
        {quick.map(([k, label]) => (
          <Pill key={k} active={value === k} onClick={() => onChange(k)}>
            {label}
          </Pill>
        ))}
        {/* The select's own CSS inherits its font, so the size sits on a wrapper. */}
        <span className="shrink-0 text-xs">
          <AnimatedSelect
            value={isMonth ? value : ""}
            onChange={e => e.target.value && onChange(e.target.value)}
            aria-label="Pick a month"
          >
            <option value="">Pick a month…</option>
            {months.map(m => (
              <option key={m} value={m}>
                {rangeBounds(m)[2]}
              </option>
            ))}
          </AnimatedSelect>
        </span>
        <Pill active={isCustom} onClick={() => setCustomOpen(o => !o)}>
          {isCustom ? `${shortDay(from)} to ${shortDay(to)}` : "Custom"}
        </Pill>
      </PillRow>
      {customOpen ? (
        <form
          className="flex flex-wrap items-center gap-2 text-sm"
          onSubmit={e => {
            e.preventDefault();
            if (!customOk) return;
            onChange(`custom:${from}:${to}`);
            setCustomOpen(false);
          }}
        >
          <DateInput
            value={from}
            min={earliest}
            max={to}
            onChange={e => setFrom(e.target.value)}
            className="rounded-lg border bg-background px-3 py-1.5"
            aria-label="From"
          />
          <span className="text-muted-foreground">to</span>
          <DateInput
            value={to}
            min={from}
            max={kuwaitToday()}
            onChange={e => setTo(e.target.value)}
            className="rounded-lg border bg-background px-3 py-1.5"
            aria-label="To"
          />
          <Button type="submit" size="sm" disabled={!customOk}>
            Apply
          </Button>
          {earliest ? (
            <span className="text-xs text-muted-foreground">
              Data from {shortDay(earliest)}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

export function ClientProfile({
  name,
  onBack,
  period,
  onPeriod,
  part = "all",
  embedded = false,
  afterPrep,
  withBrief = false,
}: {
  name: string;
  onBack?: () => void;
  /** The reporting period, shared with the list so it carries across. */
  period: PeriodKey;
  onPeriod: (k: PeriodKey) => void;
  /**
   * The client page shows this in two tabs: "overview" (before the call,
   * do's and don'ts, the latest from their card, recent calls) and
   * "results" (the period, the report, the numbers, the ads).
   */
  part?: "all" | "overview" | "results";
  /** Inside the client page, which carries the name, booking and links. */
  embedded?: boolean;
  /** What the client page puts right after "Before the call". */
  afterPrep?: React.ReactNode;
  /**
   * The client page shows its "Before the call" brief above this, which
   * already carries the do's and don'ts, the card's notes, the last call and
   * the profile; the overview then shows only the numbers and the calls.
   */
  withBrief?: boolean;
}) {
  const auth = useCockpitAuth();
  const [p, setP] = useState<Any | undefined>(undefined);
  const [profileError, setProfileError] = useState<string | null>(null);
  useEffect(() => {
    setP(undefined);
    setProfileError(null);
    if (!auth.client) return;
    let active = true;
    void fetchClientProfile(auth.client, name)
      .then(value => {
        if (active) setP(value);
      })
      .catch(error => {
        if (active)
          setProfileError(
            error instanceof Error
              ? error.message
              : "The client profile could not be read.",
          );
      });
    return () => {
      active = false;
    };
  }, [auth.client, name]);
  // Hooks before any early return, so their order never changes.
  // The chase list can run past a hundred rows: first 20, the rest on a tap.
  const [staleAll, setStaleAll] = useState(false);
  // The Calls part says when it shows the dialer's lost reasons; until then
  // (loading, an error, a done-with-you client, nobody lost in the dialer)
  // Results keeps the GoHighLevel list, so lost reasons always show once.
  const [callsShowLost, setCallsShowLost] = useState(false);
  const earliest = useMemo(() => firstDate(p ?? {}), [p]);
  const per = useMemo(
    () => periodOf(period, kuwaitToday(), earliest),
    [period, earliest],
  );
  const fig = useMemo(() => periodFigures(p ?? {}, per), [p, per]);
  const months = useMemo(() => monthsAvailable(p ?? {}), [p]);
  const changes = useMemo(
    () => changesIn(p?.changes as CardChange[] | undefined, per.from, per.to),
    [p, per],
  );
  const byAdAll = useMemo(
    () =>
      byAdIn(
        (p?.performance?.appointments ?? []) as Any[],
        per.from,
        per.to,
        undefined,
        Number.POSITIVE_INFINITY,
      ),
    [p, per],
  );
  const byAd = byAdAll.slice(0, AD_TABLE_LIMIT);
  if (profileError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {profileError}
      </p>
    );
  if (p === undefined)
    return <div className="text-sm text-muted-foreground">Loading {name}…</div>;
  if (p === null)
    return (
      <div className="space-y-3">
        {onBack && !embedded ? (
          <Button size="sm" variant="ghost" className="-ml-3" onClick={onBack}>
            <ArrowLeft aria-hidden />
            All clients
          </Button>
        ) : null}
        <p className="text-sm text-muted-foreground">
          No profile stored for {name} yet. It fills in on the next sync, within
          15 minutes of the client's ClickUp card being found.
        </p>
      </div>
    );
  const showOverview = part !== "results";
  const showResults = part !== "overview";
  const perf = p.performance ?? {};
  const { m, l } = fig;
  const all = perf.allTime ?? {};
  const stale: Any[] = perf.stale ?? [];
  const dwy = serviceModel(p.service).dwy;
  /** "12 in September 2026", "12 in the 7 days before"; nothing for all time. */
  // This month is still running; last month is whole. Say so, or a month
  // to date beside a full month reads as a fall.
  const running = per.to > kuwaitToday();
  const was = (key: string) =>
    l && per.prevLabel
      ? `${count(l[key])} in ${running && per.month ? "all of " : ""}${per.prevLabel}`
      : undefined;
  // Leads come from the ads in every period; only a client with no ad
  // history for the period falls back to the sheet, and leadsFrom says so.
  const leadsFromAds = m.leadsFrom !== "sheet";
  const recentCount = ((perf.recent ?? []) as Any[]).length;
  const hasSheet = Boolean(p.links?.sheet);
  const lostShown = Boolean(
    p.lost && ((p.lost.reasons ?? []).length || (p.lost.leads ?? []).length),
  );
  const adsTabHref = p.taskId
    ? `/clients/${encodeURIComponent(String(p.taskId))}?tab=ads&period=${encodeURIComponent(period)}`
    : undefined;
  const provisionalShown = Boolean(
    p.provisional && (p.provisional.count || p.provisional.callbacks),
  );
  const staleCount =
    typeof perf.staleCount === "number" ? perf.staleCount : undefined;
  const resultsParts: ResultsPart[] = [
    { id: "results-numbers", label: "Numbers" },
    { id: "results-calls", label: "Calls" },
    { id: "results-ads", label: "Ads" },
    { id: "results-changes", label: "Changes", count: changes.length },
    ...(hasSheet && !dwy
      ? [
          {
            id: "results-appointments",
            label: "Appointments",
            count: staleCount,
          },
        ]
      : []),
    ...(hasSheet && (byAd.length || recentCount)
      ? [{ id: "results-leads", label: "Leads", count: recentCount }]
      : []),
    ...(lostShown && !callsShowLost
      ? [
          {
            id: "results-lost",
            label: "Lost reasons",
            count: num(p.lost.total),
          },
        ]
      : []),
    ...(provisionalShown
      ? [
          {
            id: "results-provisional",
            label: "Provisional",
            count: num(p.provisional.count),
          },
        ]
      : []),
    { id: "results-report", label: "Report" },
  ];
  return (
    <div className="space-y-6">
      {embedded ? (
        showResults ? (
          // The period and the report sit together at the top of Results.
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {capital(per.label)}
                {per.prevLabel ? `, compared with ${per.prevLabel}` : ""}. The
                numbers, the report and the charts all follow this.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openReport(p, per, fig)}
              >
                Print report, {per.label}
              </Button>
            </div>
            <PeriodBar
              per={per}
              value={period}
              onChange={onPeriod}
              months={months}
              earliest={earliest}
            />
          </div>
        ) : null
      ) : (
        <div className="space-y-3">
          {onBack ? (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-3"
              onClick={onBack}
            >
              <ArrowLeft aria-hidden />
              All clients
            </Button>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight" dir="auto">
                {p.clientName}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  displayLabel(p.stage),
                  serviceModel(p.service).label,
                  displayLabel(p.happiness),
                  p.liveDays != null ? `${p.liveDays} days live` : null,
                  p.ghlName && p.ghlName !== p.clientName
                    ? `GHL: ${p.ghlName}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openReport(p, per, fig)}
            >
              Print report, {per.label}
            </Button>
          </div>
          <PeriodBar
            per={per}
            value={period}
            onChange={onPeriod}
            months={months}
            earliest={earliest}
          />
          {p.taskId ? (
            <ClientCheckIn
              taskId={String(p.taskId)}
              clientName={String(p.clientName)}
              nextCallAt={p.nextCallAt}
              stage={p.stage ? String(p.stage) : undefined}
            />
          ) : null}
          {p.taskId ? (
            <div className="flex flex-wrap items-start gap-2">
              <AddTask
                taskId={String(p.taskId)}
                clientName={String(p.clientName)}
              />
              <PortalTasksButton
                taskId={String(p.taskId)}
                clientName={String(p.clientName)}
              />
            </div>
          ) : null}
        </div>
      )}

      {embedded ? null : (
        <ClientLinks links={(p.links ?? {}) as Record<string, string>} />
      )}

      {showOverview ? (
        <>
          <BeforeTheCall p={p} withBrief={withBrief} />

          {afterPrep}

          {withBrief ? null : (
            <>
              <DosDontsCard
                text={p.dosDonts as string | undefined}
                url={p.links?.clickup as string | undefined}
              />

              <ClientUpdates
                updates={p.updates as never}
                focus="csm"
                url={p.links?.clickup as string | undefined}
              />

              <RecentCalls
                calls={(p.calls as Any[]) ?? []}
                brief={p.callsBrief as string | undefined}
              />
            </>
          )}
        </>
      ) : null}

      {showResults ? (
        <>
          <ResultsNav parts={resultsParts} />
          <ResultsParts>
            <ResultsSection
              id="results-numbers"
              title="Numbers"
              lede={`${capital(per.label)}, from their ${dwy ? "ads" : "sheet"}.`}
            >
              {perf.error ? (
                <div className="callout-warn space-y-1 rounded-2xl border p-4 text-sm">
                  <p className="font-medium">
                    {/UNAUTHENTICATED|401/.test(String(perf.error))
                      ? "Their numbers are not showing because our Google Sheets connection is down, not because the sheet is empty."
                      : "Their sheet could not be read."}
                  </p>
                  <p className="text-xs">
                    {/UNAUTHENTICATED|401/.test(String(perf.error))
                      ? "Google returned 401 invalid credentials. Reconnect Google Sheets in integrations and the numbers refill on the next sync, within 15 minutes. Nothing has been lost, and nothing here is a guess."
                      : String(perf.error)}
                  </p>
                </div>
              ) : null}
              {!p.links?.sheet && !dwy ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                  No performance sheet is linked on their ClickUp record, so
                  there are no outcomes to show. Add the Sheet Link field and
                  this fills in on the next sync.
                </div>
              ) : (
                <div className="space-y-4">
                  {dwy ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <StatTile
                          label={leadsFromAds ? "Leads (from ads)" : "Leads"}
                          value={num(m.leads)}
                          sub={was("leads")}
                        />
                        <StatTile
                          label="Spent"
                          value={`$${Math.round(num(m.spend))}`}
                          sub={
                            l
                              ? `$${Math.round(num(l.spend))} in ${per.prevLabel}`
                              : undefined
                          }
                        />
                        <StatTile
                          label="Cost per lead"
                          value={m.cpl != null ? `$${m.cpl}` : "-"}
                          sub={
                            l?.cpl != null
                              ? `$${l.cpl} in ${per.prevLabel}`
                              : undefined
                          }
                          className="col-span-2 sm:col-span-1"
                        />
                      </div>
                      <ProfileTrends
                        p={p}
                        from={per.from}
                        to={upTo(per)}
                        changes={changes}
                        adsOnly
                      />
                      <p className="text-xs text-muted-foreground">
                        Done with you: the client books their own appointments,
                        so bookings, attendance and closes are not ours to
                        report. Leads and cost per lead are the numbers we own.
                      </p>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <StatTile
                          label={leadsFromAds ? "Leads (from ads)" : "Leads"}
                          value={num(m.leads)}
                          sub={was("leads")}
                        />
                        <StatTile
                          label="Booked"
                          value={num(m.booked)}
                          sub={was("booked")}
                        />
                        <StatTile
                          label="Attended"
                          value={num(m.shows)}
                          sub={
                            m.showRate != null
                              ? `${m.showRate}% of decided`
                              : "No outcome yet"
                          }
                        />
                        <StatTile
                          label="No show"
                          value={num(m.noshows)}
                          sub={was("noshows")}
                        />
                        <StatTile
                          label="Quotes"
                          value={num(m.quotes)}
                          sub={was("quotes")}
                        />
                        <StatTile
                          label="Closed"
                          value={num(m.closes)}
                          tone={num(m.closes) ? "txt-good" : undefined}
                          sub={
                            m.closeRate != null
                              ? `${m.closeRate}% of attended`
                              : was("closes")
                          }
                        />
                      </div>
                      {m.spend ? (
                        <p className="text-xs text-muted-foreground">
                          ${Math.round(num(m.spend))} spent on their ads
                          {m.cpl != null ? `, $${m.cpl} per lead` : ""}.
                        </p>
                      ) : null}
                      <ProfileTrends
                        p={p}
                        from={per.from}
                        to={upTo(per)}
                        changes={changes}
                      />
                    </div>
                  )}
                  {!dwy && (
                    <p className="text-xs text-muted-foreground">
                      All time on this sheet: {num(all.leads)} leads ·{" "}
                      {num(all.booked)} booked · {num(all.shows)} attended ·{" "}
                      {num(all.closes)} closed
                      {perf.undated
                        ? ` · ${perf.undated} rows have no date`
                        : ""}{" "}
                      · source: {perf.source}
                    </p>
                  )}
                  {perf.staleReason ? (
                    <p className="callout-warn rounded-2xl border px-4 py-3 text-xs">
                      {perf.staleAt ? (
                        <>
                          These numbers were last read on{" "}
                          {shortDay(perf.staleAt)}.
                        </>
                      ) : (
                        "The last confirmed read date is unknown."
                      )}{" "}
                      The last verified values are retained. Reason:{" "}
                      {perf.staleReason}
                    </p>
                  ) : null}
                </div>
              )}
            </ResultsSection>

            {/* The call centre for this client (Aziz, 2026-10-13): reads on
                its own and never holds up the rest of the tab. */}
            <CallCentreSection
              taskId={p.taskId ? String(p.taskId) : undefined}
              from={per.from}
              to={per.to}
              lostElsewhereHref={lostShown ? adsTabHref : undefined}
              onLostShown={setCallsShowLost}
            />

            {/* The ads have their own tab since 2026-10-13 (Aziz: the CSM
                sees them as the media buyer does), so they show once. */}
            <ResultsSection id="results-ads" title="Ads">
              {adsTabHref ? (
                <Link
                  to={adsTabHref}
                  className="inline-flex items-center gap-0.5 text-sm text-primary underline-offset-4 hover:underline"
                >
                  See every campaign, ad set and ad for {per.label} on the Ads
                  tab
                  <ChevronRight aria-hidden className="size-4 shrink-0" />
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This client has no ClickUp card yet, so their ads cannot be
                  matched.
                </p>
              )}
            </ResultsSection>

            <ChangesList
              changes={changes}
              per={per}
              stale={
                p?.changesError
                  ? `The change history could not be read: ${p.changesError}`
                  : staleSentence(
                      p?.changesHealth as SourceHealth | undefined,
                      "csm-media-changes",
                    )
              }
            />

            {hasSheet && !dwy ? (
              <ResultsSection
                id="results-appointments"
                title="Appointments with no outcome"
                count={staleCount}
                lede="On their sheet. Every unfilled row reads as a loss in the monthly report, so chase these before the next check-in call."
              >
                {typeof perf.staleCount === "number" &&
                perf.staleCount > stale.length ? (
                  <p className="text-xs text-muted-foreground">
                    The first {stale.length} are listed here; the other{" "}
                    {perf.staleCount - stale.length} are on the client's sheet.
                  </p>
                ) : null}
                {stale.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing outstanding, every appointment has an outcome.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-2xl border bg-card">
                      <table className="w-full min-w-max">
                        <thead className="border-b">
                          <tr>
                            {[
                              "Name",
                              "Added",
                              "Appointment",
                              "Caller",
                              "Missing",
                              "Days",
                            ].map(h => (
                              <Th key={h}>{h}</Th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(staleAll ? stale : stale.slice(0, 20)).map(r => (
                            <tr key={`${r.name}-${r.added}-${r.appDate}`}>
                              <Cell v={r.name} />
                              <Cell v={shortDay(r.added)} muted />
                              <Cell v={shortDay(r.appDate)} />
                              <Cell v={r.caller} muted />
                              <Cell v={r.missing} />
                              <Cell v={r.appDaysAgo ?? r.ageDays} />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {stale.length > 20 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStaleAll(v => !v)}
                      >
                        {staleAll
                          ? "Show fewer"
                          : `Show ${stale.length - 20} more`}
                      </Button>
                    ) : null}
                  </>
                )}
              </ResultsSection>
            ) : null}
            {hasSheet && (byAd.length || recentCount) ? (
              <ResultsSection
                id="results-leads"
                title="Leads"
                lede="Which ad brings leads who turn up and buy, then the latest leads one by one."
              >
                {byAd.length ? (
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Which ad is producing the better leads
                      </h3>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {capital(per.label)}, per ad
                        {byAdAll.length > byAd.length
                          ? `, the ${byAd.length} with the most closes of ${byAdAll.length}`
                          : ""}
                        . Judge an ad on what its leads did, not on how many it
                        produced. "No outcome" is the ad's rows nobody filled
                        in, so a high number there means the comparison is not
                        fair yet.
                      </p>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border bg-card">
                      <table className="w-full min-w-max">
                        <thead className="border-b">
                          <tr>
                            {[
                              "Ad or source",
                              "Leads",
                              "Attended",
                              "Attendance",
                              "Closed",
                              "Close rate",
                              "No outcome",
                            ].map(h => (
                              <Th key={h}>{h}</Th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {byAd.map(a => (
                            <tr key={a.ad}>
                              <Cell v={a.ad} />
                              <Cell v={a.leads} />
                              <Cell v={a.shows} />
                              <Cell
                                v={a.showRate == null ? "-" : `${a.showRate}%`}
                                muted
                              />
                              <td className="px-3 py-2 text-sm tabular-nums">
                                {num(a.closes) ? (
                                  <span className="font-medium txt-good">
                                    {a.closes}
                                  </span>
                                ) : (
                                  "0"
                                )}
                              </td>
                              <Cell
                                v={
                                  a.closeRate == null ? "-" : `${a.closeRate}%`
                                }
                                muted
                              />
                              <Cell v={a.unknown ?? 0} muted />
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
                {recentCount ? <LeadsByAd rows={perf.recent as Any[]} /> : null}
              </ResultsSection>
            ) : null}

            {lostShown && !callsShowLost ? (
              <LostLeads lost={p.lost as Any} />
            ) : null}
            {provisionalShown ? (
              <Provisional pv={p.provisional as Any} />
            ) : null}
            <ReportSection p={p} per={per} fig={fig} />
          </ResultsParts>
        </>
      ) : null}

      {showOverview && !withBrief && p.profileText ? (
        <section className="space-y-3">
          <SectionTitle>Client profile</SectionTitle>
          <p
            className="whitespace-pre-wrap rounded-2xl border bg-card p-4 text-sm sm:p-6"
            dir="auto"
          >
            {p.profileText}
          </p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Which ClickUp stages count as a paying client. "Stopped" and "Cancelled onboarding" are
 * churned and are hidden here on purpose: a churned client on this board is noise, and
 * their numbers stopped meaning anything the day they left. Paused sits in its own group
 * because a pause is a decision waiting to be made, not a live account.
 */
const GROUPS = [
  {
    key: "active",
    label: "Active",
    hint: "Live and paying. These are the numbers that matter.",
    match: (stage: string) => /^active/i.test(stage),
  },
  {
    key: "onboarding",
    label: "Onboarding",
    hint: "Not live yet, so there is nothing to judge, only speed to launch.",
    match: (stage: string) =>
      /contact|booked|ready for launch|ghosted|delay/i.test(stage),
  },
  {
    key: "paused",
    label: "Paused",
    hint: "Counted as churned once they pass 14 days paused.",
    match: (stage: string) => /pause|freeze|hold/i.test(stage),
  },
] as const;

const isChurnedStage = (stage: string) =>
  /stop|cancel|churn|offboard|lost/i.test(stage ?? "");

/** The last twelve months, newest first, for the list's month picker. */
function lastMonths(today: string): string[] {
  const out: string[] = [];
  let d = `${today.slice(0, 7)}-01`;
  for (let i = 0; i < 12; i++) {
    out.push(d.slice(0, 7));
    d = `${shiftDay(d, -1).slice(0, 7)}-01`;
  }
  return out;
}

export function ClientPerformancePage({
  embedded = false,
  onOpen,
}: {
  /** Inside Clients as its Results view: no page title of its own. */
  embedded?: boolean;
  /** Open a client on its own page, with the period picked here. */
  onOpen?: (clientName: string, period: PeriodKey) => void;
} = {}) {
  const auth = useCockpitAuth();
  const [data, setData] = useState<Any | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(undefined);
    setError(null);
    if (!auth.client) return;
    let active = true;
    void fetchPerformanceOverview(auth.client, auth.clients)
      .then(value => {
        if (active) setData(value);
      })
      .catch(error => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Client results could not be read.",
          );
      });
    return () => {
      active = false;
    };
  }, [auth.client, auth.clients]);
  // One reporting period for the list and every client opened from it.
  const [period, setPeriod] = useState<PeriodKey>("month");
  const per = useMemo(() => periodOf(period, kuwaitToday()), [period]);
  // Every period, "This month" included, counts leads from the ads; the
  // sheets' month tabs add their outcome counts on top (withSheetMonth).
  const [rangedRows, setRangedRows] = useState<Any[] | undefined>(undefined);
  useEffect(() => {
    setRangedRows(undefined);
    if (!auth.client) return;
    let active = true;
    void fetchPerformancePeriod(auth.client, per.from, upTo(per))
      .then(value => {
        if (active) setRangedRows(value);
      })
      .catch(error => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "The reporting period could not be read.",
          );
      });
    return () => {
      active = false;
    };
  }, [auth.client, per]);
  const ranged = useMemo(
    () =>
      rangedRows
        ? new Map(rangedRows.map(r => [String(r.clientName), r]))
        : undefined,
    [rangedRows],
  );
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"active" | "onboarding" | "paused">(
    "active",
  );
  // The profile opens from state, not the URL: tell the Hermes chat which
  // client is on screen so its answers carry that client's numbers.
  useEffect(() => {
    publishOpenClient(openClient);
    return () => publishOpenClient(null);
  }, [openClient]);

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (data === undefined)
    return (
      <div
        className={
          embedded
            ? "text-sm text-muted-foreground"
            : "mx-auto w-full max-w-6xl text-sm text-muted-foreground"
        }
      >
        Loading client results…
      </div>
    );

  const all = (data.clients ?? []) as Any[];
  // The backend sorts each client into a group from the media buyer's
  // bucket (the ClickUp stage rule lives there); the stage regex is only
  // for a row that arrived without one.
  const groupOf = (c: Any): string =>
    c.group ??
    (isChurnedStage(c.stage ?? "")
      ? "churned"
      : (GROUPS.find(g => g.match(c.stage ?? ""))?.key ?? "active"));
  const churned = all.filter(c => groupOf(c) === "churned");
  const live = all.filter(c => groupOf(c) !== "churned");
  const chosen = GROUPS.find(g => g.key === group) ?? GROUPS[0];
  const inGroup = live.filter(c => groupOf(c) === chosen.key);
  const filtered = query.trim().length > 0;
  const rows = inGroup.filter(c =>
    c.clientName.toLowerCase().includes(query.trim().toLowerCase()),
  );
  // DWY clients keep their own appointment tracking, so their unfilled rows are not our
  // chase list and must not inflate it.
  const totalStale = rows.reduce(
    (n, c) => n + (serviceModel(c.service).dwy ? 0 : num(c.staleCount)),
    0,
  );
  const waiting = live.filter(c => (c.reportNudge as Any)?.url);
  // The list's numbers for the period: ad leads from the period query, and
  // for this month the sheet's month-tab outcomes on top. Missing stays
  // missing ("-"), never 0.
  const periodLoading = ranged === undefined;
  const figuresOf = (c: Any): Any => {
    const adBased = ranged?.get(c.clientName);
    return period === "month" ? withSheetMonth(adBased, c.month) : adBased;
  };

  return (
    <div
      className={embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"}
    >
      {embedded ? null : (
        <PageHeader
          title="Client performance"
          sub="Every client's own numbers, straight off their performance sheet. Open a client for their drive, their CRM, their ads and a report you can send."
          actions={<ReportIssue page="performance" />}
        />
      )}

      {!openClient && waiting.length ? (
        <details className="callout-warn rounded-2xl border px-4 py-3 text-sm sm:px-6">
          <summary className="font-medium">
            {waiting.length} weekly report reminder
            {waiting.length === 1 ? "" : "s"} waiting for your approval
          </summary>
          <p className="mt-2 text-xs">
            Posted in #csm-general this week. Nothing reaches a client until you
            open it and press send.
          </p>
          <ul className="mt-2 space-y-1">
            {waiting.map(c => (
              <li key={c.clientName}>
                <a
                  className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                  href={String((c.reportNudge as Any).url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.clientName}
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </a>{" "}
                <span className="text-xs text-muted-foreground">
                  {(c.reportNudge as Any).missing} with no outcome
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {openClient ? (
        <ClientProfile
          name={openClient}
          onBack={() => setOpenClient(null)}
          period={period}
          onPeriod={setPeriod}
        />
      ) : (
        <>
          <div className="space-y-2">
            <PillRow>
              {GROUPS.map(g => {
                const n = live.filter(c => groupOf(c) === g.key).length;
                return (
                  <Pill
                    key={g.key}
                    active={group === g.key}
                    onClick={() => setGroup(g.key)}
                  >
                    {g.label} ({n})
                  </Pill>
                );
              })}
            </PillRow>
            <p className="text-xs text-muted-foreground">
              {chosen.hint}
              {churned.length
                ? ` ${plural(churned.length, "churned client")} hidden.`
                : ""}
            </p>
          </div>

          <PeriodBar
            per={per}
            value={period}
            onChange={setPeriod}
            months={lastMonths(kuwaitToday())}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <StatTile
              label="Clients"
              value={rows.length}
              sub={
                filtered
                  ? `${rows.length} of ${inGroup.length} match the search`
                  : undefined
              }
            />
            <StatTile
              label="Appointments with no outcome"
              value={totalStale}
              tone={totalStale ? "txt-bad" : "txt-good"}
              sub={`Across the ${filtered ? "matching " : ""}${chosen.label.toLowerCase()} clients' sheets`}
            />
            <StatTile
              label={`Closed, ${per.label}`}
              value={
                periodLoading
                  ? "…"
                  : rows.reduce(
                      (n, c) =>
                        // Done-with-you clients close on their own, and their
                        // row shows "-" for it, so the total leaves them out.
                        n +
                        (serviceModel(c.service).dwy
                          ? 0
                          : num(figuresOf(c)?.closes)),
                      0,
                    )
              }
              sub="What done-for-you clients banked"
              className="col-span-2 sm:col-span-1"
            />
          </div>

          <BookTrends
            trend={(data.trendByGroup?.[group] ?? data.trend) as Any[]}
            weekly={
              (data.weeklyByGroup?.[group] ?? data.weeklyOutcomes) as Any[]
            }
            label={chosen.label.toLowerCase()}
          />

          <section className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold">
                  {chosen.label} clients
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {periodLoading
                    ? `Loading ${per.label}…`
                    : `Leads to closed are ${per.label}.`}{" "}
                  Biggest admin debt first: sorted by how many appointments are
                  missing an outcome.
                </p>
              </div>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Find a client…"
                aria-label="Find a client"
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm sm:w-64"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead className="border-b">
                  <tr>
                    {[
                      "Client",
                      "Stage",
                      "Leads",
                      "Booked",
                      "Attended",
                      "Closed",
                      "No outcome",
                      "Ads",
                      "",
                    ].map(h => (
                      <Th key={h}>{h}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(c => (
                    <tr key={c.clientName} className="hover:bg-muted/40">
                      <td className="px-3 py-2 pl-4 text-sm font-medium sm:pl-6">
                        <span dir="auto">{c.clientName}</span>
                        {serviceModel(c.service).dwy ? (
                          <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                            DWY
                          </span>
                        ) : !c.hasSheet ? (
                          <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                            No sheet linked
                          </span>
                        ) : null}
                      </td>
                      <Cell v={displayLabel(c.stage)} muted />
                      <Cell
                        v={periodLoading ? "…" : count(figuresOf(c)?.leads)}
                        muted={periodLoading}
                      />
                      <Cell
                        v={
                          serviceModel(c.service).dwy
                            ? "-"
                            : periodLoading
                              ? "…"
                              : count(figuresOf(c)?.booked)
                        }
                        muted={serviceModel(c.service).dwy || periodLoading}
                      />
                      <Cell
                        v={
                          serviceModel(c.service).dwy
                            ? "-"
                            : periodLoading
                              ? "…"
                              : count(figuresOf(c)?.shows)
                        }
                        muted={serviceModel(c.service).dwy || periodLoading}
                      />
                      <Cell
                        v={
                          serviceModel(c.service).dwy
                            ? "-"
                            : periodLoading
                              ? "…"
                              : count(figuresOf(c)?.closes)
                        }
                        muted={serviceModel(c.service).dwy || periodLoading}
                      />
                      <td className="px-3 py-2 text-sm tabular-nums">
                        {serviceModel(c.service).dwy ? (
                          <span className="text-muted-foreground">-</span>
                        ) : c.sheetError ? (
                          <span
                            className="text-muted-foreground"
                            title={String(c.sheetError)}
                          >
                            Sheet unreadable
                          </span>
                        ) : typeof c.staleCount !== "number" ? (
                          <span className="text-muted-foreground">-</span>
                        ) : c.staleCount ? (
                          <span className="tone-bad rounded-full px-2 py-0.5 font-medium">
                            {c.staleCount}
                          </span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {!c.live || c.adsAccess === "no_access" ? (
                          <span className="text-muted-foreground">
                            No access
                          </span>
                        ) : c.adsAccess === "no_campaigns" ? (
                          <span className="text-muted-foreground">
                            Not linked
                          </span>
                        ) : num(c.live.ads) === 0 ? (
                          <span className="tone-bad rounded-full px-2 py-0.5 font-medium">
                            Nothing live
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {num(c.live.ads)} live
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 pr-4 text-right sm:pr-6">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onOpen
                              ? onOpen(c.clientName, period)
                              : setOpenClient(c.clientName)
                          }
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
