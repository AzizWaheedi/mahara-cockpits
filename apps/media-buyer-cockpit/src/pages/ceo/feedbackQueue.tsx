import { useAction, useQuery } from "convex/react";
import { ListTodo } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips } from "@/components/ceo/FilterChips";
import { plural, relative } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";

/**
 * Changes and bugs, Aziz's own queue (2026-09-21). Two kinds, a text, a
 * queue. Bugs are picked up on the next scan; changes wait until Deploy
 * sends the batch. The scan runs from Aziz's desktop on a schedule and
 * writes its state back, so an item moves from queued to in progress to done.
 * Shown only to the founder addresses; the server refuses everyone else.
 */

type Item = {
  id: number;
  kind: "change" | "bug";
  text: string;
  status: "queued" | "dispatched" | "in_progress" | "done" | "dismissed";
  batch: string | null;
  note: string | null;
  createdAt: number | null;
  dispatchedAt: number | null;
  doneAt: number | null;
};

type Queue = { open: Item[]; closed: Item[]; queued: number };

const STATUS_LABEL: Record<Item["status"], string> = {
  queued: "Queued",
  dispatched: "Sent to build",
  in_progress: "Being built",
  done: "Done",
  dismissed: "Withdrawn",
};

function serverMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m
    .replace(/^.*Uncaught Error:\s*/s, "")
    .split("\n")[0]
    .slice(0, 200);
}

export function FeedbackQueueCard({
  order,
  now,
}: {
  order: number;
  now: number;
}) {
  const me = useQuery(api.roles.me, {});
  if (!me || me.isFounder !== true) return null;
  return <FeedbackQueue order={order} now={now} />;
}

function FeedbackQueue({ order, now }: { order: number; now: number }) {
  const listAction = useAction(api.ceo.feedback.list);
  const addAction = useAction(api.ceo.feedback.add);
  const setStatus = useAction(api.ceo.feedback.setStatus);
  const dispatch = useAction(api.ceo.feedback.dispatch);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [kind, setKind] = useState<"change" | "bug">("change");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      setQueue((await listAction({})) as Queue);
    } catch (e) {
      setMessage(serverMessage(e));
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>, after?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await load();
      if (after) setMessage(after);
    } catch (e) {
      setMessage(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const queued = queue?.queued ?? 0;

  return (
    <SectionCard
      kicker="Private"
      title="Changes and bugs"
      order={order}
      notes={[
        {
          level: "info",
          text: "Bugs are picked up on the next scan and shipped. Changes wait in the queue until Deploy sends the batch. The scan runs from your desktop app on a schedule (the app must be open), reads this list, builds, ships, and writes the state back here.",
        },
      ]}
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={busy || queued === 0}
          onClick={() =>
            void run(
              () => dispatch({}),
              `Sent ${plural(queued, "item")} to build.`,
            )
          }
        >
          {queued > 0
            ? `Deploy ${plural(queued, "queued item")}`
            : "Nothing queued"}
        </Button>
      }
    >
      {() => (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <FilterChips
              options={[
                { key: "change", label: "A change" },
                { key: "bug", label: "A bug" },
              ]}
              value={kind}
              onChange={setKind}
              ariaLabel="What you are logging"
            />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              dir="auto"
              placeholder={
                kind === "bug"
                  ? "What broke, where, and what you expected instead."
                  : "What to change, in your words. Name the tab or the number."
              }
              aria-label="What to change or what broke"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={busy || text.trim().length < 3}
                onClick={() =>
                  void run(
                    async () => {
                      await addAction({ kind, text: text.trim() });
                      setText("");
                    },
                    kind === "bug"
                      ? "Logged. It is fixed on the next scan."
                      : "Queued. Press Deploy when you want it built.",
                  )
                }
              >
                {kind === "bug" ? "Log the bug" : "Queue the change"}
              </Button>
              {message ? (
                <span className="text-xs text-muted-foreground">{message}</span>
              ) : null}
            </div>
          </div>

          {queue === null ? null : queue.open.length === 0 ? (
            <EmptyState
              title="Nothing open"
              text="Log a change or a bug above."
              icon={ListTodo}
              compact
            />
          ) : (
            <ul className="divide-y border-y">
              {queue.open.map(i => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-xs text-muted-foreground">
                      {i.kind === "bug" ? "Bug" : "Change"}
                      {i.createdAt ? ` · ${relative(i.createdAt, now)}` : ""}
                      {i.batch ? ` · ${i.batch}` : ""}
                    </span>
                    <span className="block whitespace-pre-wrap" dir="auto">
                      {i.text}
                    </span>
                    {i.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {i.note}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusChip
                      tone={
                        i.status === "in_progress"
                          ? "good"
                          : i.status === "dispatched"
                            ? "warning"
                            : "neutral"
                      }
                      label={STATUS_LABEL[i.status]}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          setStatus({ id: i.id, status: "dismissed" }),
                        )
                      }
                      className="rounded-sm text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                    >
                      Withdraw
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {queue?.closed.length ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {plural(queue.closed.length, "closed item")}
              </summary>
              <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                {queue.closed.map(i => (
                  <li
                    key={i.id}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {i.kind === "bug" ? "Bug" : "Change"}: {i.text}
                    </span>
                    <span>
                      {STATUS_LABEL[i.status]}
                      {i.doneAt ? ` ${relative(i.doneAt, now)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
