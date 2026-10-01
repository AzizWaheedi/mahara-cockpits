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
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useParams } from "react-router";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageVisible } from "@/lib/usePageVisible";
import { api } from "../../../convex/_generated/api";
import type {
  Item,
  MeetingPage as Page,
  Person,
  Sitting,
} from "../../../convex/teamPage";
import { ClientSuccessPanel } from "./ClientSuccessPanel";
import { MeetingLinks } from "./MeetingLinks";
import { PipelineBoard, PipelineStrip } from "./Pipeline";
import { RunOfShow } from "./RunOfShow";
import {
  dayName,
  errorText,
  Field,
  peopleById,
  peopleOptions,
  type SaveResult,
  SharedText,
  selectClass,
  shortName,
  when,
} from "./teamKit";
import { Wheels } from "./Wheels";
import { WhenAndWho } from "./WhenAndWho";

// The editor is the page's heaviest part: it loads with the doc, not before.
const RichDoc = lazy(() => import("./RichDoc"));

/**
 * One meeting: what it is for, when it meets and who is in it (on Google
 * Calendar too), its run of show, the agenda for the next time it meets,
 * its wheels, the notes of each sitting, and its living doc.
 *
 * The agenda is the point. An item stays open until somebody finishes or
 * drops it, so the next meeting opens with what the last one did not get
 * to, and each open item shows how many meetings it has already been
 * carried through: one ring per meeting, orange from the third. Closing an
 * item stamps the meeting it was closed in, which is what "Finished last
 * time" reads back.
 */

export const CADENCES = [
  "daily",
  "three times a week",
  "twice a week",
  "weekly",
  "every two weeks",
  "monthly",
  "quarterly",
  "as needed",
];

export function MeetingPage() {
  const { id = "" } = useParams();
  const load = useAction(api.team.meeting);
  const saveMeeting = useAction(api.teamCalendar.saveMeeting);
  const saveDoc = useAction(api.team.saveDoc);
  const saveLinks = useAction(api.team.saveLinks);
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
    const live = byDate.filter(s => s.status !== "cancelled");
    const next = live.find(s => s.onDate >= today) ?? null;
    const past = byDate.filter(s => s.onDate < today && !s.virtual).reverse();
    const todays = live.find(s => s.onDate === today) ?? null;
    // Notes open on today's meeting, else the last one (to write it up),
    // else the next one.
    const defaultNotes =
      todays ?? past.find(s => s.status !== "cancelled") ?? next;
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
    <div className="mx-auto grid w-full max-w-6xl gap-6">
      <BackLink />
      <Header
        page={page}
        onSave={fields => act(() => saveMeeting({ id: m.id, ...fields }))}
      />
      <MeetingLinks
        links={m.links}
        onSave={links => act(() => saveLinks({ meetingId: m.id, links }))}
      />
      <WhenAndWho page={page} act={act} />
      {m.embed ? <ClientSuccessPanel meetingId={m.id} embed={m.embed} /> : null}
      {page.strip ? <PipelineStrip strip={page.strip} /> : null}
      {page.creative ? (
        <PipelineBoard page={page} act={act} onError={setError} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:items-start">
        <div className="grid min-w-0 gap-6">
          <RunOfShow
            page={page}
            act={act}
            day={notesSitting?.onDate ?? agendaFor?.onDate ?? null}
          />
          <section className="rounded-2xl border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-5">
              <h2 className="text-[15px] font-semibold">
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
                Add what this meeting has to cover this time. Anything not
                finished stays here for the next one.
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

          <Wheels
            page={page}
            act={act}
            sitting={notesSitting}
            onPage={setPage}
            onError={setError}
          />

          <section className="rounded-2xl border bg-card p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">
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
                        {s.status === "cancelled" ? " (cancelled)" : ""}
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
                {page.canManage
                  ? " Give it days under When and who, or add a one-off sitting."
                  : ""}
              </p>
            )}
          </section>
        </div>

        <aside className="grid min-w-0 gap-6">
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
      <Suspense
        fallback={
          <section className="rounded-2xl border bg-card p-4 sm:p-6">
            <h2 className="text-[15px] font-semibold">The doc</h2>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Opening
              the doc
            </p>
          </section>
        }
      >
        <RichDoc
          meetingId={m.id}
          value={m.doc}
          version={m.docVersion}
          savedBy={m.docBy}
          savedAt={m.docAt}
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
      </Suspense>
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
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-6"
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
              {(CADENCES.includes(cadence)
                ? CADENCES
                : [cadence, ...CADENCES]
              ).map(c => (
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
            A new name or purpose goes on the Google Calendar event too, and
            everyone invited gets Google's update.
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

/** One ring per meeting the item has been carried through; orange from three. */
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
              borderColor: stuck ? "var(--warning)" : "var(--muted-foreground)",
            }}
          />
        ))}
      </span>
      <span
        className="text-[11px] tabular-nums"
        style={{ color: stuck ? "var(--warning)" : undefined }}
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
            {peopleOptions(people)}
          </AnimatedSelect>
          <Carried n={item.carried} />
          {item.carried ? (
            <span>since {dayName(item.addedAt.slice(0, 10))}</span>
          ) : null}
          {/* Shown on hover only where there is a mouse; a finger always
              sees them, at a size a finger can hit. */}
          <span className="ml-auto flex items-center gap-1 opacity-100 transition-opacity pointer-fine:sm:opacity-0 pointer-fine:sm:group-focus-within:opacity-100 pointer-fine:sm:group-hover:opacity-100">
            <button
              type="button"
              aria-label="Move up"
              disabled={busy || first}
              onClick={() => run(() => onMove("up"))}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30 pointer-coarse:size-10"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={busy || last}
              onClick={() => run(() => onMove("down"))}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30 pointer-coarse:size-10"
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Drop it from the agenda"
              title="Drop it: it will not be covered"
              disabled={busy}
              onClick={() => run(onDrop)}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-muted pointer-coarse:size-10"
            >
              <X className="size-4" aria-hidden />
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
        {item.status === "done" ? (
          <Check
            className="mr-1 inline size-3.5 align-[-2px] txt-good"
            aria-label="Done"
          />
        ) : null}
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
          className={`${selectClass} min-w-[8.5rem] sm:w-44`}
          aria-label="Who owns it"
          value={owner}
          onChange={e => setOwner(e.target.value)}
        >
          <option value="">No owner</option>
          {peopleOptions(people)}
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
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
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
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <h2 className="text-sm font-semibold">What changed</h2>
      <ul className="mt-2 grid gap-1.5 text-xs">
        {page.changes.slice(0, 10).map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a log, never reordered
          <li key={i} className="leading-relaxed">
            <span className="text-muted-foreground">{when(c.at)}: </span>
            {shortName(c.by)} {c.what}
          </li>
        ))}
      </ul>
    </section>
  );
}
