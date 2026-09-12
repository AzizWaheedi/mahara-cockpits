import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

// biome-ignore lint/suspicious/noExplicitAny: calendar rows
type Any = any;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kuwait",
    hour: "2-digit",
    minute: "2-digit",
  });

const KIND_LABEL: Record<string, string> = { client: "Client", team: "Team" };
const KIND_CLASS: Record<string, string> = {
  client: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  team: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
};

/**
 * Today's meetings: the shared client calendars plus your own Google
 * Calendar once you connect it. Aziz, 2026-09-12: "every cockpit should
 * also allow them to integrate their Google Calendar so it can tell them
 * what meetings they have today."
 */
export function TodayMeetings() {
  const data = useQuery(api.personalCalendars.mine, {}) as Any;
  const link = useMutation(api.personalCalendars.link);
  const unlink = useMutation(api.personalCalendars.unlink);
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  if (!data) return null;
  const { link: my, today, saEmail } = data;
  const counts = (today as Any[]).reduce((acc: Record<string, number>, e) => {
    const k = e.kind ?? (e.clientName ? "client" : "other");
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
          Today's meetings
          {today.length ? (
            <span className="ml-2 font-medium normal-case tracking-normal text-muted-foreground">
              {[
                counts.client ? `${counts.client} client` : "",
                counts.team ? `${counts.team} team` : "",
                counts.other ? `${counts.other} other` : "",
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
          ) : null}
        </h2>
        {my ? (
          <div className="text-[12px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {my.calendarId}
            </span>{" "}
            ·{" "}
            {my.status === "ok"
              ? `connected, ${my.events ?? 0} event${my.events === 1 ? "" : "s"} in view`
              : my.status === "pending"
                ? "checking, under a minute"
                : "not readable yet"}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => unlink({})}
            >
              disconnect
            </button>
          </div>
        ) : !open ? (
          <button
            type="button"
            className="text-[12px] text-primary underline"
            onClick={() => setOpen(true)}
          >
            Connect your Google Calendar
          </button>
        ) : null}
      </div>
      {my?.status === "error" && my.note ? (
        <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300">
          {my.note}
        </p>
      ) : null}
      {open && !my ? (
        <form
          className="mb-3 max-w-xl rounded-md border bg-muted/30 p-3 text-[12px]"
          onSubmit={async e => {
            e.preventDefault();
            setErr("");
            try {
              await link({ calendarId: email });
              setOpen(false);
            } catch (x) {
              setErr(String((x as Error).message ?? x));
            }
          }}
        >
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>
              In Google Calendar, open your calendar's settings, then "Share
              with specific people or groups", and add{" "}
              <code className="select-all rounded bg-background px-1">
                {saEmail}
              </code>{" "}
              with "See all event details".
            </li>
            <li>
              Type the Google account email that calendar belongs to and
              connect.
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
      ) : null}
      {today.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nothing in the calendar today.
        </p>
      ) : (
        <ul className="divide-y">
          {(today as Any[]).map(e => {
            const k = e.kind ?? (e.clientName ? "client" : "other");
            return (
              <li
                key={`${e.owner ?? ""}${e.eventId}`}
                className="flex flex-wrap items-baseline gap-3 py-2 text-[13px]"
              >
                <span className="w-14 font-mono tabular-nums">
                  {e.allDay ? "all day" : clock(e.start)}
                </span>
                <span className="font-semibold">{e.title}</span>
                {KIND_LABEL[k] ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND_CLASS[k]}`}
                  >
                    {KIND_LABEL[k]}
                  </span>
                ) : null}
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
