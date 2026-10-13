import { ChevronRight, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  type BookingLine,
  fmtDayString,
  fmtN,
  type PerClient,
  type Summary,
  type Tone,
} from "@/lib/dataView";
import { Verdict } from "./SheetGrid";

export type Go = (tab: "leads" | "appointments", filter: string) => void;

/** The system that holds a count; its dot colour names it on every step. */
type System = "meta" | "ghl" | "cockpit";
const SYSTEM: Record<System, string> = {
  meta: "Meta",
  ghl: "GHL",
  cockpit: "Cockpit",
};

/** One count from one system, with its share of the line's largest count. */
function Step({
  system,
  n,
  label,
  sub,
  max,
  source,
}: {
  system: System;
  n: number;
  label: string;
  sub: ReactNode;
  max: number;
  source?: boolean;
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, n) / max) : 0;
  return (
    <div className={`dv-step${source ? " source" : ""}`}>
      <div className={`dv-step-sys ${system}`}>{SYSTEM[system]}</div>
      <div className="dv-step-n">{fmtN(n)}</div>
      <div className="dv-step-l">{label}</div>
      <div className="dv-step-t">{sub}</div>
      <div className="dv-step-bar" aria-hidden>
        <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

/**
 * Why the next count differs. Grey is left out by design, orange needs a
 * check, red is a miss; a reason with rows behind it opens them.
 */
type Reason = {
  text: string;
  tone: "grey" | "warn" | "bad";
  hint?: string;
  onClick?: () => void;
};

/** A reason only when its count is not zero. */
const reason = (
  n: number,
  text: string | [one: string, many: string],
  r: Omit<Reason, "text">,
) =>
  n
    ? [
        {
          ...r,
          text: `${fmtN(n)} ${typeof text === "string" ? text : text[n === 1 ? 0 : 1]}`,
        },
      ]
    : [];

const signed = (n: number) =>
  n > 0 ? `+${fmtN(n)}` : n < 0 ? `−${fmtN(-n)}` : "0";

function Gap({
  delta,
  reasons,
  empty,
}: {
  delta: number;
  reasons: Reason[];
  empty: string;
}) {
  return (
    <div className="dv-gap">
      <div className="dv-gap-delta">{delta ? signed(delta) : ""}</div>
      <div className="dv-gap-line" aria-hidden />
      <ul className="dv-gap-why">
        {reasons.length ? (
          reasons.map(r => (
            <li key={r.text}>
              {r.onClick ? (
                <button
                  type="button"
                  className={`dv-reason ${r.tone}`}
                  title={r.hint}
                  onClick={r.onClick}
                >
                  <span className="dot" aria-hidden />
                  <span>{r.text}</span>
                  <ChevronRight className="chev" aria-hidden />
                </button>
              ) : (
                <span className={`dv-reason ${r.tone}`} title={r.hint}>
                  <span className="dot" aria-hidden />
                  <span>{r.text}</span>
                </span>
              )}
            </li>
          ))
        ) : (
          <li>
            <span className="dv-reason quiet">{empty}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function Line({
  name,
  sub,
  children,
}: {
  name: string;
  sub: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dv-pipe">
      <div className="dv-pipe-name">
        {name}
        <small>{sub}</small>
      </div>
      <div className="dv-hops">{children}</div>
    </div>
  );
}

/** A quiet note under the lines: what is left out, and what to do. */
function Note({
  tone,
  title,
  id,
  children,
}: {
  tone: "warn" | "info";
  title: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <div className={`dv-note ${tone}`} id={id}>
      <Icon className="dv-note-icon" aria-hidden />
      <div className="min-w-0">
        <b>{title}</b>
        <div className="dv-note-body">{children}</div>
      </div>
    </div>
  );
}

/** "A (22), B (2) and 3 more", each name opening that account. */
function Accounts({
  list,
  onClient,
}: {
  list: BookingLine["outside"];
  onClient: (location: string) => void;
}) {
  const top = list.slice(0, 3);
  return (
    <>
      {top.map((o, i) => (
        <span key={o.location_id}>
          {i ? (i === top.length - 1 && list.length <= 3 ? " and " : ", ") : ""}
          <button
            type="button"
            className="dv-link"
            onClick={() => onClient(o.location_id)}
          >
            <bdi>{o.client}</bdi>
          </button>{" "}
          ({fmtN(o.n)})
        </span>
      ))}
      {list.length > 3 ? ` and ${list.length - 3} more` : ""}
    </>
  );
}

/** The likely reason a client's counts do not match, in one phrase. */
export function likelyReason(
  c: PerClient,
  gapDays: Summary["gap_days"],
): [Tone, string] {
  const days = gapDays.filter(g => g.location_id === c.location_id);
  if (days.length)
    return [
      "bad",
      `Lead form gap on ${days
        .slice(0, 3)
        .map(g => fmtDayString(g.day))
        .join(
          ", ",
        )}${days.length > 3 ? ` and ${days.length - 3} more days` : ""}`,
    ];
  if (c.not_counted)
    return [
      "bad",
      `${c.not_counted} booking${c.not_counted > 1 ? "s" : ""} not counted by the cockpit`,
    ];
  if (c.twice)
    return ["bad", `${c.twice} booking${c.twice > 1 ? "s" : ""} counted twice`];
  if (!c.meta_tracked && c.meta_received)
    return ["grey", "No Meta campaign tied to this client"];
  if (c.meta_reported === null) return ["grey", "No Meta numbers"];
  const gap = c.meta_received - c.meta_reported;
  if (Math.abs(gap) <= Math.max(2, c.meta_reported * 0.15))
    return ["ok", "Normal timing difference"];
  return gap > 0
    ? ["warn", "GHL has extra leads, likely repeat forms"]
    : ["warn", "Gap worth a look"];
}

function BookingSteps({ b, go }: { b: BookingLine; go: Go }) {
  const max = Math.max(b.appts, b.counted);
  const noResult = b.passed - b.showed - b.noshow;
  return (
    <>
      <Step
        source
        system="ghl"
        n={b.appts}
        label="GHL has"
        sub="Bookings made in this range"
        max={max}
      />
      <Gap
        delta={b.counted - b.appts}
        empty="All counted"
        reasons={[
          ...reason(b.cancelled, "cancelled", {
            tone: "grey",
            hint: "The cockpit counts only bookings that still stand.",
          }),
          ...reason(b.calendar, ["calendar copy", "calendar copies"], {
            tone: "grey",
            hint: "The client's own Google Calendar events, copied into GHL. They are not lead bookings.",
          }),
          ...reason(b.provisional, "provisional or callback", {
            tone: "grey",
            hint: "The cockpit leaves out the provisional, callback and reschedule calendars.",
          }),
          ...reason(b.other_booking, "rebooked", {
            tone: "grey",
            hint: "The cockpit counted another booking by the same person, usually the first one before a reschedule.",
          }),
          ...reason(b.not_counted, "not counted", {
            tone: "bad",
            hint: "In GHL, but not on the cockpit's bookings card. Open them to see each one.",
            onClick: () => go("appointments", "not_counted"),
          }),
          ...reason(b.twice, "counted twice", {
            tone: "bad",
            hint: "On the bookings card twice: once from the old system and once from the new sync.",
            onClick: () => go("appointments", "twice"),
          }),
        ]}
      />
      <Step
        system="cockpit"
        n={b.counted}
        label="Cockpit counts"
        sub="On the bookings card"
        max={max}
      />
      <Gap
        delta={-b.ahead}
        empty="None ahead"
        reasons={reason(b.ahead, "still ahead", {
          tone: "grey",
          hint: "The meeting time has not come yet.",
        })}
      />
      <Step
        system="cockpit"
        n={b.passed}
        label="Meeting time passed"
        sub="Should have a result"
        max={max}
      />
      <Gap
        delta={-noResult}
        empty="All recorded"
        reasons={reason(noResult, "no result", {
          tone: "warn",
          hint: 'Nobody marked "showed" or "no-show" in GHL or the sheet. Open them to see each one.',
          onClick: () => go("appointments", "counted_no_result"),
        })}
      />
      <Step
        system="ghl"
        n={b.showed + b.noshow}
        label="Result recorded"
        sub={`${fmtN(b.showed)} showed, ${fmtN(b.noshow)} no-show`}
        max={max}
      />
    </>
  );
}

export function CompareTab({
  summary,
  go,
  onClient,
}: {
  summary: Summary;
  go: Go;
  onClient: (location: string) => void;
}) {
  const L = summary.lineage;
  const B = L.bookings;
  const unknownAd = L.meta_received - L.with_ad;
  // Meta's count, less the leads lost on gap days, plus whatever GHL has
  // extra on the other days, is GHL's count.
  const otherDays = L.meta_received - L.meta_reported + L.never_reached;
  const leadMax = Math.max(L.meta_reported, L.meta_received);
  const rows = summary.per_client.filter(
    c => c.leads || c.appts || c.meta_reported,
  );
  const unmapped = summary.meta_unmapped;
  const viaFacebook = B?.outside.filter(o => o.meta > 0) ?? [];
  const outsideTotal = B?.outside.reduce((t, o) => t + o.n, 0) ?? 0;
  return (
    <div className="dv-compare">
      <section className="dv-card">
        <div className="dv-card-h">
          <h2>Where the counts stop matching</h2>
          <p>
            Each box is a count from one system. The labels between two boxes
            say why the next count is different. Labels with an arrow open their
            rows. Meta numbers run up to {fmtDayString(L.compare_to)}, so the
            lead line stops there.
          </p>
          <ul className="dv-legend" aria-label="Label colours">
            <li>
              <span className="dot grey" aria-hidden />
              Left out by design
            </li>
            <li>
              <span className="dot warn" aria-hidden />
              Needs a check
            </li>
            <li>
              <span className="dot bad" aria-hidden />
              Missed
            </li>
          </ul>
        </div>
        <div className="dv-lineage">
          <Line
            name="Leads"
            sub={`from Facebook ads, ${fmtN(L.tracked_clients)} clients with Meta numbers`}
          >
            <Step
              source
              system="meta"
              n={L.meta_reported}
              label="Meta says"
              sub="Leads in the cockpit's Meta numbers"
              max={leadMax}
            />
            <Gap
              delta={L.meta_received - L.meta_reported}
              empty="Counts match"
              reasons={[
                ...reason(L.never_reached, "missing on gap days", {
                  tone: "bad",
                  hint: "Days where Meta counted 3 or more leads than GHL received.",
                  onClick: () =>
                    document
                      .getElementById("dv-gapdays")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                }),
                ...(otherDays > 0
                  ? reason(otherDays, "extra in GHL", {
                      tone: "grey",
                      hint: "Usually repeat form fills, or leads Meta dates on another day.",
                    })
                  : reason(-otherDays, "fewer in GHL", {
                      tone: "grey",
                      hint: "Usually timing: Meta and GHL date a lead a little differently.",
                    })),
              ]}
            />
            <Step
              system="ghl"
              n={L.meta_received}
              label="GHL received"
              sub="Contacts from Facebook"
              max={leadMax}
            />
            <Gap
              delta={L.with_ad - L.meta_received}
              empty="All tied to ads"
              reasons={reason(unknownAd, "ad unknown", {
                tone: "warn",
                hint: "GHL did not receive the ad id for these leads.",
                onClick: () => go("leads", "no_ad"),
              })}
            />
            <Step
              system="ghl"
              n={L.with_ad}
              label="Tied to an ad"
              sub="We know which ad"
              max={leadMax}
            />
          </Line>
          <Line
            name="Appointments"
            sub={
              B
                ? `booked in this range, at ${fmtN(B.clients)} clients the cockpit counts bookings for`
                : "booked in this range"
            }
          >
            {B ? (
              <BookingSteps b={B} go={go} />
            ) : (
              <div className="dv-step-wait">
                The booking line appears after the next database update.
              </div>
            )}
          </Line>
        </div>
        <div className="dv-notes">
          <Note
            tone={summary.gap_days.length ? "warn" : "info"}
            id="dv-gapdays"
            title="Days where Meta counted 3 or more leads than GHL received"
          >
            {summary.gap_days.length ? (
              <>
                <ul>
                  {summary.gap_days.map(g => (
                    <li key={`${g.location_id}-${g.day}`}>
                      <bdi>{g.client}</bdi>, {fmtDayString(g.day)}: Meta says{" "}
                      {fmtN(g.meta)}, GHL received {fmtN(g.ghl)}.
                    </li>
                  ))}
                </ul>
                What to do: open the client's lead form connection in GHL and
                check when it last delivered a lead. A day with fewer leads next
                to a day with more is usually timing, not a loss.
              </>
            ) : (
              "None in this range."
            )}
          </Note>
          {B && outsideTotal > 0 ? (
            <Note
              tone="info"
              title={`${fmtN(outsideTotal)} bookings are outside the appointment line`}
            >
              <Accounts list={B.outside} onClient={onClient} /> have no campaign
              and no bookings in the cockpit, so nothing there counts them.
              {viaFacebook.map(o => (
                <div key={o.location_id} className="dv-note-do">
                  <bdi>{o.client}</bdi> has {fmtN(o.meta)} booking
                  {o.meta > 1 ? "s" : ""} from Facebook leads. Link its ad
                  account to the client to count them.
                </div>
              ))}
            </Note>
          ) : null}
          {B?.old_not_ad ? (
            <Note
              tone="info"
              title={`${fmtN(B.old_not_ad)} older bookings are outside the appointment line`}
            >
              They were made before 8 Sep and came from no ad. The cockpit
              counted only ad bookings then.
            </Note>
          ) : null}
          {B && L.cockpit_rows !== B.counted + B.twice ? (
            <Note tone="info" title="The bookings card has other rows">
              The bookings card has {fmtN(L.cockpit_rows)} rows for these days,
              and {fmtN(B.counted + B.twice)} of them match a booking above.
            </Note>
          ) : null}
          {unmapped && unmapped.leads > 0 ? (
            <Note
              tone="info"
              title={`${fmtN(unmapped.leads)} Meta leads are not tied to a client`}
            >
              {unmapped.campaigns.join(", ")} uses an ad account that is not
              linked to exactly one client, so these leads are left out of the
              lead line. Link the ad account to its client to include them.
            </Note>
          ) : null}
          {L.meta_received_untracked > 0 ? (
            <Note
              tone="info"
              title={`${fmtN(L.meta_received_untracked)} Facebook leads are outside the lead line`}
            >
              They belong to clients with no Meta numbers in the cockpit. They
              are still in the Leads tab.
            </Note>
          ) : null}
        </div>
      </section>

      <section className="dv-card">
        <div className="dv-card-h">
          <h2>Client by client</h2>
          <p>
            Facebook leads up to {fmtDayString(L.compare_to)}. A gap of one or
            two is normal, because Meta and GHL record the time a little
            differently.
          </p>
        </div>
        <div className="dv-plain">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th className="num">Meta says</th>
                <th className="num">GHL received</th>
                <th className="num">Difference</th>
                <th className="num">Booked in GHL</th>
                <th className="num">Cockpit counted</th>
                <th>Likely reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const reason = likelyReason(c, summary.gap_days);
                const gap =
                  c.meta_reported === null
                    ? null
                    : c.meta_received - c.meta_reported;
                return (
                  <tr
                    key={c.location_id}
                    onClick={() => onClient(c.location_id)}
                  >
                    <td>
                      <b style={{ fontWeight: 500 }}>
                        <bdi>{c.client}</bdi>
                      </b>
                    </td>
                    <td className="num">
                      {c.meta_reported === null ? (
                        <span className="na">Not available</span>
                      ) : (
                        fmtN(c.meta_reported)
                      )}
                    </td>
                    <td className="num">{fmtN(c.meta_received)}</td>
                    <td
                      className={`num ${gap !== null && gap <= -3 ? "gap-bad" : reason[0] === "warn" ? "gap-warn" : "muted"}`}
                    >
                      {gap === null ? "—" : signed(gap)}
                    </td>
                    <td className="num">{fmtN(c.appts)}</td>
                    <td
                      className={`num ${c.not_counted || c.twice ? "gap-bad" : ""}`}
                    >
                      {fmtN(c.counted)}
                      {c.twice ? ` (${c.twice} twice)` : ""}
                    </td>
                    <td>
                      <Verdict
                        issues={
                          reason[0] === "ok"
                            ? []
                            : [{ tone: reason[0], label: reason[1] }]
                        }
                        okText={reason[1]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dv-foot">
          Click a client to see its leads. "Not available" means the cockpit has
          no Meta campaign tied to that client.
        </div>
      </section>
    </div>
  );
}
