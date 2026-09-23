import { useAction } from "convex/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { usePageVisible } from "@/lib/usePageVisible";
import { api } from "../../../convex/_generated/api";
import type {
  Item,
  MeetingPage as Page,
  Person,
  Sitting,
} from "../../../convex/team";
import {
  dayName,
  errorText,
  Field,
  Initials,
  PeopleOptions,
  peopleById,
  type SaveResult,
  SharedText,
  selectClass,
  shortName,
  when,
} from "./teamKit";

/**
 * One meeting: what it is for, the agenda for the next time it meets, the
 * notes of each sitting, its living doc, and who is in it.
 *
 * The agenda is the point. An item stays open until somebody finishes or
 * drops it, so the next meeting opens with what the last one did not get
 * to, and each open item shows how many meetings it has already been
 * carried through: one ring per meeting, amber from the third. Closing an
 * item stamps the meeting it was closed in, which is what "Finished last
 * time" reads back.
 */

const CADENCES = [
  "weekly",
  "every two weeks",
  "monthly",
  "quarterly",
  "as needed",
];

export function MeetingPage() {
  const { id = "" } = useParams();
  const load = useAction(api.team.meeting);
  const saveMeeting = useAction(api.team.saveMeeting);
  const setPart = useAction(api.team.setPart);
  const addSitting = useAction(api.team.addSitting);
  const saveDoc = useAction(api.team.saveDoc);
  const saveNotes = useAction(api.team.saveNotes);
  const addItem = useAction(api.team.addItem);
  const editItem = useAction(api.team.editItem);
  const closeItem = useAction(api.team.closeItem);
  const moveItem = useAction(api.team.moveItem);
  const visible = usePageVisible();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPage((await load({ id })) as Page);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [load, id]);

  // Everyone edits the same meeting: read it again every twenty seconds
  // while the page is on screen, so another person's changes show up.
  useEffect(() => {
    if (!visible) return;
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [refresh, visible]);

  /** Run a change; the server answers with the meeting as it now is. */
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      setPage((await fn()) as Page);
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  }, []);

  const derived = useMemo(() => {
    if (!page) return null;
    const today = page.today;
    const byDate = [...page.sittings].sort((a, b) =>
      a.onDate.localeCompare(b.onDate),
    );
    const next = byDate.find(s => s.onDate >= today) ?? null;
    const past = byDate.filter(s => s.onDate < today).reverse();
    const todays = byDate.find(s => s.onDate === today) ?? null;
    // Notes open on today's meeting, else the last one (to write it up),
    // else the next one.
    const defaultNotes = todays ?? past[0] ?? next;
    const open = page.items
      .filter(i => i.status === "open")
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const lastSitting = todays ?? past[0] ?? null;
    const finishedLast = lastSitting
      ? page.items.filter(
          i => i.status !== "open" && i.sittingId === lastSitting.id,
        )
      : [];
    return {
      today,
      next,
      past,
      defaultNotes,
      open,
      lastSitting,
      finishedLast,
    };
  }, [page]);

  if (!page || !derived)
    return (
      <div className="mx-auto w-full max-w-6xl p-1">
        <BackLink />
        {error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Opening the
            meeting
          </p>
        )}
      </div>
    );

  const m = page.meeting;
  const byId = peopleById(page.people);
  const notesSitting: Sitting | null =
    page.sittings.find(s => s.id === notesFor) ?? derived.defaultNotes;
  const agendaFor = derived.next;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5">
      <BackLink />
      <Header
        page={page}
        onSave={fields => act(() => saveMeeting({ id: m.id, ...fields }))}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid min-w-0 gap-5">
          <section className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold">
                {agendaFor
                  ? agendaFor.onDate === derived.today
                    ? "Today's agenda"
                    : `Agenda for ${dayName(agendaFor.onDate)}`
                  : "Agenda"}
              </h2>
              <span className="text-xs text-muted-foreground">
                {derived.open.length
                  ? `${derived.open.length} to cover`
                  : "Nothing to cover yet"}
              </span>
            </div>
            {derived.open.length ? (
              <ol className="divide-y">
                {derived.open.map((item, i) => (
                  <AgendaRow
                    key={item.id}
                    item={item}
                    people={page.people}
                    first={i === 0}
                    last={i === derived.open.length - 1}
                    onDone={() =>
                      act(() => closeItem({ id: item.id, status: "done" }))
                    }
                    onDrop={() =>
                      act(() => closeItem({ id: item.id, status: "dropped" }))
                    }
                    onMove={dir => act(() => moveItem({ id: item.id, dir }))}
                    onText={text => act(() => editItem({ id: item.id, text }))}
                    onOwner={ownerId =>
                      act(() => editItem({ id: item.id, ownerId }))
                    }
                  />
                ))}
              </ol>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
                Add what this meeting has to cover. Anything not finished stays
                here for the next one.
              </p>
            )}
            <AddItem
              people={page.people}
              onAdd={(text, ownerId) =>
                act(() =>
                  addItem({
                    meetingId: m.id,
                    text,
                    ...(ownerId ? { ownerId } : {}),
                  }),
                )
              }
            />
            {derived.finishedLast.length && derived.lastSitting ? (
              <details className="border-t px-4 py-3 text-sm sm:px-5">
                <summary className="cursor-pointer text-muted-foreground">
                  Finished{" "}
                  {derived.lastSitting.onDate === derived.today
                    ? "today"
                    : `on ${dayName(derived.lastSitting.onDate)}`}
                  : {derived.finishedLast.length}
                </summary>
                <ul className="mt-2 grid gap-1.5">
                  {derived.finishedLast.map(i => (
                    <ClosedRow
                      key={i.id}
                      item={i}
                      owner={i.ownerId ? byId.get(i.ownerId) : undefined}
                      onReopen={() =>
                        act(() => closeItem({ id: i.id, status: "open" }))
                      }
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {notesSitting
                  ? `Notes, ${notesSitting.onDate === derived.today ? "today" : dayName(notesSitting.onDate)}`
                  : "Notes"}
              </h2>
              {page.sittings.length > 1 ? (
                <AnimatedSelect
                  className={`${selectClass} h-8 w-auto`}
                  aria-label="Which meeting's notes"
                  value={notesSitting?.id ?? ""}
                  onChange={e => setNotesFor(e.target.value)}
                >
                  {[...page.sittings]
                    .sort((a, b) => b.onDate.localeCompare(a.onDate))
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {dayName(s.onDate)}
                        {s.onDate === derived.today ? " (today)" : ""}
                      </option>
                    ))}
                </AnimatedSelect>
              ) : null}
            </div>
            {notesSitting ? (
              <SharedText
                key={notesSitting.id}
                label="Meeting notes"
                value={notesSitting.notes}
                version={notesSitting.notesVersion}
                savedBy={notesSitting.notesBy}
                savedAt={notesSitting.notesAt}
                today={derived.today}
                minRows={5}
                placeholder="What was said, what was decided, who does what by when."
                onSave={async (text, version): Promise<SaveResult> => {
                  const res = (await saveNotes({
                    sittingId: notesSitting.id,
                    text,
                    version,
                  })) as { ok: boolean; page?: Page; conflict?: never };
                  if (res.ok && res.page) setPage(res.page);
                  return res as unknown as SaveResult;
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Notes open once the meeting has a date.
                {page.canManage ? " Set one in the panel on the right." : ""}
              </p>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold">The doc</h2>
            <p className="mb-3 mt-0.5 text-sm text-muted-foreground">
              This meeting's living document: the plan, the numbers, the
              projections. Everyone on the team can edit it, and it carries from
              one meeting to the next.
            </p>
            <SharedText
              label="The meeting's doc"
              value={m.doc}
              version={m.docVersion}
              savedBy={m.docBy}
              savedAt={m.docAt}
              today={derived.today}
              minRows={10}
              placeholder={
                "Write it the way you would a Google Doc.\n\nFor an end-of-month meeting: last month's numbers against the plan, what worked, what did not, and next month's projections."
              }
              onSave={async (text, version): Promise<SaveResult> => {
                const res = (await saveDoc({
                  meetingId: m.id,
                  text,
                  version,
                })) as { ok: boolean; page?: Page };
                if (res.ok && res.page) setPage(res.page);
                return res as unknown as SaveResult;
              }}
            />
          </section>
        </div>

        <aside className="grid min-w-0 gap-5">
          <When
            page={page}
            next={derived.next}
            onAdd={date => act(() => addSitting({ meetingId: m.id, date }))}
          />
          <People
            page={page}
            onPart={(personId, part) =>
              act(() => setPart({ meetingId: m.id, personId, part }))
            }
          />
          <Past
            past={derived.past}
            items={page.items}
            onOpenNotes={id => {
              setNotesFor(id);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
          <Changes page={page} />
        </aside>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/team"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" aria-hidden /> Team meetings
    </Link>
  );
}

// --- the header: name, purpose, how often ------------------------------------

function Header({
  page,
  onSave,
}: {
  page: Page;
  onSave: (f: {
    title: string;
    purpose: string;
    cadence: string;
    department?: string;
  }) => Promise<void>;
}) {
  const m = page.meeting;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [purpose, setPurpose] = useState(m.purpose ?? "");
  const [cadence, setCadence] = useState(m.cadence ?? "weekly");
  const [department, setDepartment] = useState(m.department ?? "");
  const [busy, setBusy] = useState(false);
  const departments = [
    ...new Set(
      page.people.map(p => p.department).filter((d): d is string => Boolean(d)),
    ),
  ].sort();

  if (editing)
    return (
      <form
        className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({
              title,
              purpose,
              cadence,
              ...(department ? { department } : {}),
            });
            setEditing(false);
          } catch {
            // The page shows the error.
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          {id => (
            <Input
              id={id}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="What it is for, in one sentence">
          {id => (
            <Input
              id={id}
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="Review last week's numbers and set this week's launches."
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            How often
            <AnimatedSelect
              className={selectClass}
              value={cadence}
              onChange={e => setCadence(e.target.value)}
            >
              {CADENCES.map(c => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </AnimatedSelect>
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Department
            <AnimatedSelect
              className={selectClass}
              value={department}
              onChange={e => setDepartment(e.target.value)}
            >
              <option value="">Across the team</option>
              {departments.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </AnimatedSelect>
          </label>
        </div>
        {m.fromCalendar ? (
          <p className="text-xs text-muted-foreground">
            It comes from the team's calendar. What you set here stays; the
            calendar only adds new dates and new people.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
          {m.title}
        </h1>
        {m.purpose ? (
          <p className="mt-1 text-[15px] leading-relaxed" dir="auto">
            {m.purpose}
          </p>
        ) : (
          <p className="mt-1 text-[15px] italic text-muted-foreground">
            No purpose written yet. Every meeting needs one sentence on what it
            is for
            {page.canManage
              ? "; write it with Edit."
              : "; ask a host to add it."}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {[
            m.cadence ? m.cadence[0].toUpperCase() + m.cadence.slice(1) : null,
            m.department,
          ]
            .filter(Boolean)
            .join(", ") || "No cadence set"}
        </p>
      </div>
      {page.canManage ? (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : null}
    </header>
  );
}

// --- the agenda ----------------------------------------------------------------

/** One ring per meeting the item has been carried through; amber from three. */
function Carried({ n }: { n: number }) {
  if (!n) return null;
  const shown = Math.min(n, 5);
  const stuck = n >= 3;
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Carried through ${n} ${n === 1 ? "meeting" : "meetings"}`}
    >
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: shown }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: identical rings
            key={i}
            className="size-2 rounded-full border-[1.5px]"
            style={{
              borderColor: stuck ? "#c98a00" : "var(--muted-foreground)",
            }}
          />
        ))}
      </span>
      <span
        className="text-[11px] tabular-nums"
        style={{ color: stuck ? "#c98a00" : undefined }}
      >
        {n > 5 ? `${n}×` : null}
        <span className="sr-only">
          carried through {n} {n === 1 ? "meeting" : "meetings"}
        </span>
      </span>
    </span>
  );
}

function AgendaRow({
  item,
  people,
  first,
  last,
  onDone,
  onDrop,
  onMove,
  onText,
  onOwner,
}: {
  item: Item;
  people: Person[];
  first: boolean;
  last: boolean;
  onDone: () => Promise<void>;
  onDrop: () => Promise<void>;
  onMove: (dir: "up" | "down") => Promise<void>;
  onText: (text: string) => Promise<void>;
  onOwner: (ownerId: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // The page shows the error.
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="group flex gap-3 px-4 py-3 sm:px-5">
      <button
        type="button"
        aria-label={`Mark "${item.text}" done`}
        disabled={busy}
        onClick={() => run(onDone)}
        className="group/done -my-1.5 -ml-2 flex size-9 shrink-0 self-start items-center justify-center rounded-full disabled:opacity-50"
      >
        <span className="flex size-5 items-center justify-center rounded-full border-2 border-muted-foreground/40 text-transparent transition-colors group-hover/done:border-primary group-hover/done:text-primary group-focus-visible/done:border-primary">
          <Check className="size-3" aria-hidden />
        </span>
      </button>
      <div className="grid min-w-0 flex-1 gap-1.5">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={async e => {
              e.preventDefault();
              await run(async () => {
                await onText(text);
                setEditing(false);
              });
            }}
          >
            <Input
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  setText(item.text);
                  setEditing(false);
                }
              }}
              dir="auto"
            />
            <Button type="submit" size="sm" disabled={busy}>
              Save
            </Button>
          </form>
        ) : (
          <button
            type="button"
            className="text-left text-sm leading-relaxed hover:underline hover:decoration-muted-foreground/40 hover:underline-offset-4"
            onClick={() => {
              setText(item.text);
              setEditing(true);
            }}
            title="Reword it"
            dir="auto"
          >
            {item.text}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <AnimatedSelect
            className="h-7 max-w-[11rem] rounded-md border border-input bg-transparent px-2 text-xs"
            aria-label="Who owns it"
            value={item.ownerId ?? ""}
            disabled={busy}
            onChange={e => run(() => onOwner(e.target.value || null))}
          >
            <option value="">No owner</option>
            <PeopleOptions people={people} />
          </AnimatedSelect>
          <Carried n={item.carried} />
          {item.carried ? (
            <span>since {dayName(item.addedAt.slice(0, 10))}</span>
          ) : null}
          <span className="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <button
              type="button"
              aria-label="Move up"
              disabled={busy || first}
              onClick={() => run(() => onMove("up"))}
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <ArrowUp className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={busy || last}
              onClick={() => run(() => onMove("down"))}
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <ArrowDown className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Drop it from the agenda"
              title="Drop it: it will not be covered"
              disabled={busy}
              onClick={() => run(onDrop)}
              className="rounded p-1 hover:bg-muted"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

function ClosedRow({
  item,
  owner,
  onReopen,
}: {
  item: Item;
  owner: Person | undefined;
  onReopen: () => Promise<void>;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={`min-w-0 flex-1 ${item.status === "dropped" ? "text-muted-foreground line-through" : ""}`}
        dir="auto"
      >
        {item.status === "done" ? "✓ " : ""}
        {item.text}
        {owner ? (
          <span className="text-muted-foreground">
            {" "}
            ({owner.name.split(" ")[0]})
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => void onReopen().catch(() => null)}
      >
        Reopen
      </button>
    </li>
  );
}

function AddItem({
  people,
  onAdd,
}: {
  people: Person[];
  onAdd: (text: string, ownerId: string | null) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:px-5"
      onSubmit={async e => {
        e.preventDefault();
        if (text.trim().length < 3) return;
        setBusy(true);
        try {
          await onAdd(text, owner || null);
          setText("");
        } catch {
          // The page shows the error.
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add something this meeting has to cover"
        aria-label="New agenda item"
        dir="auto"
      />
      <div className="flex gap-2">
        <AnimatedSelect
          className={`${selectClass} sm:w-40`}
          aria-label="Who owns it"
          value={owner}
          onChange={e => setOwner(e.target.value)}
        >
          <option value="">No owner</option>
          <PeopleOptions people={people} />
        </AnimatedSelect>
        <Button
          type="submit"
          size="sm"
          disabled={busy || text.trim().length < 3}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Add
        </Button>
      </div>
    </form>
  );
}

// --- the side panel --------------------------------------------------------------

function When({
  page,
  next,
  onAdd,
}: {
  page: Page;
  next: Sitting | null;
  onAdd: (date: string) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Next meeting</h2>
      <p className="mt-1 text-lg font-semibold tracking-tight">
        {next
          ? next.onDate === page.today
            ? "Today"
            : dayName(next.onDate)
          : "No date yet"}
      </p>
      <p className="text-xs text-muted-foreground">
        {page.meeting.fromCalendar
          ? "Dates come from the team's calendar every hour."
          : "This meeting is not on the calendar; its hosts set the dates here."}
      </p>
      {page.canManage ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async e => {
            e.preventDefault();
            if (!date) return;
            setBusy(true);
            try {
              await onAdd(date);
              setDate("");
            } catch {
              // The page shows the error.
            } finally {
              setBusy(false);
            }
          }}
        >
          <DateInput
            value={date}
            min={page.today}
            onChange={e => setDate(e.target.value)}
            aria-label="Add a date"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy || !date}
          >
            Add the date
          </Button>
        </form>
      ) : null}
    </section>
  );
}

const PART_LABEL: Record<string, string> = {
  host: "Hosts",
  required: "In the meeting",
  optional: "Optional",
};

function People({
  page,
  onPart,
}: {
  page: Page;
  onPart: (
    personId: string,
    part: "host" | "required" | "optional" | "off",
  ) => Promise<void>;
}) {
  const byId = peopleById(page.people);
  const [adding, setAdding] = useState("");
  const [addPart, setAddPart] = useState<"required" | "optional" | "host">(
    "required",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const members = new Set(page.members.map(x => x.personId));
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch {
      // The page shows the error.
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">
        Who is in it{" "}
        <span className="font-normal text-muted-foreground">
          {page.members.length}
        </span>
      </h2>
      {(["host", "required", "optional"] as const).map(part => {
        const list = page.members.filter(x => x.part === part);
        if (!list.length) return null;
        return (
          <div key={part} className="mt-3">
            <p className="text-xs text-muted-foreground">{PART_LABEL[part]}</p>
            <ul className="mt-1.5 grid gap-2">
              {list.map(x => {
                const p = byId.get(x.personId);
                return (
                  <li key={x.personId} className="flex items-center gap-2.5">
                    <Initials
                      person={p}
                      tone={part === "host" ? "host" : "muted"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" dir="auto">
                        {p?.name ?? x.personId}
                        {x.personId === page.me.personId ? " (you)" : ""}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p?.role, p?.department].filter(Boolean).join(", ")}
                      </span>
                    </span>
                    {page.canManage ? (
                      <AnimatedSelect
                        className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
                        aria-label={`${p?.name ?? "Their"} part`}
                        value={x.part}
                        disabled={busy === x.personId}
                        onChange={e =>
                          run(x.personId, () =>
                            onPart(
                              x.personId,
                              e.target.value as
                                | "host"
                                | "required"
                                | "optional"
                                | "off",
                            ),
                          )
                        }
                      >
                        <option value="host">Host</option>
                        <option value="required">In it</option>
                        <option value="optional">Optional</option>
                        <option value="off">Take off</option>
                      </AnimatedSelect>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {page.canManage ? (
        <form
          className="mt-4 grid gap-2 border-t pt-3"
          onSubmit={async e => {
            e.preventDefault();
            if (!adding) return;
            await run("add", () => onPart(adding, addPart));
            setAdding("");
          }}
        >
          <p className="text-xs text-muted-foreground">Add someone</p>
          <AnimatedSelect
            className={selectClass}
            value={adding}
            onChange={e => setAdding(e.target.value)}
            aria-label="Who to add"
          >
            <option value="">Pick a person</option>
            <PeopleOptions people={page.people} exclude={members} />
          </AnimatedSelect>
          <div className="flex gap-2">
            <AnimatedSelect
              className={selectClass}
              value={addPart}
              onChange={e =>
                setAddPart(e.target.value as "required" | "optional" | "host")
              }
              aria-label="As"
            >
              <option value="required">In the meeting</option>
              <option value="optional">Optional</option>
              <option value="host">Host</option>
            </AnimatedSelect>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!adding || busy === "add"}
            >
              Add them
            </Button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            This adds them here. To have it on their calendar too, add them to
            the invite in Google Calendar; the calendar never takes anyone off
            who was set here.
          </p>
        </form>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Its hosts change who is in it.
        </p>
      )}
    </section>
  );
}

function Past({
  past,
  items,
  onOpenNotes,
}: {
  past: Sitting[];
  items: Item[];
  onOpenNotes: (sittingId: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (!past.length) return null;
  const shown = all ? past : past.slice(0, 5);
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Past meetings</h2>
      <ul className="mt-2 grid gap-2.5">
        {shown.map(s => {
          const closed = items.filter(
            i => i.sittingId === s.id && i.status !== "open",
          );
          const first = s.notes.trim().split("\n")[0];
          return (
            <li key={s.id} className="grid gap-0.5">
              <button
                type="button"
                onClick={() => onOpenNotes(s.id)}
                className="flex items-baseline justify-between gap-2 text-left text-sm hover:underline hover:underline-offset-4"
              >
                <span className="font-medium">{dayName(s.onDate)}</span>
                <span className="text-xs text-muted-foreground">
                  {closed.length
                    ? `${closed.filter(i => i.status === "done").length} finished`
                    : ""}
                </span>
              </button>
              <span
                className="line-clamp-2 text-xs text-muted-foreground"
                dir="auto"
              >
                {first || "No notes written."}
              </span>
            </li>
          );
        })}
      </ul>
      {past.length > 5 ? (
        <button
          type="button"
          onClick={() => setAll(a => !a)}
          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {all ? "Show the last five" : `Show all ${past.length}`}
        </button>
      ) : null}
    </section>
  );
}

function Changes({ page }: { page: Page }) {
  if (!page.changes.length) return null;
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">What changed</h2>
      <ul className="mt-2 grid gap-1.5 text-xs">
        {page.changes.slice(0, 10).map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a log, never reordered
          <li key={i} className="leading-relaxed">
            <span className="text-muted-foreground">
              {when(c.at, page.today)}:{" "}
            </span>
            {shortName(c.by)} {c.what}
          </li>
        ))}
      </ul>
    </section>
  );
}
