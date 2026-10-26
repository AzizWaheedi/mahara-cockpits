import { ExternalLink, Send } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as B from "./blueprintBrief";
import { hhmm } from "./blueprintData";
import {
  type BpKey,
  type BpPart,
  CURRENCIES,
  type Currency,
  FIELDS,
  has,
  labelOf,
  PART_KEYS,
  QUESTIONS,
  type Question,
  required,
  sameValue,
  shown,
} from "./blueprintForm";
import { Field, PrepText, Toggle } from "./controls";
import { openNamed } from "./PresentButton";
import type { BpModel, PartKey } from "./useBlueprint";

/**
 * The Brand Blueprint's fields in cockpit UI, for the notes window and the
 * prep view (never the canvas): one editor per answer type, the suggestion
 * beside it with its source, and the three parts' presses with their runs.
 */

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const lines = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
    : [];

/** An answer in plain words, for a suggestion's line ("Interior design"). */
export function said(k: string, v: unknown): string {
  if (k === "pack_url" && typeof v === "string") return "A Drive folder";
  if (k === "red_lines" || k === "rules") return B.say(k, v);
  if (k === "competitors") return B.say(k, v);
  if (typeof v === "string" && v.length > 140) return `${v.slice(0, 140)}…`;
  return B.say(k, v);
}

const dayOf = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** The suggestion beside a field: its words, its source and date, and "Use it". */
function Suggestion({ bp, k }: { bp: BpModel; k: BpKey }) {
  const p = bp.prefill.values[k];
  const [all, setAll] = useState(false);
  if (!p) return null;
  const now = bp.answers[k];
  if (has(bp.answers, k) && sameValue(now, p.value))
    return (
      <div className="text-xs text-muted-foreground">
        {p.kind === "D" ? "Default" : "From"}:{" "}
        {p.source.replace(/^The /, "the ")}
        {p.date ? `, ${dayOf(p.date)}` : ""}.
      </div>
    );
  const text = all && p.full ? p.full : said(k, p.value);
  return (
    <div className="rounded-md border border-dashed px-2 py-1.5 text-xs">
      <div className="text-muted-foreground">
        {p.kind === "D"
          ? "Default"
          : p.kind === "S"
            ? "Their words"
            : "Suggested"}{" "}
        · {p.source}
        {p.date ? `, ${dayOf(p.date)}` : ""}
      </div>
      <div className="mt-0.5 whitespace-pre-wrap" dir="auto">
        {text}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {!bp.readOnly ? (
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() =>
              bp.accept(k, all && p.full ? { ...p, value: p.full } : p)
            }
          >
            Use it
          </button>
        ) : null}
        {p.full ? (
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setAll(a => !a)}
          >
            {all ? "Show less" : "Show all"}
          </button>
        ) : null}
      </div>
      {p.note ? <div className="mt-1 txt-warn">{p.note}</div> : null}
    </div>
  );
}

/** One answer's editor, by its type. */
export function FieldEditor({ bp, k }: { bp: BpModel; k: BpKey }) {
  const def = FIELDS[k] as { type: string; choices?: readonly string[] };
  const v = bp.answers[k];
  const off = bp.readOnly;
  const set = (value: unknown, now = false) => bp.set(k, value, { now });
  const label = labelOf(k);
  switch (def.type) {
    case "choice":
      return (
        <div
          className={cn(
            "flex flex-wrap gap-1.5",
            off && "pointer-events-none opacity-60",
          )}
        >
          {(def.choices ?? []).map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={v === c}
              disabled={off}
              onClick={() => set(v === c ? null : c, true)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-medium",
                v === c
                  ? "border-primary bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {B.say(k, c)}
            </button>
          ))}
        </div>
      );
    case "ticks":
      return (
        <Toggle checked={v === true} onChange={c => !off && set(c, true)}>
          {label}
        </Toggle>
      );
    case "text":
    case "url":
      return (
        <PrepText
          label={label}
          value={typeof v === "string" ? v : ""}
          onChange={x => !off && set(x)}
        />
      );
    case "long":
      return (
        <PrepText
          label={label}
          rows={3}
          value={typeof v === "string" ? v : ""}
          onChange={x => !off && set(x)}
        />
      );
    case "date":
      return (
        <input
          type="date"
          aria-label={label}
          disabled={off}
          className="rounded-lg border bg-background px-2 py-1 text-sm"
          value={typeof v === "string" ? v : ""}
          onChange={e => set(e.target.value || null, true)}
        />
      );
    case "usd": {
      const u = v as { usd?: number; said?: string } | undefined;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            aria-label="Dollars a day"
            disabled={off}
            className="w-24 rounded-lg border bg-background px-2 py-1 text-sm"
            value={u?.usd ?? ""}
            onChange={e => {
              const n = Number(e.target.value);
              set(
                n >= 1
                  ? { usd: n, ...(u?.said ? { said: u.said } : {}) }
                  : null,
                true,
              );
            }}
          />
          <span className="text-xs text-muted-foreground">USD a day</span>
        </div>
      );
    }
    case "money": {
      const m = v as { amount?: number; currency?: Currency } | undefined;
      const cur = m?.currency ?? "USD";
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            aria-label={`${label}, amount`}
            disabled={off}
            className="w-32 rounded-lg border bg-background px-2 py-1 text-sm"
            value={m?.amount ?? ""}
            onChange={e => {
              const n = Number(e.target.value);
              set(n >= 1 ? { amount: n, currency: cur } : null, true);
            }}
          />
          <select
            aria-label={`${label}, currency`}
            disabled={off}
            className="rounded-lg border bg-background px-2 py-1 text-sm"
            value={cur}
            onChange={e =>
              m?.amount
                ? set({ amount: m.amount, currency: e.target.value }, true)
                : undefined
            }
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "lines":
      return (
        <PrepText
          label={`${label}, one per line`}
          rows={3}
          value={lines(v).join("\n")}
          onChange={x =>
            !off &&
            set(
              x
                .split("\n")
                .map(s => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case "rules": {
      const r = (v ?? {}) as Record<string, unknown>;
      const put = (key: string, x: string) => {
        const next = {
          ...r,
          [key]: x
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean),
        };
        set(next);
      };
      return (
        <div className="space-y-1.5">
          {(
            [
              ["always", "In their ads"],
              ["never", "Never in their ads"],
              ["neverShow", "Never shown (projects, names)"],
            ] as const
          ).map(([key, l]) => (
            <Field key={key} label={l}>
              <PrepText
                label={l}
                rows={2}
                value={lines(r[key]).join("\n")}
                onChange={x => !off && put(key, x)}
              />
            </Field>
          ))}
        </div>
      );
    }
    case "names": {
      const list = Array.isArray(v)
        ? (v as { name: string; lose?: boolean }[])
        : [];
      return (
        <PrepText
          label={`${label}, one per line; end with * for one they lose to`}
          rows={3}
          value={list.map(n => `${n.name}${n.lose ? " *" : ""}`).join("\n")}
          onChange={x =>
            !off &&
            set(
              x
                .split("\n")
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => ({
                  name: s.replace(/\s*\*$/, ""),
                  lose: /\*$/.test(s),
                })),
            )
          }
        />
      );
    }
    case "offer": {
      const o = (v ?? {}) as Record<string, string | undefined>;
      const put = (key: string, x: string) => set({ ...o, [key]: x });
      return (
        <div className="space-y-1.5">
          <PrepText
            label="Its name"
            placeholder="Its name"
            value={o.name ?? ""}
            onChange={x => !off && put("name", x)}
          />
          <PrepText
            label="What they get"
            placeholder="What they get"
            value={o.what ?? ""}
            onChange={x => !off && put("what", x)}
          />
          <PrepText
            label="The free first step, and who gives it"
            placeholder="The free first step, and who gives it"
            value={o.firstStep ?? ""}
            onChange={x => !off && put("firstStep", x)}
          />
        </div>
      );
    }
  }
  return null;
}

/** A question with its editor, its suggestion and its condition's note. */
export function QuestionField({ bp, q }: { bp: BpModel; q: Question }) {
  if (!q.key || !shown(q, bp.answers)) return null;
  const req = required(q, bp.answers);
  const missingNow = req && !has(bp.answers, q.key);
  const sub = q.sub;
  const subShown =
    sub === "capacity_note"
      ? bp.answers.capacity === "tight" || bp.answers.capacity === "no"
      : sub === "pack_changes"
        ? bp.answers.pack_approval === "wants_changes"
        : sub === "dna_missing"
          ? bp.answers.dna_status === "small_gaps" ||
            bp.answers.dna_status === "big_gaps"
          : sub === "scripts_date"
            ? Boolean(bp.answers.scripts_status)
            : false;
  return (
    <div className="space-y-1.5" id={`bp-${q.key}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium">
          <span className="me-1 font-mono text-muted-foreground">{q.n}</span>
          {q.label}
        </div>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            missingNow ? "txt-warn" : "text-muted-foreground",
          )}
        >
          {missingNow ? "Needed" : req ? "" : "If they have it"}
        </span>
      </div>
      <FieldEditor bp={bp} k={q.key} />
      <Suggestion bp={bp} k={q.key} />
      {sub && subShown ? (
        <Field label={labelOf(sub)}>
          <FieldEditor bp={bp} k={sub} />
        </Field>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the parts

const PRESS: Record<BpPart, string> = {
  1: "Send to media",
  2: "Close the call",
  3: "Lock the offer",
};

/** A part's one state, in the CD's words (SPEC 4.1). */
export function partState(
  bp: BpModel,
  part: BpPart,
  timeZone: string,
): { text: string; tone: "muted" | "good" | "warn" | "bad"; link?: string } {
  const k = String(part) as PartKey;
  const run = bp.runs[k];
  const stamp = bp.parts[k];
  const at = (iso: string | null | undefined) =>
    iso ? hhmm(iso, timeZone) : "";
  if (run?.phase === "running" || (run?.phase === "queued" && run.live))
    return {
      text: `Sent ${at(stamp?.lastAt ?? run.at)} · ${part === 1 ? "Making the launch task…" : "Running…"}`,
      tone: "muted",
    };
  // A press saved on the record whose run never finished: the same ID runs again.
  if (run?.phase === "queued" && run.requestId)
    return { text: "Saved, not confirmed. Run it again.", tone: "warn" };
  if (run?.phase === "rehearsed")
    return {
      text: "Rehearsed: the plan is below. Nothing was sent.",
      tone: "good",
    };
  if (run?.phase === "reconcile")
    return {
      text: `Needs a look: ${run.error ?? "the run did not finish"}`,
      tone: "bad",
    };
  if (run?.phase === "failed" && !stamp)
    return { text: run.error ?? "Not sent.", tone: "bad" };
  if (run?.phase === "failed" && stamp && run.requestId)
    return {
      text: `Needs a look: ${run.error ?? "the run did not finish"}`,
      tone: "bad",
    };
  if (stamp && bp.changed(part))
    return { text: "Changed since sent", tone: "warn" };
  if (stamp) {
    const task = part === 1 ? (bp.launchTaskId ?? null) : null;
    return {
      text: `${run?.duplicate ? "Already sent" : "Sent"} ${at(stamp.lastAt)}${run?.duplicate ? ". Nothing has changed since." : ""}${task ? " · Launch task ready" : ""}`,
      tone: "good",
      ...(task ? { link: B.cardUrl(task) } : {}),
    };
  }
  const keys = PART_KEYS[part].filter(x => x !== "shot_list_due");
  const asked = QUESTIONS.filter(
    q => q.part === part && q.key && required(q, bp.answers),
  );
  const left = bp.missing(part).length;
  const done = asked.length - left;
  if (left === 0) return { text: "Ready to send", tone: "good" };
  if (keys.some(x => has(bp.answers, x)))
    return { text: `In progress · ${done} of ${asked.length}`, tone: "muted" };
  return { text: "Not started", tone: "muted" };
}

const TONE = {
  muted: "text-muted-foreground",
  good: "txt-good",
  warn: "txt-warn",
  bad: "txt-bad",
};

/** The three parts, each with its state and, where it is pressed, its button. */
export function PartsBar({
  bp,
  timeZone,
  press = [],
}: {
  bp: BpModel;
  timeZone: string;
  /** The parts this place may press (the notes on slide 5 and 14, prep's form). */
  press?: BpPart[];
}) {
  return (
    <ol className="space-y-2">
      {([1, 2, 3] as const).map(n => {
        const s = partState(bp, n, timeZone);
        return (
          <li key={n} className="rounded-lg border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold">
                  {n} · {["Starter ads", "Brand and money", "The offer"][n - 1]}
                </div>
                <div className={cn("text-xs", TONE[s.tone])} role="status">
                  {s.text}
                  {s.link ? (
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noreferrer"
                      className="ms-1 inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
                    >
                      Open it <ExternalLink aria-hidden className="size-3" />
                    </a>
                  ) : null}
                </div>
              </div>
              {press.includes(n) ? <PressButton bp={bp} part={n} /> : null}
            </div>
            <RunLines bp={bp} part={n} />
          </li>
        );
      })}
    </ol>
  );
}

/** A part's press: disabled, with the reason, until it may go. */
export function PressButton({ bp, part }: { bp: BpModel; part: BpPart }) {
  const [busy, setBusy] = useState(false);
  if (bp.readOnly)
    return (
      <span className="text-[11px] text-muted-foreground">
        Only the creative director sends the parts.
      </span>
    );
  const k = String(part) as PartKey;
  const order =
    part === 2 && !bp.parts["1"]
      ? "Send part 1 to media first."
      : part === 3 && !bp.parts["2"]
        ? "Close the call first."
        : null;
  const label =
    bp.parts[k] && bp.changed(part) ? "Send the changes" : PRESS[part];
  const run = bp.runs[k];
  // Sent and unchanged: nothing to press until something changes.
  const settled =
    bp.parts[k] &&
    !bp.changed(part) &&
    (run?.phase === "done" ||
      run?.phase === "running" ||
      (run?.phase === "queued" && run.live) ||
      !run);
  if (settled && !busy) return null;
  const again = run?.phase === "queued" && run.requestId && !run.live && !busy;
  return (
    <Button
      size="sm"
      disabled={busy || Boolean(order)}
      title={order ?? undefined}
      data-guide={`part${part}`}
      onClick={() => {
        setBusy(true);
        void bp.press(part).finally(() => setBusy(false));
      }}
    >
      <Send aria-hidden />
      {busy ? "Sending…" : again ? "Run it again" : label}
    </Button>
  );
}

/** A rehearsal's plan, a refusal's missing answers, a run's note. */
function RunLines({ bp, part }: { bp: BpModel; part: BpPart }): ReactNode {
  const run = bp.runs[String(part) as PartKey];
  if (!run) return null;
  return (
    <>
      {run.missing?.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {run.missing.map(m => (
            <a
              key={m}
              href={`#bp-${m}`}
              className="rounded border px-1.5 py-0.5 txt-warn hover:underline"
            >
              {labelOf(m)}
            </a>
          ))}
        </div>
      ) : null}
      {run.lines?.length ? (
        <ul className="mt-1.5 list-disc space-y-0.5 ps-4 text-xs text-muted-foreground">
          {run.lines.map(l => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Opens one of the client's documents in its own window (to share, never framed). */
export function OpenDoc({
  url,
  name,
  children,
}: {
  url: string | null | undefined;
  name: string;
  children: ReactNode;
}) {
  if (!url) return null;
  return (
    <Button size="sm" variant="outline" onClick={() => openNamed(url, name)}>
      <ExternalLink aria-hidden />
      {children}
    </Button>
  );
}

/** The conflicts to settle: theirs is shown, yours kept under it. */
export function Conflicts({ bp }: { bp: BpModel }) {
  if (!bp.conflicts.length) return null;
  return (
    <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
      {bp.conflicts.map(c => (
        <div key={c.key} className="space-y-1">
          <div className="font-medium">
            {labelOf(c.key)}: changed in another window by {c.by ?? "someone"}
            {c.at
              ? ` at ${new Date(c.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
            .
          </div>
          <div dir="auto">Yours was: "{said(c.key, c.mine)}"</div>
          <div className="flex gap-3">
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => bp.keepMine(c.key)}
            >
              Use mine
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => bp.dismiss(c.key)}
            >
              Keep theirs
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

export { str as bpStr };
