import { CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { StatusDot } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import {
  linkHow,
  readSeatLinks,
  type SeatLink,
  type SeatLinksRead,
  setSeatLink,
} from "@/lib/requestsAdmin";
import { errorWords, PLAIN_ERRORS, RequestError } from "@/lib/requestsClient";
import { stampWords } from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";

/*
 * Hallmark · component: seat links · genre: modern-minimal (the cockpit's)
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 *
 * One flush row per active seat: "first name, role", the ClickUp user it
 * is linked to or "Not linked", how the link was made, a picker and Clear.
 * A seat that is not linked sees "not linked" on its Today card, never an
 * empty list, so this is where that gets fixed (R11).
 */

/**
 * A seat's one line: "Huda, set by hand" when linked; when not, the
 * server's own sentence where it says why and what to do (no email match,
 * two matches, or a match already linked to another seat), else "Not
 * linked. {how}." Said once, never the same fact twice.
 */
export function seatLine(s: SeatLink, linked: boolean): string {
  if (linked)
    return `${s.link?.username ?? `ClickUp user ${s.link?.clickupUserId}`}, ${linkHow(s.link).toLowerCase()}`;
  const note = s.link?.note?.trim();
  if (note && (s.link?.state === "not_found" || s.link?.state === "ambiguous"))
    return note;
  return `Not linked. ${linkHow(s.link)}.`;
}

/**
 * A refused link in plain words (cockpit_member_clickup_set): a ClickUp
 * person already linked to another seat names that seat; a seat that may
 * not be linked from here, and a pick that is not valid, say what to do.
 */
export function linkRefusal(
  e: unknown,
  clickupUserId: number | null,
  read: { status: string; data?: SeatLinksRead },
): string {
  const code = e instanceof RequestError ? e.code : null;
  if (code === "23505") {
    const data = read.status === "ready" ? read.data : undefined;
    const member = data?.members.find(m => m.clickupUserId === clickupUserId);
    const other = member?.linkedTo
      ? data?.seats.find(x => x.memberId === member.linkedTo)?.label
      : null;
    return other
      ? `That ClickUp person is already linked to ${other}. Clear that link first.`
      : "That ClickUp person is already linked to another seat. Clear that link first.";
  }
  if (code === "42501" || code === "22023") {
    // The server's own sentence says which rule refused it; keep it.
    const said = errorWords(e);
    if (said && !Object.values(PLAIN_ERRORS).includes(said as never))
      return said;
    return code === "42501"
      ? "This seat cannot be linked from your seat. Only the CEO links their own seat, and the CEO's ClickUp account links only to the CEO."
      : "That link cannot be saved. Pick someone from the list.";
  }
  return errorWords(e);
}

/** People in ClickUp (editors): which ClickUp user each seat is. */
export function SeatLinks() {
  const seat = useTaskSeat();
  const client = seat.client;
  const [read, setRead] = useState<
    | { status: "loading" }
    | { status: "ready"; data: SeatLinksRead }
    | { status: "error"; error: string }
  >({ status: "loading" });
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setRead({ status: "ready", data: await readSeatLinks(client) });
    } catch (e) {
      setRead({ status: "error", error: errorWords(e) });
    }
  }, [client]);
  useEffect(() => {
    if (seat.ready && client) void load();
  }, [seat.ready, client, load]);

  async function link(s: SeatLink, clickupUserId: number | null) {
    if (!client || saving) return;
    setSaving(s.memberId);
    setRowError(null);
    try {
      const next = await setSeatLink(client, s.memberId, clickupUserId);
      setRead(r =>
        r.status === "ready"
          ? {
              status: "ready",
              data: {
                ...r.data,
                seats: r.data.seats.map(x =>
                  x.memberId === next.memberId ? next : x,
                ),
              },
            }
          : r,
      );
      // The row says the new link; the member list's "linked to" changes
      // too, so read it again.
      void load();
    } catch (e) {
      setRowError({
        id: s.memberId,
        text: linkRefusal(e, clickupUserId, read),
      });
    } finally {
      setSaving(null);
    }
  }

  if (read.status === "loading")
    return (
      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Reading the seats and the ClickUp workspace
        </p>
      </section>
    );
  if (read.status === "error")
    return (
      <section className="rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-2 text-sm" role="alert">
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <div className="space-y-2">
            <p>{read.error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      </section>
    );

  const { seats, members, readAt } = read.data;
  const unlinked = seats.filter(
    s => !s.link || !["ok", "manual"].includes(s.link.state),
  ).length;
  const labelOf = (linkedTo: string | null) =>
    linkedTo
      ? (seats.find(s => s.memberId === linkedTo)?.label ?? linkedTo)
      : null;

  return (
    <section className="rounded-2xl border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">People in ClickUp</h2>
          <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
            Each seat's ClickUp user, so its tasks and alerts can show.
            {unlinked
              ? ` ${unlinked} ${unlinked === 1 ? "seat is" : "seats are"} not linked.`
              : " Every seat is linked."}
          </p>
        </div>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {readAt
            ? `ClickUp read ${stampWords(readAt)}`
            : "ClickUp not read yet"}
        </p>
      </header>
      {members.length === 0 ? (
        <p className="border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
          The ClickUp workspace has not been read yet. It is read every hour;
          the list fills in after the next read.
        </p>
      ) : null}
      <ul className="divide-y border-t">
        {seats.map(s => {
          const linked = s.link && ["ok", "manual"].includes(s.link.state);
          const busy = saving === s.memberId;
          return (
            <li
              key={s.memberId}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-center sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.label}</p>
                <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <StatusDot
                    tone={linked ? "good" : "warning"}
                    label={linked ? "Linked" : "Not linked"}
                  />
                  {/* One line a seat (D10): who it is linked to and how,
                      or why it is not linked, with the fix. */}
                  <span className="min-w-0">
                    {seatLine(s, Boolean(linked))}
                  </span>
                </p>
                {rowError?.id === s.memberId ? (
                  <p className="text-[13px] text-destructive" role="alert">
                    {rowError.text}
                  </p>
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <select
                  aria-label={`ClickUp user for ${s.label}`}
                  className="block h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
                  value={
                    linked && s.link?.clickupUserId
                      ? String(s.link.clickupUserId)
                      : ""
                  }
                  disabled={busy || members.length === 0}
                  onChange={e => {
                    if (e.target.value) void link(s, Number(e.target.value));
                  }}
                >
                  <option value="">Pick their ClickUp user</option>
                  {members.map(m => {
                    const other = labelOf(m.linkedTo);
                    const taken = other && m.linkedTo !== s.memberId;
                    return (
                      <option
                        key={m.clickupUserId}
                        value={String(m.clickupUserId)}
                      >
                        {m.username}
                        {taken ? ` (linked to ${other})` : ""}
                      </option>
                    );
                  })}
                </select>
                <div className="flex items-center gap-2">
                  {busy ? (
                    <LoaderCircle
                      aria-label="Saving"
                      className="size-4 animate-spin text-muted-foreground"
                    />
                  ) : null}
                  {/* Clear undoes a link an editor set by hand; an email
                      match is changed by picking another user. */}
                  {s.link?.state === "manual" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void link(s, null)}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
