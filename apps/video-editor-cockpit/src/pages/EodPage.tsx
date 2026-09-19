import { type FormEvent, useMemo, useState } from "react";
import { Problem, Section } from "../components/bits";
import { useWho } from "../lib/auth";
import { askFor, useEodToday } from "../lib/data";
import { moment } from "../lib/format";

/**
 * End of day, in the cockpit instead of the Typeform.
 *
 * The questions are the Video Editors EOD form's own, in its order, and the
 * answers land on the same "Video Editors" tab of the EOD Reports sheet that
 * the form writes to. Aziz keeps that sheet as the accountability record for
 * every role, so filing here has to be indistinguishable from filing there.
 *
 * The browser holds no Google credential: it queues the filing and the
 * worker appends the row, the same way everything else that leaves this
 * cockpit works.
 */
const QUESTIONS: { key: string; label: string; hint?: string; rows?: number }[] = [
  {
    key: "completed",
    label: "Videos completed today",
    hint: "count, client and the delivery link",
    rows: 3,
  },
  {
    key: "in_progress",
    label: "Videos in progress or pending",
    hint: "with how far along",
    rows: 3,
  },
  { key: "revisions", label: "Revisions handled today", hint: "count and client", rows: 2 },
  {
    key: "blockers",
    label: "Blockers",
    hint: "missing footage, unclear brief, waiting on someone",
    rows: 3,
  },
  { key: "recommendations", label: "Recommendations or process improvements", rows: 2 },
  { key: "tomorrow", label: "Tomorrow's plan", rows: 3 },
  { key: "summary", label: "Day summary", rows: 3 },
];

/** Kuwait's day, which is what the sheet records. */
function today(): string {
  const now = new Date();
  const kuwait = new Date(now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60_000);
  return kuwait.toISOString().slice(0, 10);
}

export default function EodPage() {
  const { email, name } = useWho();
  const day = useMemo(today, []);
  const filed = useEodToday(day);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [who, setWho] = useState(name);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const already = filed.data?.[0];

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!answers.summary?.trim()) {
      setProblem("The day summary is the one line Aziz reads first. Fill that in at least.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const err = await askFor(
      "eod",
      `eod:${day}`,
      JSON.stringify({ ...answers, name: who || name }),
      { email, name },
      { day },
    );
    setBusy(false);
    if (err) setProblem(`That could not be filed: ${err}`);
    else {
      setSaid("Filed. It reaches the EOD Reports sheet within a few minutes.");
      filed.reload();
    }
  }

  const field =
    "w-full resize-y rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">End of day</h1>
        <p className="muted mt-1 text-sm">
          The same questions as the Video Editors form, filed straight into the EOD Reports sheet.
          For {day}.
        </p>
      </header>

      {already ? (
        <Section title="Already filed today">
          <p className="text-sm">
            Filed {already.finished_at ? moment(already.finished_at) : "just now"}
            {already.status === "queued" || already.status === "running"
              ? ", on its way to the sheet."
              : already.status === "failed"
                ? `, but it did not reach the sheet: ${already.error ?? "no reason given"}`
                : "."}
          </p>
          <p className="muted mt-2 text-sm">
            Filing again adds a second row rather than replacing the first, so only do it if the
            first one was wrong.
          </p>
        </Section>
      ) : null}

      <form onSubmit={send} className="mt-4 space-y-4">
        <Section title="Who">
          <label htmlFor="eod-name" className="block">
            <span className="muted mb-1.5 block text-[11px] uppercase tracking-wide">Name</span>
            <input
              id="eod-name"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              className="h-10 w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 text-sm"
            />
          </label>
        </Section>

        {QUESTIONS.map((q) => (
          <Section key={q.key} title={q.label}>
            {q.hint ? <p className="muted mb-2 text-xs">{q.hint}</p> : null}
            <textarea
              id={`eod-${q.key}`}
              rows={q.rows ?? 2}
              value={answers[q.key] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
              className={field}
            />
          </Section>
        ))}

        {problem && <Problem>{problem}</Problem>}
        {said && <p className="muted text-sm">{said}</p>}

        <button
          type="submit"
          disabled={busy}
          className="h-11 w-full rounded-[var(--radius-md)] bg-[color:var(--primary)] text-sm font-medium text-[color:var(--primary-foreground)] disabled:opacity-50"
        >
          {busy ? "Filing" : "File the day"}
        </button>
      </form>
    </div>
  );
}
