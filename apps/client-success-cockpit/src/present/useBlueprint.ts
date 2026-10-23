import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Answers,
  type BpKey,
  type BpPart,
  checkValue,
  labelOf,
  missing as missingOf,
  partAnswers,
  sameValue,
} from "./blueprintForm";
import {
  blueprintPrefill,
  type Prefill,
  type PrefillOut,
} from "./blueprintPrefill";
import { BlueprintSaver, sessionId } from "./blueprintSaver";
import {
  type BlueprintBundle,
  type PartStamp,
  StillMissing,
} from "./blueprintSources";
import type { BpPhase, DeckHub } from "./channel";
import type { DeckData } from "./deckData";
import type { BlueprintIO, Loaded, SaveState } from "./useDeckModel";

/**
 * The Brand Blueprint in one window (docs/brand-blueprint/SPEC.md 2.4 and
 * 3.1): the answers as typed, what the record holds, the suggestions, the
 * three parts and their runs, and the conflicts to settle. The deck window,
 * the notes window and prep each hold one, kept in step over the deck's hub
 * (an answer shows in the others at once; a confirmed save tells them what
 * the server holds; a press tells the deck to land the Part 1 stamp).
 *
 * Rehearsal (`?rehearse=1`, admins and the CEO): answers stay in memory,
 * nothing reaches cockpit_blueprint_save, and each press shows the plan
 * built from ClickUp reads only. The canvas never says it is a rehearsal.
 */

export type PartKey = "1" | "2" | "3";

export interface BpRun {
  phase: BpPhase;
  at: string;
  requestId?: string | null;
  lines?: string[];
  error?: string | null;
  result?: unknown;
  /** The press found nothing changed since the last one. */
  duplicate?: boolean;
  /** Keys the press found still missing (the notes window jumps to the first). */
  missing?: string[];
  /** Pressed on this call (a window's own press, or another's over the hub). */
  live?: boolean;
}

export interface BpConflict {
  key: string;
  theirs: unknown;
  mine: unknown;
  by: string | null;
  at: string | null;
}

export type SourceMark =
  | "kickoff"
  | "deck"
  | "onboarding"
  | "call"
  | "now"
  | null;

/** The client's documents the call opens, each in its own window. */
export interface BpDocs {
  /** The Brand DNA doc's text (its colours are read from it). */
  brandDna: string | null;
  brandDnaUrl: string | null;
  offerUrl: string | null;
  driveUrl: string | null;
  research: string | null;
  /** The harness's pictures in place of Drive's folder view (never in production). */
  packStandIn: string[] | null;
}

export interface BpModel {
  answers: Answers;
  prefill: PrefillOut;
  can: { write: boolean; rehearse: boolean };
  rehearsal: boolean;
  /** A CSM seat: the deck reads, never writes or presses. */
  readOnly: boolean;
  parts: Partial<Record<PartKey, PartStamp>>;
  runs: Partial<Record<PartKey, BpRun>>;
  /** The Part 1 stamp: `fresh` only when this call's press landed it. */
  stamp: { at: string; fresh: boolean } | null;
  conflicts: BpConflict[];
  save: SaveState;
  bundle: BlueprintBundle | null;
  docs: BpDocs;
  launchTaskId: string | null;
  set: (
    key: BpKey,
    value: unknown,
    opts?: { now?: boolean; from?: string },
  ) => void;
  /** Take a suggestion as the answer (one tap), recording where it came from. */
  accept: (key: BpKey, prefill?: Prefill) => void;
  /** Take several suggestions in one save (prep's "Confirm part 1"). */
  acceptMany: (items: { key: BpKey; prefill: Prefill }[]) => void;
  keepMine: (key: string) => void;
  dismiss: (key: string) => void;
  press: (part: BpPart) => Promise<void>;
  missing: (part: BpPart) => string[];
  /** The part was sent and its answers changed since. */
  changed: (part: BpPart) => boolean;
  mark: (key: BpKey) => SourceMark;
  flush: () => Promise<void>;
  now: () => Date;
}

const iso = (d: Date) => d.toISOString();

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * One request ID per press, kept under a hash of the task, the part and
 * the part's answers, so a retry after a dropped connection reuses it.
 */
function requestIdFor(taskId: string, part: BpPart, answers: Answers): string {
  const key = `mahara-bp-req:${taskId}:${part}:${hash(JSON.stringify(sortKeys(partAnswers(part, answers))))}`;
  try {
    const kept = localStorage.getItem(key);
    if (kept && /^[0-9a-f-]{36}$/.test(kept)) return kept;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
function forgetRequest(taskId: string, part: BpPart) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(`mahara-bp-req:${taskId}:${part}:`))
        localStorage.removeItem(k);
    }
  } catch {
    // nothing kept
  }
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map(k => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/**
 * The answers as the server keeps them (trimmed, spaces folded, repeats
 * dropped), so a stray space never reads as "Changed since sent" nor mints
 * a new request ID. The server's own shot list date is kept as it is.
 */
function tidy(a: Answers): Answers {
  return Object.fromEntries(
    Object.entries(a).flatMap(([k, v]) => {
      if (k === "shot_list_due") return [[k, v]];
      const c = checkValue(k, v);
      return "error" in c || c.value === null ? [] : [[k, c.value]];
    }),
  );
}

const PHASE: Record<string, BpPhase> = {
  pending: "queued",
  sending: "running",
  done: "done",
  failed: "failed",
  reconcile: "reconcile",
};

function runsOf(
  bundle: BlueprintBundle | null,
): Partial<Record<PartKey, BpRun>> {
  const out: Partial<Record<PartKey, BpRun>> = {};
  for (const k of ["1", "2", "3"] as PartKey[]) {
    const row = bundle?.outbox?.[k];
    if (!row) continue;
    out[k] = {
      phase: PHASE[row.state] ?? "queued",
      at: row.settledAt ?? row.createdAt ?? "",
      requestId: row.id,
      error: row.error ?? null,
      result: row.result,
    };
  }
  return out;
}

export function useBlueprint({
  enabled,
  taskId,
  loaded,
  d,
  io,
  hub,
  rehearseAsked,
  now: nowIn,
}: {
  enabled: boolean;
  taskId: string;
  loaded: Loaded | null;
  d: DeckData | null;
  io: BlueprintIO | undefined;
  hub: DeckHub;
  rehearseAsked: boolean;
  now?: () => Date;
}): BpModel | null {
  const bundle = enabled ? (loaded?.blueprint ?? null) : null;
  const now = useCallback(() => nowIn?.() ?? new Date(), [nowIn]);
  const rehearsal = Boolean(rehearseAsked && bundle?.can.rehearse);
  const write = Boolean(bundle?.can.write);
  const readOnly = !write && !rehearsal;

  const [answers, setAnswers] = useState<Answers>({});
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const [parts, setParts] = useState<Partial<Record<PartKey, PartStamp>>>({});
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const [runs, setRuns] = useState<Partial<Record<PartKey, BpRun>>>({});
  const [stamp, setStamp] = useState<BpModel["stamp"]>(null);
  const [conflicts, setConflicts] = useState<BpConflict[]>([]);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [launchTaskId, setLaunchTaskId] = useState<string | null>(null);
  /** When each key was typed on this call (any window), for "Just now". */
  const [touched, setTouched] = useState<Record<string, number>>({});
  /**
   * When each key's last save landed (this window's, or another's over the
   * hub): "Just now" holds only until then, then it reads "Said on this
   * call".
   */
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const markSaved = useCallback((keys: string[]) => {
    if (!keys.length) return;
    const at = Date.now();
    setSavedAt(m => ({ ...m, ...Object.fromEntries(keys.map(k => [k, at])) }));
  }, []);
  const [meta, setMeta] = useState<
    Record<string, { at?: string | null; from?: string | null }>
  >({});

  const ioRef = useRef(io);
  ioRef.current = io;
  const session = useMemo(() => sessionId(), []);
  const memRevision = useRef(1);

  const saver = useMemo(
    () =>
      new BlueprintSaver({
        save: async (changes, base) => {
          setSave({ kind: "saving" });
          const save = ioRef.current?.save;
          if (!save)
            throw Error(
              "Saving needs your cockpit sign-in. The preview still works.",
            );
          return save(changes, session, base);
        },
        onSaved: (result, sent) => {
          setSave({ kind: "saved", at: Date.now(), changed: true });
          markSaved(result.applied);
          const values: Record<string, unknown> = {};
          for (const k of result.applied)
            values[k] = result.row
              ? (result.row.answers[k] ?? null)
              : sent[k]?.value;
          if (result.row) {
            const due = result.row.answers.shot_list_due;
            values.shot_list_due = due ?? null;
            setAnswers(a => {
              const next = { ...a };
              if (due === undefined) delete next.shot_list_due;
              else next.shot_list_due = due;
              return next;
            });
            if (result.row.meta)
              setMeta(m => ({ ...m, ...(result.row?.meta ?? {}) }));
          }
          hub.post({
            type: "bp-saved",
            values,
            revision: result.row?.revision ?? null,
          });
        },
        onConflict: c => {
          setConflicts(list => [...list.filter(x => x.key !== c.key), c]);
          setAnswers(a => ({ ...a, [c.key]: c.theirs }));
          hub.post({ type: "bp-conflict", ...c });
        },
        onError: message => setSave({ kind: "error", message }),
      }),
    [hub, session, markSaved],
  );

  // The record as read, the first time it arrives; later reads keep what
  // this window has typed and take the parts, the runs and the task link.
  const first = useRef(true);
  useEffect(() => {
    if (!bundle) return;
    const row = bundle.row;
    if (first.current) {
      first.current = false;
      const a = { ...(row?.answers ?? {}) };
      answersRef.current = a;
      setAnswers(a);
      setMeta(row?.meta ?? {});
      saver.load(a, row?.revision ?? null);
      memRevision.current = row?.revision ?? 1;
      setRuns(runsOf(bundle));
      const p1 = row?.parts?.["1"];
      if (p1) setStamp({ at: p1.firstAt ?? p1.lastAt ?? "", fresh: false });
    } else {
      setRuns(r => ({ ...runsOf(bundle), ...r }));
    }
    setParts((row?.parts ?? {}) as Partial<Record<PartKey, PartStamp>>);
    setLaunchTaskId(row?.launchTaskId ?? null);
  }, [bundle, saver]);

  const prefill = useMemo<PrefillOut>(
    () =>
      blueprintPrefill({
        forms: (loaded?.kit?.forms as never) ?? null,
        cardBudget: loaded?.kit?.handover?.daily_budget ?? null,
        onboardingPrep: loaded?.prep.onboarding ?? {},
        dosDonts: d?.dosDonts ?? { do: [], dont: [] },
        card: bundle?.card ?? null,
        packs: bundle?.settings.packs ?? {},
        lang: d?.lang ?? "en",
      }),
    [loaded, d?.dosDonts, d?.lang, bundle],
  );

  // What the other windows say.
  useEffect(() => {
    if (!enabled) return;
    return hub.on(m => {
      if (m.type === "bp-set") {
        setAnswers(a => {
          const next = { ...a };
          if (m.value === null || m.value === undefined) delete next[m.key];
          else next[m.key] = m.value;
          answersRef.current = next;
          return next;
        });
        setTouched(t => ({ ...t, [m.key]: Date.now() }));
      } else if (m.type === "bp-saved") {
        saver.confirm(m.values, m.revision);
        markSaved(Object.keys(m.values ?? {}));
      } else if (m.type === "bp-conflict") {
        setConflicts(list => [...list.filter(x => x.key !== m.key), m]);
        setAnswers(a => ({ ...a, [m.key]: m.theirs }));
        // This window shows theirs now: an edit here is made over it.
        saver.confirm({ [m.key]: m.theirs }, null);
      } else if (m.type === "bp-flush")
        void saver.flush().then(() =>
          hub.post({
            type: "bp-flushed",
            id: m.id,
            ok: saver.waiting.length === 0,
          }),
        );
      else if (m.type === "bp-part") {
        const k = String(m.part) as PartKey;
        setRuns(r => ({
          ...r,
          [k]: {
            phase: m.phase,
            at: m.at,
            requestId: m.requestId ?? null,
            lines: m.lines,
            error: m.error ?? null,
            result: m.result,
            live: true,
          },
        }));
        if ((m.phase === "queued" || m.phase === "rehearsed") && m.sent) {
          setParts(p => ({
            ...p,
            [k]: {
              ...(p[k] ?? {}),
              status: "done",
              firstAt: m.firstAt ?? p[k]?.firstAt ?? m.at,
              lastAt: m.at,
              presses: m.presses ?? (p[k]?.presses ?? 0) + 1,
              sent: m.sent,
            },
          }));
          // The stamp lands on the deck only from this call's press (a
          // rehearsal's, once its plan came back).
          if (m.part === 1)
            setStamp(s => s ?? { at: m.firstAt ?? m.at, fresh: true });
        }
        const tid = (m.result as { launchTaskId?: unknown } | undefined)
          ?.launchTaskId;
        if (typeof tid === "string") setLaunchTaskId(tid);
      }
    });
  }, [enabled, hub, saver, markSaved]);

  // A save that failed offline goes again when the connection comes back,
  // and a window closed within the pause still sends its last keystrokes.
  useEffect(() => {
    if (!enabled) return;
    const again = () => void saver.flush();
    window.addEventListener("online", again);
    window.addEventListener("pagehide", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("pagehide", again);
      void saver.flush();
    };
  }, [enabled, saver]);

  const memorySave = useCallback(
    (key: string, value: unknown) => {
      memRevision.current += 1;
      saver.confirm({ [key]: value }, memRevision.current);
      setSave({ kind: "saved", at: Date.now(), changed: true });
      markSaved([key]);
      if (key === "shot_list") {
        const due =
          value === true
            ? iso(new Date(now().getTime() + 72 * 3_600_000))
            : null;
        setAnswers(a => {
          const next = { ...a };
          if (due) next.shot_list_due = due;
          else delete next.shot_list_due;
          return next;
        });
        hub.post({ type: "bp-set", key: "shot_list_due", value: due });
      }
    },
    [saver, hub, now, markSaved],
  );

  const setRef = useRef<BpModel["set"]>(() => {});
  const set = useCallback<BpModel["set"]>(
    (key, value, opts = {}) => {
      if (readOnly) return;
      const before = answersRef.current;
      const checked = checkValue(key, value);
      // What was typed stays as typed here (the saver trims it on its way
      // out), so a space at the end of a word survives; an answer that
      // empties out is removed, and anything else the server would refuse
      // is refused before it is shown or sent.
      if ("error" in checked && typeof value !== "string") {
        setSave({ kind: "error", message: checked.error });
        return;
      }
      const typed =
        "error" in checked ? value : checked.value === null ? null : value;
      setAnswers(a => {
        const next = { ...a };
        if (typed === null || typed === undefined) delete next[key];
        else next[key] = typed;
        answersRef.current = next;
        return next;
      });
      setTouched(t => ({ ...t, [key]: Date.now() }));
      if (opts.from)
        setMeta(m => ({ ...m, [key]: { at: iso(now()), from: opts.from } }));
      else setMeta(m => ({ ...m, [key]: { at: iso(now()), from: null } }));
      hub.post({ type: "bp-set", key, value: typed ?? null });
      setConflicts(list => list.filter(c => c.key !== key));
      // The red lines they agree (slide 2, or prep) seed slide 11's Never
      // list while it is empty or still the same lines, so the call does not
      // ask for them twice (2.14 merges 1.9).
      if (key === "red_lines" && !("error" in checked)) {
        const rules = (
          before.rules && typeof before.rules === "object" ? before.rules : {}
        ) as Record<string, unknown>;
        const never = Array.isArray(rules.never) ? rules.never : [];
        if (!never.length || sameValue(never, before.red_lines ?? null)) {
          const next: Record<string, unknown> = { ...rules };
          const lines = Array.isArray(checked.value) ? checked.value : [];
          if (lines.length) next.never = lines;
          else delete next.never;
          if (!sameValue(next, rules))
            queueMicrotask(() =>
              setRef.current("rules", Object.keys(next).length ? next : null, {
                now: true,
              }),
            );
        }
      }
      if (rehearsal) {
        if ("error" in checked)
          setSave({ kind: "error", message: checked.error });
        else memorySave(key, checked.value);
        return;
      }
      const refused = saver.set(key, value, opts);
      if (refused) setSave({ kind: "error", message: refused });
    },
    [readOnly, rehearsal, saver, hub, now, memorySave],
  );
  setRef.current = set;

  const accept = useCallback<BpModel["accept"]>(
    (key, p) => {
      const s = p ?? prefill.values[key];
      if (!s) return;
      set(key, s.value, { now: true, from: s.from });
    },
    [prefill, set],
  );
  const acceptMany = useCallback<BpModel["acceptMany"]>(
    items => {
      for (const { key, prefill: p } of items)
        set(key, p.value, { from: p.from });
      if (!rehearsal) void saver.flush();
    },
    [set, saver, rehearsal],
  );

  const keepMine = useCallback(
    (key: string) => {
      const c = conflicts.find(x => x.key === key);
      if (!c || readOnly) return;
      setConflicts(list => list.filter(x => x.key !== key));
      setAnswers(a => ({ ...a, [key]: c.mine }));
      hub.post({ type: "bp-set", key, value: c.mine });
      if (rehearsal) return;
      const refused = saver.keepMine(key, c.mine, c.theirs);
      if (refused) setSave({ kind: "error", message: refused });
    },
    [conflicts, readOnly, rehearsal, saver, hub],
  );
  const dismiss = useCallback(
    (key: string) => setConflicts(list => list.filter(x => x.key !== key)),
    [],
  );

  /**
   * Every window sends what it still holds before a press goes. False when
   * this window, or another that answered, still holds unsaved answers.
   */
  const flushAll = useCallback(async (): Promise<boolean> => {
    await saver.flush();
    const id = crypto.randomUUID();
    let othersOk = true;
    await new Promise<void>(resolve => {
      const timer = window.setTimeout(done, 900);
      const off = hub.on(m => {
        if (m.type === "bp-flushed" && m.id === id) {
          if (m.ok === false) othersOk = false;
          done();
        }
      });
      function done() {
        window.clearTimeout(timer);
        off();
        resolve();
      }
      hub.post({ type: "bp-flush", id });
    });
    return othersOk && saver.waiting.length === 0;
  }, [saver, hub]);

  const post = useCallback(
    (
      part: BpPart,
      run: BpRun,
      extra: Partial<{
        presses: number;
        firstAt: string | null;
        sent: Answers;
      }> = {},
    ) => {
      const k = String(part) as PartKey;
      setRuns(r => ({ ...r, [k]: { ...run, live: true } }));
      hub.post({
        type: "bp-part",
        part,
        phase: run.phase,
        at: run.at,
        requestId: run.requestId ?? null,
        lines: run.lines,
        error: run.error ?? null,
        result: run.result,
        ...extra,
      });
    },
    [hub],
  );

  const stampPart = useCallback(
    (
      part: BpPart,
      at: string,
      sent: Answers,
      firstAt?: string | null,
      presses?: number,
    ) => {
      const k = String(part) as PartKey;
      setParts(p => ({
        ...p,
        [k]: {
          ...(p[k] ?? {}),
          status: "done",
          firstAt: firstAt ?? p[k]?.firstAt ?? at,
          lastAt: at,
          presses: presses ?? (p[k]?.presses ?? 0) + 1,
          sent,
        },
      }));
      if (part === 1) setStamp(s => s ?? { at: firstAt ?? at, fresh: true });
    },
    [],
  );

  const press = useCallback(
    async (part: BpPart) => {
      if (readOnly) return;
      const k = String(part) as PartKey;
      const at = iso(now());
      const fail = (error: string, missing?: string[]) =>
        post(part, {
          phase: "failed",
          at,
          error,
          ...(missing ? { missing } : {}),
        });
      if (part === 2 && !partsRef.current["1"])
        return fail("Send part 1 to media first.");
      if (part === 3 && !partsRef.current["2"])
        return fail("Close the call first.");
      const a = answersRef.current;
      const miss = missingOf(part, a);
      if (miss.length)
        return fail(`Still missing: ${miss.map(labelOf).join(", ")}.`, miss);
      const sent = partAnswers(part, tidy(a));
      const blueprint = ioRef.current;

      if (rehearsal) {
        // The stamp lands with the plan, never before it (nor on a refusal).
        post(part, { phase: "queued", at });
        try {
          const plan = await blueprint?.rehearse(part, a);
          if (!plan) throw Error("The rehearsal needs the cockpit's sign-in.");
          if (plan.missing.length)
            return fail(
              `Still missing: ${plan.missing.map(labelOf).join(", ")}.`,
              plan.missing,
            );
          const firstAt = partsRef.current[k]?.firstAt ?? at;
          stampPart(part, at, sent, firstAt);
          post(
            part,
            { phase: "rehearsed", at: iso(now()), lines: plan.lines },
            { sent, firstAt },
          );
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e));
        }
        return;
      }

      if (!blueprint) return fail("Sending needs your cockpit sign-in.");
      // A save that did not land would send the older answers while this
      // window shows the newer ones as sent: refuse instead.
      if (!(await flushAll()))
        return fail(
          "Your last answers are not saved yet, so nothing was sent. Check the connection, then press again.",
        );
      const requestId = requestIdFor(taskId, part, tidy(answersRef.current));
      let res: Awaited<ReturnType<BlueprintIO["partDone"]>>;
      try {
        res = await blueprint.partDone(part, requestId);
      } catch (e) {
        if (e instanceof StillMissing)
          return fail(
            `Still missing: ${e.keys.map(labelOf).join(", ")}.`,
            e.keys,
          );
        return fail(e instanceof Error ? e.message : String(e));
      }
      const firstAt = res.firstAt ?? at;
      stampPart(part, res.lastAt ?? at, sent, firstAt, res.presses);
      if (res.duplicate && res.state !== "pending") {
        post(
          part,
          {
            phase: res.state === "done" ? "done" : "running",
            at: res.lastAt ?? at,
            requestId: res.id,
            duplicate: true,
          },
          { sent, firstAt, presses: res.presses },
        );
        return;
      }
      post(
        part,
        { phase: "queued", at, requestId: res.id },
        { sent, firstAt, presses: res.presses },
      );
      post(part, { phase: "running", at: iso(now()), requestId: res.id });
      try {
        const run = await blueprint.run(res.id);
        const result = run.result as { launchTaskId?: unknown } | undefined;
        if (typeof result?.launchTaskId === "string")
          setLaunchTaskId(result.launchTaskId);
        forgetRequest(taskId, part);
        post(part, {
          phase: "done",
          at: iso(now()),
          requestId: res.id,
          result: run.result,
          lines: run.note ? [run.note] : undefined,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        post(part, {
          phase: /reconcil/i.test(message) ? "reconcile" : "failed",
          at: iso(now()),
          requestId: res.id,
          error: message,
        });
      }
    },
    [readOnly, rehearsal, now, post, stampPart, flushAll, taskId],
  );

  const changed = useCallback(
    (part: BpPart) => {
      const sent = parts[String(part) as PartKey]?.sent;
      if (!sent) return false;
      return !sameValue(sent, partAnswers(part, tidy(answers)));
    },
    [parts, answers],
  );

  const mark = useCallback(
    (key: BpKey): SourceMark => {
      const t = touched[key];
      const from = meta[key]?.from ?? null;
      // Amber "Just now" while it is being typed and not saved yet; teal
      // "Said on this call" once its save has landed.
      if (t && !from) return (savedAt[key] ?? 0) >= t ? "call" : "now";
      if (from?.startsWith("kickoff")) return "kickoff";
      // The onboarding deck's prep: said on the onboarding call.
      if (from?.startsWith("deck.")) return "deck";
      if (from?.startsWith("onboarding")) return "onboarding";
      const at = meta[key]?.at;
      if (at && at.slice(0, 10) === iso(now()).slice(0, 10)) return "call";
      return null;
    },
    [touched, meta, now, savedAt],
  );

  const editor = loaded?.sources?.editor ?? null;
  const links = (loaded?.kit?.links ?? {}) as Record<
    string,
    string | undefined
  >;
  const kitLinks = (loaded?.sources?.kit?.links ?? {}) as Record<
    string,
    string | undefined
  >;
  const docs: BpDocs = {
    brandDna: editor?.brandDna ?? null,
    brandDnaUrl: editor?.brandDnaUrl ?? links.brand_dna ?? null,
    offerUrl: editor?.offerUrl ?? links.offer_sheet ?? null,
    driveUrl:
      kitLinks.driveFolder ??
      links.drive_folder ??
      editor?.driveUrl ??
      links.drive ??
      null,
    research: links.market_research ?? null,
    packStandIn: io?.packStandIn ?? null,
  };

  if (!enabled || !bundle) return null;
  return {
    answers,
    prefill,
    can: bundle.can,
    rehearsal,
    readOnly,
    parts,
    runs,
    stamp,
    conflicts,
    save,
    bundle,
    docs,
    launchTaskId,
    set,
    accept,
    acceptMany,
    keepMine,
    dismiss,
    press,
    missing: part => missingOf(part, answers),
    changed,
    mark,
    flush: () => saver.flush(),
    now,
  };
}
