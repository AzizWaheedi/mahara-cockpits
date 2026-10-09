import { Check, Copy, Link2, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { date, dateTime, relative } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, StatusDot } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";

/**
 * What the person told us when they joined.
 *
 * Aziz, 2026-10-09: walk every new team member through their role scorecard,
 * learn their financial and non-financial goals, and keep it on their file
 * ("it pulls in"). The onboarding Typeform posts each submission to the
 * team-onboarding-intake function; this panel reads it back through
 * cockpit_ceo_onboarding, the CEO's address and nothing else.
 *
 * The one thing to see first is the standards check as twelve notches: teal
 * for a right answer, orange for a miss, each named for its topic. A miss is
 * where the first one-to-one starts.
 */

export const ONBOARDING_FORM_URL =
  "https://maharamedia.typeform.com/to/Cef2QGBh";

/** The standards check in the form's order. Mirrors QUIZ_TOPICS in
 * supabase/functions/team-onboarding-intake/parse.ts. */
const QUIZ: { ref: string; topic: string }[] = [
  { ref: "q_hours", topic: "Core hours" },
  { ref: "q_reply", topic: "Reply time" },
  { ref: "q_status", topic: "Slack status" },
  { ref: "q_late", topic: "Late notice" },
  { ref: "q_strike", topic: "Strikes" },
  { ref: "q_pto", topic: "Time off" },
  { ref: "q_internet", topic: "Internet" },
  { ref: "q_eod", topic: "EOD form" },
  { ref: "q_clickup", topic: "ClickUp" },
  { ref: "q_problem", topic: "Problems with solutions" },
  { ref: "q_value", topic: "Partner results" },
  { ref: "q_camera", topic: "Cameras" },
];

type Value = string | string[] | number | boolean | null;
type Answer = { ref: string; section: string; title: string; value: Value };
type Missed = {
  ref: string;
  topic: string;
  answered: string | null;
  correct: string | null;
};
type Form = {
  id: number;
  person_id: number | null;
  matched_by: "email" | "name" | "manual" | null;
  email: string | null;
  full_name: string | null;
  preferred_name: string | null;
  role_label: string | null;
  submitted_at: string;
  score: number | null;
  score_max: number | null;
  missed: Missed[];
  goals: {
    money12m?: string;
    moneyFor?: string;
    life?: string;
    career3y?: string;
    help?: string;
  };
  answers: Answer[];
  setup: { done?: string[]; missing?: string[]; blocked?: string | null };
  workspace: {
    device?: string | null;
    speedMbps?: number | null;
    backup?: boolean | null;
    cameraAndMic?: boolean | null;
    quietSpace?: boolean | null;
  };
  goals_copied_at: string | null;
  goals_copied_by: string | null;
};
type Unmatched = {
  id: number;
  fullName: string | null;
  preferredName: string | null;
  email: string | null;
  role: string | null;
  submittedAt: string;
};
type State = {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  failedCount: number;
};
type Read = { forms: Form[]; unmatched: Unmatched[]; state: State | null };

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : null);
const GOAL_ROWS: [keyof Form["goals"], string][] = [
  ["money12m", "Earning in 12 months"],
  ["moneyFor", "What the money is for"],
  ["life", "Outside work, this year"],
  ["career3y", "In 3 years"],
  ["help", "How Mahara can help"],
];
// Shown on their own above; the rest are "In their words".
const SHOWN_ELSEWHERE = new Set(["Goals", "Setup", "Workspace", "Standards"]);
const FOLDED = new Set(["About them", "Commitment"]);

function say(v: Value): string {
  if (v === null || v === undefined || v === "") return "Not answered";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "None";
  return String(v);
}

function CopyLink() {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(ONBOARDING_FORM_URL);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        } catch {
          window.prompt("Copy the onboarding form link", ONBOARDING_FORM_URL);
        }
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {done ? "Link copied" : "Copy the form link"}
    </Button>
  );
}

/** The standards check as one notch per question. */
function Notches({ form }: { form: Form }) {
  const missed = new Map(form.missed.map(m => [m.ref, m]));
  const known = form.score_max === QUIZ.length;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs text-muted-foreground">Standards check</span>
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {form.score ?? "n/a"}
          <span className="text-base font-normal text-muted-foreground">{` of ${form.score_max ?? QUIZ.length}`}</span>
        </span>
        {form.missed.length === 0 && form.score !== null ? (
          <StatusChip tone="good" label="All right first time" />
        ) : null}
      </div>
      {known ? (
        <ol
          className="grid grid-cols-12 gap-1"
          aria-label="Each question of the standards check"
        >
          {QUIZ.map(q => {
            const miss = missed.get(q.ref);
            return (
              <li
                key={q.ref}
                title={`${q.topic}: ${miss ? "missed" : "right"}`}
                className={cn(
                  "h-2.5 rounded-full",
                  miss ? "bg-warning" : "bg-mahara-teal",
                )}
              >
                <span className="sr-only">{`${q.topic}, ${miss ? "missed" : "right"}`}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {form.missed.length ? (
        <ul className="grid gap-2 text-sm">
          {form.missed.map(m => (
            <li key={m.ref} className="flex gap-2">
              <span className="mt-2 flex">
                <StatusDot tone="warning" label="Missed" />
              </span>
              <span>
                <span className="font-medium">{m.topic}.</span>{" "}
                <span className="text-muted-foreground">
                  {m.answered
                    ? `They chose "${m.answered}".`
                    : "Their answer was wrong."}
                  {m.correct ? ` The standard: "${m.correct}".` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Goals({
  form,
  personId,
  onCopied,
}: {
  form: Form;
  personId: number;
  onCopied: () => void;
}) {
  const copy = useAction(api.ceo.profiles.onboarding.copyGoals);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const rows = GOAL_ROWS.filter(([k]) => form.goals?.[k]);
  return (
    <div className="grid gap-3 rounded-xl bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Their goals</h3>
        {rows.length ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const res = await copy({ id: form.id, personId });
                setMsg(
                  res?.goals?.changed
                    ? "Copied into Who they are."
                    : "Who they are already has them.",
                );
                onCopied();
              } catch (e) {
                setMsg(
                  String(e instanceof Error ? e.message : e).slice(0, 200),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Copy into Who they are
          </Button>
        ) : null}
      </div>
      {rows.length ? (
        <dl className="grid gap-3 @2xl:grid-cols-2">
          {rows.map(([k, label]) => (
            <div key={k} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-line text-sm">{form.goals[k]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          This submission came before the form asked about goals. Ask them in
          your first one-to-one.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {msg ??
          (form.goals_copied_at
            ? `On their file since ${date(form.goals_copied_at.slice(0, 10))}${form.goals_copied_by && form.goals_copied_by !== "onboarding form" ? `, copied by ${form.goals_copied_by}` : ", filled in from this form"}.`
            : "A first form fills empty goal boxes on its own. Copy adds them below what you wrote.")}
      </p>
    </div>
  );
}

function Words({ answers }: { answers: Answer[] }) {
  const sections: [string, Answer[]][] = [];
  for (const a of answers) {
    if (SHOWN_ELSEWHERE.has(a.section)) continue;
    const at = sections.find(([s]) => s === a.section);
    if (at) at[1].push(a);
    else sections.push([a.section, [a]]);
  }
  const block = (list: Answer[]) => (
    <dl className="grid gap-3">
      {list.map(a => (
        <div key={a.ref} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{a.title}</dt>
          <dd className="whitespace-pre-line text-sm">{say(a.value)}</dd>
        </div>
      ))}
    </dl>
  );
  const open = sections.filter(([s]) => !FOLDED.has(s));
  const folded = sections.filter(([s]) => FOLDED.has(s));
  return (
    <div className="grid gap-5">
      {open.map(([name, list]) => (
        <section
          key={name}
          className="grid gap-3 border-t pt-4 first:border-t-0 first:pt-0"
        >
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {name}
          </h3>
          {block(list)}
        </section>
      ))}
      {folded.length ? (
        <details className="border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Contact details and sign-off
          </summary>
          <div className="mt-4 grid gap-5">
            {folded.map(([name, list]) => (
              <section key={name} className="grid gap-3">
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {name}
                </h3>
                {block(list)}
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Started({
  form,
  personId,
  onCopied,
}: {
  form: Form;
  personId: number;
  onCopied: () => void;
}) {
  const done = form.setup?.done ?? [];
  const missing = form.setup?.missing ?? [];
  const ws = form.workspace ?? {};
  const walked = form.answers.find(a => a.ref === "scorecard_walked")?.value;
  const slow = typeof ws.speedMbps === "number" && ws.speedMbps < 20;
  return (
    <div className="grid gap-6">
      <Notches form={form} />
      <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
        <StatTile
          variant="plain"
          label="Scorecard walk-through"
          value={
            walked === true
              ? "Done"
              : walked === false
                ? "Not yet"
                : "Not asked"
          }
          status={
            walked === false ? (
              <StatusChip tone="warning" label="Book it" />
            ) : null
          }
          hint="Whether their manager had walked them through their role's scorecard when they filled in the form."
        />
        <StatTile
          variant="plain"
          label="Tools set up"
          value={
            done.length + missing.length
              ? `${done.length} of ${done.length + missing.length}`
              : "Not asked"
          }
          status={
            missing.length ? (
              <StatusChip tone="warning" label={`${missing.length} to do`} />
            ) : null
          }
        />
        <StatTile
          variant="plain"
          label="Download speed"
          value={
            typeof ws.speedMbps === "number"
              ? `${ws.speedMbps} Mbps`
              : "Not given"
          }
          sub={
            ws.backup === true
              ? "Has a backup connection"
              : ws.backup === false
                ? "No backup connection"
                : undefined
          }
          status={
            slow || ws.backup === false ? (
              <StatusChip tone="warning" label="Fix" />
            ) : null
          }
        />
        <StatTile
          variant="plain"
          label="Camera and quiet space"
          value={
            ws.cameraAndMic === true && ws.quietSpace === true
              ? "Ready"
              : ws.cameraAndMic === null && ws.quietSpace === null
                ? "Not given"
                : "Not ready"
          }
          sub={ws.device ?? undefined}
          status={
            ws.cameraAndMic === false || ws.quietSpace === false ? (
              <StatusChip tone="warning" label="Fix" />
            ) : null
          }
        />
      </div>
      {missing.length || form.setup?.blocked ? (
        <div className="grid gap-2">
          {missing.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Not set up yet">
              {missing.map(m => (
                <li
                  key={m}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                >
                  <StatusDot tone="warning" label="Not set up" />
                  {m}
                </li>
              ))}
            </ul>
          ) : null}
          {form.setup?.blocked ? (
            <p className="whitespace-pre-line text-sm">
              <span className="text-muted-foreground">
                What is blocking them:{" "}
              </span>
              {form.setup.blocked}
            </p>
          ) : null}
        </div>
      ) : null}
      <Goals form={form} personId={personId} onCopied={onCopied} />
      <Words answers={form.answers} />
    </div>
  );
}

export function OnboardingPanel({
  personId,
  personName,
  onProfileChanged,
}: {
  personId: number;
  personName: string;
  onProfileChanged: () => void;
}) {
  const read = useAction(api.ceo.profiles.onboarding.read);
  // Held in a ref: a new identity must never start another read.
  const readRef = useRef(read);
  readRef.current = read;
  const link = useAction(api.ceo.profiles.onboarding.link);
  const [data, setData] = useState<Read | null>(null);
  const [pick, setPick] = useState(0);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const first = personName.trim().split(/\s+/)[0] || "this person";

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = (await readRef.current({ personId })) as Read;
      if (!Array.isArray(res?.forms))
        throw new Error("The onboarding forms could not be read.");
      setData({
        forms: res.forms,
        unmatched: res.unmatched ?? [],
        state: res.state ?? null,
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setBusy(false);
    }
  }, [personId]);

  useEffect(() => {
    setPick(0);
    void load();
  }, [load]);

  const forms = data?.forms ?? [];
  const form = forms[pick] ?? forms[0] ?? null;
  const st = data?.state;
  const failing =
    st?.lastErrorAt &&
    (!st.lastOkAt || (ms(st.lastErrorAt) ?? 0) > (ms(st.lastOkAt) ?? 0));

  return (
    <SectionCard
      kicker="From the form"
      title={form ? "How they started" : "Onboarding"}
      description={
        form
          ? [
              `Sent ${dateTime(ms(form.submitted_at))}`,
              form.role_label,
              form.matched_by === "manual"
                ? "linked by hand"
                : form.matched_by
                  ? `matched by ${form.matched_by}`
                  : "matched by email",
            ]
              .filter(Boolean)
              .join(" · ")
          : "What they told us when they joined: their goals, the standards check and their setup."
      }
      order={1}
      bodyClassName="@container"
    >
      <div className="grid gap-6">
        {failing ? (
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden
            />
            <span>
              {`The last form delivery failed ${relative(ms(st?.lastErrorAt))}${st?.lastError ? `: ${st.lastError}` : ""}. Typeform tries again on its own; if this stays, the webhook on the form needs checking.`}
            </span>
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
        ) : null}
        {busy && !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Reading their onboarding form
          </p>
        ) : null}
        {forms.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              They sent the form {forms.length} times:
            </span>
            {forms.map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPick(i)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs",
                  i === pick
                    ? "bg-primary/15 ring-1 ring-inset ring-primary/40"
                    : "hover:bg-muted/60",
                )}
              >
                {date(f.submitted_at.slice(0, 10))}
              </button>
            ))}
          </div>
        ) : null}
        {form ? (
          <Started
            form={form}
            personId={personId}
            onCopied={() => {
              void load();
              onProfileChanged();
            }}
          />
        ) : data ? (
          <EmptyState
            icon={Link2}
            title={`No onboarding form from ${first} yet`}
            text="Send them the form. When they submit it, their goals, the standards check and their setup land here on their own."
            action={<CopyLink />}
          />
        ) : null}
        {!form && data?.unmatched.length ? (
          <div className="grid gap-2 border-t pt-4">
            <h3 className="text-sm font-semibold">
              Forms nobody is matched to
            </h3>
            <p className="text-xs text-muted-foreground">
              A form is matched by the Mahara email on it, then by full name. If
              one of these is {first}, link it.
            </p>
            <ul className="divide-y">
              {data.unmatched.map(u => (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {u.fullName ?? u.preferredName ?? "No name given"}
                    </span>
                    <span className="text-muted-foreground">
                      {` · ${[u.email, u.role, date(u.submittedAt.slice(0, 10))].filter(Boolean).join(" · ")}`}
                    </span>
                  </span>
                  {confirm === u.id ? (
                    <span className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await link({ id: u.id, personId });
                            setConfirm(null);
                            await load();
                            onProfileChanged();
                          } catch (e) {
                            setError(
                              String(e instanceof Error ? e.message : e).slice(
                                0,
                                200,
                              ),
                            );
                          }
                        }}
                      >
                        {`Link to ${first}`}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirm(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirm(u.id)}
                    >
                      This is them
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
