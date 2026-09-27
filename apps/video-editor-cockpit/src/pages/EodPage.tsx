import { type FormEvent, useMemo, useState } from "react";
import { FIELD, Page, PageHeader, Problem, Section } from "../components/bits";
import { Button } from "../components/ui/button";
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
/**
 * The Typeform's seven questions, in its order, grouped into three blocks.
 * Seven separate cards for seven questions was a wall; the grouping is only
 * visual and the answers still go to the same seven columns.
 */
interface Question {
  key: string;
  label: string;
  hint?: string;
  rows?: number;
}

const BLOCKS: { title: string; questions: Question[] }[] = [
  {
    title: "What you did",
    questions: [
      {
        key: "completed",
        label: "Videos completed",
        hint: "Count, client and the delivery link",
        rows: 3,
      },
      {
        key: "in_progress",
        label: "In progress or pending",
        hint: "With how far along",
        rows: 2,
      },
      {
        key: "revisions",
        label: "Revisions handled",
        hint: "Count and client",
        rows: 2,
      },
    ],
  },
  {
    title: "What got in the way",
    questions: [
      {
        key: "blockers",
        label: "Blockers",
        hint: "Missing footage, unclear brief, waiting on someone",
        rows: 2,
      },
      {
        key: "recommendations",
        label: "Recommendations",
        hint: "Anything that would make this easier",
        rows: 2,
      },
    ],
  },
  {
    title: "What is next",
    questions: [
      { key: "tomorrow", label: "Tomorrow's plan", rows: 2 },
      {
        key: "summary",
        label: "Day summary",
        hint: "The one line Aziz reads first",
        rows: 3,
      },
    ],
  },
];

/** Kuwait's day, which is what the sheet records. */
function today(): string {
  const now = new Date();
  const kuwait = new Date(
    now.getTime() + (3 * 60 + now.getTimezoneOffset()) * 60_000,
  );
  return kuwait.toISOString().slice(0, 10);
}

/** "2026-09-26" read as a person says it: "Saturday 26 September". */
function spoken(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export default function EodPage() {
  const { email, name } = useWho();
  const day = useMemo(today, []);
  const filed = useEodToday(day);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The name the row is filed under: the seat's name unless the editor
  // changes it (the Who card used to be a field; it is one tap away now).
  const [who, setWho] = useState(name);
  const [editingWho, setEditingWho] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const already = filed.data?.[0];

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!answers.summary?.trim()) {
      setProblem(
        "The day summary is the one line Aziz reads first. Fill that in at least.",
      );
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

  const field = `${FIELD} resize-y py-2`;

  return (
    <Page>
      <PageHeader
        title="End of day"
        sub={
          editingWho ? (
            <span className="flex flex-wrap items-center gap-2">
              <label htmlFor="eod-name">Filing as</label>
              <input
                id="eod-name"
                value={who}
                onChange={e => setWho(e.target.value)}
                onBlur={() => setEditingWho(false)}
                // biome-ignore lint/a11y/noAutofocus: opened on purpose by the Change link
                autoFocus
                className="h-9 w-48 rounded-lg border bg-background px-3 text-sm"
              />
              <span>for {spoken(day)}.</span>
            </span>
          ) : (
            <>
              Filing as {who || name} for {spoken(day)}, straight into the EOD
              Reports sheet.{" "}
              <button
                type="button"
                onClick={() => setEditingWho(true)}
                className="text-primary underline-offset-4 hover:underline"
              >
                Change
              </button>
            </>
          )
        }
      />

      {already ? (
        <div className="mb-4 sm:mb-6">
          <Section title="Already filed today">
            <p className="text-sm">
              Filed{" "}
              {already.finished_at ? moment(already.finished_at) : "just now"}
              {already.status === "queued" || already.status === "running"
                ? ", on its way to the sheet."
                : already.status === "failed"
                  ? `, but it did not reach the sheet: ${already.error ?? "no reason given"}`
                  : "."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Filing again adds a second row rather than replacing the first, so
              only do it if the first one was wrong.
            </p>
          </Section>
        </div>
      ) : null}

      <form onSubmit={send} className="space-y-4 sm:space-y-6">
        {BLOCKS.map(block => (
          <Section key={block.title} title={block.title}>
            <div className="space-y-4">
              {block.questions.map(q => (
                <div key={q.key}>
                  <label
                    htmlFor={`eod-${q.key}`}
                    className="block text-sm font-medium"
                  >
                    {q.label}
                  </label>
                  {q.hint ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {q.hint}
                    </p>
                  ) : null}
                  <textarea
                    id={`eod-${q.key}`}
                    rows={q.rows ?? 2}
                    dir="auto"
                    value={answers[q.key] ?? ""}
                    onChange={e =>
                      setAnswers(a => ({ ...a, [q.key]: e.target.value }))
                    }
                    className={`${field} mt-2`}
                  />
                </div>
              ))}
            </div>
          </Section>
        ))}

        {problem && <Problem>{problem}</Problem>}
        {said && (
          <p role="status" className="text-sm text-muted-foreground">
            {said}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={busy}
          className="w-full pointer-coarse:h-11 sm:w-auto"
        >
          {busy ? "Filing" : "File the day"}
        </Button>
      </form>
    </Page>
  );
}
