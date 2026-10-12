import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  History,
  UserRound,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { parseDosDonts } from "@/components/DosDonts";
import { Chip, Dot, Kicker } from "@/components/kit";
import {
  type Brief,
  type BriefInput,
  type BriefLine,
  buildBrief,
  type Digest,
} from "@/lib/clientBrief";
import { readClientDigests, type Timeline } from "@/lib/csmCalls";
import { diagnose } from "@/lib/csmDiagnosis";
import { cn } from "@/lib/utils";

/**
 * "Before the call": everything about one client in short lines, so the CSM
 * walks into the call knowing what was said, what was promised, what changed
 * and what to raise. Design (docs/DESIGN.md, the cockpit's own system): one
 * featured card with the teal hairline; the signature is the "Raise on this
 * call" rail, the one place the teal rule appears. Quoted source text folds at
 * two lines with its source and day under it; a tap opens the rest, and each
 * group says how to see everything.
 */

type Row = Record<string, any>;
type CardNotes = { digests: Digest[]; teamActors: string[] };

/** Read the client's ClickUp card notes once per client. */
function useCardNotes(client: SupabaseClient | null, taskId: string) {
  const [notes, setNotes] = useState<CardNotes | null | undefined>(undefined);
  useEffect(() => {
    setNotes(undefined);
    if (!client || !taskId) return;
    let live = true;
    readClientDigests(client, taskId)
      .then(d => live && setNotes(d))
      .catch(() => live && setNotes(null));
    return () => {
      live = false;
    };
  }, [client, taskId]);
  return notes;
}

/** Text that starts in Arabic reads right to left, dot and all. */
const RTL = /^[\s\p{P}\d]*[؀-ۿ]/u;

function Line({ line, clamp = true }: { line: BriefLine; clamp?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  // "Read all" only when two lines really hide something at this width.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open || !clamp) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, clamp]);
  const rtl = !line.label && RTL.test(line.text);
  const source = `${line.source}${line.day ? ` · ${line.day}` : ""}`;
  return (
    <li className="flex gap-2.5" dir={rtl ? "rtl" : undefined}>
      <span className="mt-[9px]">
        <Dot tone={line.risk ? "warn" : "neutral"} />
      </span>
      <div className="min-w-0 flex-1">
        <span
          ref={ref}
          className={cn(
            "block whitespace-pre-line text-sm leading-6",
            clamp && !open && "line-clamp-2",
          )}
        >
          {line.label ? (
            <span className="text-muted-foreground">{line.label}: </span>
          ) : null}
          <bdi dir="auto">{line.text}</bdi>
        </span>
        {cut || open ? (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            {open ? "Show less" : "Read all"}
          </button>
        ) : null}
        <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
          {line.href ? (
            <a
              href={line.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-foreground"
            >
              {source}
              <ArrowUpRight aria-hidden className="size-3" />
            </a>
          ) : (
            source
          )}
        </span>
      </div>
    </li>
  );
}

/** A group of lines: the first few, then "Show all N" in place. */
function Lines({
  lines,
  first = 4,
  noun = "lines",
  clamp = true,
}: {
  lines: BriefLine[];
  first?: number;
  noun?: string;
  /** Quoted source text folds at two lines; the brief's own sentences do not. */
  clamp?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const shown = all ? lines : lines.slice(0, first);
  return (
    <>
      <ul className="space-y-3">
        {shown.map((l, i) => (
          <Line key={`${i}-${l.text.slice(0, 24)}`} line={l} clamp={clamp} />
        ))}
      </ul>
      {lines.length > first ? (
        <button
          type="button"
          onClick={() => setAll(v => !v)}
          className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
        >
          {all ? "Show fewer" : `Show all ${lines.length} ${noun}`}
        </button>
      ) : null}
    </>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** A labelled list inside a group: "We said we would", "The team said". */
function Part({
  title,
  lines,
  first = 3,
  noun,
}: {
  title: string;
  lines: BriefLine[];
  first?: number;
  noun: string;
}) {
  if (!lines.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{title}</p>
      <Lines lines={lines} first={first} noun={noun} />
    </div>
  );
}

function Group({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <Kicker>{title}</Kicker>
        {action}
      </div>
      {children}
    </section>
  );
}

function Strip({ b }: { b: Brief }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      {b.contact ? (
        <span
          className="inline-flex items-center gap-1.5"
          title="The name on their newest booking"
        >
          <UserRound aria-hidden className="size-3.5 text-muted-foreground" />
          <span>
            With <bdi>{b.contact}</bdi>
          </span>
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <History aria-hidden className="size-3.5 text-muted-foreground" />
        {b.lastCall ? (
          <span>
            {`Last call ${b.lastCall.day}`}
            <span className="text-muted-foreground">
              {b.lastCall.ago === 0
                ? ", today"
                : b.lastCall.ago === 1
                  ? ", yesterday"
                  : `, ${b.lastCall.ago} days ago`}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">No call on record</span>
        )}
      </span>
      {b.mode === "stopped" || b.mode === "paused" ? null : (
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock aria-hidden className="size-3.5 text-primary" />
          {b.nextCall ? (
            <>
              {b.nextCall.kind}, {b.nextCall.when}
            </>
          ) : (
            <span className="text-muted-foreground">No call booked</span>
          )}
        </span>
      )}
      {b.priority ? (
        <span className="text-muted-foreground">Priority {b.priority}</span>
      ) : null}
    </div>
  );
}

export function ClientBrief({
  client,
  row,
  timeline,
  profile,
  error,
  onOpenCalls,
  otherClients,
  notes: given,
  whatsapp,
}: {
  client: SupabaseClient | null;
  /** The client's row from the CSM snapshot. */
  row: Row;
  timeline: Timeline | null;
  /** The client's profile (numbers, do's and don'ts), when loaded. */
  profile?: Row | null;
  /** Why the call history could not be read, when it could not. */
  error?: string | null;
  onOpenCalls?: () => void;
  /** Every client's name, so a team roll-up keeps only this client's part. */
  otherClients?: string[];
  /** Stored card notes instead of a read (the dev harness). */
  notes?: CardNotes | null;
  /** The client's linked WhatsApp chats for the day, once read. */
  whatsapp?: BriefInput["whatsapp"];
}) {
  const taskId = String(row.taskId ?? "");
  const read = useCardNotes(given === undefined ? client : null, taskId);
  const notes = given === undefined ? read : given;
  const diagnosis = useMemo(() => {
    if (!profile?.performance) return null;
    try {
      return diagnose(profile);
    } catch {
      return null;
    }
  }, [profile]);
  const b = useMemo(
    () =>
      timeline
        ? buildBrief({
            now: Date.now(),
            client: row,
            timeline,
            digests: notes === undefined ? [] : (notes?.digests ?? null),
            teamActors: notes?.teamActors,
            diagnosis,
            otherClients,
            whatsapp,
          })
        : null,
    [row, timeline, notes, diagnosis, otherClients, whatsapp],
  );
  const dosDonts = useMemo(
    () => parseDosDonts(profile?.dosDonts as string | undefined),
    [profile?.dosDonts],
  );

  if (!b)
    return (
      <section className="rounded-2xl border border-primary/30 bg-card p-4 sm:p-6">
        <h2 className="text-[15px] font-semibold">Before the call</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error
            ? `The call history could not be read, so there is no brief yet: ${error}. Reload the page; if it stays, report it with the button above.`
            : "Reading their calls, forms and changes…"}
        </p>
      </section>
    );

  const asLines = (items: string[]): BriefLine[] =>
    items.map(text => ({ text, source: "ClickUp card" }));
  const dos = asLines(dosDonts.find(s => s.tone === "do")?.items ?? []);
  const donts = asLines(dosDonts.find(s => s.tone === "dont")?.items ?? []);
  const profileText = String(profile?.profileText ?? "").trim();
  const live = b.mode === "live" || b.mode === "onboarding";

  const who = (
    <Group title="Who they are">
      {b.who.length ? (
        <Lines lines={b.who} first={3} noun="answers" />
      ) : (
        <Empty>No onboarding or kickoff form on record for this client.</Empty>
      )}
      <Part title="Do" lines={dos} noun="do's" />
      <Part title="Don't" lines={donts} noun="don'ts" />
      {profileText ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">Their profile</p>
          <ul>
            <Line line={{ text: profileText, source: "Client profile" }} />
          </ul>
        </div>
      ) : null}
    </Group>
  );

  return (
    <section
      aria-label={`Before the call with ${b.clientName}`}
      className="space-y-6 rounded-2xl border border-primary/30 bg-card p-4 sm:p-6"
    >
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Before the call</h2>
          {b.defcon ? (
            b.defcon.old ? (
              <Chip
                tone="neutral"
                title="From an older 1-1 form: ask how they feel now"
              >
                {b.defcon.value} as of {b.defcon.day}
              </Chip>
            ) : (
              <Chip
                tone={b.defcon.risk ? "warn" : "good"}
                title={`From the 1-1 form on ${b.defcon.day}`}
              >
                {b.defcon.value}
              </Chip>
            )
          ) : null}
        </div>
        <Strip b={b} />
      </header>

      {b.quiet ? (
        <>
          <p className="text-sm text-muted-foreground">{b.quiet}</p>
          {b.who.length || dos.length || donts.length ? who : null}
        </>
      ) : (
        <>
          <section className="space-y-3 border-l-2 border-primary pl-4">
            <Kicker className="text-primary">
              {live ? "Raise on this call" : "Where it stands"}
            </Kicker>
            {b.raise.length ? (
              <Lines lines={b.raise} first={6} noun="points" clamp={false} />
            ) : (
              <Empty>
                Nothing needs raising: no open risk, promise or change on
                record.
              </Empty>
            )}
          </section>

          <div className="@container">
            <div className="grid gap-6 @2xl:grid-cols-2">
              <div className="space-y-6">
                <Group
                  title={b.call.heading}
                  action={
                    onOpenCalls ? (
                      <button
                        type="button"
                        onClick={onOpenCalls}
                        className="inline-flex shrink-0 items-center gap-0.5 text-xs text-primary underline-offset-4 hover:underline"
                      >
                        Every call
                        <ChevronRight aria-hidden className="size-3.5" />
                      </button>
                    ) : null
                  }
                >
                  {b.call.empty && b.call.lines.length ? (
                    <p className="-mt-1 text-xs text-muted-foreground">
                      {b.call.empty}
                    </p>
                  ) : null}
                  {b.call.lines.length ? (
                    <Lines lines={b.call.lines} first={4} noun="points" />
                  ) : (
                    <Empty>
                      {b.call.empty ?? "No notes from the last call."}
                    </Empty>
                  )}
                </Group>

                {live ? (
                  <Group title="Promises">
                    {b.promises.from ? (
                      <p className="-mt-1 text-xs text-muted-foreground">
                        {b.promises.from}
                      </p>
                    ) : null}
                    <Part
                      title="We said we would"
                      lines={b.promises.ours}
                      noun="promises"
                    />
                    <Part
                      title="They said they would"
                      lines={b.promises.theirs}
                      noun="promises"
                    />
                    <Part
                      title="Next steps from the call"
                      lines={b.promises.steps}
                      noun="steps"
                    />
                    <Part
                      title="Still open"
                      lines={b.promises.open}
                      noun="loose ends"
                    />
                    {b.promises.empty ? (
                      <Empty>{b.promises.empty}</Empty>
                    ) : null}
                  </Group>
                ) : null}
              </div>

              <div className="space-y-6">
                <Group title={b.since.heading}>
                  {b.since.stale ? (
                    <p className="flex gap-2 text-xs text-muted-foreground">
                      <span className="mt-1.5">
                        <Dot tone="warn" />
                      </span>
                      {b.since.stale}
                    </p>
                  ) : null}
                  {b.since.changes.length ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium">On their ads</p>
                      <Lines lines={b.since.changes} first={3} noun="days" />
                      {b.since.capped ? (
                        <p className="text-xs text-muted-foreground">
                          {b.since.capped}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <Part
                    title="On WhatsApp"
                    lines={b.since.chats}
                    noun="messages"
                  />
                  <Part title="Notes" lines={b.since.notes} noun="notes" />
                  <Part
                    title="The team said"
                    lines={b.since.team}
                    first={2}
                    noun="mentions"
                  />
                  {b.since.empty ? <Empty>{b.since.empty}</Empty> : null}
                </Group>

                {who}
              </div>
            </div>
          </div>
        </>
      )}

      {b.gaps.length ? (
        <ul className="space-y-1 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          {b.gaps.map(g => (
            <li key={g} className="flex gap-2">
              <span className="mt-1.5">
                <Dot tone="warn" />
              </span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
