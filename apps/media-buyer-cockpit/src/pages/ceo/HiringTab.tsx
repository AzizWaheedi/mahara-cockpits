import { useAction } from "convex/react";
import {
  ArrowRight,
  Bot,
  CircleDashed,
  ExternalLink,
  Inbox,
  Mail,
  MoveRight,
  Send,
  Star,
  StickyNote,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { Facts } from "@/components/ceo/Facts";
import { FeedList } from "@/components/ceo/FeedList";
import { FilterChips } from "@/components/ceo/FilterChips";
import { FunnelStrip } from "@/components/ceo/FunnelStrip";
import {
  count,
  decimal,
  humanize,
  isNum,
  pct,
  plural,
} from "@/components/ceo/format";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { ShowMore } from "@/components/ceo/ShowMore";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { useRefresh } from "@/components/ceo/useCeo";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { api } from "../../../convex/_generated/api";
import type {
  HiringCandidate,
  HiringPayload,
  HiringRoleFunnel,
} from "../../../convex/ceo/payloads";
import { STAGES, type StageKey } from "../../../convex/hiring/spec";
import type { CeoTabProps } from "./types";

/**
 * Recruiting: the five roles Mahara hires on repeat, and the one thing that
 * moves any of them, which is a score out of ten from Aziz.
 *
 * The tab is ordered by who is blocked. The grading queue is first because
 * nothing advances until a stage's score is given; then where candidates get
 * stuck, who is going cold, the bench, the message engine and what it has
 * done. Contact details stay in GoHighLevel: every name is a link to the card.
 */

/** The five scores a candidate can be given, in the order the process asks for them. */
const SCORE_KEYS = [
  "application",
  "loom",
  "group",
  "oneToOne",
  "testProject",
] as const;
type ScoreKey = (typeof SCORE_KEYS)[number];

const SCORE_LABEL: Record<ScoreKey, string> = {
  application: "Application",
  loom: "Loom",
  group: "Group interview",
  oneToOne: "One-to-one",
  testProject: "Test project",
};

const isScoreKey = (k: string | null): k is ScoreKey =>
  k !== null && (SCORE_KEYS as readonly string[]).includes(k);

/** The advancing stages, in order: the funnel is drawn over these and nothing else. */
const ADVANCING = new Set<string>(
  STAGES.filter(s => s.advancing).map(s => s.key),
);

/** What the engine sends when a switch is on, in the words of the step it belongs to. */
const ACTION_HINT: Record<string, string> = {
  loom_request: "Asks for the Loom once they reach Loom request.",
  group_invite: "Invites them to the group interview.",
  test_project: "Sends the test project before the one-to-one.",
  offer: "Sends the job offer.",
  rejection: "Tells a disqualified candidate it is a no.",
  bench_note: "Tells a benched candidate they are on the bench.",
};

/**
 * The two sales tracks. Everyone applies through the closer's form, so the one
 * open question on a sales candidate is which board they belong on. Every
 * other role has a single track and shows nothing here.
 */
const TRACK: Record<string, { role: string; copy: string } | undefined> = {
  "sales-closer": { role: "sales-setter", copy: "Start them as a setter" },
  "sales-setter": { role: "sales-closer", copy: "Move them up to closer" },
};

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const tabular = { fontVariantNumeric: "tabular-nums" } as const;
const field = "rounded-md border bg-background px-2 py-1 text-sm";

/** The server's own sentence, without the Convex framing around it. */
function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^\[.*?]\s*/, "")
      .trim() || "That did not go through."
  );
}

/** "9 days here", or n/a when the board never said when the card last moved. */
function daysHere(days: number | null) {
  return isNum(days) ? (
    <span style={tabular}>
      {days === 1 ? "1 day here" : `${count(days)} days here`}
    </span>
  ) : (
    <Na hint="The board does not say when this card last moved." />
  );
}

/** The name, linked to the GoHighLevel card when the board gave one. */
function CandidateName({ c }: { c: HiringCandidate }) {
  const cls = "min-w-0 truncate text-sm font-medium text-foreground";
  if (!c.ghlUrl) return <span className={cls}>{c.name}</span>;
  return (
    <a
      href={c.ghlUrl}
      target="_blank"
      rel="noreferrer"
      className={`${cls} inline-flex items-center gap-1 hover:underline`}
    >
      {c.name}
      <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
    </a>
  );
}

/** The scores already given, as a quiet line. Nothing shows for a candidate nobody has graded. */
function ScoresGiven({ c }: { c: HiringCandidate }) {
  const given = SCORE_KEYS.filter(k => isNum(c.scores[k]));
  if (!given.length)
    return <span className="text-xs text-muted-foreground">No score yet</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {given.map(k => (
        <span key={k}>
          {SCORE_LABEL[k]}{" "}
          <strong className="font-medium text-foreground" style={tabular}>
            {decimal(c.scores[k], 1)}
          </strong>
        </span>
      ))}
    </span>
  );
}

/**
 * The signature control: eleven notches filled up to the score, so the range
 * and the choice read at once and a grade is one tap wide enough for a thumb.
 * Each notch is a real radio, so the arrow keys walk the scale.
 */
function ScoreScale({
  name,
  label,
  value,
  disabled,
  onChange,
}: {
  /** Unique radio group name, so two rows never share a scale. */
  name: string;
  /** What is being scored, read out before the notches. */
  label: string;
  /** The score picked so far, or null before anything is picked. */
  value: number | null;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div
      className="grid grid-cols-11 gap-[3px]"
      role="group"
      aria-label={label}
    >
      {SCALE.map(n => {
        const filled = value !== null && n <= value;
        return (
          <label
            key={n}
            className={`relative flex h-8 cursor-pointer items-end rounded-[3px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${disabled ? "cursor-default opacity-50" : ""}`}
          >
            <input
              type="radio"
              name={name}
              checked={value === n}
              disabled={disabled}
              onChange={() => onChange(n)}
              aria-label={`${n} out of 10`}
              className="sr-only"
            />
            <span
              aria-hidden
              className="w-full rounded-[3px]"
              style={{
                height: `${40 + n * 6}%`,
                backgroundColor: filled
                  ? "var(--ceo-emphasis)"
                  : "var(--ceo-emphasis-track)",
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

/**
 * The other track, for a sales candidate. This is a judgement about where
 * someone starts, not a verdict on them, so it sits beside the grade as a
 * quiet line and never as a red button. The reason is worth writing down and
 * is never demanded: the board takes the move either way.
 */
function TrackSwitch({
  c,
  onMoved,
}: {
  c: HiringCandidate;
  /** The same refresh the grade uses, so the queue redraws around the move. */
  onMoved: () => Promise<void>;
}) {
  const reassign = useAction(api.hiring.actions.reassign);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const track = TRACK[c.role];
  if (!track) return null;

  const move = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = (await reassign({
        candidateId: c.id,
        role: track.role,
        reason: reason.trim() || undefined,
      })) as { role?: string; stage?: string };
      setMsg(
        `Moved to ${r?.role ?? "the other board"}${
          r?.stage ? `, still in ${r.stage}` : ""
        }.`,
      );
      setReason("");
      setOpen(false);
      await onMoved();
    } catch (e) {
      setError(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-2">
      {open ? (
        <div className="grid gap-2 @lg:grid-cols-[minmax(0,1fr)_auto] @lg:items-center">
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={busy}
            placeholder="Why this track, in one line (optional)"
            aria-label={`Why ${c.name} moves track`}
            className={`${field} min-w-0`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void move()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium text-foreground hover:bg-[var(--ceo-emphasis-wash)] disabled:opacity-50"
            >
              <MoveRight className="size-3.5 shrink-0" aria-hidden />
              {busy ? "Moving" : track.copy}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="inline-flex h-8 items-center rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 min-w-0 items-center gap-1.5 justify-self-start rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <MoveRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 truncate">{track.copy}</span>
        </button>
      )}
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      {error ? (
        <p className="text-xs text-[var(--ceo-critical)]">{error}</p>
      ) : null}
    </div>
  );
}

/** The agent's one-word read, in the cockpit's words and never in a tone. */
const VERDICT: Record<string, string> = {
  advance: "Advance",
  "look closer": "Look closer",
  drop: "Drop",
};

/**
 * What the recruiting agent proposed, beside the control Aziz grades with and
 * plainly under it: smaller, quieter, attributed, and with no way to take its
 * number. He types his own, and the gap between the two is what calibrates the
 * agent. The reasons are long, so they stay clamped to two lines until he asks
 * for them; the questions come with them, because they are what he reads out
 * on the call. Nothing at all renders for someone the agent has not read yet.
 */
function AgentProposal({ c }: { c: HiringCandidate }) {
  const [open, setOpen] = useState(false);
  if (!isNum(c.agentScore)) return null;

  const note = c.agentNote?.trim() ?? "";
  const asks = [
    ...new Set(c.agentAsks.map(a => a.trim()).filter(Boolean)),
  ].slice(0, 4);
  const raw = c.agentVerdict?.trim() ?? "";
  const verdict = raw ? (VERDICT[raw.toLowerCase()] ?? humanize(raw)) : "";
  let label = open ? "Hide the reasons" : "Read the reasons";
  if (!note) label = open ? "Hide the questions" : "Questions to ask";

  return (
    <div className="grid min-w-0 gap-1.5 self-start rounded-md border border-dashed px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Bot className="size-3 shrink-0" aria-hidden />
          Recruiting agent
        </span>
        <span className="text-xs text-muted-foreground" style={tabular}>
          <strong className="font-medium text-foreground">
            {decimal(c.agentScore, 1)}
          </strong>
          {` / 10${verdict ? ` \u00b7 ${verdict}` : ""}`}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A proposal from the application. Your score is the one that counts.
      </p>
      {note ? (
        <p
          className={`break-words text-xs leading-relaxed text-muted-foreground ${open ? "" : "line-clamp-2"}`}
        >
          {note}
        </p>
      ) : null}
      {note || asks.length ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="justify-self-start rounded-sm text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      ) : null}
      {open && asks.length ? (
        <div className="grid min-w-0 gap-1">
          <p className="text-[11px] font-medium text-foreground/80">
            Questions to ask on the call
          </p>
          <ul className="grid min-w-0 gap-1">
            {asks.map(a => (
              <li
                key={a}
                className="flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
              >
                <CircleDashed
                  className="mt-[3px] size-3 shrink-0"
                  aria-hidden
                />
                <span className="min-w-0 break-words">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One person waiting on a score: who they are, where they are, what they were
 * given already, and the one score the stage is holding out for. The note and
 * the move are optional, because a score is not always a decision.
 */
function GradeRow({
  c,
  onGraded,
}: {
  c: HiringCandidate;
  onGraded: () => Promise<void>;
}) {
  const grade = useAction(api.hiring.actions.grade);
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [moveTo, setMoveTo] = useState<"" | StageKey>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const due = isScoreKey(c.scoreDue) ? c.scoreDue : null;

  const save = async () => {
    if (score === null || due === null) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = (await grade({
        candidateId: c.id,
        stage: due,
        score,
        note: note.trim() || undefined,
        moveTo: moveTo || undefined,
      })) as { total?: number | null; moved?: string | null };
      setMsg(
        `Saved ${score} out of 10.${
          r?.moved ? ` Moved to ${r.moved}.` : ""
        }${isNum(r?.total) ? ` Their total is now ${decimal(r.total, 1)}.` : ""}`,
      );
      setNote("");
      setMoveTo("");
      await onGraded();
    } catch (e) {
      setError(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2.5 border-b border-[color:var(--ceo-grid)] py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <CandidateName c={c} />
        <span className="text-xs text-muted-foreground">{c.roleLabel}</span>
        <StatusChip
          tone={c.stale ? "warning" : "neutral"}
          label={c.stageName}
          hint={
            c.stale
              ? "No move for longer than the engine's stale line."
              : undefined
          }
        />
        <span className="text-xs text-muted-foreground">
          {daysHere(c.daysInStage)}
        </span>
      </div>
      <ScoresGiven c={c} />
      {due === null ? (
        <p className="text-xs text-muted-foreground">
          Nothing is due here. This stage asks for no score.
        </p>
      ) : (
        <>
          {/* The scale stays a hand's width on any screen: eleven notches
              across a whole desk read as blocks, not as a score. The agent's
              proposal sits beside it where there is room and under it on a
              phone, so his own control is never pushed off the screen. */}
          <div className="grid min-w-0 items-start gap-x-6 gap-y-3 @2xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
            <div className="grid min-w-0 max-w-sm gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[13px] text-foreground">
                  {SCORE_LABEL[due]} score
                </span>
                <span className="text-sm text-muted-foreground" style={tabular}>
                  {score === null ? (
                    "not picked"
                  ) : (
                    <>
                      <strong className="text-base font-semibold text-foreground">
                        {score}
                      </strong>
                      <span className="text-xs"> / 10</span>
                    </>
                  )}
                </span>
              </div>
              <ScoreScale
                name={`score-${c.id}`}
                label={`${SCORE_LABEL[due]} score for ${c.name}, out of ten`}
                value={score}
                disabled={busy}
                onChange={setScore}
              />
            </div>
            <AgentProposal c={c} />
          </div>
          <div className="grid gap-2 @lg:grid-cols-[minmax(0,1fr)_11rem_auto] @lg:items-center">
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={busy}
              placeholder="Why, in one line (optional)"
              aria-label={`Note on ${c.name}`}
              className={`${field} min-w-0`}
            />
            <AnimatedSelect
              value={moveTo}
              onChange={e => setMoveTo(e.target.value as "" | StageKey)}
              disabled={busy}
              aria-label={`Move ${c.name} after grading`}
              className={`${field} min-w-0`}
            >
              <option value="">Leave them here</option>
              {STAGES.map(s => (
                <option key={s.key} value={s.key}>
                  {`and move to ${s.name}`}
                </option>
              ))}
            </AnimatedSelect>
            <button
              type="button"
              disabled={busy || score === null}
              onClick={() => void save()}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50"
            >
              {busy ? "Saving" : "Save the score"}
              {busy ? null : <ArrowRight className="size-3.5" aria-hidden />}
            </button>
          </div>
        </>
      )}
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      {error ? (
        <p className="text-xs text-[var(--ceo-critical)]">{error}</p>
      ) : null}
      <TrackSwitch c={c} onMoved={onGraded} />
    </div>
  );
}

/** One role's funnel: the advancing stages on one scale, where they sit, and the terms of the job. */
function RolePanel({ r }: { r: HiringRoleFunnel }) {
  const steps = r.stages.filter(s => ADVANCING.has(s.key));
  const exits = r.stages.filter(s => !ADVANCING.has(s.key) && s.count > 0);
  const sitting = steps.filter(s => isNum(s.medianDays) && s.count > 0);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-foreground">{r.label}</h3>
        {r.running ? null : (
          <StatusChip
            tone="neutral"
            label="Not hiring now"
            hint="Nobody is in an advancing stage for this role. The funnel below is what happened, not a problem."
          />
        )}
        <a
          href={r.careersUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Careers page
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      <FunnelStrip
        steps={steps.map(s => ({ label: s.name, value: s.count }))}
        rateNoun="carry on"
        ariaLabel={`${r.label} funnel, application to hired`}
      />

      {sitting.length ? (
        <p className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground/80">How long they sit</span>
          {sitting.map(s => (
            <span key={s.key} style={tabular}>
              {s.name}{" "}
              <strong className="font-medium text-foreground">
                {`${decimal(s.medianDays, 1)} d`}
              </strong>
            </span>
          ))}
        </p>
      ) : null}

      <Facts
        items={[
          { label: "Open", value: count(r.open) },
          { label: "Hired", value: count(r.hired) },
          { label: "Applied", value: count(r.applied) },
          {
            label: "Applied to hired",
            value: r.conversion === null ? null : pct(r.conversion),
            hint: "Hired over everyone who applied for this role.",
          },
          {
            label: "Application to offer",
            value:
              r.timeToOfferDays === null
                ? null
                : `${decimal(r.timeToOfferDays, 1)} d`,
            hint: "Median days from applying to the offer going out.",
          },
          ...(exits.length
            ? [
                {
                  label: "Left the funnel",
                  value: exits
                    .map(s => `${s.name} ${count(s.count)}`)
                    .join(", "),
                },
              ]
            : []),
        ]}
      />

      <dl className="grid gap-x-6 gap-y-2 text-xs @2xl:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Pay</dt>
        <dd className="text-foreground">{r.compensation}</dd>
        {r.scorecard.length ? (
          <>
            <dt className="text-muted-foreground">Judged on once hired</dt>
            <dd className="text-foreground">{r.scorecard.join(" · ")}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** Stale and bench rows share a shape: who, where, how long, and one line of context. */
function PersonRow({
  c,
  context,
}: {
  c: HiringCandidate;
  /** The one thing this list is about: the bench reason, or nothing. */
  context?: string | null;
}) {
  return (
    <div className="grid gap-1 border-b border-[color:var(--ceo-grid)] py-2.5 first:pt-0 last:border-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <CandidateName c={c} />
        <span className="text-xs text-muted-foreground">{c.roleLabel}</span>
        <StatusChip tone="neutral" label={c.stageName} />
        <span className="text-xs text-muted-foreground">
          {daysHere(c.daysInStage)}
        </span>
        {isNum(c.scores.total) ? (
          <span className="text-xs text-muted-foreground" style={tabular}>
            total{" "}
            <strong className="font-medium text-foreground">
              {decimal(c.scores.total, 1)}
            </strong>
          </span>
        ) : null}
      </div>
      {context ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {context}
        </p>
      ) : null}
    </div>
  );
}

/** One switch, the same shape as the team roster's, so a toggle means the same thing everywhere. */
function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[var(--ceo-emphasis)]" : "bg-muted-foreground/40"} disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-background transition-[left] ${on ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

type DraftRow = {
  id: number;
  name: string;
  stage: string;
  action: string;
  text: string;
};

/**
 * The engine, and the fact that it is holding its tongue. Disarmed is a
 * setting, not a fault: it is stated in plain words, drawn in the neutral
 * token, and every message it wrote is one click away.
 */
function EngineCard({
  engine,
  onChanged,
}: {
  engine: HiringPayload["engine"];
  onChanged: () => Promise<void>;
}) {
  // GoHighLevel owns sending, so arming the cockpit is not the live question
  // and there are no drafts to read: it writes none while it is standing down.
  const byGoHighLevel = engine.channel.startsWith("GoHighLevel");
  const setEngine = useAction(api.hiring.actions.setEngine);
  const loadDrafts = useAction(api.hiring.actions.drafts);
  const sendDraft = useAction(api.hiring.actions.sendDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [sent, setSent] = useState<Record<number, string>>({});

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(serverMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            {engine.armed ? (
              <Send
                className="size-4 shrink-0 text-[color:var(--ceo-emphasis)]"
                aria-hidden
              />
            ) : (
              <StickyNote
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            {engine.armed
              ? "Armed and sending"
              : byGoHighLevel
                ? "GoHighLevel is the sender"
                : "Disarmed on purpose"}
          </p>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {engine.armed
              ? `Every switch below that is on will send over ${engine.channel} without asking you.`
              : byGoHighLevel
                ? "The published workflows on the hiring sub-account send every candidate message, on email and on SMS. The cockpit stays quiet so nobody hears anything twice. The words still come from the custom values, so edit them there."
                : "Every message is written down and nothing is sent. Read the drafts below, send the ones you like, and arm it when the words are right."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {engine.armed
              ? "sending"
              : byGoHighLevel
                ? "GoHighLevel"
                : "writing only"}
          </span>
          <Toggle
            on={engine.armed}
            label={
              engine.armed
                ? "The engine is armed and sending"
                : "The engine is disarmed and only writing"
            }
            disabled={busy !== null}
            onChange={armed =>
              void run("armed", async () => {
                await setEngine({ armed });
                await onChanged();
              })
            }
          />
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-[13px] text-foreground">
          What it is allowed to send
        </p>
        {engine.actions.length ? (
          <div className="grid gap-x-6 gap-y-2 @2xl:grid-cols-2">
            {engine.actions.map(a => (
              <div
                key={a.action}
                className="flex min-w-0 items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] text-foreground">
                    {humanize(a.action)}
                  </p>
                  {ACTION_HINT[a.action] ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {ACTION_HINT[a.action]}
                    </p>
                  ) : null}
                </div>
                <Toggle
                  on={a.on}
                  label={`${humanize(a.action)} is ${a.on ? "on" : "off"}`}
                  disabled={busy !== null}
                  onChange={on =>
                    void run(a.action, async () => {
                      await setEngine({ action: a.action, on });
                      await onChanged();
                    })
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Mail}
            title="No steps are set up yet"
            text="Run the hiring setup so the engine knows which message belongs to which stage."
            compact
          />
        )}
      </div>

      {engine.blockers.length ? (
        <div className="grid gap-1.5">
          <p className="text-[13px] text-foreground">
            What has to be true before it sends
          </p>
          <ul className="grid gap-1.5">
            {engine.blockers.map(b => (
              <li
                key={b}
                className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <CircleDashed
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden
                />
                <span className="min-w-0">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Facts
        items={[
          { label: "Channel", value: engine.channel },
          {
            label: "Called stale after",
            value: `${count(engine.staleDays)} days`,
          },
          { label: "Written, not sent", value: count(engine.drafted) },
        ]}
      />

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("drafts", async () => {
                setDrafts(((await loadDrafts({})) ?? []) as DraftRow[]);
              })
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium text-foreground hover:bg-[var(--ceo-emphasis-wash)] disabled:opacity-50"
          >
            <Mail
              className="size-3.5 text-[color:var(--ceo-emphasis)]"
              aria-hidden
            />
            {busy === "drafts" ? "Opening" : "Read the drafts"}
          </button>
          {drafts !== null ? (
            <button
              type="button"
              onClick={() => setDrafts(null)}
              className="rounded-sm text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          ) : null}
        </div>

        {drafts === null ? null : drafts.length ? (
          <ul className="grid gap-2">
            {drafts.map(d => (
              <li key={d.id} className="grid gap-2 rounded-lg border p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-foreground">
                    {d.name}
                  </span>
                  {d.stage ? (
                    <StatusChip tone="neutral" label={d.stage} />
                  ) : null}
                  {d.action ? (
                    <span className="text-xs text-muted-foreground">
                      {humanize(d.action)}
                    </span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {d.text}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy !== null || sent[d.id] !== undefined}
                    onClick={() =>
                      void run(`send-${d.id}`, async () => {
                        await sendDraft({ eventId: d.id });
                        setSent(s => ({ ...s, [d.id]: "Sent." }));
                        await onChanged();
                      })
                    }
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-foreground hover:bg-[var(--ceo-emphasis-wash)] disabled:opacity-50"
                  >
                    <Send className="size-3.5" aria-hidden />
                    {busy === `send-${d.id}` ? "Sending" : "Send this one"}
                  </button>
                  {sent[d.id] ? (
                    <span className="text-xs text-muted-foreground">
                      {sent[d.id]}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Inbox}
            title="Nothing is written yet"
            text="The engine writes a message when a candidate reaches a step whose switch is on. Pull the board to let it catch up."
            compact
          />
        )}
      </div>

      {error ? (
        <p className="text-xs text-[var(--ceo-critical)]">{error}</p>
      ) : null}
    </div>
  );
}

/** The kind icons for this tab's own events: a score, a move, a note, a message. */
function hiringKindIcon(kind: string) {
  if (/score/i.test(kind)) return Star;
  if (/stage/i.test(kind)) return MoveRight;
  if (/action|message/i.test(kind)) return Send;
  return StickyNote;
}

export function HiringTab({ sections, now }: CeoTabProps) {
  const section = sections.hiring;
  const payload = section?.payload ?? null;
  const pull = useAction(api.hiring.actions.refreshNow);
  const { refresh } = useRefresh();
  const [role, setRole] = useState<string>("");
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [allQueue, setAllQueue] = useState(false);
  const [allStale, setAllStale] = useState(false);
  const [allBench, setAllBench] = useState(false);

  const recompute = useCallback(async () => {
    await refresh(["hiring"]);
  }, [refresh]);

  const pullBoard = async () => {
    setPulling(true);
    setPullError(null);
    setPullMsg(null);
    try {
      const r = (await pull({})) as {
        sync?: { added?: number; moved?: number };
        engine?: { drafted?: number; sent?: number };
      };
      const bits = [
        isNum(r?.sync?.added)
          ? `${plural(r.sync.added, "new application")}`
          : null,
        isNum(r?.sync?.moved) ? `${plural(r.sync.moved, "card")} moved` : null,
        isNum(r?.engine?.drafted)
          ? `${plural(r.engine.drafted, "message")} written`
          : null,
        isNum(r?.engine?.sent) && r.engine.sent > 0
          ? `${count(r.engine.sent)} sent`
          : null,
      ].filter(Boolean);
      setPullMsg(
        bits.length
          ? `Pulled the board: ${bits.join(", ")}.`
          : "Pulled the board.",
      );
    } catch (e) {
      setPullError(serverMessage(e));
    } finally {
      setPulling(false);
    }
  };

  const pullButton = (
    <button
      type="button"
      disabled={pulling}
      onClick={() => void pullBoard()}
      className="inline-flex h-8 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium text-foreground hover:bg-[var(--ceo-emphasis-wash)] disabled:opacity-50"
    >
      <UserPlus
        className="size-3.5 text-[color:var(--ceo-emphasis)]"
        aria-hidden
      />
      {pulling ? "Pulling" : "Pull the board"}
    </button>
  );

  // Nothing computed, or nothing connected: one card says so, the way the
  // Delivery tab does, instead of six identical empty states.
  if (!payload)
    return (
      <div className="grid min-w-0">
        <SectionCard
          title="Recruiting"
          section={section}
          actions={pullButton}
          order={0}
        >
          {() => null}
        </SectionCard>
      </div>
    );

  if (!payload.connected)
    return (
      <div className="grid min-w-0">
        <SectionCard
          kicker="Five roles, one board"
          title="Recruiting"
          section={section}
          notes={payload.notes}
          actions={pullButton}
          order={0}
        >
          {() => (
            <div className="grid gap-3">
              <EmptyState
                icon={UserPlus}
                title="The hiring board is not connected"
                text="Set GHL_HIRING_PIT and GHL_HIRING_LOCATION on the deployment, run the hiring setup, then pull the board. Until then this tab has nothing true to show."
                action={pullButton}
              />
              {pullMsg ? (
                <p className="text-center text-xs text-muted-foreground">
                  {pullMsg}
                </p>
              ) : null}
              {pullError ? (
                <p className="text-center text-xs text-[var(--ceo-critical)]">
                  {pullError}
                </p>
              ) : null}
            </div>
          )}
        </SectionCard>
      </div>
    );

  const roles = payload.roles;
  const chosen = roles.find(r => r.role === role) ?? roles[0] ?? null;
  const queue = allQueue
    ? payload.needsGrading
    : payload.needsGrading.slice(0, 6);
  const stale = allStale ? payload.stale : payload.stale.slice(0, 6);
  const bench = allBench ? payload.bench : payload.bench.slice(0, 6);

  return (
    <div className="@container grid min-w-0 gap-4 lg:gap-6">
      <SectionCard
        kicker="Nothing advances until a stage's score is given"
        title="Waiting on you"
        section={section}
        notes={payload.notes}
        actions={pullButton}
        order={0}
      >
        {d => (
          <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 @lg:grid-cols-4">
              <StatTile
                variant="plain"
                label="Waiting on you"
                value={count(d.totals.ungraded)}
                sub="a score their stage is holding out for"
              />
              <StatTile
                variant="plain"
                label="In the funnel"
                value={count(d.totals.inFunnel)}
                hint="Everyone in an advancing stage, so not hired, benched, disqualified, fired or churned."
              />
              <StatTile
                variant="plain"
                label="Applied in 30 days"
                value={count(d.totals.applied30)}
              />
              <StatTile
                variant="plain"
                label="Roles being hired for"
                value={count(d.totals.rolesRunning)}
                sub={`of ${count(d.roles.length)}`}
              />
            </div>

            <Facts
              items={[
                {
                  label: "Sitting in Hired",
                  value: count(d.totals.hired90),
                  hint: "Everyone on the board in the Hired stage, all time, not a 90 day window.",
                },
                {
                  label: "On the bench",
                  value: count(d.bench.length),
                },
                {
                  label: "Board",
                  value: d.boardUrl ? (
                    <a
                      href={d.boardUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      open in GoHighLevel
                    </a>
                  ) : null,
                },
              ]}
            />

            {pullMsg ? (
              <p className="text-xs text-muted-foreground">{pullMsg}</p>
            ) : null}
            {pullError ? (
              <p className="text-xs text-[var(--ceo-critical)]">{pullError}</p>
            ) : null}

            {queue.length ? (
              <div className="grid min-w-0">
                {queue.map(c => (
                  <GradeRow key={c.id} c={c} onGraded={recompute} />
                ))}
                {payload.needsGrading.length > 6 ? (
                  <ShowMore
                    total={payload.needsGrading.length}
                    expanded={allQueue}
                    onToggle={() => setAllQueue(v => !v)}
                  />
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={Star}
                title="Nobody is waiting on a score"
                text="Every candidate in an advancing stage has the score their stage asks for. Pull the board to bring in new applications."
                compact
              />
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        kicker="One role at a time"
        title="Where candidates get stuck"
        section={section}
        order={1}
      >
        {() =>
          roles.length && chosen ? (
            <div className="grid min-w-0 gap-5">
              <FilterChips
                options={roles.map(r => ({
                  key: r.role,
                  label: r.label,
                  count: r.open,
                  hint: r.running
                    ? `${plural(r.open, "person", "people")} in an advancing stage.`
                    : "Not being hired for right now.",
                }))}
                value={chosen.role}
                onChange={setRole}
                ariaLabel="Show one role's funnel"
              />
              <RolePanel r={chosen} />
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="No roles on the board yet"
              text="Run the hiring setup to build the five pipelines, then pull the board."
              compact
            />
          )
        }
      </SectionCard>

      <div className="grid min-w-0 items-start gap-4 lg:gap-6 @4xl:grid-cols-2">
        <SectionCard
          kicker={`No move in more than ${count(payload.engine.staleDays)} days`}
          title="Going cold"
          section={section}
          order={2}
        >
          {() =>
            stale.length ? (
              <div className="grid min-w-0">
                {stale.map(c => (
                  <PersonRow key={c.id} c={c} />
                ))}
                {payload.stale.length > 6 ? (
                  <ShowMore
                    total={payload.stale.length}
                    expanded={allStale}
                    onToggle={() => setAllStale(v => !v)}
                  />
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={Timer}
                title="Nobody has been left sitting"
                text="Every card has moved inside the stale line. Grade the queue above to keep it that way."
                compact
              />
            )
          }
        </SectionCard>

        <SectionCard
          kicker="Good, but not now. Best total first"
          title="The bench"
          section={section}
          order={3}
        >
          {() =>
            bench.length ? (
              <div className="grid min-w-0">
                {bench.map(c => (
                  <PersonRow
                    key={c.id}
                    c={c}
                    context={
                      c.benchReason ??
                      "No reason was written down. Add one on the card so it is clear what brings them back."
                    }
                  />
                ))}
                {payload.bench.length > 6 ? (
                  <ShowMore
                    total={payload.bench.length}
                    expanded={allBench}
                    onToggle={() => setAllBench(v => !v)}
                  />
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={Users}
                title="The bench is empty"
                text="Move a strong candidate to Bench with the reason, and they are the first call when a seat opens."
                compact
              />
            )
          }
        </SectionCard>
      </div>

      <SectionCard
        kicker="What it writes, and whether it sends"
        title="The message engine"
        section={section}
        order={4}
      >
        {d => <EngineCard engine={d.engine} onChanged={recompute} />}
      </SectionCard>

      <SectionCard
        kicker="Newest first"
        title="What has happened"
        section={section}
        order={5}
      >
        {d => (
          <FeedList
            items={d.recent.map(e => ({
              at: e.at,
              actor: e.name,
              role: e.role ? humanize(e.role) : null,
              kind: e.kind,
              subject: e.ok ? "" : "written, not sent",
              text: e.text,
            }))}
            now={now}
            kindIcon={hiringKindIcon}
            emptyText="Nothing has happened on the board yet."
          />
        )}
      </SectionCard>
    </div>
  );
}
