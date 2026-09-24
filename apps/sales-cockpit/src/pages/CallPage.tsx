import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  Timer,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  SectionCard,
} from "../components/kit";
import { api } from "../lib/api";
import { useLead, useLeadActivity, useNow, useQuery } from "../lib/data";
import { when } from "../lib/format";
import {
  type Block,
  CARRY_OVER,
  type Capture,
  type Fill,
  firstSentence,
  groupBlocks,
  type PlaybookEntry,
  personalise,
  type ScriptRow,
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
 * so the demo never asks it again.
 */

type Key = "intro" | "demo";
type Mode = "words" | "bullets";

const PREF = "sales_call_prefs";

function readPrefs(): { lang: "en" | "ar"; mode: Mode } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? "{}");
    return {
      lang: p.lang === "en" ? "en" : "ar",
      mode: p.mode === "bullets" ? "bullets" : "words",
    };
  } catch {
    return { lang: "ar", mode: "words" };
  }
}

function writePrefs(p: { lang: "en" | "ar"; mode: Mode }) {
  try {
    localStorage.setItem(PREF, JSON.stringify(p));
  } catch {
    // it still works, it just forgets
  }
}

function useScript(key: Key, lang: "en" | "ar") {
  return useQuery<ScriptRow>(
    () =>
      supabase
        .from("cockpit_sales_scripts")
        .select("*")
        .eq("key", key)
        .eq("lang", lang)
        .eq("active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    [key, lang],
  );
}

const COUNTRIES: Record<string, [string, string]> = {
  KW: ["Kuwait", "الكويت"],
  SA: ["Saudi Arabia", "السعودية"],
  AE: ["the UAE", "الإمارات"],
  QA: ["Qatar", "قطر"],
  BH: ["Bahrain", "البحرين"],
  OM: ["Oman", "عُمان"],
};

/** The lead's country as the script says it; the CRM only has the code. */
function countryName(
  code: string | null | undefined,
  lang: "en" | "ar",
): string | null {
  const c = COUNTRIES[String(code ?? "").toUpperCase()];
  return c ? (lang === "ar" ? c[1] : c[0]) : null;
}

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
  }, [contactId, key, lastOwn?.id, lastIntro?.id]);

  // Keep a draft on this device, so a refresh mid-call loses nothing.
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey(contactId, key),
        JSON.stringify({ values, checked }),
      );
    } catch {
      // private window
    }
  }, [contactId, key, values, checked]);

  const fill: Fill = useMemo(
    () => ({
      name: lead.data?.name?.split(/\s+/)[0] ?? null,
      yourName: (me.name ?? "").split(/\s+/)[0] || null,
      city: countryName(lead.data?.country, prefs.lang),
      closer: demo?.assigned_user_name ?? null,
      date: demo?.start_at ? when(demo.start_at) : null,
      problem: values.pain ?? null,
      revenue: values.revenue_12m ?? null,
      goal: values.goal ?? values.desired_state ?? null,
      tried: values.tried ?? null,
      desired: values.desired_state ?? values.goal ?? null,
      gap: values.gap_per_year ?? null,
    }),
    [lead.data, me.name, demo, values, prefs.lang],
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
                : "This script has not been imported yet"
            }
            text={
              !lead.data
                ? "Open it again from the Leads list."
                : "Run the script import in hermes/sales-desk."
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
    const body = summarise(doc?.captures ?? [], values);
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
          values,
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
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 md:px-6">
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
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-2.5 text-[13px] tabular-nums"
            title={`About ${totalMinutes} minutes in all`}
          >
            <Timer className="size-3.5" aria-hidden /> {mmss(now - startedAt)}
            <span className="muted">/ {totalMinutes}:00</span>
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className={buttonPrimary}
          >
            {saving ? "Saving…" : "Save notes"}
          </button>
        </div>
      </header>

      <div
        className="raised grid grid-cols-3 rounded-[var(--radius-md)] p-0.5 text-sm lg:hidden"
        role="tablist"
      >
        {(["script", "capture", "objections"] as const).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-[calc(var(--radius-md)-2px)] py-1.5 ${tab === t ? "bg-[color:var(--card)] font-medium shadow-sm" : "muted"}`}
          >
            {t === "script"
              ? "Script"
              : t === "capture"
                ? "Answers"
                : "Objections"}
          </button>
        ))}
      </div>

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
          {key === "demo" && lastIntro ? (
            <SectionCard title="From the intro call">
              <p className="whitespace-pre-wrap text-sm" dir="auto">
                {lastIntro.body.replace(/^Intro call notes\n/, "")}
              </p>
              <p className="muted mt-2 text-xs">
                Captured by {lastIntro.author.split("@")[0]}. Don't ask these
                again.
              </p>
            </SectionCard>
          ) : null}
        </aside>

        <section
          className={`min-w-0 space-y-4 lg:col-span-6 ${tab === "script" ? "" : "hidden lg:block"}`}
        >
          <div className="panel p-4 md:p-5">
            <div className="muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span>
                Stage {stageIdx + 1} of {stages.length}
              </span>
              {stage.minutes ? (
                <span
                  className="tabular-nums"
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

            <div className="mt-4 space-y-3">
              {groupBlocks(stage.blocks).map((g, gi) =>
                g.branch ? (
                  <BranchGroup
                    key={`${stage.no}-${gi}`}
                    label={personalise(g.branch, fill)}
                  >
                    <Blocks blocks={g.blocks} fill={fill} mode={prefs.mode} />
                  </BranchGroup>
                ) : (
                  <Blocks
                    key={`${stage.no}-${gi}`}
                    blocks={g.blocks}
                    fill={fill}
                    mode={prefs.mode}
                  />
                ),
              )}
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
          <div className={tab === "objections" ? "hidden lg:block" : ""}>
            <Captures
              captures={stageCaptures.length ? stageCaptures : doc.captures}
              all={doc.captures}
              values={values}
              onChange={(k, v) => setValues(x => ({ ...x, [k]: v }))}
              stageTitle={stageCaptures.length ? stage.title : null}
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

function Wrap({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      {children}
    </main>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="raised inline-flex rounded-[var(--radius-md)] p-0.5 text-[13px]"
      role="group"
      aria-label={label}
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 ${
            value === v
              ? "bg-[color:var(--card)] font-medium shadow-sm"
              : "muted"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Blocks({
  blocks,
  fill,
  mode,
}: {
  blocks: Block[];
  fill: Fill;
  mode: Mode;
}) {
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const text = b.text ? personalise(b.text, fill) : "";
        if (b.type === "say")
          return (
            <p
              key={i}
              dir="auto"
              className={`rounded-e-[var(--radius-md)] border-s-2 py-1 ps-3 leading-relaxed ${
                mode === "bullets" ? "text-[15px]" : "text-[17px]"
              }`}
              style={{
                borderColor: "var(--primary)",
                background:
                  "color-mix(in oklch, var(--primary) 7%, transparent)",
              }}
            >
              {mode === "bullets" ? firstSentence(text) : text}
            </p>
          );
        if (b.type === "adapt")
          return (
            <p
              key={i}
              dir="auto"
              className={`leading-relaxed ${mode === "bullets" ? "text-sm" : "text-[15px]"}`}
            >
              {mode === "bullets" ? firstSentence(text) : text}
            </p>
          );
        if (b.type === "step")
          return (
            <p
              key={i}
              className="pt-1 text-[13px] font-semibold"
              style={{ color: "var(--primary)" }}
            >
              {text}
            </p>
          );
        if (b.type === "list")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm" dir="auto">
              {(b.items ?? []).map((it, j) => (
                <li key={j}>{personalise(it, fill)}</li>
              ))}
            </ul>
          );
        if (mode === "bullets") return null;
        return (
          <p
            key={i}
            dir="auto"
            className="muted text-[13px] italic leading-relaxed"
          >
            {text}
          </p>
        );
      })}
    </div>
  );
}

function BranchGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius-md)] border hairline">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-[color:var(--secondary)]"
        dir="auto"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        {label}
      </button>
      {open ? (
        <div className="border-t hairline px-3 py-3">{children}</div>
      ) : null}
    </div>
  );
}

function Captures({
  captures,
  all,
  values,
  onChange,
  stageTitle,
}: {
  captures: Capture[];
  all: Capture[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  stageTitle: string | null;
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
            <span className="muted block text-xs" id={`cap-${c.key}`}>
              {c.label}
            </span>
            {c.type === "choice" ? (
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-labelledby={`cap-${c.key}`}
              >
                {(c.options ?? []).map(o => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={values[c.key] === o}
                    onClick={() =>
                      onChange(c.key, values[c.key] === o ? "" : o)
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      values[c.key] === o
                        ? "border-[color:var(--primary)] font-medium"
                        : "hairline"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <input
                aria-labelledby={`cap-${c.key}`}
                value={values[c.key] ?? ""}
                onChange={e => onChange(c.key, e.target.value)}
                inputMode={c.type === "number" ? "decimal" : undefined}
                dir="auto"
                className={field}
              />
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

function Playbook({
  objections,
  faqs,
  fill,
}: {
  objections: PlaybookEntry[];
  faqs: PlaybookEntry[];
  fill: Fill;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const match = (e: PlaybookEntry) =>
    !q.trim() ||
    e.title.toLowerCase().includes(q.toLowerCase()) ||
    e.blocks.some(b => (b.text ?? "").toLowerCase().includes(q.toLowerCase()));
  const sections: [string, PlaybookEntry[]][] = [
    ["Objections", objections.filter(match)],
    ["Questions they ask", faqs.filter(match)],
  ];
  return (
    <SectionCard title="Objections and questions" flush>
      <div className="border-b hairline p-3">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search
            className="muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Too expensive, partner, think about it…"
            className={`${field} pl-8`}
          />
        </label>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {sections.map(([title, list]) =>
          list.length ? (
            <div key={title}>
              <p className="muted px-4 pt-3 pb-1 text-xs font-medium">
                {title}
              </p>
              <ul>
                {list.map(e => {
                  const id = `${title}:${e.title}`;
                  const isOpen = open === id;
                  return (
                    <li key={id} className="border-t hairline first:border-t-0">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : id)}
                        className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-[color:var(--secondary)]"
                        dir="auto"
                      >
                        {isOpen ? (
                          <ChevronDown
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                        ) : (
                          <ChevronRight
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                        )}
                        {e.title}
                      </button>
                      {isOpen ? (
                        <div className="px-4 pb-3">
                          <Blocks blocks={e.blocks} fill={fill} mode="words" />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </SectionCard>
  );
}
