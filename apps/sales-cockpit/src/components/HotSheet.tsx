import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  Flame,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { CLIENT_NOTE, isClient } from "../lib/clients";
import {
  type Loaded,
  readAll,
  useLeadSearch,
  useNow,
  useQuery,
  useTeam,
} from "../lib/data";
import { classLabel, isArabic, plainStage, when } from "../lib/format";
import { ghlContactUrl } from "../lib/highlevel";
import {
  DEFAULT_SORT,
  dueOf,
  followUpWords,
  type HotRow,
  type HotStatus,
  heatOf,
  hotCounts,
  isOpen,
  keepOrder,
  lastFollowUp,
  mergeHot,
  nextSort,
  type Sort,
  type SortKey,
  sortHot,
  statusOf,
  statusWord,
  TOUCH_DAYS,
  type Touches,
  touchesFrom,
} from "../lib/hot";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Lead, Me } from "../lib/types";
import {
  AmountEdit,
  FailedSaves,
  HeatPick,
  type HotEdits,
  type HotField,
  LastShown,
  NextAsk,
  NextShown,
  OwnerPick,
  phaseClass,
  SaveMark,
  StatusPick,
  TextEdit,
  useHotEdits,
  WhenEdit,
} from "./HotCells";
import {
  button,
  EmptyState,
  Failed,
  field,
  Parts,
  Reading,
  SectionCard,
  Segmented,
  SourceNote,
} from "./kit";

/**
 * The hot list as a sheet (Aziz, 2026-09-27: "the same way a spreadsheet is
 * for last follow-up, next follow-up"). One row per hot lead, edited in its
 * cells; each change is saved through sales-api on Enter or on leaving the
 * cell, with its own saved or failed mark. It opens on the next follow-up,
 * overdue first. "Followed up" marks the last follow-up as now and asks for
 * the next one: the daily loop in two taps.
 */

export interface LeadName {
  contact_id: string;
  name: string | null;
  phone8: string | null;
}

const DAY = 86_400_000;

/** A read for many ids, 150 at a time: one address holding them all is refused. */
async function inBatches<T>(
  ids: string[],
  read: (batch: string[]) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await read(ids.slice(i, i + 150));
    if (error) return { data: null, error };
    out.push(...(data ?? []));
  }
  return { data: out, error: null };
}

/** The rows on the hot list: one seat's, or the whole team's. */
function useHotRows(
  scope: "mine" | "team",
  email: string,
  nonce: number,
): Loaded<HotRow[]> {
  return useQuery<HotRow[]>(
    () => {
      let q = supabase
        .from("cockpit_sales_hot")
        .select("*")
        .is("removed_at", null)
        .order("next_at", { ascending: true, nullsFirst: false })
        .limit(500);
      if (scope === "mine") q = q.eq("owner_email", email);
      return q;
    },
    [scope, email, nonce],
    60_000,
  );
}

/** The names and last eight digits of the leads on the list. */
function useLeadNames(ids: string[], nonce: number): Loaded<LeadName[]> {
  const key = ids.join(",");
  return useQuery<LeadName[]>(
    () =>
      inBatches<LeadName>(key ? key.split(",") : [], batch =>
        supabase
          .from("cockpit_sales_leads")
          .select("contact_id,name,phone8")
          .in("contact_id", batch),
      ),
    [key, nonce],
  );
}

/**
 * Each lead's last outbound call (Maqsam, answered or not) and last WhatsApp
 * from us in the last TOUCH_DAYS days, for Last follow-up. Null leads: not
 * known yet, so nothing is read.
 */
export function useHotTouches(
  leads: LeadName[] | null,
  nonce = 0,
): Loaded<Map<string, Touches>> {
  // "" only while the leads are not known; an empty list reads as "+".
  const key = leads
    ? `+${leads
        .map(l => `${l.contact_id}:${l.phone8 ?? ""}`)
        .sort()
        .join(",")}`
    : "";
  return useQuery<Map<string, Touches>>(
    async () => {
      if (!leads) return { data: null, error: null };
      if (!leads.length) return { data: new Map(), error: null };
      const ids = leads.map(l => l.contact_id);
      const phones = [
        ...new Set(leads.map(l => l.phone8).filter((p): p is string => !!p)),
      ];
      const since = new Date(Date.now() - TOUCH_DAYS * DAY).toISOString();
      const cols = "contact_id,lead_phone8,occurred_at,state,direction";
      const [linked, unlinked, inbox, sent] = await Promise.all([
        inBatches(ids, batch =>
          readAll((from, to) =>
            supabase
              .from("cockpit_sales_dials")
              .select(cols)
              .eq("direction", "outbound")
              .in("contact_id", batch)
              .gte("occurred_at", since)
              .order("occurred_at", { ascending: false })
              .order("call_id", { ascending: true })
              .range(from, to),
          ),
        ),
        // Calls not linked to a lead yet, by the last eight digits.
        inBatches(phones, batch =>
          readAll((from, to) =>
            supabase
              .from("cockpit_sales_dials")
              .select(cols)
              .eq("direction", "outbound")
              .is("contact_id", null)
              .in("lead_phone8", batch)
              .gte("occurred_at", since)
              .order("occurred_at", { ascending: false })
              .order("call_id", { ascending: true })
              .range(from, to),
          ),
        ),
        inBatches(ids, batch =>
          supabase
            .from("cockpit_sales_inbox")
            .select("contact_id,last_message_at,last_direction,last_type")
            .in("contact_id", batch)
            .limit(1000),
        ),
        inBatches(ids, batch =>
          supabase
            .from("cockpit_sales_messages")
            .select("contact_id,created_at,channel,state")
            .eq("channel", "whatsapp")
            .in("state", ["sent", "delivered", "read"])
            .in("contact_id", batch)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(1000),
        ),
      ]);
      const failed = [linked, unlinked, inbox, sent].find(r => r.error);
      if (failed?.error) return { data: null, error: failed.error };
      return {
        data: touchesFrom(
          leads,
          [...(linked.data ?? []), ...(unlinked.data ?? [])],
          inbox.data ?? [],
          sent.data ?? [],
        ),
        error: null,
      };
    },
    [key, nonce],
    60_000,
  );
}

interface Col {
  key: SortKey;
  label: string;
  /** The column's width; the two without one share what is left. */
  width?: string;
  right?: boolean;
}

const COLS: Col[] = [
  { key: "name", label: "Name", width: "w-[8.5rem] sm:w-[10.5rem]" },
  { key: "heat", label: "Type", width: "w-[7rem]" },
  {
    key: "status",
    label: "Status",
    // Touch screens set pickers in 16px, so "Nurturing" needs more room.
    width: "w-[7rem] pointer-coarse:w-[8.25rem]",
  },
  { key: "objection", label: "Last objection" },
  { key: "amount", label: "Amount", width: "w-[5.5rem]", right: true },
  { key: "last", label: "Last follow-up", width: "w-[8.75rem]" },
  { key: "next", label: "Next follow-up", width: "w-[8.75rem]" },
  { key: "note", label: "Notes" },
];
const OWNER: Col = { key: "owner", label: "Owner", width: "w-[7rem]" };

// Opaque, so the pinned Name column hides what scrolls under it.
const ROW_PLAIN =
  "[--row:var(--card)] hover:[--row:color-mix(in_oklch,var(--foreground)_4%,var(--card))]";
const ROW_OVERDUE =
  "[--row:color-mix(in_oklch,var(--destructive)_7%,var(--card))]";

export function HotSheet({
  me,
  scope,
  nonce,
}: {
  me: Me;
  scope: "mine" | "team";
  /** Bumped by the page's refresh button. */
  nonce: number;
}) {
  const email = String(me.email ?? "");
  const team = scope === "team";
  const hot = useHotRows(scope, email, nonce);
  // Rows as saves here answered them, until a read made after them lands.
  const [saved, setSaved] = useState<Record<string, HotRow>>({});
  const onSaved = useCallback(
    (r: HotRow) => setSaved(s => ({ ...s, [r.contact_id]: r })),
    [],
  );
  const edits = useHotEdits(onSaved);
  // Leads added here, named before the next read of names.
  const [added, setAdded] = useState<Record<string, LeadName>>({});
  const rows = useMemo(
    () => mergeHot(hot.data, saved, team ? null : email),
    [hot.data, saved, team, email],
  );

  const ids = useMemo(() => rows.map(r => r.contact_id).sort(), [rows]);
  const names = useLeadNames(ids, nonce);
  const leadBy = useMemo(() => {
    const m = new Map<string, LeadName>(Object.entries(added));
    for (const l of names.data ?? []) m.set(l.contact_id, l);
    return m;
  }, [names.data, added]);
  // Once names are in (or failed, and then without the digits).
  const known = names.data || names.error ? ids : null;
  const touches = useHotTouches(
    known
      ? known.map(
          id => leadBy.get(id) ?? { contact_id: id, name: null, phone8: null },
        )
      : null,
    nonce,
  );
  const people = useTeam();
  const seats = useMemo<[string, string][]>(
    () =>
      (people.data ?? [])
        // A working seat, as the dialer counts one.
        .filter(t => t.active && t.via_portal)
        .map(t => [t.email, t.name ?? t.email]),
    [people.data],
  );
  const ownerWord = useCallback(
    (e: string) =>
      people.data?.find(t => t.email === e)?.name?.split(/\s+/)[0] ??
      e.split("@")[0],
    [people.data],
  );

  const now = useNow(60_000);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [show, setShow] = useState<"open" | "all">("open");
  const [limit, setLimit] = useState(50);
  // Open editors, and the row asking for its next follow-up: while either is
  // on, rows keep their places, so nothing moves under the cursor.
  const [editing, setEditing] = useState(0);
  const onEditing = useCallback(
    (on: boolean) => setEditing(n => Math.max(0, n + (on ? 1 : -1))),
    [],
  );
  const [asking, setAsking] = useState<string | null>(null);

  const lastBy = useMemo(
    () =>
      new Map(
        rows.map(r => [
          r.contact_id,
          lastFollowUp(r.last_fu_at, touches.data?.get(r.contact_id)),
        ]),
      ),
    [rows, touches.data],
  );
  const sortedIds = useMemo(
    () =>
      sortHot(rows, sort, {
        name: id => leadBy.get(id)?.name ?? null,
        last: id => lastBy.get(id)?.at ?? null,
        owner: ownerWord,
      }).map(r => r.contact_id),
    [rows, sort, leadBy, lastBy, ownerWord],
  );
  const lastOrder = useRef<string[]>([]);
  const orderIds =
    editing > 0 || asking !== null
      ? keepOrder(lastOrder.current, sortedIds)
      : sortedIds;
  useEffect(() => {
    lastOrder.current = orderIds;
  });

  const byId = useMemo(() => new Map(rows.map(r => [r.contact_id, r])), [rows]);
  const visible = orderIds
    .map(id => byId.get(id))
    .filter((r): r is HotRow => !!r && (show === "all" || isOpen(r)));
  const counts = hotCounts(rows, now);
  const cols = team ? [...COLS, OWNER] : COLS;
  const nameOf = (id: string) =>
    leadBy.get(id)?.name ?? (names.data ? "Unnamed lead" : "A lead");

  const onStatus = (id: string, s: HotStatus) => {
    if (s !== "nurturing" && show === "open")
      toast.success(
        `${nameOf(id)} is ${statusWord(s).toLowerCase()}. The row stays on the list under All.`,
      );
  };

  if (hot.error && !hot.data)
    return <Failed what="The hot list" error={hot.error} retry={hot.reload} />;
  if (!hot.data) return <Reading what="the hot list" />;

  const summary = [
    `${counts.open} open`,
    counts.overdue ? `${counts.overdue} overdue` : null,
    counts.today ? `${counts.today} due today` : null,
    show === "open" && counts.done
      ? `${counts.done} closed or lost hidden`
      : null,
  ];

  return (
    <SectionCard
      flush
      title={
        <span className="inline-flex items-center gap-2">
          <Flame
            className="size-4"
            style={{ color: "var(--primary)" }}
            aria-hidden
          />
          Hot list
        </span>
      }
      side={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="muted text-xs tabular-nums">
            <Parts items={summary} />
          </span>
          <Segmented
            label="Which rows"
            value={show}
            options={[
              ["open", "Open only"],
              ["all", "All"],
            ]}
            onChange={v => setShow(v as "open" | "all")}
          />
        </div>
      }
    >
      {hot.error ? (
        <p className="callout-warn border-b px-4 py-2 text-xs">
          The list could not be read again ({hot.error}); it shows the last
          read.{" "}
          <button
            type="button"
            onClick={hot.reload}
            className="underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : null}
      {names.error ? (
        <p className="callout-warn border-b px-4 py-2 text-xs">
          The leads' names could not be read ({names.error}).{" "}
          <button
            type="button"
            onClick={names.reload}
            className="underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : null}
      {touches.error ? (
        <p className="callout-warn border-b px-4 py-2 text-xs">
          Calls and WhatsApp could not be read ({touches.error}), so Last
          follow-up shows only what was marked by hand.{" "}
          <button
            type="button"
            onClick={touches.reload}
            className="underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : null}

      {!rows.length ? (
        <EmptyState
          icon={Flame}
          title={
            team ? "Nobody on the hot list yet" : "Nobody on your hot list yet"
          }
          text={
            team
              ? "Add a lead below by name or phone, or from the lead's own page. A hot lead comes up first in the dialer at its next follow-up."
              : "Add a lead below by name or phone, or switch to Team to see everyone's. A hot lead comes up first in the dialer at its next follow-up."
          }
        />
      ) : !visible.length ? (
        <EmptyState
          compact
          icon={Flame}
          title="No open hot leads"
          text={`${counts.done} closed or lost ${counts.done === 1 ? "is" : "are"} hidden.`}
          action={
            <button
              type="button"
              onClick={() => setShow("all")}
              className={button}
            >
              Show all
            </button>
          }
        />
      ) : (
        <div className="@container max-h-[calc(100dvh-15rem)] min-h-0 overflow-auto overscroll-x-contain">
          <table
            className={`w-full table-fixed border-separate border-spacing-0 text-[13px] ${
              team
                ? "min-w-[72.5rem] pointer-coarse:min-w-[73.75rem]"
                : "min-w-[65.5rem] pointer-coarse:min-w-[66.75rem]"
            }`}
          >
            <colgroup>
              {cols.map(c => (
                <col key={c.key} className={c.width} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      sort.key === c.key
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={`sticky top-0 whitespace-nowrap border-b hairline bg-[color:var(--card)] px-2.5 py-2 text-xs font-medium ${
                      c.right ? "text-right" : "text-left"
                    } ${i === 0 ? "left-0 z-30 border-r" : "z-20"}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSort(s => nextSort(s, c.key))}
                      title={`Sort by ${c.label.toLowerCase()}`}
                      className={`no-touch relative inline-flex items-center gap-1 after:absolute after:-inset-2 hover:text-[color:var(--foreground)] ${
                        sort.key === c.key ? "" : "muted"
                      }`}
                    >
                      {c.label}
                      {sort.key === c.key ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, limit).map(r => (
                <SheetRow
                  key={r.contact_id}
                  row={r}
                  name={nameOf(r.contact_id)}
                  touch={touches.data?.get(r.contact_id)}
                  touchFailed={Boolean(touches.error)}
                  canEdit={Boolean(me.manager) || r.owner_email === email}
                  owner={team ? { seats, canGive: Boolean(me.manager) } : null}
                  cols={cols.length}
                  edits={edits}
                  onEditing={onEditing}
                  asking={asking === r.contact_id}
                  setAsking={setAsking}
                  onStatus={onStatus}
                  now={now}
                />
              ))}
              {visible.length > limit ? (
                <tr>
                  <td colSpan={cols.length} className="p-0">
                    <div className="sticky left-0 w-full max-w-[100cqw] px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setLimit(l => l + 50)}
                        className={button}
                      >
                        Show 50 more ({visible.length - limit} not shown)
                      </button>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <AddLead
        email={email}
        ownerWord={ownerWord}
        onAdded={(row, lead) => {
          setAdded(a => ({ ...a, [lead.contact_id]: lead }));
          onSaved(row);
          if (!isOpen(row)) setShow("all");
        }}
      />

      <div className="px-4 pb-3">
        <SourceNote label="Where Last follow-up comes from">
          <p>
            Last follow-up is the latest of three: the moment marked by hand (in
            the cell, or with Followed up), the lead's last outbound call on
            Maqsam in the last {TOUCH_DAYS} days, answered or not, and the last
            WhatsApp we sent them, from the cockpit or from HighLevel. The small
            word under it says which.
          </p>
          <p>
            Left out: emails, and a WhatsApp sent in HighLevel that the lead has
            replied to since, because the cockpit copies only each
            conversation's last message. A dash means none of the three was
            found, never a guess.
          </p>
          <p>
            Next follow-up is when the dialer brings the lead up for its owner
            or a manager. A closed or lost row stays here under All and is no
            longer hot in the dialer or on the board.
          </p>
          <p>
            Amounts are sorted by their number whatever their currency: KWD
            1,500 sorts below $2,000.
          </p>
        </SourceNote>
      </div>
    </SectionCard>
  );
}

function SheetRow({
  row,
  name,
  touch,
  touchFailed,
  canEdit,
  owner,
  cols,
  edits,
  onEditing,
  asking,
  setAsking,
  onStatus,
  now,
}: {
  row: HotRow;
  name: string;
  touch: Touches | undefined;
  touchFailed: boolean;
  canEdit: boolean;
  /** The Owner column (the team's list), or null. */
  owner: { seats: [string, string][]; canGive: boolean } | null;
  cols: number;
  edits: HotEdits;
  onEditing: (on: boolean) => void;
  asking: boolean;
  setAsking: (id: string | null) => void;
  onStatus: (id: string, s: HotStatus) => void;
  now: number;
}) {
  const id = row.contact_id;
  // The row as shown: fields still saving, or that failed, as typed.
  const r = edits.view(row);
  const open = isOpen(r);
  const due = open ? dueOf(r.next_at, now) : null;
  const overdue = due === "overdue";
  const last = lastFollowUp(r.last_fu_at, touch);
  const words = followUpWords(r.last_fu_at, touch, touchFailed, now);
  const fails = edits.failures(id);
  const phase = (f: HotField) => edits.phase(id, f);
  const save = (f: HotField, body: Record<string, unknown>) =>
    edits.commit(id, f, body);
  const rowCls = overdue ? ROW_OVERDUE : ROW_PLAIN;
  const cell = "border-b hairline bg-[color:var(--row)] px-1 py-1 align-middle";
  const td = (f: HotField) => `relative ${cell} ${phaseClass(phase(f))}`;
  const mark = (f: HotField) => (
    <SaveMark phase={phase(f)} className="absolute right-1.5 top-1" />
  );
  const stamping = phase("last_fu_at")?.phase === "saving";

  async function stamp() {
    const out = await save("last_fu_at", {
      last_fu_at: new Date().toISOString(),
    });
    if (out) setAsking(id);
  }

  async function pickNext(at: number) {
    const iso = new Date(at).toISOString();
    const out = await save("next_at", { next_at: iso });
    if (!out) return;
    setAsking(null);
    toast.success(`Next follow-up with ${name}: ${when(iso)}.`);
  }

  return (
    <>
      <tr className={rowCls}>
        <th
          scope="row"
          className={`${cell} sticky left-0 z-10 border-r text-left font-normal ${
            overdue ? "shadow-[inset_2px_0_0_var(--destructive)]" : ""
          }`}
        >
          <span className="flex min-w-0 items-center gap-1 px-1.5">
            <Link
              to={`/lead/${id}`}
              title={name}
              dir="auto"
              className={`min-w-0 truncate font-medium hover:underline ${isArabic(name) ? "ar" : ""}`}
            >
              {name}
            </Link>
            <a
              href={ghlContactUrl(id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in HighLevel"
              aria-label={`Open ${name} in HighLevel`}
              className="no-touch muted relative inline-flex shrink-0 after:absolute after:-inset-1.5 hover:text-[color:var(--foreground)]"
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </span>
          {/* The follow-up loop is for deals still being worked. */}
          {canEdit && open ? (
            <button
              type="button"
              onClick={() => void stamp()}
              disabled={stamping}
              title="Mark the last follow-up as now, then pick the next one"
              className="no-touch muted relative ms-1.5 mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium after:absolute after:-inset-1.5 hover:text-[color:var(--primary)] disabled:opacity-60"
            >
              <Check className="size-3" aria-hidden />
              {stamping ? "Saving…" : "Followed up"}
            </button>
          ) : null}
        </th>
        <td className={td("heat")}>
          <HeatPick
            value={heatOf(r)}
            readOnly={!canEdit}
            onPick={v => void save("heat", { heat: v })}
          />
          {mark("heat")}
        </td>
        <td className={td("status")}>
          <StatusPick
            value={statusOf(r)}
            readOnly={!canEdit}
            onPick={async v => {
              if (await save("status", { status: v })) onStatus(id, v);
            }}
          />
          {mark("status")}
        </td>
        <td className={td("last_objection")}>
          <TextEdit
            label="Last objection"
            value={r.last_objection}
            max={500}
            empty="No objection noted yet."
            readOnly={!canEdit}
            onEditing={onEditing}
            onCommit={v => void save("last_objection", { last_objection: v })}
          />
          {mark("last_objection")}
        </td>
        <td className={td("amount")}>
          <AmountEdit
            amount={r.amount}
            currency={r.amount_currency}
            readOnly={!canEdit}
            onEditing={onEditing}
            onCommit={v => void save("amount", v)}
          />
          {mark("amount")}
        </td>
        <td className={td("last_fu_at")}>
          <WhenEdit
            label="Last follow-up"
            value={r.last_fu_at}
            min={now - 366 * DAY}
            max={now}
            readOnly={!canEdit}
            onEditing={onEditing}
            onCommit={v => void save("last_fu_at", { last_fu_at: v })}
          >
            <LastShown last={last} words={words} now={now} />
          </WhenEdit>
          {mark("last_fu_at")}
        </td>
        <td className={td("next_at")}>
          <WhenEdit
            label="Next follow-up"
            value={r.next_at}
            min={now - DAY}
            max={now + 366 * DAY}
            readOnly={!canEdit}
            onEditing={onEditing}
            onCommit={v => void save("next_at", { next_at: v })}
          >
            <NextShown at={r.next_at} due={due} open={open} now={now} />
          </WhenEdit>
          {mark("next_at")}
        </td>
        <td className={td("note")}>
          <TextEdit
            label="Notes"
            value={r.note}
            max={4000}
            multiline
            empty="No notes yet."
            readOnly={!canEdit}
            onEditing={onEditing}
            onCommit={v => void save("note", { note: v })}
          />
          {mark("note")}
        </td>
        {owner ? (
          <td className={td("owner_email")}>
            <OwnerPick
              value={r.owner_email}
              seats={owner.seats}
              readOnly={!owner.canGive}
              onPick={v => void save("owner_email", { owner_email: v })}
            />
            {mark("owner_email")}
          </td>
        ) : null}
      </tr>
      {asking ? (
        <tr className={rowCls}>
          <td
            colSpan={cols}
            className="border-b hairline bg-[color:var(--row)] p-0"
          >
            <div className="sticky left-0 w-full max-w-[100cqw] px-3 py-2">
              <NextAsk
                name={name}
                busy={phase("next_at")?.phase === "saving"}
                onPick={at => void pickNext(at)}
                onClose={() => setAsking(null)}
              />
            </div>
          </td>
        </tr>
      ) : null}
      {fails.length ? (
        <tr className={rowCls}>
          <td
            colSpan={cols}
            className="border-b hairline bg-[color:var(--row)] p-0"
          >
            <div className="sticky left-0 w-full max-w-[100cqw] px-3 py-1.5">
              <div className="callout-bad rounded-[var(--radius-md)] border px-2.5 py-1.5">
                <FailedSaves
                  list={fails}
                  onRetry={f => edits.retry(id, f)}
                  onUndo={f => edits.undo(id, f)}
                />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The row at the foot of the list: find a lead by name or phone and put it
 * on. A lead already on someone's list says so instead of offering "Add".
 */
function AddLead({
  email,
  ownerWord,
  onAdded,
}: {
  email: string;
  ownerWord: (email: string) => string;
  onAdded: (row: HotRow, lead: LeadName) => void;
}) {
  const [term, setTerm] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(term.trim()), 250);
    return () => window.clearTimeout(t);
  }, [term]);
  const found = useLeadSearch(q);
  const list = q.length >= 2 ? (found.data ?? []).slice(0, 8) : [];
  const idKey = list.map(l => l.contact_id).join(",");
  const taken = useQuery<HotRow[]>(
    () =>
      idKey
        ? supabase
            .from("cockpit_sales_hot")
            .select("*")
            .is("removed_at", null)
            .in("contact_id", idKey.split(","))
        : Promise.resolve({ data: [], error: null }),
    [idKey],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(l: Lead) {
    setBusy(l.contact_id);
    setError(null);
    try {
      const out = await api<{ hot?: HotRow }>("hot.save", {
        contact_id: l.contact_id,
      });
      if (out.hot)
        onAdded(out.hot, {
          contact_id: l.contact_id,
          name: l.name,
          phone8: l.phone8,
        });
      setTerm("");
      setQ("");
      toast.success(
        `${l.name ?? "The lead"} is on the hot list. Set the next follow-up so the dialer brings them up.`,
      );
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const searching = q.length >= 2 && found.loading && !found.data;
  return (
    <div className="border-t hairline px-4 py-3">
      <label className="flex max-w-md items-center gap-2">
        <Plus className="muted size-4 shrink-0" aria-hidden />
        <input
          type="search"
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder="Add a lead: name or phone"
          aria-label="Add a lead: type a name or phone number"
          className={`${field} h-8`}
        />
      </label>
      {searching ? (
        <Reading what="the leads" className="ms-6 mt-2 text-xs" />
      ) : found.error && q.length >= 2 ? (
        <div className="ms-6 mt-2">
          <Failed what="The leads" error={found.error} retry={found.reload} />
        </div>
      ) : q.length >= 2 && found.data && !list.length ? (
        <p className="muted ms-6 mt-2 text-xs">
          No lead matches "{q}". Try part of the name, or the last digits of the
          phone number.
        </p>
      ) : null}
      {list.length ? (
        <ul className="ms-6 mt-2 max-w-xl divide-y hairline overflow-hidden rounded-[var(--radius-md)] border hairline">
          {list.map(l => {
            const on = taken.data?.find(h => h.contact_id === l.contact_id);
            const whose = on
              ? on.owner_email === email
                ? "your list"
                : `${ownerWord(on.owner_email)}'s list`
              : null;
            return (
              <li
                key={l.contact_id}
                className="flex items-center gap-3 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-medium ${isArabic(l.name) ? "ar" : ""}`}
                    dir="auto"
                  >
                    {l.name ?? "Unnamed lead"}
                  </span>
                  <span className="muted block truncate text-[11px]">
                    <Parts
                      items={[
                        l.phone,
                        plainStage(l.stage_name),
                        classLabel(l.lead_class),
                      ]}
                    />
                  </span>
                </span>
                {isClient(l) ? (
                  <span className="muted shrink-0 text-xs" title={CLIENT_NOTE}>
                    Active client
                  </span>
                ) : on ? (
                  <span className="muted shrink-0 text-xs">
                    On {whose}
                    {isOpen(on)
                      ? ""
                      : `, ${statusWord(statusOf(on)).toLowerCase()}`}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void add(l)}
                    disabled={busy !== null}
                    className={button}
                  >
                    {busy === l.contact_id ? "Adding…" : "Add"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p className="callout-bad ms-6 mt-2 max-w-xl rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs">
          Not added: {error}
        </p>
      ) : null}
    </div>
  );
}
