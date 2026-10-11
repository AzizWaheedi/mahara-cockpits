import type { SupabaseClient } from "@supabase/supabase-js";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  apptIssues,
  buildStory,
  debugBundle,
  ghlContactUrl,
  leadIssues,
  plainSource,
  type RecordData,
} from "@/lib/dataView";
import { fetchRecord } from "@/lib/dataViewClient";
import { Verdict } from "./SheetGrid";

const NA = <span className="na">—</span>;

/**
 * The person behind one row: verdict, story, where they came from, then the
 * technical details. Not modal: the table stays usable while it is open.
 * Opening it writes one audit row (cockpit_data_view_record).
 */
export function RecordDrawer({
  id,
  client,
  actor,
  now,
  onClose,
  toast,
}: {
  id: string | null;
  client: SupabaseClient | null;
  actor: string | null;
  now: number;
  onClose: () => void;
  toast: (text: string) => void;
}) {
  const [state, setState] = useState<{
    id: string | null;
    data: RecordData | null;
    error: string | null;
  }>({
    id: null,
    data: null,
    error: null,
  });
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!id || !client || !actor) return;
    let live = true;
    setState({ id, data: null, error: null });
    fetchRecord(client, actor, id)
      .then(data => live && setState({ id, data, error: null }))
      .catch(
        error =>
          live &&
          setState({
            id,
            data: null,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
    return () => {
      live = false;
    };
  }, [id, client, actor]);
  useEffect(() => {
    if (id) panel.current?.focus({ preventScroll: true });
  }, [id]);

  const rec = state.id === id ? state.data : null;
  const error = state.id === id ? state.error : null;
  const lead = rec?.lead ?? null;
  const first = rec?.appointments[0] ?? null;
  const issues = rec
    ? [
        ...(lead ? leadIssues(lead) : []),
        ...rec.appointments.flatMap(a => apptIssues(a, now)),
      ]
    : [];
  const name = lead?.name || first?.name || (rec ? "No name" : "Loading");
  const phone = lead?.phone || first?.phone;
  const contact = rec?.contact_id;

  const copy = () => {
    if (!rec) return;
    const text = JSON.stringify(debugBundle(rec, now), null, 2);
    navigator.clipboard?.writeText(text).then(
      () => toast("Copied the debug bundle"),
      () => toast("The browser blocked the copy"),
    );
  };

  return (
    <aside
      ref={panel}
      className={`dv-panel${id ? " open" : ""}`}
      aria-labelledby="dv-p-title"
      aria-hidden={!id}
      tabIndex={-1}
    >
      <div className="dv-p-head">
        <button
          type="button"
          className="dv-iconbtn dv-close"
          onClick={onClose}
          aria-label="Close details"
        >
          <X className="size-4" />
        </button>
        <div className="dv-eyebrow">
          {rec
            ? lead
              ? "Lead"
              : "Appointment without a lead record"
            : "Details"}
        </div>
        <h3 id="dv-p-title">{name}</h3>
        <div className="muted">
          {lead?.client ?? first?.client ?? ""}
          {phone ? (
            <>
              {" · "}
              <span className="mono">{phone}</span>
            </>
          ) : null}
        </div>
        {rec ? (
          <div className="dv-p-verdict">
            {issues.length ? (
              issues.map(i => (
                <div key={i.label}>
                  <Verdict issues={[i]} />
                  <div
                    className="muted"
                    style={{ fontSize: 12.5, margin: "4px 0 0 2px" }}
                  >
                    {i.why}
                  </div>
                </div>
              ))
            ) : (
              <div>
                <Verdict issues={[]} />
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  Every check passed for this person.
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div className="dv-p-body">
        {error ? (
          <div className="dv-p-sec">
            <div className="dv-alert">{error}</div>
          </div>
        ) : !rec ? (
          <div className="dv-p-sec" aria-busy="true">
            <div className="dv-skel" style={{ width: "70%" }} />
            <div className="dv-skel" style={{ width: "45%", marginTop: 10 }} />
            <div className="dv-skel" style={{ width: "60%", marginTop: 10 }} />
          </div>
        ) : (
          <>
            <section className="dv-p-sec">
              <h4>What happened</h4>
              <ol className="dv-story">
                {buildStory(rec, now).map((s, i) => (
                  <li key={`${i}-${s.title}`} className={s.tone || undefined}>
                    <div className="tt">{s.title}</div>
                    {s.meta ? <div className="tm">{s.meta}</div> : null}
                  </li>
                ))}
              </ol>
            </section>
            {lead ? (
              <section className="dv-p-sec">
                <h4>Where they came from</h4>
                <dl className="dv-kv">
                  <dt>Channel</dt>
                  <dd>{plainSource(lead.source, lead.channel)}</dd>
                  <dt>Campaign</dt>
                  <dd>{lead.campaign_name ?? lead.utm_campaign ?? NA}</dd>
                  <dt>Ad set</dt>
                  <dd>{lead.adset_name ?? NA}</dd>
                  <dt>Ad</dt>
                  <dd>
                    {lead.ad_name ?? (lead.ad_id ? `Ad ${lead.ad_id}` : NA)}
                  </dd>
                  <dt>First page</dt>
                  <dd className="m">{lead.first_url ?? NA}</dd>
                </dl>
              </section>
            ) : null}
            <section className="dv-p-sec">
              <details className="dv-tech">
                <summary>Technical details for debugging</summary>
                <div className="tin">
                  <dl className="dv-kv">
                    <dt>Contact ID</dt>
                    <dd className="m">{contact ?? NA}</dd>
                    <dt>Location ID</dt>
                    <dd className="m">{rec.location_id}</dd>
                    {rec.appointments.map(a => [
                      <dt key={`${a.id}-t`}>Appointment ID</dt>,
                      <dd key={`${a.id}-d`} className="m">
                        {a.id}
                      </dd>,
                    ])}
                    {lead?.ad_id ? (
                      <>
                        <dt>Ad ID</dt>
                        <dd className="m">{lead.ad_id}</dd>
                      </>
                    ) : null}
                    <dt>Tables</dt>
                    <dd className="m">
                      client_leads, appointments, cockpit_media_booking_events,
                      appointment_outcomes
                    </dd>
                  </dl>
                  <pre>{JSON.stringify(rec.raw, null, 2)}</pre>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className="dv-btn small"
                      onClick={copy}
                    >
                      Copy debug bundle
                    </button>
                    {contact ? (
                      <a
                        className="dv-btn small"
                        href={ghlContactUrl(rec.location_id, contact)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in GHL
                      </a>
                    ) : null}
                  </div>
                  <p
                    className="muted"
                    style={{ fontSize: 12, margin: "8px 0 0" }}
                  >
                    The bundle holds IDs and the story only, no phone or email.
                    Opening this panel writes one audit row.
                  </p>
                </div>
              </details>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
