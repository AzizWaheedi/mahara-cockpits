import { useQuery } from "convex/react";
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
export function MeetingsPage() {
  const data = useQuery(api.comms.overview, {});
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
  } = data as Any;
  const waiting = (threads as Any[]).filter(t => t.waitingSince);
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
          {!calendarConfigured ? "Calendar not connected yet. " : ""}
          {!whatsappConfigured ? "WhatsApp not connected yet." : ""}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-widest text-teal-600">
          Today
        </h2>
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
            {waiting.map(t => (
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
              </li>
            ))}
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
