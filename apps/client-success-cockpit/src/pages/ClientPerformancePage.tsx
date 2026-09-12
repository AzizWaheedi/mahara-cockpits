import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type Constraint, diagnose } from "@/lib/csmDiagnosis";
import { serviceModel } from "@/lib/csmTemplates";
import { api } from "../../convex/_generated/api";
import { AiHelper } from "./CsmPage";

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

function Cell({ v, muted }: { v: unknown; muted?: boolean }) {
  const text = v === null || v === undefined || v === "" ? "-" : String(v);
  return (
    <td
      className={`px-3 py-2 text-sm tabular-nums ${muted ? "text-muted-foreground" : ""}`}
    >
      {text}
    </td>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

const LINK_LABELS: { key: string; label: string; hint: string }[] = [
  {
    key: "sheet",
    label: "Performance sheet",
    hint: "leads, appointments, outcomes",
  },
  {
    key: "drive",
    label: "Client drive",
    hint: "raw and finished creative, sheets",
  },
  { key: "ghl", label: "GHL sub-account", hint: "app.maharamedia.com" },
  { key: "adAccount", label: "Ad account", hint: "Meta Ads Manager" },
  { key: "clickup", label: "ClickUp record", hint: "stage, dates, fields" },
  { key: "contract", label: "Contract", hint: "signed agreement" },
];

function Links({ links }: { links: Record<string, string> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {LINK_LABELS.map(l => {
        const href = links?.[l.key];
        return href ? (
          <a
            key={l.key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border bg-card px-3 py-2 hover:bg-accent"
          >
            <div className="text-sm font-medium">{l.label} ↗</div>
            <div className="text-xs text-muted-foreground">{l.hint}</div>
          </a>
        ) : (
          <div
            key={l.key}
            className="rounded-lg border border-dashed px-3 py-2 opacity-60"
          >
            <div className="text-sm font-medium">{l.label}</div>
            <div className="text-xs text-muted-foreground">
              not on their ClickUp record yet
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A printable one-pager. Opened in a new tab; Cmd/Ctrl+P saves it as a PDF. */
function reportHtml(p: Any): string {
  const perf = p.performance ?? {};
  const m = perf.month ?? {};
  const l = perf.lastMonth ?? {};
  const rows = (perf.stale ?? []) as Any[];
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
  <div class="sub">Performance report · ${esc(perf.monthLabel ?? "")} · generated ${new Date().toISOString().slice(0, 10)} · source: the client's own performance sheet</div>
  <h2>${dwy ? "Lead volume" : "The funnel"}</h2>
  <table><tr><th>Metric</th><th class="n">${esc(perf.monthLabel ?? "This month")}</th><th class="n">${esc(perf.lastMonthLabel ?? "Last month")}</th></tr>
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
  ${dwy ? "" : `<h2>Appointments with no outcome on the sheet (${rows.length})</h2>`}
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

function openReport(p: Any) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(reportHtml(p));
  w.document.close();
}

function AdTree({ ads }: { ads: Any[] }) {
  const [openAd, setOpenAd] = useState<string | null>(null);
  if (!ads?.length)
    return (
      <p className="text-sm text-muted-foreground">
        No campaigns are synced for this client. If they are running ads, the
        ads board is missing the client name, use the report button at the
        bottom-right and I will fix the mapping.
      </p>
    );
  return (
    <div className="space-y-4">
      {ads.map(c => (
        <div key={c.campaign} className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <div>
              <div className="text-sm font-semibold">{c.campaign}</div>
              <div className="text-xs text-muted-foreground">
                {c.account} · {c.status ?? "status unknown"}
              </div>
            </div>
            <div className="flex gap-4 text-xs tabular-nums text-muted-foreground">
              <span>{num(c.leads7d)} leads 7d</span>
              <span>
                {c.cpl ? `$${Number(c.cpl).toFixed(2)} per lead` : "no CPL"}
              </span>
              <span>{num(c.bookings7d)} booked</span>
              <span>{num(c.showed7d)} showed</span>
            </div>
          </div>
          {(c.adsets ?? []).length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Meta will not show us the ad sets or the creative for this
              account. Mahara's Meta app has not been granted access to ad
              account {c.accountId ?? "this one"}, so the spend and lead numbers
              above come from the campaign report while the previews stay
              locked. Fix is in Meta Business Settings: assign the account to
              Mahara's portfolio, then reauthorize with it selected.
            </p>
          ) : null}
          <div className="divide-y">
            {(c.adsets ?? []).map((s: Any) => (
              <div key={s.name} className="px-3 py-2">
                <div className="text-sm font-medium">
                  {s.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {s.status}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(s.ads ?? []).map((ad: Any) => (
                    <Button
                      key={ad.name + ad.previewSrc}
                      size="sm"
                      variant={
                        openAd === ad.previewSrc ? "default" : "secondary"
                      }
                      onClick={() =>
                        setOpenAd(
                          openAd === ad.previewSrc ? null : ad.previewSrc,
                        )
                      }
                    >
                      {ad.name} · {ad.status}
                    </Button>
                  ))}
                </div>
                {(s.ads ?? []).some((a: Any) => a.previewSrc === openAd) &&
                openAd ? (
                  <iframe
                    title="Ad preview"
                    src={openAd}
                    className="mt-2 h-[520px] w-full max-w-[420px] rounded-md border"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
  const tone =
    c.layer === "macro"
      ? "border-rose-300 bg-rose-50"
      : c.layer === "admin"
        ? "border-amber-300 bg-amber-50"
        : "border-sky-300 bg-sky-50";
  return (
    <div className={`rounded-lg border ${first ? tone : "bg-card"}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="flex items-center gap-2">
            {first ? (
              <span className="rounded bg-[#091333] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                Fix this first
              </span>
            ) : null}
            <span className="rounded border px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {c.layer === "macro"
                ? "whole system"
                : c.layer === "admin"
                  ? "our admin"
                  : "one leak"}
            </span>
            {c.owner ? (
              <span className="text-[12px] text-muted-foreground">
                owner: {c.owner}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm font-semibold">{c.title}</div>
          <div className="text-xs text-muted-foreground">{c.evidence}</div>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t px-4 py-3">
          <p className="text-sm">{c.diagnosis}</p>
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What to do
            </div>
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
                  className="mt-1"
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
              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What to say
                </div>
                {(["en", "ar"] as const).map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLang(l)}
                    className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                      lang === l
                        ? "border-teal-400 bg-teal-50 text-teal-800"
                        : ""
                    }`}
                  >
                    {l}
                  </button>
                ))}
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
 * One card that makes the CSM walk into a call with solutions instead of questions.
 *
 * The company rule is that the CSM always brings solutions. That is a preparation problem, not a
 * character problem, so this assembles the four things a good call needs from data already on
 * the profile: where the client stands, the single constraint to lead with, the fix to offer,
 * and the ask that is owed. Nothing here is invented. When a number is missing the card says
 * what to ask for instead of guessing.
 */
function CallPrep({ p }: { p: Any }) {
  const [open, setOpen] = useState(false);
  const perf = (p.performance ?? {}) as Any;
  const d = useMemo(() => diagnose(p), [p]);
  const m = (perf.month ?? {}) as Any;
  const l = (perf.lastMonth ?? {}) as Any;
  const useLast = Number(m.leads ?? 0) === 0 && Number(l.leads ?? 0) > 0;
  const n = useLast ? l : m;
  const label = useLast
    ? (perf.lastMonthLabel ?? "last month")
    : (perf.monthLabel ?? "this month");
  const lead = d.top ?? d.rest?.[0];
  const stale = Number(perf.staleCount ?? 0);
  const facts = [
    `${label}: ${Number(n.leads ?? 0)} enquiries, ${Number(n.booked ?? 0)} booked, ${Number(n.shows ?? 0)} attended, ${Number(n.closes ?? 0)} closed`,
    stale
      ? `${stale} appointments still have no outcome on their sheet`
      : "Every appointment has an outcome, their tracking is clean",
    p.liveDays != null
      ? `Live ${p.liveDays} days, stage ${p.stage ?? "unknown"}`
      : `Stage ${p.stage ?? "unknown"}`,
    p.happiness
      ? `Their own happiness rating: ${p.happiness}`
      : "No happiness rating on their record, ask for one",
  ];
  const nudge = p.reportNudge as Any;
  return (
    <section className="space-y-3 rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
      {nudge?.url ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">
            This week's report reminder is waiting for your approval
          </p>
          <p className="mt-0.5 text-xs text-amber-900">
            {nudge.missing} appointment{nudge.missing === 1 ? "" : "s"} with no
            outcome. Nothing reaches the client until you open this and press
            send.
          </p>
          <a
            className="mt-2 inline-block rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            href={String(nudge.url)}
            target="_blank"
            rel="noreferrer"
          >
            Review and send ↗
          </a>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Prep for this call
          </h3>
          <p className="text-xs text-muted-foreground">
            Read this once before you dial. Lead with the constraint, offer the
            fix, then make the ask.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(v => !v)}>
          {open ? "Hide" : "Open"}
        </Button>
      </div>
      {open ? (
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium">Where they stand</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {facts.map(f => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">Lead with this</p>
            <p className="mt-1 text-muted-foreground">
              {lead ? lead.title : d.headline}
            </p>
          </div>
          {lead?.fixes?.length ? (
            <div>
              <p className="font-medium">The fix you are bringing</p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {lead.fixes.slice(0, 3).map((x: string) => (
                  <li key={x}>• {x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="font-medium">Before you hang up</p>
            <p className="mt-1 text-muted-foreground">
              {stale
                ? "Agree who fills the missing outcomes and by when. Get a name, not a nod."
                : "Book the next check in on the call, and ask for the review or the referral while they are happy."}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DiagnosisSection({ p }: { p: Any }) {
  const d = diagnose(p);
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          What is holding this client back
        </h3>
        <p className="text-sm">{d.headline}</p>
        <p className="text-xs text-muted-foreground">Judged on {d.basis}.</p>
      </div>
      {d.healthy ? null : (
        <div className="space-y-2">
          {d.top ? <ConstraintCard c={d.top} first /> : null}
          {d.rest.map(c => (
            <ConstraintCard key={c.id} c={c} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Gates: cost per lead under $20 · a quarter of leads booked · 75% of
        appointments attended · a fifth of attended closed. Fixes come from
        Diagnosing &amp; Fixing Acquisition Constraints, one leak at a time.
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

function ReportSection({ p }: { p: Any }) {
  const request = useMutation(api.csm.requestReportDoc);
  const [note, setNote] = useState("");
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [busy, setBusy] = useState(false);
  const [extras, setExtras] = useState<string[]>(REPORT_EXTRAS.map(e => e.key));
  const reports: Any[] = p.reports ?? [];
  const pending = reports.find((r: Any) => !r.builtAt);
  const ready = reports.filter((r: Any) => r.builtAt);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Monthly report
        </h3>
        <p className="text-sm text-muted-foreground">
          I write it as a Google Doc you can edit before it goes anywhere. Same
          template every month, so the client learns to read it.
        </p>
      </div>
      <div className="rounded border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Always in the report</p>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {REPORT_TEMPLATE.map(line => (
            <li key={line}>• {line}</li>
          ))}
        </ul>
        <p className="mt-3 font-medium">Want anything else in this one?</p>
        <div className="mt-1 space-y-1">
          {REPORT_EXTRAS.map(e => (
            <label
              key={e.key}
              className="flex items-start gap-2 text-muted-foreground"
            >
              <input
                type="checkbox"
                className="mt-1"
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
      <div className="flex flex-wrap items-center gap-2">
        {(["en", "ar"] as const).map(l => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`rounded border px-2 py-1 text-xs font-semibold uppercase ${
              lang === l ? "border-teal-400 bg-teal-50 text-teal-800" : ""
            }`}
          >
            {l}
          </button>
        ))}
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request({
                clientName: p.clientName,
                language: lang,
                note: note.trim() || undefined,
                extras,
              });
              toast.success(
                "Asked for it, the link appears here within about 15 minutes",
              );
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
        <Button size="sm" variant="secondary" onClick={() => openReport(p)}>
          Or print a one-pager now
        </Button>
      </div>
      <Textarea
        rows={2}
        value={note}
        placeholder="Anything I should put in it? e.g. mention the new creative, or that they paused for Ramadan"
        onChange={e => setNote(e.target.value)}
      />
      {pending ? (
        <div className="rounded border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Writing {pending.month} now, the link lands here on the next sync.
          {pending.error ? ` Last attempt failed: ${pending.error}` : ""}
        </div>
      ) : null}
      {ready.map((r: Any) => (
        <a
          key={r._id}
          href={r.docUrl}
          target="_blank"
          rel="noreferrer"
          className="block rounded border px-3 py-2 text-sm hover:bg-accent"
        >
          {r.month} report ↗{" "}
          <span className="text-xs text-muted-foreground">
            editable Google Doc
          </span>
        </a>
      ))}
    </section>
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
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Provisionally booked
      </h3>
      <p className="text-sm text-muted-foreground">
        {pv.count} appointment{pv.count === 1 ? "" : "s"} on the Not Confirmed
        calendar
        {pv.callbacks
          ? `, ${pv.callbacks} callback${pv.callbacks === 1 ? "" : "s"} scheduled`
          : ""}
        . Not on the stat sheet until confirmed.
      </p>
      {pv.upcoming?.length ? (
        <ul className="divide-y rounded-lg border text-sm">
          {pv.upcoming.map((e: Any, i: number) => (
            <li
              key={`${e.at}-${i}`}
              className="flex flex-wrap items-baseline gap-2 p-2"
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
    </section>
  );
}

const TEAMS: [string, string][] = [
  ["", "Me (Client Success list)"],
  ["creative", "Media / Creative"],
  ["tech", "Operations / Tech"],
  ["call_center", "Call Center"],
  ["media_buyer", "Media buyer (Marketing / ADs)"],
];

/**
 * Add a task for this client: a reminder for me, or a request to another
 * team. It reaches ClickUp within five minutes with the client's tag on it.
 */
function AddTask({
  taskId,
  clientName,
}: {
  taskId: string;
  clientName: string;
}) {
  const add = useMutation(api.csm.addTask);
  const added = useQuery(api.csm.tasksAdded, { taskId }) as Any[] | undefined;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [team, setTeam] = useState("");
  const [due, setDue] = useState("");
  const submit = async () => {
    if (!title.trim()) return;
    await add({
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
    setOpen(false);
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        onClick={() => setOpen(v => !v)}
      >
        {open ? "Close" : "Add a task for this client"}
      </button>
      {open ? (
        <form
          className="space-y-2 rounded-lg border bg-card p-3 text-sm"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5"
            placeholder="What needs doing"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border bg-background px-2 py-1.5"
            rows={2}
            placeholder="Detail, optional"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border bg-background px-2 py-1.5"
              value={team}
              onChange={e => setTeam(e.target.value)}
            >
              {TEAMS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-md border bg-background px-2 py-1.5"
              value={due}
              onChange={e => setDue(e.target.value)}
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="ml-auto rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              Add task
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tagged "{clientName.toLowerCase()}" in ClickUp, so the board
            attributes it to this client.
          </p>
        </form>
      ) : null}
      {added?.length ? (
        <ul className="divide-y rounded-lg border text-sm">
          {added.map(t => (
            <li key={t.id} className="flex flex-wrap items-baseline gap-2 p-2">
              <span className="font-medium">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                {t.department
                  ? (TEAMS.find(x => x[0] === t.department)?.[1] ??
                    t.department)
                  : "my list"}
              </span>
              <span className="ml-auto text-xs">
                {t.url ? (
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    In ClickUp
                  </a>
                ) : t.error ? (
                  <span className="text-red-600">failed: {t.error}</span>
                ) : (
                  <span className="text-muted-foreground">queued</span>
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
  if (!calls?.length) return null;
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
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Recent calls
      </h3>
      <p className="text-sm text-muted-foreground">
        Recorded calls this client came up in, with what was said about them.
      </p>
      {brief ? (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Where things stand, from the calls
          </p>
          <p className="whitespace-pre-wrap">{brief}</p>
        </div>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {calls.map((c, i) => (
          <li
            key={`${c.url ?? c.title}-${i}`}
            className="space-y-1 p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{String(c.title)}</span>
              {c.host ? (
                <span className="text-xs text-muted-foreground">
                  hosted by {String(c.host)}
                </span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {when(String(c.at ?? ""))}
              </span>
              {c.url ? (
                <a
                  href={String(c.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  Open recording
                </a>
              ) : null}
            </div>
            {c.brief ? (
              <p className="whitespace-pre-wrap text-sm">{String(c.brief)}</p>
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
                    className="text-sm text-primary underline"
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
    </section>
  );
}

function LostLeads({ lost }: { lost: Any }) {
  const [open, setOpen] = useState(false);
  const reasons = (lost?.reasons ?? []) as Any[];
  const leads = (lost?.leads ?? []) as Any[];
  if (!reasons.length && !leads.length) return null;
  const shown = open ? leads : leads.slice(0, 6);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Why leads were marked lost
      </h3>
      <p className="text-sm text-muted-foreground">
        {lost.total} leads sit in {lost.pipeline || "their lost pipeline"}.
        These are the {leads.length} most recent.
      </p>
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
      <ul className="divide-y rounded-lg border">
        {shown.map((l, i) => (
          <li key={i} className="space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{String(l.name)}</span>
              <span className="text-xs text-muted-foreground">
                {String(l.reason).replace(/\s*\(Write why.*\)/i, "")}
              </span>
              {l.ad ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {String(l.ad)}
                </span>
              ) : null}
              {l.movedAt ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {String(l.movedAt)}
                </span>
              ) : null}
            </div>
            {l.note ? (
              <p className="text-sm text-muted-foreground">{String(l.note)}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {leads.length > 6 ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="text-sm text-primary underline"
        >
          {open ? "Show fewer" : `Show the other ${leads.length - 6}`}
        </button>
      ) : null}
    </section>
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
      return { label: "Closed", tone: "text-emerald-600 font-medium" };
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
    return { label: "Not filled in", tone: "text-rose-600" };
  };
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Every lead, and the ad it came from ({rows.length})
      </h3>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {["all", ...ads].map(a => (
          <button
            key={a}
            type="button"
            onClick={() => setAd(a)}
            className={`rounded px-2 py-1 ${ad === a ? "bg-foreground text-background" : "bg-muted"}`}
          >
            {a === "all" ? `All (${rows.length})` : a}
          </button>
        ))}
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border">
        <table className="w-full">
          <thead className="sticky top-0 bg-muted/80">
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
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r, i) => {
              const o = outcome(r);
              return (
                <tr key={`${r.name}-${r.added}-${i}`}>
                  <Cell v={r.name} />
                  <Cell v={r.added} muted />
                  <Cell v={r.appDate} muted />
                  <Cell v={r.ad || r.source || "not tagged"} />
                  <Cell v={r.type} muted />
                  <Cell v={r.caller} muted />
                  <td className={`px-3 py-2 text-sm ${o.tone}`}>{o.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type RangeKey = "month" | "3d" | "7d" | "30d" | "lastMonth" | string;

const kuwaitToday = () =>
  new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const shiftDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000)
    .toISOString()
    .slice(0, 10);

/** [from, to] inclusive ISO dates for a range key; months are "YYYY-MM". */
function rangeBounds(key: RangeKey): [string, string, string] {
  const today = kuwaitToday();
  if (key === "3d") return [shiftDays(today, -2), today, "last 3 days"];
  if (key === "7d") return [shiftDays(today, -6), today, "last 7 days"];
  if (key === "30d") return [shiftDays(today, -29), today, "last 30 days"];
  const ym =
    key === "month"
      ? today.slice(0, 7)
      : key === "lastMonth"
        ? shiftDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
        : key;
  const [y, mo] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return [`${ym}-01`, last, label];
}

/** Sum the profile's daily grain for one range: ad leads and spend, sheet outcomes. */
function rangeMetrics(p: Any, key: RangeKey) {
  const [from, to, label] = rangeBounds(key);
  const daily: Any[] = p.adLeads?.daily ?? [];
  let leads = 0;
  let spend = 0;
  for (const d of daily) {
    if (d.date >= from && d.date <= to) {
      leads += d.leads;
      spend += d.spend;
    }
  }
  const rows: Any[] = (p.performance?.appointments ?? []).filter(
    (r: Any) =>
      r.added && r.added.slice(0, 10) >= from && r.added.slice(0, 10) <= to,
  );
  const booked = rows.filter((r: Any) => r.booked).length;
  const shows = rows.filter((r: Any) => r.show === "y").length;
  const noshows = rows.filter((r: Any) => r.show === "n").length;
  const quotes = rows.filter((r: Any) => r.quote === "y").length;
  const closes = rows.filter((r: Any) => r.closed === "y").length;
  const decided = shows + noshows;
  return {
    label,
    from,
    to,
    leads,
    spend: Math.round(spend * 100) / 100,
    cpl: leads ? Math.round((spend / leads) * 100) / 100 : null,
    booked,
    shows,
    noshows,
    quotes,
    closes,
    showRate: decided ? Math.round((100 * shows) / decided) : null,
    closeRate: shows ? Math.round((100 * closes) / shows) : null,
  };
}

/** Months with any data, newest first, for the month picker. */
function monthsAvailable(p: Any): string[] {
  const set = new Set<string>();
  for (const d of p.adLeads?.daily ?? []) set.add(String(d.date).slice(0, 7));
  for (const r of p.performance?.appointments ?? [])
    if (r.added) set.add(String(r.added).slice(0, 7));
  return [...set].sort().reverse();
}

function RangePicker({
  value,
  onChange,
  months,
}: {
  value: RangeKey;
  onChange: (k: RangeKey) => void;
  months: string[];
}) {
  const quick: [RangeKey, string][] = [
    ["3d", "3 days"],
    ["7d", "7 days"],
    ["30d", "30 days"],
    ["month", "This month"],
    ["lastMonth", "Last month"],
  ];
  const isMonth = /^\d{4}-\d{2}$/.test(String(value));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {quick.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded-md border px-2.5 py-1 ${value === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {label}
        </button>
      ))}
      <select
        className="rounded-md border bg-background px-2 py-1"
        value={isMonth ? value : ""}
        onChange={e => e.target.value && onChange(e.target.value)}
      >
        <option value="">Pick a month…</option>
        {months.map(m => (
          <option key={m} value={m}>
            {rangeBounds(m)[2]}
          </option>
        ))}
      </select>
    </div>
  );
}

function Profile({ name, onBack }: { name: string; onBack: () => void }) {
  const p = useQuery(api.csm.clientProfile, { clientName: name });
  // Hooks before any early return, so their order never changes.
  const [range, setRange] = useState<RangeKey>("month");
  const rv = useMemo(() => rangeMetrics(p ?? {}, range), [p, range]);
  const months = useMemo(() => monthsAvailable(p ?? {}), [p]);
  if (p === undefined)
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading {name}…</div>
    );
  if (p === null)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No profile stored for {name} yet.
      </div>
    );
  const perf = p.performance ?? {};
  // "This month" keeps the profile's own month figures (they carry the sheet's
  // extra fields); every other range is summed from the daily grain.
  const custom = range !== "month";
  const m: Any = custom ? rv : (perf.month ?? {});
  const l: Any = custom ? {} : (perf.lastMonth ?? {});
  const all = perf.allTime ?? {};
  const stale: Any[] = perf.stale ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button size="sm" variant="ghost" onClick={onBack}>
            ← All clients
          </Button>
          <h2 className="mt-1 text-xl font-bold">{p.clientName}</h2>
          {p.taskId ? (
            <div className="mt-2">
              <AddTask
                taskId={String(p.taskId)}
                clientName={String(p.clientName)}
              />
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {[
              p.stage,
              serviceModel(p.service).label,
              p.happiness,
              p.liveDays != null ? `${p.liveDays} days live` : null,
              p.ghlName && p.ghlName !== p.clientName
                ? `GHL: ${p.ghlName}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button onClick={() => openReport(p)}>Download report</Button>
      </div>

      <Links links={(p.links ?? {}) as Record<string, string>} />

      <CallPrep p={p} />

      <DiagnosisSection p={p} />

      {perf.error ? (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">
            {/UNAUTHENTICATED|401/.test(String(perf.error))
              ? "Their numbers are not showing because our Google Sheets connection is down, not because the sheet is empty."
              : "Their sheet could not be read."}
          </p>
          <p className="text-xs text-amber-900">
            {/UNAUTHENTICATED|401/.test(String(perf.error))
              ? "Google returned 401 invalid credentials. Reconnect Google Sheets in integrations and the numbers refill on the next sync, within 15 minutes. Nothing has been lost, and nothing here is a guess."
              : String(perf.error)}
          </p>
        </div>
      ) : null}
      {!p.links?.sheet ? (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No performance sheet is linked on their ClickUp record, so there are
          no numbers to show. Add the Sheet Link field and this fills in on the
          next sync.
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {perf.monthLabel ?? "This month"} · from their sheet
            </h3>
            {serviceModel(p.service).dwy ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat
                    label="Leads"
                    value={num(m.leads)}
                    hint={custom ? rv.label : `${num(l.leads)} last month`}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Done with you: the client books their own appointments, so
                  bookings, attendance and closes are not ours to report. Leads
                  and cost per lead are the numbers we own, and they sit in the
                  ad table below.
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <RangePicker
                    value={range}
                    onChange={setRange}
                    months={months}
                  />
                  <span className="text-xs text-muted-foreground">
                    {custom
                      ? `${rv.label} · ${rv.from} to ${rv.to}`
                      : (perf.monthLabel ?? "this month")}
                    {custom && rv.cpl != null
                      ? ` · $${rv.spend} spent, $${rv.cpl} per lead`
                      : ""}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat
                    label={
                      perf.leadsSource === "meta" ? "Leads (from ads)" : "Leads"
                    }
                    value={num(m.leads)}
                    hint={
                      perf.leadsSource === "meta"
                        ? custom
                          ? rv.label
                          : `${num(l.leads)} last month · ${num(p.adLeads?.allTime)} since launch`
                        : custom
                          ? rv.label
                          : `${num(l.leads)} last month`
                    }
                  />
                  <Stat
                    label="Booked"
                    value={num(m.booked)}
                    hint={custom ? rv.label : `${num(l.booked)} last month`}
                  />
                  <Stat
                    label="Attended"
                    value={num(m.shows)}
                    hint={
                      m.showRate != null
                        ? `${m.showRate}% of decided`
                        : "no outcome yet"
                    }
                  />
                  <Stat label="No show" value={num(m.noshows)} />
                  <Stat label="Quotes" value={num(m.quotes)} />
                  <Stat
                    label="Closed"
                    value={num(m.closes)}
                    tone={num(m.closes) ? "text-emerald-600" : undefined}
                    hint={
                      m.closeRate != null
                        ? `${m.closeRate}% of attended`
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
            {!serviceModel(p.service).dwy && (
              <p className="text-xs text-muted-foreground">
                All time on this sheet: {num(all.leads)} leads ·{" "}
                {num(all.booked)} booked · {num(all.shows)} attended ·{" "}
                {num(all.closes)} closed
                {perf.undated ? ` · ${perf.undated} rows have no date` : ""} ·
                source: {perf.source}
              </p>
            )}
            {perf.staleReason ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                These numbers were last read on {perf.staleAt}. Today's read
                failed, so you are looking at the last good copy rather than a
                partial one. Reason: {perf.staleReason}
              </p>
            ) : null}
          </section>
          <section
            className={`space-y-2 ${serviceModel(p.service).dwy ? "hidden" : ""}`}
          >
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Appointments with no outcome on the sheet ({perf.staleCount ?? 0})
            </h3>
            {stale.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding, every appointment has an outcome.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Every unfilled row reads as a loss in the monthly report.
                  Chase these before the next check-in call.
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        {[
                          "Name",
                          "Added",
                          "Appointment",
                          "Caller",
                          "Missing",
                          "Days",
                        ].map(h => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {stale.map(r => (
                        <tr key={`${r.name}-${r.added}-${r.appDate}`}>
                          <Cell v={r.name} />
                          <Cell v={r.added} muted />
                          <Cell v={r.appDate} />
                          <Cell v={r.caller} muted />
                          <Cell v={r.missing} />
                          <Cell v={r.appDaysAgo ?? r.ageDays} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
          (perf.byAd ?? []).length ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Which ad is producing the better leads
            </h3>
            <p className="text-xs text-muted-foreground">
              Last two months, per ad. Judge an ad on what its leads did, not on
              how many it produced. "No outcome" is the ad's rows nobody filled
              in, so a high number there means the comparison is not fair yet.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {[
                      "Ad / source",
                      "Leads",
                      "Attended",
                      "Attendance",
                      "Closed",
                      "Close rate",
                      "No outcome",
                    ].map(h => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(perf.byAd as Any[]).map(a => (
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
                          <span className="font-medium text-emerald-600">
                            {a.closes}
                          </span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <Cell
                        v={a.closeRate == null ? "-" : `${a.closeRate}%`}
                        muted
                      />
                      <Cell v={a.unknown ?? 0} muted />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          ) : null(perf.recent ?? []).length ? (
          <LeadsByAd rows={perf.recent as Any[]} />) : null
        </>
      )}

      {p.lost ? <LostLeads lost={p.lost as Any} /> : null}
      {p.provisional ? <Provisional pv={p.provisional as Any} /> : null}
      {p.calls ? (
        <RecentCalls
          calls={p.calls as Any[]}
          brief={p.callsBrief as string | undefined}
        />
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Live campaigns, ad sets and ads
        </h3>
        <AdTree ads={(p.ads ?? []) as Any[]} />
      </section>

      <ReportSection p={p} />

      {p.profileText ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Client profile
          </h3>
          <p className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm">
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

export function ClientPerformancePage() {
  const data = useQuery(api.csm.performanceOverview, {});
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"active" | "onboarding" | "paused">(
    "active",
  );

  if (data === undefined)
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Loading client performance…
      </div>
    );

  const all = (data.clients ?? []) as Any[];
  const churned = all.filter(c => isChurnedStage(c.stage ?? ""));
  const live = all.filter(c => !isChurnedStage(c.stage ?? ""));
  const chosen = GROUPS.find(g => g.key === group) ?? GROUPS[0];
  const rows = live
    .filter(c =>
      group === "active"
        ? chosen.match(c.stage ?? "") ||
          !GROUPS.some(g => g.match(c.stage ?? ""))
        : chosen.match(c.stage ?? ""),
    )
    .filter(c =>
      c.clientName.toLowerCase().includes(query.trim().toLowerCase()),
    );
  // DWY clients keep their own appointment tracking, so their unfilled rows are not our
  // chase list and must not inflate it.
  const totalStale = rows.reduce(
    (n, c) => n + (serviceModel(c.service).dwy ? 0 : num(c.staleCount)),
    0,
  );
  const waiting = live.filter(c => (c.reportNudge as Any)?.url);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Client performance
        </h1>
        <p className="text-sm text-muted-foreground">
          Every client's own numbers, straight off their performance sheet.
          Click a client for the full picture, their drive, their CRM, their ads
          and a report you can send.
        </p>
      </div>

      {!openClient && waiting.length ? (
        <details className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {waiting.length} weekly report reminder
            {waiting.length === 1 ? "" : "s"} waiting for your approval
          </summary>
          <p className="mt-1 text-xs text-amber-900">
            Posted in #csm-general this week. Nothing reaches a client until you
            open it and press send.
          </p>
          <ul className="mt-2 space-y-1">
            {waiting.map(c => (
              <li key={c.clientName}>
                <a
                  className="underline"
                  href={String((c.reportNudge as Any).url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.clientName}
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
        <Profile name={openClient} onBack={() => setOpenClient(null)} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Clients" value={rows.length} />
            <Stat
              label="Appointments with no outcome"
              value={totalStale}
              tone={totalStale ? "text-rose-600" : "text-emerald-600"}
              hint="across every sheet"
            />
            <Stat
              label="Closed this month"
              value={rows.reduce((n, c) => n + num(c.month?.closes), 0)}
              hint="what the client actually banked"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {GROUPS.map(g => {
              const n = live.filter(c =>
                g.key === "active"
                  ? g.match(c.stage ?? "") ||
                    !GROUPS.some(x => x.match(c.stage ?? ""))
                  : g.match(c.stage ?? ""),
              ).length;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroup(g.key)}
                  className={`rounded px-3 py-1 ${group === g.key ? "bg-foreground text-background" : "bg-muted"}`}
                >
                  {g.label} ({n})
                </button>
              );
            })}
            <span className="text-xs text-muted-foreground">
              {churned.length} churned client
              {churned.length === 1 ? "" : "s"} hidden
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{chosen.hint}</p>

          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a client…"
            className="w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm"
          />

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full">
              <thead className="bg-muted/50">
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
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(c => (
                  <tr key={c.clientName} className="hover:bg-accent/40">
                    <td className="px-3 py-2 text-sm font-medium">
                      {c.clientName}
                      {serviceModel(c.service).dwy ? (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          DWY
                        </span>
                      ) : !c.hasSheet ? (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          no sheet linked
                        </span>
                      ) : null}
                    </td>
                    <Cell v={c.stage} muted />
                    <Cell v={c.month?.leads ?? 0} />
                    <Cell
                      v={
                        serviceModel(c.service).dwy
                          ? "-"
                          : (c.month?.booked ?? 0)
                      }
                      muted={serviceModel(c.service).dwy}
                    />
                    <Cell
                      v={
                        serviceModel(c.service).dwy
                          ? "-"
                          : (c.month?.shows ?? 0)
                      }
                      muted={serviceModel(c.service).dwy}
                    />
                    <Cell
                      v={
                        serviceModel(c.service).dwy
                          ? "-"
                          : (c.month?.closes ?? 0)
                      }
                      muted={serviceModel(c.service).dwy}
                    />
                    <td className="px-3 py-2 text-sm tabular-nums">
                      {serviceModel(c.service).dwy ? (
                        <span className="text-muted-foreground">-</span>
                      ) : num(c.staleCount) ? (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">
                          {c.staleCount}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {!c.live || c.adsAccess === "no_access" ? (
                        <span className="text-muted-foreground">no access</span>
                      ) : c.adsAccess === "no_campaigns" ? (
                        <span className="text-muted-foreground">
                          not linked
                        </span>
                      ) : num(c.live.ads) === 0 ? (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">
                          nothing live
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {num(c.live.ads)} live
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpenClient(c.clientName)}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Sorted by how many appointments are missing an outcome, the biggest
            admin debt first. Open a client for last month, their ad tree and a
            report.
          </p>
        </>
      )}
      <AiHelper page="performance" clientName={openClient ?? undefined} />
    </div>
  );
}
