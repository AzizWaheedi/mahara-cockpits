import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

// biome-ignore lint/suspicious/noExplicitAny: feed rows
type Any = any;

const KW = "Asia/Kuwait";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: KW,
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: KW,
    hour: "2-digit",
    minute: "2-digit",
  });
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
};

/**
 * Meetings and messages.
 *
 * Everything booked in the calendar for the next three weeks, the next call
 * per client, and every WhatsApp thread with a client, unanswered ones first.
 * Read-only: the app never sends a message on its own.
 */
const KIND_LABEL: Record<string, string> = {
  client: "Client",
  team: "Team",
  other: "",
};
const KIND_CLASS: Record<string, string> = {
  client: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  team: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  other: "bg-muted text-muted-foreground",
};

/**
 * Connect your own Google Calendar: share it with the cockpit's service
 * account, type the Google email, done. Checked within a minute.
 */
function CalendarLink({ link, saEmail }: { link: Any; saEmail: string }) {
  const linkCalendar = useMutation(api.comms.linkCalendar);
  const unlinkCalendar = useMutation(api.comms.unlinkCalendar);
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  if (link) {
    const status =
      link.status === "ok"
        ? `connected, ${link.events ?? 0} event${link.events === 1 ? "" : "s"} in view`
        : link.status === "pending"
          ? "checking, under a minute"
          : "not readable yet";
    return (
      <div className="text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">{link.calendarId}</span>{" "}
        · {status}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => unlinkCalendar({})}
        >
          disconnect
        </button>
        {link.status === "error" && link.note ? (
          <p className="mt-1 text-amber-700 dark:text-amber-300">{link.note}</p>
        ) : null}
      </div>
    );
  }
  if (!open)
    return (
      <button
        type="button"
        className="text-[12px] text-primary underline"
        onClick={() => setOpen(true)}
      >
        Connect your Google Calendar
      </button>
    );
  return (
    <form
      className="mt-1 max-w-xl rounded-md border bg-muted/30 p-3 text-[12px]"
      onSubmit={async e => {
        e.preventDefault();
        setErr("");
        try {
          await linkCalendar({ calendarId: email });
          setOpen(false);
        } catch (x) {
          setErr(String((x as Error).message ?? x));
        }
      }}
    >
      <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
        <li>
          In Google Calendar, open your calendar's settings, then "Share with
          specific people or groups", and add{" "}
          <code className="select-all rounded bg-background px-1">
            {saEmail}
          </code>{" "}
          with "See all event details".
        </li>
        <li>
          Type the Google account email that calendar belongs to and connect.
        </li>
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@maharamedia.com"
          className="w-64 rounded-md border bg-background px-2 py-1 text-[13px]"
        />
        <button
          type="submit"
          disabled={!email.includes("@")}
          className="rounded-md bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          Connect
        </button>
        <button
          type="button"
          className="text-muted-foreground underline"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        {err ? <span className="text-red-600">{err}</span> : null}
      </div>
    </form>
  );
}

export function MeetingsPage() {
  const data = useQuery(api.comms.overview, {});
  const sendReply = useMutation(api.comms.sendReply);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [openThread, setOpenThread] = useState<string | null>(null);
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const {
    today,
    upcoming,
    nextCall,
    threads,
    calendarConfigured,
    whatsappConfigured,
    syncedAt,
    myCalendar,
    saEmail,
  } = data as Any;
  const todayCounts = (today as Any[]).reduce(
    (acc: Record<string, number>, e) => {
      const k = e.kind ?? (e.clientName ? "client" : "other");
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const waiting = (threads as Any[]).filter(
    t => t.waitingSince && !t.repliedAt && !t.sendingAt,
  );
  const inFlight = (threads as Any[]).filter(t => t.sendingAt);
  const quiet = (threads as Any[]).filter(
    t => !t.waitingSince && (t.silentDays ?? 0) >= 3 && t.clientName,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Meetings and messages
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {syncedAt ? `Refreshed ${ago(syncedAt)} ago. ` : ""}
          {!calendarConfigured ? "No calendar events yet. " : ""}
          {!whatsappConfigured ? "WhatsApp not connected yet." : ""}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
            Today
            {today.length ? (
              <span className="ml-2 font-medium normal-case tracking-normal text-muted-foreground">
                {[
                  todayCounts.client ? `${todayCounts.client} client` : "",
                  todayCounts.team ? `${todayCounts.team} team` : "",
                  todayCounts.other ? `${todayCounts.other} other` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            ) : null}
          </h2>
          <CalendarLink link={myCalendar} saEmail={saEmail} />
        </div>
        {today.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing in the calendar today.
          </p>
        ) : (
          <ul className="divide-y">
            {(today as Any[]).map(e => (
              <li
                key={e.eventId}
                className="flex flex-wrap items-baseline gap-3 py-2 text-[13px]"
              >
                <span className="w-14 font-mono tabular-nums">
                  {e.allDay ? "all day" : clock(e.start)}
                </span>
                <span className="font-semibold">{e.title}</span>
                {(() => {
                  const k = e.kind ?? (e.clientName ? "client" : "other");
                  return KIND_LABEL[k] ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND_CLASS[k]}`}
                    >
                      {KIND_LABEL[k]}
                    </span>
                  ) : null;
                })()}
                {e.clientName ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[12px]">
                    {e.clientName}
                  </span>
                ) : null}
                {e.meetLink ? (
                  <a
                    href={e.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    Join
                  </a>
                ) : null}
                {e.attendees?.length ? (
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    {e.attendees.slice(0, 3).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {inFlight.length ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
            Sending
          </h2>
          <ul className="divide-y text-[13px]">
            {inFlight.map(t => (
              <li key={t.chatId} className="flex items-baseline gap-2 py-2">
                <span className="font-semibold">{t.name}</span>
                <span className="text-muted-foreground">
                  reply leaving within a minute, queued {ago(t.sendingAt)} ago
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
          Next check-in per client
        </h2>
        {nextCall.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No client calls booked in the next three weeks.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {(nextCall as Any[]).map(n => (
                <tr key={n.clientName} className="border-t">
                  <td className="py-1.5 font-semibold">{n.clientName}</td>
                  <td className="py-1.5 text-muted-foreground">{n.title}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {day(n.start)} {n.allDay ? "" : clock(n.start)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
          Waiting on you in WhatsApp
        </h2>
        {waiting.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nobody is waiting for a reply.
          </p>
        ) : (
          <ul className="divide-y">
            {waiting.map(t => {
              const text = drafts[t.chatId] ?? t.draft ?? "";
              return (
                <li key={t.chatId} className="py-2 text-[13px]">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{t.name}</span>
                    {t.clientName ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[12px]">
                        {t.clientName}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[12px] text-muted-foreground">
                      waiting {ago(t.waitingSince)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {t.recent?.length
                      ? `${t.recent[t.recent.length - 1].who}: ${t.recent[t.recent.length - 1].text}`
                      : ""}
                  </p>
                  <div className="mt-2 rounded-md border bg-muted/30 p-2">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Recommended reply
                      {t.draft ? ", from the communication SOP" : ""}
                    </p>
                    {t.sendError ? (
                      <p className="mb-1 text-[12px] text-red-600">
                        The last send failed: {t.sendError}. Fix and send again.
                      </p>
                    ) : null}
                    <textarea
                      value={text}
                      onChange={e =>
                        setDrafts(d => ({ ...d, [t.chatId]: e.target.value }))
                      }
                      rows={3}
                      placeholder={
                        t.draft
                          ? ""
                          : "Hermes is drafting a reply from the SOP…"
                      }
                      className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[13px]"
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!text.trim() || sending[t.chatId]}
                        onClick={async () => {
                          setSending(x => ({ ...x, [t.chatId]: true }));
                          try {
                            await sendReply({ chatId: t.chatId, text });
                          } finally {
                            setSending(x => ({ ...x, [t.chatId]: false }));
                          }
                        }}
                        className="rounded-md bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {sending[t.chatId] ? "Sending…" : "Send on WhatsApp"}
                      </button>
                      <span className="text-[11px] text-muted-foreground">
                        Edit it first if you want. It leaves within a minute.
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {quiet.length > 0 ? (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
            Quiet clients
          </h2>
          <ul className="flex flex-wrap gap-2 text-[13px]">
            {quiet.map(t => (
              <li key={t.chatId} className="rounded-full border px-3 py-1">
                {t.clientName}{" "}
                <span className="text-muted-foreground">
                  · silent {t.silentDays}d
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
          Next 7 days
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nothing booked.</p>
        ) : (
          <ul className="divide-y">
            {(upcoming as Any[]).map(e => (
              <li
                key={e.eventId}
                className="flex flex-wrap items-baseline gap-3 py-2 text-[13px]"
              >
                <span className="w-24 font-mono tabular-nums text-muted-foreground">
                  {day(e.start)}
                </span>
                <span className="w-12 font-mono tabular-nums">
                  {e.allDay ? "" : clock(e.start)}
                </span>
                <span>{e.title}</span>
                {e.clientName ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[12px]">
                    {e.clientName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
          All WhatsApp threads
        </h2>
        <ul className="divide-y">
          {(threads as Any[]).map(t => (
            <li key={t.chatId} className="py-2 text-[13px]">
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline gap-2 text-left"
                onClick={() =>
                  setOpenThread(v => (v === t.chatId ? null : t.chatId))
                }
              >
                <span className="font-semibold">{t.name}</span>
                {!t.isGroup ? (
                  <span className="text-[12px] text-muted-foreground">
                    private
                  </span>
                ) : null}
                {t.clientName ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[12px]">
                    {t.clientName}
                  </span>
                ) : null}
                <span className="ml-auto text-[12px] text-muted-foreground">
                  {t.lastAt
                    ? `${t.lastFromUs ? "we wrote" : "they wrote"} ${ago(t.lastAt)} ago`
                    : (t.error ?? "")}
                </span>
              </button>
              {openThread === t.chatId ? (
                <ul className="mt-2 space-y-1 rounded-md bg-muted/40 p-2">
                  {(t.recent as Any[]).map((m, i) => (
                    <li key={i} className={m.fromMe ? "text-right" : ""}>
                      <span className="text-[12px] text-muted-foreground">
                        {m.who} · {ago(m.at)} ago
                      </span>
                      <p>{m.text}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
