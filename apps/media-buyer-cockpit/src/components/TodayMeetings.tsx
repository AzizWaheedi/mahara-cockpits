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
// One neutral chip; a client meeting carries the teal dot, a team one none.
const KIND_DOT: Record<string, string | undefined> = {
  client: "var(--mahara-teal)",
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
    <section className="rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">
          Today's meetings
          {today.length ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
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
          <div className="text-xs text-muted-foreground">
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
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => unlink({})}
            >
              Disconnect
            </button>
          </div>
        ) : !open ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setOpen(true)}
          >
            Connect your Google Calendar
          </button>
        ) : null}
      </div>
      {my?.status === "error" && my.note ? (
        <p className="mt-2 text-xs txt-warn">{my.note}</p>
      ) : null}
      {open && !my ? (
        <form
          className="mt-3 max-w-xl rounded-xl bg-muted/40 p-3 text-xs"
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
              className="h-8 w-64 max-w-full rounded-lg border bg-background px-2 text-sm"
            />
            <button
              type="submit"
              disabled={!email.includes("@")}
              className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
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
            {err ? <span className="txt-bad">{err}</span> : null}
          </div>
        </form>
      ) : null}
      {today.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing in the calendar today.
        </p>
      ) : (
        <ul className="mt-3 divide-y">
          {(today as Any[]).map(e => {
            const k = e.kind ?? (e.clientName ? "client" : "other");
            return (
              <li
                key={`${e.owner ?? ""}${e.eventId}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm"
              >
                <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {e.allDay ? "all day" : clock(e.start)}
                </span>
                <span className="min-w-0 font-medium">{e.title}</span>
                {KIND_LABEL[k] ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {KIND_DOT[k] ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: KIND_DOT[k] }}
                      />
                    ) : null}
                    {e.clientName ?? KIND_LABEL[k]}
                  </span>
                ) : e.clientName ? (
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {e.clientName}
                  </span>
                ) : null}
                {e.meetLink ? (
                  <a
                    href={e.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Join
                  </a>
                ) : null}
                {e.attendees?.length ? (
                  <span className="basis-full pl-[4.25rem] text-xs text-muted-foreground sm:ml-auto sm:basis-auto sm:pl-0">
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
