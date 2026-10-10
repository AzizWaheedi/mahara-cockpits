import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Timer,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api";
import { bookedDemo, sayWhen, slotWords } from "../lib/booking";
import { isClient } from "../lib/clients";
import { useNow, useQuery } from "../lib/data";
import { outcomeWords } from "../lib/dialerUi";
import { clock, when } from "../lib/format";
import {
  type Currency,
  currencyFor,
  funnel,
  funnelTokens,
  isCurrency,
  type LeakKey,
  readGiven,
} from "../lib/funnel";
import {
  CARRY_OVER,
  type Capture,
  CLOSER_KEY,
  type Fill,
  groupBlocks,
  inlineCaptures,
  LEDGER_SLOTS,
  numbersFields,
  numbersSummary,
  personalise,
  type Stage,
  scriptNoteBody,
} from "../lib/script";
import {
  clearCallDraft,
  NotesSaver,
  newCallId,
  readCallDraft,
  type SaveState,
  saveWords,
  someText,
  writeCallDraft,
} from "../lib/scriptNotes";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { CalendarRow, Lead, Me, Note } from "../lib/types";
import { BookDemoBlock } from "./BookDemoBlock";
import type { As } from "./BookForm";
import { FunnelLadder } from "./FunnelLadder";
import { GroupKit } from "./GroupKit";
import {
  button,
  buttonPrimary,
  Failed,
  Segmented as KitSegmented,
  SectionCard,
} from "./kit";
import { CaptureField, LEDGER_TOP, NumberLedger } from "./NumberLedger";
import { PartNotes } from "./PartNotes";
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
} from "./ScriptParts";

/**
 * One script for one lead (sales simplify, 2026-10-10), the same in the
 * guided call (/call, layout "page") and the dialer's Script tab (layout
 * "pane"): the number ledger pinned on top, the lines with each answer's
 * field right under the line that asks for it, open notes on every part,
 * the checklist, and on the intro the demo booked from its last part. What
 * the rep types is kept on the device and saved to the lead as the call
 * goes (script.save, one row per call), so the closer, the deck and the
 * lead page read it during the call, not only after it.
 *
 * The parent keys it by lead and script, so another lead or script is a
 * fresh call screen.
 */

const INTRO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(CARRY_OVER).map(([from, to]) => [to, from]),
);

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface SetterNote {
  id: string;
  rep_email: string | null;
  outcome: string | null;
  note: string | null;
  saved_at: string | null;
  item_kind: string | null;
}

export function ScriptRunner({
  me,
  as,
  lead,
  scriptKey: key,
  onScriptKey,
  layout,
  appointments,
  notes,
  notesLoaded,
  reload,
  attemptId = null,
  onBooked,
  headerStart,
  headerEnd,
}: {
  me: Me;
  as: As;
  lead: Lead;
  scriptKey: Key;
  onScriptKey: (k: Key) => void;
  layout: "page" | "pane";
  appointments: CalendarRow[];
  notes: Note[];
  /** The lead's notes have been read (seed the answers once, then). */
  notesLoaded: boolean;
  reload: () => void;
  /** The dialer's open call with this lead: a booking saves it as booked. */
  attemptId?: string | null;
  /** The demo was booked from the script (the dialer keeps the lead on screen). */
  onBooked?: (words: string) => void;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
}) {
  const contactId = lead.contact_id;
  const page = layout === "page";
  const now = useNow(1000);
  const [startedAt] = useState(() => Date.now());
  const [prefs, setPrefs] = useState(readPrefs);
  const script = useScript(key, prefs.lang);
  const doc = script.data?.doc;
  const lang = prefs.lang;

  // ------------------------------------------------------------ the call
  const [draft] = useState(() => readCallDraft(contactId, key));
  const callId = useRef(draft.callId);
  const touched = useRef(draft.touched);
  const [values, setValues] = useState<Record<string, string>>(draft.values);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    draft.checked,
  );
  const [partNotes, setPartNotes] = useState<Record<string, string>>(
    draft.notes,
  );
  const [stageIdx, setStageIdx] = useState(0);
  const [reached, setReached] = useState(1);
  const [stageStart, setStageStart] = useState(() => Date.now());
  const [tab, setTab] = useState<"script" | "objections">("script");
  const [drawer, setDrawer] = useState<null | "answers" | "funnel">(null);
  const [slotIsos, setSlotIsos] = useState<string[]>([]);
  const [bookedHere, setBookedHere] = useState<{
    words: string;
    start: string | null;
  } | null>(null);
  const partRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLDivElement>(null);

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
  const introValues = useMemo(
    () =>
      key === "demo"
        ? (((
            lastIntro?.fields as { values?: Record<string, string> } | undefined
          )?.values ?? {}) as Record<string, string>)
        : ({} as Record<string, string>),
    [key, lastIntro],
  );
  // Seeded once the notes are read: carried intro answers, the last saved
  // answers of this script, then what this device kept (and anything typed
  // meanwhile) over them.
  const seeded = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per call screen, when the notes arrive
  useEffect(() => {
    if (seeded.current || !notesLoaded) return;
    seeded.current = true;
    let seed: Record<string, string> = {};
    if (key === "demo")
      for (const [from, to] of Object.entries(CARRY_OVER))
        if (introValues[from]) seed[to] = introValues[from];
    const own = ((lastOwn?.fields as { values?: Record<string, string> })
      ?.values ?? {}) as Record<string, string>;
    seed = { ...seed, ...own };
    setValues(v => ({ ...seed, ...draft.values, ...v }));
  }, [notesLoaded]);

  // Kept on this device as it is typed: a refresh mid-call loses nothing.
  useEffect(() => {
    if (!touched.current) return;
    writeCallDraft(contactId, key, {
      callId: callId.current,
      at: Date.now(),
      values,
      checked,
      notes: partNotes,
      touched: true,
    });
  }, [contactId, key, values, checked, partNotes]);

  const currency: Currency = isCurrency(values.currency)
    ? values.currency
    : isCurrency(introValues.currency)
      ? introValues.currency
      : currencyFor(lead.country);
  const f = useMemo(
    () => funnel(readGiven({ ...introValues, ...values }), currency),
    [introValues, values, currency],
  );
  const tokens = useMemo(() => funnelTokens(f, lang), [f, lang]);

  const demoAppt = bookedDemo(appointments);
  const bookedStart = bookedHere?.start ?? demoAppt?.start_at ?? null;
  const fill: Fill = useMemo(
    () => ({
      name: lead.name?.split(/\s+/)[0] ?? null,
      yourName: (me.name ?? "").split(/\s+/)[0] || null,
      city: countryName(lead.country, lang),
      closer: demoAppt?.assigned_user_name ?? null,
      date: bookedStart
        ? sayWhen(bookedStart, lang, {
            country: lead.country,
            phone: lead.phone,
          })
        : null,
      problem: values.pain || introValues.pain || null,
      revenue: tokens.REVENUE ?? (values.revenue_12m || null),
      goal: values.goal || values.desired_state || introValues.goal || null,
      tried: values.tried || introValues.tried || null,
      desired: values.desired_state || values.goal || introValues.goal || null,
      gap: tokens["GAP YEAR"] ?? null,
      tokens,
      slots:
        slotIsos.length >= 2
          ? slotIsos
              .slice(0, 2)
              .map(t =>
                sayWhen(t, lang, { country: lead.country, phone: lead.phone }),
              )
          : null,
      booked: bookedStart
        ? sayWhen(bookedStart, lang, {
            country: lead.country,
            phone: lead.phone,
            whole: true,
          })
        : null,
    }),
    [
      lead,
      me.name,
      demoAppt,
      bookedStart,
      values,
      introValues,
      tokens,
      lang,
      slotIsos,
    ],
  );

  // The appointment this call is about, for the note.
  const appt =
    appointments.find(
      a =>
        a.call_type === key &&
        a.start_at &&
        Date.parse(a.start_at) > Date.now() - 6 * 3_600_000,
    ) ??
    appointments.find(a => a.call_type === key) ??
    null;

  // -------------------------------------------------------------- saving
  const latest = useRef({
    values,
    checked,
    partNotes,
    doc,
    f,
    currency,
    reached,
    version: script.data?.version,
    lang,
    appt,
  });
  latest.current = {
    values,
    checked,
    partNotes,
    doc,
    f,
    currency,
    reached,
    version: script.data?.version,
    lang,
    appt,
  };

  const build = useCallback(
    (final: boolean) => {
      const st = latest.current;
      if (!st.doc) return null;
      const anything =
        someText(st.values) ||
        someText(st.partNotes) ||
        Object.values(st.checked).some(Boolean);
      if (!anything) return null;
      const stages =
        key === "intro"
          ? st.doc.stages.filter(s => s.no !== lastNo(st.doc?.stages ?? []))
          : st.doc.stages;
      const body = scriptNoteBody({
        key,
        captures: st.doc.captures,
        values: st.values,
        numbers: numbersSummary(st.f, key),
        notes: st.partNotes,
        stages,
        currency: st.currency,
      });
      return {
        contact_id: contactId,
        call_id: callId.current,
        script: key,
        lang: st.lang,
        version: st.version ?? null,
        appointment_id: st.appt?.appointment_id ?? null,
        final,
        body,
        fields: {
          script: key,
          lang: st.lang,
          version: st.version ?? null,
          values: { ...st.values, currency: st.currency },
          notes: st.partNotes,
          checklist: st.checked,
          stage_reached: st.reached,
          math: numbersFields(st.f),
          minutes: Math.round((Date.now() - startedAt) / 60_000),
          final,
        },
      };
    },
    [contactId, key, startedAt],
  );

  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const saver = useRef<NotesSaver | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const s = new NotesSaver(
      {
        build,
        send: p => api("script.save", p),
        onState: setSaveState,
        onSaved: final => {
          if (!final) return;
          // The next open of this lead's script is a new call.
          clearCallDraft(contactId, key);
          reloadRef.current();
        },
        onDeleted: () => {
          callId.current = newCallId();
        },
      },
      touched.current,
    );
    saver.current = s;
    setSaveState(s.state);
    const hidden = () => {
      if (document.visibilityState === "hidden") void s.flush();
    };
    const leaving = () => void s.flush();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
      void s.flush();
      s.dispose();
      if (saver.current === s) saver.current = null;
    };
  }, [build, contactId, key]);

  function touch() {
    touched.current = true;
    saver.current?.change();
  }
  function setValue(k: string, v: string) {
    setValues(x => ({ ...x, [k]: v }));
    touch();
  }

  async function saveNow(final: boolean) {
    const payload = build(final);
    if (!payload) {
      toast.error(
        "Capture an answer or write a note before saving the call's notes.",
      );
      return;
    }
    const ok = (await saver.current?.flush(final)) ?? false;
    if (ok)
      toast.success(
        final
          ? key === "intro"
            ? "Saved to the lead. The closer sees these notes before the demo."
            : "Saved to the lead."
          : "Saved to the lead.",
      );
  }

  // ------------------------------------------------------- the setter's notes
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

  function setPref(p: Partial<{ lang: "en" | "ar"; mode: Mode }>) {
    const next = { ...prefs, ...p };
    setPrefs(next);
    writePrefs(next);
  }

  // -------------------------------------------------------------- drawing
  const toolbar = (
    <>
      <Segmented
        label="Script"
        value={key}
        options={[
          ["intro", "Intro"],
          ["demo", "Demo"],
        ]}
        onChange={v => onScriptKey(v as Key)}
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
    </>
  );

  if (script.error)
    return (
      <div className="space-y-3">
        {page ? (
          <header className="flex flex-wrap items-center gap-3">
            {headerStart}
          </header>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <Failed what="The script" error={script.error} retry={script.reload} />
      </div>
    );
  if (!doc)
    return (
      <div className="space-y-3">
        {page ? (
          <header className="flex flex-wrap items-center gap-3">
            {headerStart}
          </header>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        <p className="muted text-sm">
          {script.loading
            ? "Reading the script…"
            : "This script is not imported yet. Ask your manager."}
        </p>
      </div>
    );

  const stages = doc.stages;
  const stage = stages[Math.min(stageIdx, stages.length - 1)];
  const last = lastNo(stages);
  const totalMinutes = stages.reduce((a, s) => a + (s.minutes ?? 0), 0);
  const stageBudget = (stage.minutes ?? 0) * 60_000;
  const overStage = stageBudget > 0 && now - stageStart > stageBudget;
  const checklistDone = stage.checklist.every(
    (_, i) => checked[`${stage.no}.${i}`],
  );
  const closerPart = key === "intro" && stage.no === last;
  const { at: fieldsAt, rest } = inlineCaptures(stage, doc.captures, [
    CLOSER_KEY,
  ]);
  // The booking goes right after the calendar lock's first line, so "__ or
  // __" reads the two real times; with no lock in the part, at its end.
  const lockStage =
    key === "intro"
      ? (stages.find(s => s.blocks.some(isLock)) ?? stages[stages.length - 1])
      : null;
  const bookHere = lockStage?.no === stage.no;
  const lockAt = bookHere ? stage.blocks.findIndex(isLock) : -1;
  const bookAt =
    lockAt >= 0 && lockAt + 1 < stage.blocks.length ? lockAt + 1 : -1;
  const allCaptures = doc.captures.filter(c => c.key !== CLOSER_KEY);
  const filledAll = allCaptures.filter(c =>
    (values[c.key] ?? "").trim(),
  ).length;
  const fromIntro = (k: string) => {
    const from = INTRO_FIELD[k];
    return Boolean(
      key === "demo" && from && values[k] && introValues[from] === values[k],
    );
  };

  function go(i: number, then?: () => void) {
    void saver.current?.flush();
    const next = Math.max(0, Math.min(stages.length - 1, i));
    setStageIdx(next);
    setReached(r => Math.max(r, stages[next].no));
    setStageStart(Date.now());
    window.setTimeout(() => {
      if (then) then();
      else
        partRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 30);
  }

  function goBook() {
    if (!lockStage) return;
    const i = stages.findIndex(s => s.no === lockStage.no);
    const show = () =>
      document
        .getElementById("book-demo")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (i === stageIdx) show();
    else go(i, show);
  }

  /** The ledger's slot: its own field when it is on screen. */
  function jump(k: string): boolean {
    const el = scriptRef.current?.querySelector<HTMLElement>(
      `[data-capture="${k}"][data-inline]`,
    );
    if (!el?.offsetParent) return false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.querySelector<HTMLElement>("input, button")?.focus({
      preventScroll: true,
    });
    return true;
  }

  function booked(words: string, start: string | null) {
    setBookedHere({ words, start });
    setValues(x => ({ ...x, demo: "Booked" }));
    if (lockStage)
      setChecked(c => {
        const next = { ...c };
        lockStage.checklist.forEach((item, j) => {
          if (/demo booked/i.test(item)) next[`${lockStage.no}.${j}`] = true;
        });
        return next;
      });
    touch();
    void saver.current?.flush();
    reload();
    onBooked?.(words);
  }

  const field = (c: Capture) => (
    <CaptureField
      key={c.key}
      c={c}
      inline
      value={values[c.key] ?? ""}
      onChange={v => setValue(c.key, v)}
      currency={currency}
      fromIntro={fromIntro(c.key)}
    />
  );

  const bookingBlock = (
    <div className="space-y-3 py-1">
      <BookDemoBlock
        me={me}
        as={as}
        lead={lead}
        appointments={appointments}
        values={values}
        attemptId={attemptId}
        onSlots={setSlotIsos}
        onBooked={booked}
      />
      {demoAppt && !isClient(lead) ? (
        <GroupKit
          lead={lead}
          me={me}
          demo={{
            appointment_id: demoAppt.appointment_id,
            start_at: demoAppt.start_at,
            assigned_user_name: demoAppt.assigned_user_name,
            assigned_user_id: demoAppt.assigned_user_id,
          }}
          lang={lang}
          compact
        />
      ) : null}
    </div>
  );

  const under = (i: number): ReactNode => {
    const here = fieldsAt[i] ?? [];
    const book = bookHere && i === bookAt;
    if (!here.length && !book) return null;
    return (
      <>
        {here.length ? (
          <div className="space-y-2">{here.map(field)}</div>
        ) : null}
        {book ? bookingBlock : null}
      </>
    );
  };

  const savedLine = saveWords(saveState, ms =>
    clock(new Date(ms).toISOString()),
  );
  const saveDot = (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      role="status"
      aria-live="polite"
    >
      <span
        className={`size-2 rounded-full ${saveState.kind === "saving" || saveState.kind === "pending" ? "animate-pulse motion-reduce:animate-none" : ""}`}
        style={{
          background:
            saveState.kind === "failed"
              ? "var(--warning)"
              : saveState.kind === "saved"
                ? "var(--success)"
                : saveState.kind === "idle"
                  ? "var(--muted-foreground)"
                  : "var(--primary)",
        }}
        aria-hidden
      />
      <span
        className={saveState.kind === "failed" ? "" : "muted"}
        style={
          saveState.kind === "failed" ? { color: "var(--warning)" } : undefined
        }
      >
        {saveState.kind === "failed"
          ? "Not saved"
          : saveState.kind === "saved"
            ? `Saved ${clock(new Date(saveState.at).toISOString())}`
            : saveState.kind === "idle"
              ? "Nothing to save yet"
              : "Saving…"}
      </span>
    </span>
  );

  const stepper = (
    <div className="flex items-center gap-2 text-sm lg:hidden">
      <button
        type="button"
        onClick={() => go(stageIdx - 1)}
        disabled={stageIdx === 0}
        aria-label="The part before"
        className="flex size-10 shrink-0 items-center justify-center rounded-[12px] hover:bg-white/[0.06] disabled:opacity-30"
      >
        <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-center">
        <span className="muted font-mono text-xs tabular-nums">
          {stageIdx + 1} of {stages.length}
        </span>{" "}
        · <span className="font-medium">{stage.title}</span>
      </span>
      <button
        type="button"
        onClick={() => go(stageIdx + 1)}
        disabled={stageIdx === stages.length - 1}
        aria-label="The next part"
        className="flex size-10 shrink-0 items-center justify-center rounded-[12px] hover:bg-white/[0.06] disabled:opacity-30"
      >
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
      </button>
    </div>
  );

  const ledger = (
    <NumberLedger
      slots={LEDGER_SLOTS[key]}
      captures={doc.captures}
      values={values}
      currency={currency}
      onChange={setValue}
      onJump={jump}
      book={
        key === "intro"
          ? {
              // The rep's own clock, as the booking block says it: Kuwait's.
              booked: bookedStart
                ? kuwaitShort(bookedStart)
                : bookedHere
                  ? "Booked"
                  : null,
              onClick: goBook,
            }
          : null
      }
      answers={{ filled: filledAll, total: allCaptures.length }}
      onAnswers={() => setDrawer(d => (d === "answers" ? null : "answers"))}
      funnelOpen={drawer === "funnel"}
      onFunnel={() => setDrawer(d => (d === "funnel" ? null : "funnel"))}
      fromIntro={fromIntro}
      head={page ? stepper : undefined}
    />
  );

  const drawers =
    drawer === "funnel" ? (
      <div className="space-y-2">
        <FunnelLadder
          f={f}
          script={key}
          onCurrency={c => setValue("currency", c)}
        />
      </div>
    ) : drawer === "answers" ? (
      <SectionCard
        title="All answers"
        side={
          <button
            type="button"
            onClick={() => setDrawer(null)}
            className="muted text-xs hover:underline"
          >
            Close
          </button>
        }
      >
        <div className="space-y-5">
          {stages
            .filter(s => allCaptures.some(c => c.stage === s.no))
            .map(s => (
              <div key={s.no} className="space-y-2">
                <p className="muted text-xs font-medium">
                  {String(s.no).padStart(2, "0")} {s.title}
                </p>
                {allCaptures
                  .filter(c => c.stage === s.no)
                  .map(c => (
                    <CaptureField
                      key={c.key}
                      c={c}
                      value={values[c.key] ?? ""}
                      onChange={v => setValue(c.key, v)}
                      currency={currency}
                      fromIntro={fromIntro(c.key)}
                    />
                  ))}
              </div>
            ))}
        </div>
      </SectionCard>
    ) : null;

  const fromIntroBox =
    key === "demo" && (lastIntro || dialerNotes.length) ? (
      <FromIntro note={lastIntro} dialer={dialerNotes} />
    ) : null;

  const part = (
    <div
      ref={partRef}
      className={`${page ? "panel p-4 sm:p-6" : ""} scroll-mt-44`}
    >
      <div className="muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono tabular-nums">
          Part {stageIdx + 1} of {stages.length}
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
      <h2
        className={`mt-1 font-semibold tracking-tight ${page ? "text-xl" : "text-lg"}`}
      >
        {stage.title}
      </h2>
      {stage.goal ? <p className="muted mt-1 text-sm">{stage.goal}</p> : null}

      {fromIntroBox && stageIdx === 0 ? (
        <div
          className={`mt-4 rounded-[var(--radius-md)] border hairline p-3 ${page ? "lg:hidden" : ""}`}
        >
          <p className="text-sm font-medium">From the intro call</p>
          <div className="mt-1">{fromIntroBox}</div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {groupBlocks(stage.blocks).map((g, gi) => {
          const whenKey = g.blocks[0]?.when ?? "";
          const leakKey = whenKey.startsWith("leak:")
            ? (whenKey.slice(5) as LeakKey)
            : null;
          const groupFill = leakKey
            ? { ...fill, tokens: funnelTokens(f, lang, leakKey) }
            : fill;
          const theirs = leakKey != null && f.leak === leakKey;
          const inside = Array.from(
            { length: g.blocks.length },
            (_, j) => g.start + j,
          );
          const hasAnswer = inside.some(i =>
            (fieldsAt[i] ?? []).some(c => (values[c.key] ?? "").trim()),
          );
          const hasBooking = bookHere && inside.includes(bookAt);
          const blocks = (
            <Blocks
              key={`${stage.no}-${gi}-blocks`}
              blocks={g.blocks}
              fill={groupFill}
              mode={prefs.mode}
              lang={lang}
              start={g.start}
              after={under}
            />
          );
          return g.branch ? (
            <BranchGroup
              key={`${stage.no}-${gi}`}
              label={personalise(g.branch, fill)}
              open={theirs || hasAnswer || hasBooking}
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
              {blocks}
            </BranchGroup>
          ) : (
            <div key={`${stage.no}-${gi}`}>{blocks}</div>
          );
        })}
        {bookHere && bookAt < 0 ? bookingBlock : null}
      </div>

      {rest.length ? (
        <div className="mt-5 space-y-2.5 border-t hairline pt-4">
          <p className="text-sm font-medium">Answers for this part</p>
          {rest.map(field)}
        </div>
      ) : null}

      <div className="mt-5 border-t hairline pt-4">
        <PartNotes
          id={`part-notes-${key}-${stage.no}`}
          label={closerPart ? "For the closer" : "Notes on this part"}
          hint={
            closerPart
              ? "What the closer needs before the demo: who decides, what they care about, anything to avoid."
              : "Anything they said that no field asks for."
          }
          value={
            closerPart
              ? (values[CLOSER_KEY] ?? "")
              : (partNotes[String(stage.no)] ?? "")
          }
          onChange={v => {
            if (closerPart) setValue(CLOSER_KEY, v);
            else {
              setPartNotes(n => ({ ...n, [String(stage.no)]: v }));
              touch();
            }
          }}
          state={saveState}
        />
      </div>

      {stage.checklist.length ? (
        <div className="mt-5 border-t hairline pt-4">
          <p className="text-sm font-medium">Before you move on</p>
          <ul className="mt-2 space-y-1.5">
            {stage.checklist.map((c, i) => {
              const id = `${stage.no}.${i}`;
              return (
                <li key={id}>
                  <label className="flex items-start gap-2.5 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0"
                      checked={Boolean(checked[id])}
                      onChange={e => {
                        setChecked(v => ({ ...v, [id]: e.target.checked }));
                        touch();
                      }}
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
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden /> Back
        </button>
        {stageIdx < stages.length - 1 ? (
          <button
            type="button"
            className={checklistDone ? buttonPrimary : button}
            onClick={() => go(stageIdx + 1)}
          >
            Next: {stages[stageIdx + 1].title}{" "}
            <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={buttonPrimary}
            disabled={saveState.kind === "saving"}
            onClick={() => void saveNow(true)}
          >
            {saveState.kind === "saving" ? "Saving…" : "Save the call's notes"}
          </button>
        )}
      </div>
      {!checklistDone && stage.checklist.length ? (
        <p className="muted mt-2 text-end text-xs">
          The checklist is not complete; you can still move on.
        </p>
      ) : null}
      {stageIdx === stages.length - 1 && savedLine ? (
        <p className="muted mt-1 text-end text-xs">
          Your notes save as you type. This marks the call's notes as done.
        </p>
      ) : null}
    </div>
  );

  if (!page)
    return (
      <div className="space-y-3" ref={scriptRef}>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <span className="ms-auto flex items-center gap-2">
            {saveDot}
            <button
              type="button"
              onClick={() => void saveNow(false)}
              className={`${button} h-8 px-3 text-xs`}
            >
              Save notes
            </button>
          </span>
        </div>
        {ledger}
        {drawers}
        <div
          className="no-scrollbar flex gap-1 overflow-x-auto pb-1"
          role="group"
          aria-label="Part"
        >
          {stages.map((s, i) => {
            const done =
              s.checklist.length > 0 &&
              s.checklist.every((_, j) => checked[`${s.no}.${j}`]);
            return (
              <button
                key={s.no}
                type="button"
                aria-pressed={i === stageIdx}
                onClick={() => go(i)}
                className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs ${
                  i === stageIdx
                    ? "border-[color:var(--primary)] font-semibold"
                    : "hairline muted"
                }`}
              >
                {done ? (
                  <Check
                    className="size-3"
                    style={{ color: "var(--success)" }}
                    aria-label="Done"
                  />
                ) : null}
                {s.title}
              </button>
            );
          })}
        </div>
        {part}
        <PaneSection title="Objections and questions">
          <Playbook objections={doc.objections} faqs={doc.faqs} fill={fill} />
        </PaneSection>
      </div>
    );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        {headerStart}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {toolbar}
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 font-mono text-xs font-semibold tabular-nums text-teal-300 shadow-sm"
            title={`About ${totalMinutes} minutes in all`}
          >
            <Timer className="size-3.5 text-teal-400" aria-hidden />{" "}
            {mmss(now - startedAt)}
            <span className="muted">/ {totalMinutes}:00</span>
          </span>
          {headerEnd}
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveNow(false)}
              className={`${buttonPrimary} shadow-md shadow-teal-500/20`}
            >
              Save notes
            </button>
            {saveDot}
          </span>
        </div>
      </header>

      <KitSegmented
        label="Show"
        value={tab}
        options={[
          ["script", "Script"],
          ["objections", "Objections"],
        ]}
        onChange={v => setTab(v as "script" | "objections")}
        className="lg:hidden"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,17rem)]">
        <aside className="hidden min-w-0 space-y-4 lg:block">
          <div className={`sticky space-y-4 ${LEDGER_TOP}`}>
            <SectionCard title="Parts" flush>
              <ol className="py-1">
                {stages.map((s, i) => {
                  const done =
                    s.checklist.length > 0 &&
                    s.checklist.every((_, j) => checked[`${s.no}.${j}`]);
                  const noted = (
                    s.no === last && key === "intro"
                      ? (values[CLOSER_KEY] ?? "")
                      : (partNotes[String(s.no)] ?? "")
                  ).trim();
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
                        <span className="muted w-5 shrink-0 font-mono text-xs tabular-nums">
                          {String(s.no).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {s.title}
                        </span>
                        {noted ? (
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: "var(--primary)" }}
                            title="Has notes"
                          />
                        ) : null}
                        {done ? (
                          <Check
                            className="size-3.5 shrink-0"
                            style={{ color: "var(--success)" }}
                            aria-label="Done"
                          />
                        ) : s.minutes ? (
                          <span className="muted shrink-0 font-mono text-xs tabular-nums">
                            {s.minutes}m
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </SectionCard>
            {fromIntroBox ? (
              <SectionCard title="From the intro call">
                {fromIntroBox}
              </SectionCard>
            ) : null}
          </div>
        </aside>

        <section
          ref={scriptRef}
          className={`min-w-0 space-y-4 ${tab === "script" ? "" : "hidden lg:block"}`}
        >
          {ledger}
          {drawers}
          {part}
        </section>

        <aside
          className={`min-w-0 space-y-4 ${tab === "objections" ? "" : "hidden lg:block"}`}
        >
          {/* Stays beside the line being read, as the parts do: an objection
              comes at any point in the call, not only at the top. */}
          <div className="lg:sticky lg:top-3 lg:max-h-[calc(100dvh-1.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-[var(--radius-xl)]">
            <Playbook objections={doc.objections} faqs={doc.faqs} fill={fill} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** A booked time on Kuwait's clock, short: "Sun 6:00 pm". */
function kuwaitShort(iso: string): string {
  const w = slotWords(iso, "Kuwait");
  return `${w.day.split(" ")[0]} ${w.time}`;
}

function lastNo(stages: Pick<Stage, "no">[]): number {
  return stages.length ? stages[stages.length - 1].no : 0;
}

function isLock(b: { type: string; text?: string }): boolean {
  return b.type === "step" && /CALENDAR LOCK/i.test(b.text ?? "");
}

/** The playbook in the dialer: closed until the rep needs it. */
function PaneSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[18px] border border-white/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm font-medium hover:bg-white/[0.03]"
      >
        {title}
        <span className="muted text-xs">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="border-t border-white/5 p-2">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * What the setter found, for the closer before the demo: the answers and
 * notes they captured on the intro (For the closer first), then what they
 * wrote in the dialer.
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
            {note.body.replace(/^Intro call notes\n/, "").trim()}
          </p>
          <p className="muted mt-1 text-xs">
            Captured by {note.author.split("@")[0]}{" "}
            {when(note.updated_at || note.created_at)}. Confirm these, don't ask
            them again.
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
