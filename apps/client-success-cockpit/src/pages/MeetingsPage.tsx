import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight } from "lucide-react";
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
/** The dot on the kind chip: teal for a client meeting, quiet for the team. */
const KIND_DOT: Record<string, string> = {
  client: "bg-primary",
  team: "bg-muted-foreground/60",
  other: "bg-muted-foreground/60",
};

/** One card per block of the page, the same everywhere in the portal. */
const CARD = "rounded-2xl border bg-card p-4 sm:p-6";
const CARD_TITLE = "text-[15px] font-semibold";

/** A small outside link: teal, one trailing arrow. */
function Ext({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </a>
  );
}

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
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{link.calendarId}</span> ·{" "}
        {status}{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => unlinkCalendar({})}
        >
          Disconnect
        </button>
        {link.status === "error" && link.note ? (
          <p className="mt-1 txt-warn">{link.note}</p>
        ) : null}
      </div>
    );
  }
  if (!open)
    return (
      <button
        type="button"
        className="text-xs text-primary underline-offset-4 hover:underline"
        onClick={() => setOpen(true)}
      >
        Connect your Google Calendar
      </button>
    );
  return (
    <form
      className="mt-2 w-full max-w-xl rounded-xl bg-muted/40 p-4 text-xs"
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
          className="h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm sm:w-64"
        />
        <button
          type="submit"
          disabled={!email.includes("@")}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Connect
        </button>
        <button
          type="button"
          className="px-2 text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        {err ? <span className="txt-bad">{err}</span> : null}
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
  if (!data)
    return (
      <p className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </p>
    );
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
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
          Meetings and messages
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {syncedAt ? `Refreshed ${ago(syncedAt)} ago. ` : ""}
          {!calendarConfigured ? "No calendar events yet. " : ""}
          {!whatsappConfigured ? "WhatsApp not connected yet." : ""}
        </p>
      </header>

      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
          <h2 className={CARD_TITLE}>
            Today
            {today.length ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
            Nothing in the calendar today.
          </p>
        ) : (
          <ul className="divide-y">
            {(today as Any[]).map(e => (
              <li
                key={e.eventId}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0"
              >
                <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {e.allDay ? "All day" : clock(e.start)}
                </span>
                <span className="min-w-0 font-medium" dir="auto">
                  {e.title}
                </span>
                {(() => {
                  const k = e.kind ?? (e.clientName ? "client" : "other");
                  return KIND_LABEL[k] ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
                      <span
                        aria-hidden
                        className={`size-1.5 rounded-full ${KIND_DOT[k]}`}
                      />
                      {KIND_LABEL[k]}
                    </span>
                  ) : null;
                })()}
                {e.clientName ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {e.clientName}
                  </span>
                ) : null}
                {e.meetLink ? <Ext href={e.meetLink}>Join</Ext> : null}
                {e.attendees?.length ? (
                  <span className="basis-full text-xs text-muted-foreground sm:ml-auto sm:basis-auto">
                    {e.attendees.slice(0, 3).join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {inFlight.length ? (
        <section className={CARD}>
          <h2 className={`mb-4 ${CARD_TITLE}`}>Sending</h2>
          <ul className="divide-y text-sm">
            {inFlight.map(t => (
              <li
                key={t.chatId}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground">
                  Reply leaving within a minute, queued {ago(t.sendingAt)} ago
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={CARD}>
        <h2 className={`mb-4 ${CARD_TITLE}`}>Next check-in per client</h2>
        {nextCall.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No client calls booked in the next three weeks.
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {(nextCall as Any[]).map(n => (
                  <tr key={n.clientName} className="align-baseline">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{n.clientName}</div>
                      {/* On a phone the title sits under the name, so the
                          date keeps its place on the right. */}
                      <div
                        className="text-xs text-muted-foreground sm:hidden"
                        dir="auto"
                      >
                        {n.title}
                      </div>
                    </td>
                    <td
                      className="py-2 pr-4 text-muted-foreground max-sm:hidden"
                      dir="auto"
                    >
                      {n.title}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right font-mono text-xs tabular-nums">
                      {day(n.start)} {n.allDay ? "" : clock(n.start)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={CARD}>
        <h2 className={`mb-4 ${CARD_TITLE}`}>Waiting on you in WhatsApp</h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is waiting for a reply.
          </p>
        ) : (
          <ul className="divide-y">
            {waiting.map(t => {
              const text = drafts[t.chatId] ?? t.draft ?? "";
              return (
                <li
                  key={t.chatId}
                  className="py-4 text-sm first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium">{t.name}</span>
                    {t.clientName ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {t.clientName}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">
                      Waiting {ago(t.waitingSince)}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground" dir="auto">
                    {t.recent?.length
                      ? `${t.recent[t.recent.length - 1].who}: ${t.recent[t.recent.length - 1].text}`
                      : ""}
                  </p>
                  <div className="mt-3 rounded-xl bg-muted/40 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Recommended reply
                      {t.draft ? ", from the communication SOP" : ""}
                    </p>
                    {t.sendError ? (
                      <p className="mb-2 text-xs txt-bad">
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
                      dir="auto"
                      className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
                        className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {sending[t.chatId] ? "Sending…" : "Send on WhatsApp"}
                      </button>
                      <span className="text-xs text-muted-foreground">
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
        <section className={CARD}>
          <h2 className={`mb-4 ${CARD_TITLE}`}>Quiet clients</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
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

      <section className={CARD}>
        <h2 className={`mb-4 ${CARD_TITLE}`}>Next 7 days</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing booked.</p>
        ) : (
          <ul className="divide-y">
            {(upcoming as Any[]).map(e => (
              <li
                key={e.eventId}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0"
              >
                <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {day(e.start)}
                </span>
                <span className="w-12 shrink-0 font-mono text-xs tabular-nums">
                  {e.allDay ? "" : clock(e.start)}
                </span>
                <span className="min-w-0" dir="auto">
                  {e.title}
                </span>
                {e.clientName ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {e.clientName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <h2 className={`mb-4 ${CARD_TITLE}`}>All WhatsApp threads</h2>
        <ul className="divide-y">
          {(threads as Any[]).map(t => (
            <li key={t.chatId} className="text-sm">
              <button
                type="button"
                aria-expanded={openThread === t.chatId}
                className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 py-3 text-left"
                onClick={() =>
                  setOpenThread(v => (v === t.chatId ? null : t.chatId))
                }
              >
                <span className="font-medium" dir="auto">
                  {t.name}
                </span>
                {!t.isGroup ? (
                  <span className="text-xs text-muted-foreground">Private</span>
                ) : null}
                {t.clientName ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {t.clientName}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {t.lastAt
                    ? `${t.lastFromUs ? "We wrote" : "They wrote"} ${ago(t.lastAt)} ago`
                    : (t.error ?? "")}
                </span>
              </button>
              {openThread === t.chatId ? (
                <ul className="mb-3 space-y-2 rounded-xl bg-muted/40 p-3">
                  {(t.recent as Any[]).map((m, i) => (
                    <li key={i} className={m.fromMe ? "text-right" : ""}>
                      <span className="text-xs text-muted-foreground">
                        {m.who} · {ago(m.at)} ago
                      </span>
                      <p dir="auto">{m.text}</p>
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
