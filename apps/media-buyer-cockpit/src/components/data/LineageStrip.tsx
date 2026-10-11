import type { ReactNode } from "react";
import {
  fmtDayString,
  fmtN,
  type PerClient,
  type Summary,
  type Tone,
} from "@/lib/dataView";
import { Verdict } from "./SheetGrid";

export type Go = (tab: "leads" | "appointments", filter: string) => void;

function Hop({
  n,
  label,
  sub,
  first,
}: {
  n: ReactNode;
  label: string;
  sub: string;
  first?: boolean;
}) {
  return (
    <div className={`dv-hop${first ? " first" : ""}`}>
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      <div className="t">{sub}</div>
    </div>
  );
}

function Flow({
  text,
  tone,
  onClick,
}: {
  text: string;
  tone?: "warn" | "bad";
  onClick?: () => void;
}) {
  return (
    <div className="dv-flow">
      {onClick ? (
        <button
          type="button"
          className={`dv-leak ${tone ?? ""}`}
          onClick={onClick}
        >
          {text}
        </button>
      ) : (
        <span className="dv-leak">{text}</span>
      )}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${fmtN(n)}`;

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
  const A = summary.appointments;
  const unknownAd = L.meta_received - L.with_ad;
  const notRecorded = L.passed - L.recorded;
  const rows = summary.per_client.filter(
    c => c.leads || c.appts || c.meta_reported,
  );
  const unmapped = summary.meta_unmapped;
  return (
    <div className="dv-compare">
      <section className="dv-card">
        <div className="dv-card-h">
          <h2>Where the counts stop matching</h2>
          <p>
            Each box is a count from one system. The label between two boxes
            says why the next count is different. Click a red or orange label to
            see the rows. Meta numbers run up to {fmtDayString(L.compare_to)},
            so the lead line stops there.
          </p>
        </div>
        <div className="dv-lineage">
          <div className="dv-pipe">
            <div className="dv-pipe-name">
              Leads
              <small>
                from Facebook ads, {fmtN(L.tracked_clients)} clients with Meta
                numbers
              </small>
            </div>
            <div className="dv-hops">
              <Hop
                first
                n={fmtN(L.meta_reported)}
                label="Meta says"
                sub="Lead count in the cockpit's Meta numbers"
              />
              {L.never_reached ? (
                <Flow
                  tone="bad"
                  text={`${fmtN(L.never_reached)} missing on gap days`}
                  onClick={() =>
                    document
                      .getElementById("dv-gapdays")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" })
                  }
                />
              ) : (
                <Flow
                  text={`${signed(L.meta_received - L.meta_reported)}, normal`}
                />
              )}
              <Hop
                n={fmtN(L.meta_received)}
                label="GHL received"
                sub="Contacts from Facebook"
              />
              {unknownAd > 0 ? (
                <Flow
                  tone="warn"
                  text={`${fmtN(unknownAd)} ad unknown`}
                  onClick={() => go("leads", "no_ad")}
                />
              ) : (
                <Flow text="All tied to ads" />
              )}
              <Hop
                n={fmtN(L.with_ad)}
                label="Tied to an ad"
                sub="We know which ad"
              />
            </div>
          </div>
          <div className="dv-pipe">
            <div className="dv-pipe-name">
              Appointments<small>booked in this range</small>
            </div>
            <div className="dv-hops">
              <Hop
                first
                n={fmtN(L.appts)}
                label="GHL has"
                sub="Appointments booked"
              />
              {A.not_counted || A.twice ? (
                <Flow
                  tone="bad"
                  text={[
                    A.not_counted ? `${fmtN(A.not_counted)} not counted` : "",
                    A.twice ? `${fmtN(A.twice)} twice` : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  onClick={() =>
                    go("appointments", A.not_counted ? "not_counted" : "twice")
                  }
                />
              ) : (
                <Flow text="All Facebook bookings counted" />
              )}
              <Hop
                n={fmtN(L.cockpit_rows)}
                label="Cockpit counts"
                sub="Rows behind the bookings card"
              />
              <Flow
                text={`${fmtN(L.appts - L.passed)} upcoming or cancelled`}
              />
              <Hop
                n={fmtN(L.passed)}
                label="Meeting time passed"
                sub="Should have a result"
              />
              {notRecorded > 0 ? (
                <Flow
                  tone="warn"
                  text={`${fmtN(notRecorded)} no result`}
                  onClick={() => go("appointments", "no_result")}
                />
              ) : (
                <Flow text="All recorded" />
              )}
              <Hop
                n={fmtN(L.recorded)}
                label="Result recorded"
                sub="Showed or no-show"
              />
            </div>
          </div>
        </div>
        <div className="dv-why" id="dv-gapdays">
          <b>Days where Meta counted 3 or more leads than GHL received</b>
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
              <div style={{ marginTop: 6 }}>
                What to do: open the client's lead form connection in GHL and
                check when it last delivered a lead. A day with fewer leads next
                to a day with more is usually timing, not a loss.
              </div>
            </>
          ) : (
            <div>None in this range.</div>
          )}
        </div>
        {unmapped && unmapped.leads > 0 ? (
          <div className="dv-why">
            <b>{fmtN(unmapped.leads)} Meta leads are not tied to a client</b>
            <div>
              {unmapped.campaigns.join(", ")} uses an ad account that is not
              linked to exactly one client, so these leads are left out of the
              line above. Link the ad account to its client to include them.
            </div>
          </div>
        ) : null}
        {L.meta_received_untracked > 0 ? (
          <div className="dv-why">
            {fmtN(L.meta_received_untracked)} Facebook leads in GHL belong to
            clients with no Meta numbers in the cockpit, so they are left out of
            the line above. They are still in the Leads tab.
          </div>
        ) : null}
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
