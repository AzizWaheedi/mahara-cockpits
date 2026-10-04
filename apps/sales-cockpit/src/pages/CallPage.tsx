import { ArrowLeft, ArrowRight, Check, Timer } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { FunnelLadder } from "../components/FunnelLadder";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  FilterChip,
  field,
  Segmented as KitSegmented,
  page,
  pageWide,
  SectionCard,
} from "../components/kit";
import {
  Blocks,
  BranchGroup,
  countryName,
  type Key,
  type Mode,
  Playbook,
  readPrefs,
  Segmented,
  useScript,
  writePrefs,
} from "../components/ScriptParts";
import { api } from "../lib/api";
import { useLead, useLeadActivity, useNow, useQuery } from "../lib/data";
import { outcomeWords } from "../lib/dialerUi";
import { when } from "../lib/format";
import {
  type Currency,
  currencyFor,
  type Funnel,
  funnel,
  funnelTokens,
  gapFor,
  isCurrency,
  type LeakKey,
  readGiven,
  readNumber,
  sayMany,
  sayMoney,
  sayPct,
  stepWords,
} from "../lib/funnel";
import {
  CARRY_OVER,
  type Capture,
  type Fill,
  groupBlocks,
  personalise,
  summarise,
} from "../lib/script";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me, Note } from "../lib/types";

/**
 * The call, guided: the setter's intro or the closer's demo, one stage at a
 * time, from Aziz's own frameworks. Word for word or as bullets, English or
 * Gulf Arabic, with the lead's details already in the lines. What the lead
 * says is captured beside the question that draws it out, saved to the lead
 * as the call's notes, and what the setter captured fills the closer's demo
 * so the demo never asks it again. The numbers they give are worked out as
 * they are typed (lib/funnel.ts): their funnel beside ours, the one step
 * that leaks the most, and every numbers line of the script filled in.
 */

const draftKey = (contactId: string, key: Key) =>
  `sales_call_draft_${contactId}_${key}`;

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function CallPage({ me }: { me: Me }) {
  const { contactId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const lead = useLead(contactId);
  const activity = useLeadActivity(contactId, lead.data?.phone8 ?? null);
  const now = useNow(1000);
  const [startedAt] = useState(() => Date.now());

  const defaultKey: Key =
    me.role === "setter" ? "intro" : me.role === "closer" ? "demo" : "intro";
  const key: Key =
    params.get("script") === "demo"
      ? "demo"
      : params.get("script") === "intro"
        ? "intro"
        : defaultKey;
  const [prefs, setPrefs] = useState(readPrefs);
  const script = useScript(key, prefs.lang);
  const doc = script.data?.doc;

  const [stageIdx, setStageIdx] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  // Which lead and script the answers were restored for: nothing is kept
  // on the device until then, or a refresh would write over the draft
  // before reading it back.
  const [restored, setRestored] = useState<string | null>(null);
  const [stageStart, setStageStart] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"script" | "capture" | "objections">("script");

  const appointments = activity.data?.appointments ?? [];
  const notes = activity.data?.notes ?? [];
  const appt =
    appointments.find(
      a =>
        a.call_type === key &&
        a.start_at &&
        Date.parse(a.start_at) > Date.now() - 6 * 3_600_000,
    ) ??
    appointments.find(a => a.call_type === key) ??
    null;
  const demo = appointments.find(a => a.call_type === "demo");

  // What was captured before: this script's last notes, then the intro's for a demo.
  const lastOwn = notes.find(
    n =>
      n.kind === "script" && (n.fields as { script?: string }).script === key,
  );
  const lastIntro = notes.find(
    n =>
      n.kind === "script" &&
      (n.fields as { script?: string }).script === "intro",
  );
  // What the setter wrote in the dialer on this lead (the call that booked
  // the intro, the intro itself), for the closer: most intro calls are
  // worked from the dialer, not this page.
  const setterNotes = useQuery<SetterNote[]>(
    () =>
      supabase
        .from("cockpit_sales_attempts")
        .select("id,rep_email,outcome,note,saved_at,item_kind")
        .eq("contact_id", contactId)
        .eq("state", "saved")
        .eq("as_role", "setter")
        .not("note", "is", null)
        .order("saved_at", { ascending: false })
        .limit(6),
    [contactId, key],
  );
  const dialerNotes =
    key === "demo"
      ? (setterNotes.data ?? []).filter(n => (n.note ?? "").trim())
      : [];
  // Everything the setter captured, for the demo: carried fields seed the
  // closer's answers, and the rest (quotes, why now, what they tried) still
  // feeds the numbers and the lines.
  const introValues = useMemo(
    () =>
      key === "demo"
        ? (((
            lastIntro?.fields as { values?: Record<string, string> } | undefined
          )?.values ?? {}) as Record<string, string>)
        : ({} as Record<string, string>),
    [key, lastIntro],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once per lead and script
  useEffect(() => {
    let seeded: Record<string, string> = {};
    const fromNote = (n: Note | undefined) =>
      ((n?.fields as { values?: Record<string, string> } | undefined)?.values ??
        {}) as Record<string, string>;
    if (key === "demo") {
      const intro = fromNote(lastIntro);
      for (const [from, to] of Object.entries(CARRY_OVER))
        if (intro[from]) seeded[to] = intro[from];
    }
    seeded = { ...seeded, ...fromNote(lastOwn) };
    try {
      const draft = JSON.parse(
        localStorage.getItem(draftKey(contactId, key)) ?? "null",
      );
      if (draft?.values) seeded = { ...seeded, ...draft.values };
      if (draft?.checked) setChecked(draft.checked);
    } catch {
      // no draft
    }
    setValues(seeded);
    setRestored(`${contactId}:${key}`);
  }, [contactId, key, lastOwn?.id, lastIntro?.id]);

  // Keep a draft on this device, so a refresh mid-call loses nothing.
  useEffect(() => {
    if (restored !== `${contactId}:${key}`) return;
    try {
      localStorage.setItem(
        draftKey(contactId, key),
        JSON.stringify({ values, checked }),
      );
    } catch {
      // private window
    }
  }, [contactId, key, values, checked, restored]);

  const currency: Currency = isCurrency(values.currency)
    ? values.currency
    : isCurrency(introValues.currency)
      ? introValues.currency
      : currencyFor(lead.data?.country);
  const f = useMemo(
    () => funnel(readGiven({ ...introValues, ...values }), currency),
    [introValues, values, currency],
  );
  const tokens = useMemo(() => funnelTokens(f, prefs.lang), [f, prefs.lang]);

  const fill: Fill = useMemo(
    () => ({
      name: lead.data?.name?.split(/\s+/)[0] ?? null,
      yourName: (me.name ?? "").split(/\s+/)[0] || null,
      city: countryName(lead.data?.country, prefs.lang),
      closer: demo?.assigned_user_name ?? null,
      date: demo?.start_at ? when(demo.start_at) : null,
      problem: values.pain || introValues.pain || null,
      revenue: tokens.REVENUE ?? (values.revenue_12m || null),
      goal: values.goal || values.desired_state || introValues.goal || null,
      tried: values.tried || introValues.tried || null,
      desired: values.desired_state || values.goal || introValues.goal || null,
      gap: tokens["GAP YEAR"] ?? null,
      tokens,
    }),
    [lead.data, me.name, demo, values, introValues, tokens, prefs.lang],
  );

  if (lead.error)
    return (
      <Wrap>
        <Failed what="This lead" error={lead.error} retry={lead.reload} />
      </Wrap>
    );
  if (script.error)
    return (
      <Wrap>
        <Failed what="The script" error={script.error} retry={script.reload} />
      </Wrap>
    );
  if (!lead.data || !doc)
    return (
      <Wrap>
        {lead.loading || script.loading ? (
          <p className="muted text-sm">Opening the call…</p>
        ) : (
          <EmptyState
            title={
              !lead.data
                ? "This lead is not in the cockpit"
                : "This script is not ready yet"
            }
            text={
              !lead.data
                ? "Open it again from the Leads list."
                : "Ask your manager."
            }
          />
        )}
      </Wrap>
    );

  const stages = doc.stages;
  const stage = stages[Math.min(stageIdx, stages.length - 1)];
  const totalMinutes = stages.reduce((a, s) => a + (s.minutes ?? 0), 0);
  const stageCaptures = doc.captures.filter(c => c.stage === stage.no);
  const stageBudget = (stage.minutes ?? 0) * 60_000;
  const overStage = stageBudget > 0 && now - stageStart > stageBudget;
  const checklistDone = stage.checklist.every(
    (_, i) => checked[`${stage.no}.${i}`],
  );

  function go(i: number) {
    setStageIdx(Math.max(0, Math.min(stages.length - 1, i)));
    setStageStart(Date.now());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setPref(p: Partial<{ lang: "en" | "ar"; mode: Mode }>) {
    const next = { ...prefs, ...p };
    setPrefs(next);
    writePrefs(next);
  }

  async function save() {
    const answers = summarise(doc?.captures ?? [], values);
    const numbers = numbersSummary(f, key);
    const body = [answers, numbers].filter(Boolean).join("\n");
    if (!body) {
      toast.error(
        "Capture at least one answer before saving the call's notes.",
      );
      return;
    }
    setSaving(true);
    try {
      await api("note.add", {
        contact_id: contactId,
        appointment_id: appt?.appointment_id ?? null,
        kind: "script",
        body: `${key === "intro" ? "Intro call" : "Demo"} notes\n${body}`,
        fields: {
          script: key,
          lang: prefs.lang,
          version: script.data?.version,
          values: { ...values, currency },
          math: numbersFields(f),
          stage_reached: stage.no,
          checklist: checked,
          minutes: Math.round((Date.now() - startedAt) / 60_000),
        },
      });
      try {
        localStorage.removeItem(draftKey(contactId, key));
      } catch {
        // nothing to clear
      }
      toast.success(
        key === "intro"
          ? "Saved to the lead. The closer sees these answers before the demo."
          : "Saved to the lead.",
      );
      activity.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const leadName = lead.data.name ?? "the lead";

  return (
    <main className={pageWide}>
      <header className="flex flex-wrap items-center gap-3">
        <Link
          to={`/lead/${contactId}`}
          className="muted inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> {leadName}
        </Link>
        <h1 className="text-lg font-semibold tracking-tight" dir="auto">
          {key === "intro" ? "Intro call" : "Demo"} with {leadName}
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Script"
            value={key}
            options={[
              ["intro", "Intro"],
              ["demo", "Demo"],
            ]}
            onChange={v => {
              const p = new URLSearchParams(params);
              p.set("script", v);
              setParams(p, { replace: true });
              setStageIdx(0);
            }}
          />
          <Segmented
            label="Language"
            value={prefs.lang}
            options={[
              ["ar", "العربية"],
              ["en", "English"],
            ]}
            onChange={v => setPref({ lang: v as "en" | "ar" })}
          />
          <Segmented
            label="How much to show"
            value={prefs.mode}
            options={[
              ["words", "Word for word"],
              ["bullets", "Bullets"],
            ]}
            onChange={v => setPref({ mode: v as Mode })}
          />
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 font-mono text-xs font-semibold tabular-nums text-teal-300 shadow-sm"
            title={`About ${totalMinutes} minutes in all`}
          >
            <Timer className="size-3.5 text-teal-400 animate-pulse" aria-hidden /> {mmss(now - startedAt)}
            <span className="muted">/ {totalMinutes}:00</span>
          </span>
          {key === "demo" ? (
            <Link
              to={`/deck?lead=${encodeURIComponent(contactId)}`}
              target="_blank"
              rel="noopener"
              className={button}
              title="The pitch deck with their name and the numbers from these notes. Save the notes first."
            >
              Present the deck
            </Link>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className={`${buttonPrimary} shadow-md shadow-teal-500/20`}
          >
            {saving ? "Saving…" : "Save notes"}
          </button>
        </div>
      </header>

      <KitSegmented
        label="Show"
        value={tab}
        options={[
          ["script", "Script"],
          ["capture", "Answers"],
          ["objections", "Objections"],
        ]}
        onChange={v => setTab(v as "script" | "capture" | "objections")}
        className="lg:hidden"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <aside className="hidden min-w-0 space-y-4 lg:col-span-3 lg:block">
          <SectionCard title="Stages" flush>
            <ol className="py-1">
              {stages.map((s, i) => {
                const done =
                  s.checklist.length > 0 &&
                  s.checklist.every((_, j) => checked[`${s.no}.${j}`]);
                return (
                  <li key={s.no}>
                    <button
                      type="button"
                      onClick={() => go(i)}
                      aria-current={i === stageIdx ? "step" : undefined}
                      className={`flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm ${
                        i === stageIdx
                          ? "bg-[color:var(--secondary)] font-medium"
                          : "hover:bg-[color:var(--secondary)]"
                      }`}
                    >
                      <span className="muted w-5 shrink-0 tabular-nums text-xs">
                        {String(s.no).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      {done ? (
                        <Check
                          className="size-3.5 shrink-0"
                          style={{ color: "var(--success)" }}
                          aria-label="Done"
                        />
                      ) : s.minutes ? (
                        <span className="muted shrink-0 text-xs tabular-nums">
                          {s.minutes}m
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </SectionCard>
          {key === "demo" && (lastIntro || dialerNotes.length) ? (
            <SectionCard title="From the intro call">
              <FromIntro note={lastIntro} dialer={dialerNotes} />
            </SectionCard>
          ) : null}
        </aside>

        <section
          className={`min-w-0 space-y-4 lg:col-span-6 ${tab === "script" ? "" : "hidden lg:block"}`}
        >
          <div className="panel p-4 sm:p-6">
            <div className="muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>
                Stage {stageIdx + 1} of {stages.length}
              </span>
              {stage.minutes ? (
                <span
                  className="font-mono tabular-nums"
                  style={overStage ? { color: "var(--warning)" } : undefined}
                >
                  {mmss(now - stageStart)} of {stage.minutes}:00
                  {overStage ? ", over time" : ""}
                </span>
              ) : null}
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              {stage.title}
            </h2>
            {stage.goal ? (
              <p className="muted mt-1 text-sm">{stage.goal}</p>
            ) : null}

            {key === "demo" &&
            stageIdx === 0 &&
            (lastIntro || dialerNotes.length) ? (
              <div className="mt-4 rounded-[var(--radius-md)] border hairline p-3 lg:hidden">
                <p className="text-sm font-medium">From the intro call</p>
                <div className="mt-1">
                  <FromIntro note={lastIntro} dialer={dialerNotes} />
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              {groupBlocks(stage.blocks).map((g, gi) => {
                // A branch that says which leak it tells speaks that step's
                // numbers, and opens by itself when it is the prospect's.
                const whenKey = g.blocks[0]?.when ?? "";
                const leakKey = whenKey.startsWith("leak:")
                  ? (whenKey.slice(5) as LeakKey)
                  : null;
                const groupFill = leakKey
                  ? { ...fill, tokens: funnelTokens(f, prefs.lang, leakKey) }
                  : fill;
                const theirs = leakKey != null && f.leak === leakKey;
                return g.branch ? (
                  <BranchGroup
                    key={`${stage.no}-${gi}`}
                    label={personalise(g.branch, fill)}
                    open={theirs}
                    badge={
                      theirs ? (
                        <span
                          className="shrink-0 text-xs font-semibold"
                          style={{ color: "var(--primary)" }}
                        >
                          Their numbers
                        </span>
                      ) : null
                    }
                  >
                    <Blocks
                      blocks={g.blocks}
                      fill={groupFill}
                      mode={prefs.mode}
                    />
                  </BranchGroup>
                ) : (
                  <Blocks
                    key={`${stage.no}-${gi}`}
                    blocks={g.blocks}
                    fill={groupFill}
                    mode={prefs.mode}
                  />
                );
              })}
            </div>

            {stage.checklist.length ? (
              <div className="mt-5 border-t hairline pt-4">
                <p className="text-sm font-medium">Before you move on</p>
                <ul className="mt-2 space-y-1.5">
                  {stage.checklist.map((c, i) => {
                    const id = `${stage.no}.${i}`;
                    return (
                      <li key={id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={Boolean(checked[id])}
                            onChange={e =>
                              setChecked(v => ({
                                ...v,
                                [id]: e.target.checked,
                              }))
                            }
                          />
                          <span dir="auto">{personalise(c, fill)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t hairline pt-4">
              <button
                type="button"
                className={button}
                disabled={stageIdx === 0}
                onClick={() => go(stageIdx - 1)}
              >
                <ArrowLeft className="size-3.5" aria-hidden /> Back
              </button>
              {stageIdx < stages.length - 1 ? (
                <button
                  type="button"
                  className={checklistDone ? buttonPrimary : button}
                  onClick={() => go(stageIdx + 1)}
                >
                  Next: {stages[stageIdx + 1].title}{" "}
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  className={buttonPrimary}
                  disabled={saving}
                  onClick={save}
                >
                  {saving ? "Saving…" : "Save the call's notes"}
                </button>
              )}
            </div>
            {!checklistDone && stage.checklist.length ? (
              <p className="muted mt-2 text-right text-xs">
                The checklist is not complete; you can still move on.
              </p>
            ) : null}
          </div>
        </section>

        <aside
          className={`min-w-0 space-y-4 lg:col-span-3 ${tab === "script" ? "hidden lg:block" : ""}`}
        >
          <div
            className={`space-y-4 ${tab === "objections" ? "hidden lg:block" : ""}`}
          >
            <FunnelLadder
              f={f}
              script={key}
              onCurrency={c => setValues(x => ({ ...x, currency: c }))}
            />
            <Captures
              captures={stageCaptures.length ? stageCaptures : doc.captures}
              all={doc.captures}
              values={values}
              onChange={(k, v) => setValues(x => ({ ...x, [k]: v }))}
              stageTitle={stageCaptures.length ? stage.title : null}
              fromIntro={k => {
                const from = INTRO_FIELD[k];
                return Boolean(
                  from && values[k] && introValues[from] === values[k],
                );
              }}
              currency={currency}
            />
          </div>
          <div className={tab === "capture" ? "hidden lg:block" : ""}>
            <Playbook objections={doc.objections} faqs={doc.faqs} fill={fill} />
          </div>
        </aside>
      </div>
    </main>
  );
}

/**
 * How a typed number was read, when it was not typed as a plain number
 * ("85k" reads as 85,000 KWD), and a plain warning when it cannot be read.
 */
function Reads({
  raw,
  money,
  currency,
}: {
  raw: string | undefined;
  money: boolean;
  currency: Currency;
}) {
  const text = (raw ?? "").trim();
  if (!text || /^\d+(\.\d+)?$/.test(text)) return null;
  const n = readNumber(text);
  if (n == null)
    return (
      <p className="text-xs" style={{ color: "var(--warning)" }}>
        No number in this, so the math leaves it out.
      </p>
    );
  return (
    <p className="muted text-xs tabular-nums">
      Reads as{" "}
      {money
        ? sayMoney(n, currency, "en")
        : Number.isInteger(n)
          ? n.toLocaleString("en-US")
          : String(Math.round(n * 10) / 10)}
    </p>
  );
}

interface SetterNote {
  id: string;
  rep_email: string | null;
  outcome: string | null;
  note: string | null;
  saved_at: string | null;
  item_kind: string | null;
}

/**
 * What the setter found, for the closer before the demo: the answers they
 * captured on the guided intro call, then what they wrote in the dialer.
 */
function FromIntro({
  note,
  dialer,
}: {
  note: Note | undefined;
  dialer: SetterNote[];
}) {
  return (
    <div className="space-y-3">
      {note ? (
        <div>
          <p className="whitespace-pre-wrap text-sm" dir="auto">
            {note.body.replace(/^Intro call notes\n/, "")}
          </p>
          <p className="muted mt-1 text-xs">
            Captured by {note.author.split("@")[0]} {when(note.created_at)}.
            Confirm these, don't ask them again.
          </p>
        </div>
      ) : null}
      {dialer.length ? (
        <div>
          <p className="muted text-xs font-medium">
            {note ? "And in the dialer" : "What the setter wrote in the dialer"}
          </p>
          <ul className="mt-1 space-y-2">
            {dialer.map(n => (
              <li key={n.id} className="text-sm">
                <p className="whitespace-pre-wrap" dir="auto">
                  {n.note}
                </p>
                <p className="muted text-xs">
                  {n.outcome ? outcomeWords(n.outcome) : "Note"},{" "}
                  {(n.rep_email ?? "").split("@")[0]} {when(n.saved_at)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <main className={page}>{children}</main>;
}

// Which intro field each demo field was seeded from.
const INTRO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(CARRY_OVER).map(([from, to]) => [to, from]),
);

/**
 * The numbers, said for the team in the call's saved notes. The intro's are
 * too few to name the one thing; the demo names it.
 */
function numbersSummary(f: Funnel, script: "intro" | "demo"): string {
  const m = (n: number) => sayMoney(n, f.currency, "en");
  const g = f.given;
  const parts: string[] = [];
  if (g.spend != null) parts.push(`ad spend ${m(g.spend)} a month`);
  if (f.costs.perLead != null)
    parts.push(
      `${m(f.costs.perLead)} an inquiry${f.costs.perLeadAllSources ? " (all sources)" : ""}, ours ${m(f.ours.perLead)}`,
    );
  if (g.leads != null) parts.push(`${g.leads} inquiries a month`);
  const names: Record<string, string> = {
    booking: "booked",
    show: "held",
    close: "signed",
  };
  for (const st of f.steps)
    if (st.key !== "ads" && st.theirs != null && st.standing !== "impossible")
      parts.push(
        `${names[st.key]} ${sayPct(st.theirs, "en")}, ours ${sayPct(st.ours, "en")}`,
      );
  if (f.rates.quoteWin != null && f.rates.quoteWin <= 1)
    parts.push(`wins ${sayPct(f.rates.quoteWin, "en")} of quotes`);
  const lines: string[] = [];
  if (parts.length) lines.push(`Their numbers: ${parts.join("; ")}.`);
  const gap = script === "demo" ? gapFor(f) : null;
  if (f.leak && gap?.projectsYear != null && gap.projectsYear >= 0.5)
    lines.push(
      `The one thing: ${stepWords(f.leak, "en")}, ${sayMany(gap.projectsYear, "project", "en", f.leak !== "referrals")} a year${
        gap.moneyYear != null ? `, ${m(gap.moneyYear)} a year` : ""
      }.`,
    );
  return lines.join("\n");
}

/** The same numbers kept on the note, for anyone who adds them up later. */
function numbersFields(f: Funnel) {
  const gap = gapFor(f);
  const round = (n: number | null | undefined, places: number) =>
    n == null ? null : Math.round(n * 10 ** places) / 10 ** places;
  return {
    currency: f.currency,
    leak: f.leak,
    gap_projects_year: round(gap?.projectsYear, 1),
    gap_money_year: round(gap?.moneyYear, 0),
    rates: f.rates,
    costs: f.costs,
    ours: f.ours,
    problems: f.problems,
  };
}

function Captures({
  captures,
  all,
  values,
  onChange,
  stageTitle,
  fromIntro,
  currency,
}: {
  captures: Capture[];
  all: Capture[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  stageTitle: string | null;
  fromIntro: (key: string) => boolean;
  currency: Currency;
}) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? all : captures;
  const filled = all.filter(c => values[c.key]?.trim()).length;
  return (
    <SectionCard
      title={stageTitle && !showAll ? `Answers: ${stageTitle}` : "Answers"}
      side={
        <button
          type="button"
          onClick={() => setShowAll(s => !s)}
          className="muted text-xs underline-offset-2 hover:underline"
        >
          {showAll ? "This stage" : `All (${filled}/${all.length})`}
        </button>
      }
    >
      <div className="space-y-3">
        {list.map(c => (
          <div key={c.key} className="space-y-1">
            <span
              className="muted flex items-baseline justify-between gap-2 text-xs"
              id={`cap-${c.key}`}
            >
              <span>
                {c.label}
                {c.type === "money" ? ` (${currency})` : ""}
              </span>
              {fromIntro(c.key) ? (
                <span className="shrink-0" style={{ color: "var(--primary)" }}>
                  from the intro
                </span>
              ) : null}
            </span>
            {c.type === "choice" ? (
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-labelledby={`cap-${c.key}`}
              >
                {(c.options ?? []).map(o => (
                  <FilterChip
                    key={o}
                    on={values[c.key] === o}
                    onClick={() =>
                      onChange(c.key, values[c.key] === o ? "" : o)
                    }
                  >
                    {o}
                  </FilterChip>
                ))}
              </div>
            ) : (
              <>
                <input
                  aria-labelledby={`cap-${c.key}`}
                  value={values[c.key] ?? ""}
                  onChange={e => onChange(c.key, e.target.value)}
                  inputMode={c.type === "number" ? "decimal" : undefined}
                  dir="auto"
                  className={field}
                />
                {c.type === "money" || c.type === "number" ? (
                  <Reads
                    raw={values[c.key]}
                    money={c.type === "money"}
                    currency={currency}
                  />
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
      <p className="muted mt-3 text-xs">
        Kept on this device until you save. Saving puts them on the lead.
      </p>
    </SectionCard>
  );
}
