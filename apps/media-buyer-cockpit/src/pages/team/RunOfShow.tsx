import { api, useAction } from "@/lib/cockpitApi";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  blocksFor,
  DAY_NAMES,
  totalMinutes,
  variesByDay,
  weekdayOf,
} from "@/lib/teamCore";
import type { BlockRow, MeetingPage as Page } from "@/lib/team";
import {
  ConfirmInline,
  chip,
  fieldClass,
  InlineText,
  iconButton,
  selectClass,
  useBusy,
} from "./teamKit";

/**
 * The run of show: the fixed, timed part of every sitting, above the
 * agenda's one-off items. Minutes on the left, the total against the
 * meeting's length, and a day switcher when the meeting runs differently
 * on different days (CSM Daily's theme of the day). Anyone on the team
 * edits it, like the rest of the page.
 */

type Act = (fn: () => Promise<unknown>) => Promise<void>;

export function RunOfShow({
  page,
  act,
  day,
}: {
  page: Page;
  act: Act;
  day: string | null;
}) {
  const saveBlock = useAction(api.team.saveBlock);
  const deleteBlock = useAction(api.team.deleteBlock);
  const moveBlock = useAction(api.team.moveBlock);
  const varies = variesByDay(page.blocks);
  const meets = page.meeting.weekdays ?? [];
  const fallback = day ? weekdayOf(day) : (meets[0] ?? null);
  const [weekday, setWeekday] = useState<number | null>(fallback);
  const shownDay = varies ? weekday : null;
  const blocks = blocksFor(page.blocks, shownDay);
  const total = totalMinutes(blocks);
  const dayTabs = [
    ...new Set([
      ...meets,
      ...page.blocks.map(b => b.weekday).filter((d): d is number => d !== null),
    ]),
  ].sort((a, b) => a - b);
  const [busy, run] = useBusy();
  const id = page.meeting.id;
  return (
    <section
      className="rounded-2xl border bg-card"
      aria-labelledby="run-of-show"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <h2 id="run-of-show" className="text-[15px] font-semibold">
          Run of show
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {total
            ? `${total}${page.meeting.minutes ? ` of ${page.meeting.minutes}` : ""} min`
            : ""}
        </span>
        {varies && dayTabs.length > 1 ? (
          <div className="-mx-1 flex w-full gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {dayTabs.map(d => (
              <button
                key={d}
                type="button"
                aria-pressed={weekday === d}
                onClick={() => setWeekday(d)}
                className={chip(weekday === d)}
              >
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {blocks.length ? (
        <ol className="divide-y">
          {blocks.map((b, i) => (
            <Block
              key={b.id}
              b={b}
              first={i === 0}
              last={i === blocks.length - 1}
              varies={varies}
              busy={busy === String(b.id)}
              onSave={fields =>
                act(() =>
                  saveBlock({
                    meetingId: id,
                    id: b.id,
                    title: b.title,
                    ...fields,
                  }),
                )
              }
              onMove={dir =>
                run(String(b.id), () =>
                  act(() => moveBlock({ id: b.id, dir, weekday: shownDay })),
                )
              }
              onDelete={() => act(() => deleteBlock({ id: b.id }))}
            />
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
          No run of show yet. Add the parts every sitting goes through, with
          their minutes.
        </p>
      )}
      <AddBlock
        weekday={shownDay}
        varies={varies || dayTabs.length > 1}
        days={dayTabs}
        onAdd={(title, minutes, onDay) =>
          act(() =>
            saveBlock({
              meetingId: id,
              title,
              minutes,
              weekday: onDay,
              detail: null,
            }),
          )
        }
      />
    </section>
  );
}

function Block({
  b,
  first,
  last,
  varies,
  busy,
  onSave,
  onMove,
  onDelete,
}: {
  b: BlockRow;
  first: boolean;
  last: boolean;
  varies: boolean;
  busy: boolean;
  onSave: (fields: {
    title?: string;
    detail?: string | null;
    minutes?: number | null;
  }) => Promise<void>;
  onMove: (dir: "up" | "down") => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [minutes, setMinutes] = useState(
    b.minutes === null ? "" : String(b.minutes),
  );
  return (
    <li className="group grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:px-5">
      <label className="self-start">
        <span className="sr-only">Minutes for {b.title}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={480}
          value={minutes}
          placeholder="min"
          onChange={e => setMinutes(e.target.value)}
          onBlur={() => {
            const next =
              minutes === ""
                ? null
                : Math.max(0, Math.min(480, Math.trunc(Number(minutes))));
            if (next !== b.minutes)
              void onSave({ minutes: next }).catch(() =>
                setMinutes(b.minutes === null ? "" : String(b.minutes)),
              );
          }}
          className="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-right font-mono text-sm tabular-nums hover:border-input focus:border-input focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <div className="grid min-w-0 gap-1">
        <div className="flex items-start gap-2">
          <InlineText
            value={b.title}
            label="Block"
            placeholder="What happens"
            className="flex-1 text-sm font-medium leading-snug"
            onSave={title => onSave({ title })}
          />
          {varies && b.weekday !== null ? (
            <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              {DAY_NAMES[b.weekday]} only
            </span>
          ) : null}
        </div>
        <InlineText
          value={b.detail ?? ""}
          label="Detail"
          placeholder="Add detail"
          multiline
          max={1000}
          emptyClass="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-70 focus-visible:opacity-100"
          className="text-sm leading-relaxed text-muted-foreground"
          onSave={detail => onSave({ detail: detail || null })}
        />
      </div>
      <div className="col-span-2 flex items-start justify-end gap-1 opacity-100 transition-opacity sm:col-span-1 sm:-mr-2 pointer-fine:sm:opacity-0 pointer-fine:sm:group-focus-within:opacity-100 pointer-fine:sm:group-hover:opacity-100">
        {busy ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
        <button
          type="button"
          aria-label="Move up"
          disabled={first || busy}
          onClick={() => void onMove("up")}
          className={iconButton}
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Move down"
          disabled={last || busy}
          onClick={() => void onMove("down")}
          className={iconButton}
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <ConfirmInline ask="Take it out?" yes="Take out" onYes={onDelete}>
          {open => (
            <button
              type="button"
              aria-label={`Take "${b.title}" out of the run of show`}
              onClick={open}
              className={iconButton}
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </ConfirmInline>
      </div>
    </li>
  );
}

function AddBlock({
  weekday,
  varies,
  days,
  onAdd,
}: {
  weekday: number | null;
  varies: boolean;
  days: number[];
  onAdd: (
    title: string,
    minutes: number | null,
    weekday: number | null,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("");
  const [onDay, setOnDay] = useState<string>("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2 border-t px-4 py-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_auto_auto] sm:items-center sm:px-5"
      onSubmit={async e => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await onAdd(
            title,
            minutes === "" ? null : Math.trunc(Number(minutes)),
            onDay === "" ? null : Number(onDay),
          );
          setTitle("");
          setMinutes("");
        } catch {
          // The page shows the error.
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Add a part of the run of show"
        aria-label="New block"
        dir="auto"
      />
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={480}
        value={minutes}
        onChange={e => setMinutes(e.target.value)}
        placeholder="Minutes"
        aria-label="Minutes"
        className={fieldClass}
      />
      {varies ? (
        <AnimatedSelect
          className={`${selectClass} sm:w-36`}
          value={onDay}
          onChange={e => setOnDay(e.target.value)}
          aria-label="Which sittings"
        >
          <option value="">Every sitting</option>
          {days.map(d => (
            <option key={d} value={String(d)}>
              {DAY_NAMES[d]} only{weekday === d ? " (shown)" : ""}
            </option>
          ))}
        </AnimatedSelect>
      ) : (
        <span className="hidden sm:block" />
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={busy || !title.trim()}
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Plus aria-hidden />
        )}
        Add
      </Button>
    </form>
  );
}
