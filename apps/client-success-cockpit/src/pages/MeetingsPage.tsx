import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Pill, PillRow } from "@/components/kit";
import { WhatsAppDesk } from "@/components/WhatsAppDesk";
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
  const [busy, setBusy] = useState(false);
  if (link) {
    const status =
      link.status === "ok"
        ? `connected, ${link.events ?? 0} event${link.events === 1 ? "" : "s"} in view`
        : link.status === "pending"
          ? "connection check queued"
          : "not readable yet";
    return (
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{link.calendarId}</span> ·{" "}
        {status}{" "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await unlinkCalendar({});
            } catch {
              toast.error("The calendar could not be disconnected.");
            } finally {
              setBusy(false);
            }
          }}
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
        if (busy) return;
        setBusy(true);
        setErr("");
        try {
          await linkCalendar({ calendarId: email });
          setOpen(false);
        } catch (x) {
          setErr(String((x as Error).message ?? x));
        } finally {
          setBusy(false);
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
          aria-label="Google Calendar email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@maharamedia.com"
          className="h-9 w-full min-w-0 rounded-lg border bg-background px-3 text-sm sm:w-64"
        />
        <button
          type="submit"
          disabled={busy || !email.includes("@")}
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
  const [params, setParams] = useSearchParams();
  const messages = params.get("view") === "messages";
  if (!data)
    return (
      <p
        className="mx-auto max-w-6xl text-sm text-muted-foreground"
        role="status"
      >
        Loading your schedule…
      </p>
    );
  const { today, upcoming, syncedAt, myCalendar, saEmail } = data as Any;
  const todayCounts = (today as Any[]).reduce(
    (acc: Record<string, number>, e) => {
      const k = e.kind ?? (e.clientName ? "client" : "other");
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {},
  );
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          Meetings and messages
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your calendar and linked client conversations. Times are shown in
          Kuwait time.
          {syncedAt ? ` Calendar refreshed ${ago(syncedAt)} ago.` : ""}
        </p>
      </header>
      <PillRow>
        <Pill active={!messages} onClick={() => setParams({})}>
          Schedule
        </Pill>
        <Pill active={messages} onClick={() => setParams({ view: "messages" })}>
          Client messages
        </Pill>
      </PillRow>
      {messages ? (
        <WhatsAppDesk desk="csm" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Book the next check-in from the client's card.
            </p>
            <Link
              to="/clients"
              className="text-sm font-medium text-primary hover:underline"
            >
              Find a client
            </Link>
          </div>
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
        </>
      )}
    </div>
  );
}
