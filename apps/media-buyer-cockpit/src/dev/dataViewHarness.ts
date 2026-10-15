/**
 * The data view in the layout harness: made-up clients, leads and
 * appointments, answered after a delay so a switch between tabs and chips
 * can be watched (?path=/data&reads=1, ?delay=600 by default). The people
 * and phone numbers are invented. Never imported by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Answer = { data: unknown; error: { message: string } | null };
type Row = Record<string, unknown>;

const NOW = Date.parse("2026-10-11T12:00:00Z");
const HOUR = 3600e3;
const CLIENTS = [
  { location_id: "harness-loc-harbor", name: "Harbor Interiors" },
  { location_id: "harness-loc-dune", name: "Dune Contracting" },
  { location_id: "harness-loc-palm", name: "Palm Studio" },
  // An account the cockpit does not count bookings for (Mahara's own sales).
  { location_id: "harness-loc-own", name: "Mahara sales" },
];
const FIRST = [
  "Sara",
  "Omar",
  "Lina",
  "Yousef",
  "Huda",
  "Faisal",
  "Noor",
  "Khalid",
  "Reem",
  "Majed",
];
const LAST = [
  "Haddad",
  "Saleh",
  "Nasser",
  "Karim",
  "Fahad",
  "Aziz",
  "Rami",
  "Tarek",
];
const iso = (t: number) => new Date(t).toISOString();

function build() {
  const leads: Row[] = [];
  const appts: Row[] = [];
  for (let i = 0; i < 420; i++) {
    const c = CLIENTS[i % CLIENTS.length];
    const at = NOW - i * 1.7 * HOUR;
    const meta = i % 10 < 7;
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const phone = `+965 5${String(1000000 + ((i * 7919) % 8999999)).slice(0, 7)}`;
    const booked = i % 6 === 0;
    const start = at + (i % 4 === 0 ? 40 : -20) * HOUR;
    const status =
      start > NOW
        ? "confirmed"
        : ["showed", "noshow", "confirmed", "cancelled"][i % 4];
    const id = `harness-contact-${i}`;
    leads.push({
      id,
      location_id: c.location_id,
      client: c.name,
      created_at: iso(at),
      synced_at: iso(at + 0.2 * HOUR),
      channel: meta ? "Meta" : "Organic",
      source: meta ? "Facebook lead form" : "Website form",
      ad_id: meta && i % 9 !== 0 ? `ad-${i % 12}` : null,
      adset_id: meta ? `adset-${i % 5}` : null,
      campaign_id: meta ? `camp-${i % 3}` : null,
      ad_name: meta && i % 9 !== 0 ? `Villa reel ${i % 12}` : null,
      adset_name: meta ? `Kuwait 25 to 55 (${i % 5})` : null,
      campaign_name: meta ? `${c.name} leads ${i % 3}` : null,
      utm_campaign: meta ? `${c.name.split(" ")[0].toLowerCase()}-leads` : null,
      name,
      phone,
      email: `${name.split(" ")[0].toLowerCase()}${i}@example.test`,
      deleted: i % 37 === 0,
      deleted_at: i % 37 === 0 ? iso(at + 5 * HOUR) : null,
      utm_source: meta ? "facebook" : null,
      utm_content: null,
      utm_medium: meta ? "paid" : null,
      first_url: meta ? null : "https://example.test/contact",
      meeting_id: booked ? `harness-appt-${i}` : null,
      meeting_start: booked ? iso(start) : null,
      meeting_status: booked ? status : null,
      meeting_source: booked ? "calendar_page" : null,
      meetings: booked ? 1 : 0,
    });
    if (booked) {
      const calendarEvent = i % 30 === 0;
      appts.push({
        id: `harness-appt-${i}`,
        contact_id: id,
        location_id: c.location_id,
        client: c.name,
        booked_at: iso(at + 0.5 * HOUR),
        start_at: iso(start),
        status,
        ghl_source: calendarEvent ? "google_calendar" : "calendar_page",
        calendar: "Site visit",
        name,
        phone,
        lead_found: true,
        lead_channel: meta ? "Meta" : "Organic",
        lead_source: meta ? "Facebook lead form" : "Website form",
        lead_ad_name: meta ? `Villa reel ${i % 12}` : null,
        lead_campaign_name: meta ? `${c.name} leads ${i % 3}` : null,
        updated_at: iso(at + 2 * HOUR),
        deal: status === "showed" && i % 12 === 0 ? "won" : null,
        quotation: status === "showed" ? i % 2 === 0 : null,
        project_value: status === "showed" && i % 12 === 0 ? 4200 : null,
        currency: status === "showed" && i % 12 === 0 ? "KWD" : null,
        feedback: null,
        lead_quality: status === "showed" ? 3 + (i % 3) : null,
        not_closed_reason: null,
        outcome_at: status === "showed" ? iso(start + 2 * HOUR) : null,
        cockpit:
          c.location_id === "harness-loc-own"
            ? "not_tracked"
            : status === "cancelled" || calendarEvent
              ? "left_out"
              : i % 24 === 0
                ? "missing"
                : i % 18 === 0
                  ? "twice"
                  : "counted",
        cockpit_at: meta && i % 24 !== 0 ? iso(at + 1 * HOUR) : null,
        // Some results live only in the sheet (attended), not in GHL.
        result:
          status === "showed" || status === "noshow"
            ? status
            : status === "confirmed" && start < NOW && i % 3 === 0
              ? "showed"
              : null,
        // Some bookings are not in the client portal yet; one agent is new.
        notes:
          i % 7 === 0
            ? null
            : "Wants a site visit next week. Asked about the villa package and payment in two parts.",
        agent: i % 7 === 0 ? null : i % 5 === 0 ? "New Agent" : "Daniya Ziad",
        agent_number: i % 7 === 0 || i % 5 === 0 ? null : "7",
      });
    }
  }
  return { leads, appts };
}

const DATA = build();
const since = (days: number) => NOW - days * 24 * HOUR;
const past = (r: Row) => Date.parse(String(r.start_at)) <= NOW;
const counted = (r: Row) =>
  ["counted", "twice", "by_day"].includes(String(r.cockpit));

const LEAD_FILTERS: Record<string, (r: Row) => boolean> = {
  any: () => true,
  all: r => !r.deleted,
  meta: r => !r.deleted && r.channel === "Meta",
  other: r => !r.deleted && r.channel !== "Meta",
  booked: r => !r.deleted && !!r.meeting_id,
  no_ad: r => !r.deleted && r.channel === "Meta" && !r.ad_id,
  deleted: r => !!r.deleted,
};
const APPT_FILTERS: Record<string, (r: Row) => boolean> = {
  any: () => true,
  all: () => true,
  upcoming: r => !past(r) && r.status !== "cancelled",
  showed: r => r.result === "showed",
  not_counted: r => r.cockpit === "missing",
  twice: r => r.cockpit === "twice",
  no_result: r =>
    past(r) &&
    r.status === "confirmed" &&
    !r.result &&
    r.ghl_source !== "google_calendar",
  calendar: r => r.ghl_source === "google_calendar",
  counted_no_result: r => counted(r) && past(r) && !r.result,
};

function scoped(kind: "leads" | "appointments", loc: unknown, days: unknown) {
  const from = since(Number(days) || 30);
  const rows = kind === "leads" ? DATA.leads : DATA.appts;
  const at = kind === "leads" ? "created_at" : "booked_at";
  return rows.filter(
    r => (!loc || r.location_id === loc) && Date.parse(String(r[at])) >= from,
  );
}

/** The Compare tab's booking line, by the same rules as the SQL. */
function bookingLine(appts: Row[]) {
  const line = appts.filter(
    r => r.cockpit !== "not_tracked" && r.cockpit !== "not_ad",
  );
  const n = (f: (r: Row) => boolean) => line.filter(f).length;
  const left = (r: Row) => r.cockpit === "left_out";
  const outside = new Map<
    string,
    { location_id: string; client: string; n: number; meta: number }
  >();
  for (const r of appts.filter(r => r.cockpit === "not_tracked")) {
    const o = outside.get(String(r.location_id)) ?? {
      location_id: String(r.location_id),
      client: String(r.client),
      n: 0,
      meta: 0,
    };
    o.n += 1;
    if (r.lead_channel === "Meta") o.meta += 1;
    outside.set(o.location_id, o);
  }
  return {
    appts: line.length,
    clients: new Set(line.map(r => r.location_id)).size,
    counted: n(counted),
    twice: n(r => r.cockpit === "twice"),
    cancelled: n(r => left(r) && r.status === "cancelled"),
    calendar: n(
      r =>
        left(r) &&
        r.status !== "cancelled" &&
        r.ghl_source === "google_calendar",
    ),
    provisional: n(
      r =>
        left(r) &&
        r.status !== "cancelled" &&
        r.ghl_source !== "google_calendar",
    ),
    other_booking: n(r => r.cockpit === "other_booking"),
    not_counted: n(r => r.cockpit === "missing" || r.cockpit === "missing_old"),
    ahead: n(r => counted(r) && !past(r)),
    passed: n(r => counted(r) && past(r)),
    showed: n(r => counted(r) && past(r) && r.result === "showed"),
    noshow: n(r => counted(r) && past(r) && r.result === "noshow"),
    outside: [...outside.values()].sort((a, b) => b.n - a.n),
    old_not_ad: appts.filter(r => r.cockpit === "not_ad").length,
  };
}

function summary(loc: unknown, days: unknown) {
  const n = Number(days) || 30;
  const leads = scoped("leads", loc, n);
  const appts = scoped("appointments", loc, n);
  const count = (
    rows: Row[],
    f: Record<string, (r: Row) => boolean>,
    k: string,
  ) => rows.filter(f[k]).length;
  const per = CLIENTS.filter(c => !loc || c.location_id === loc).map(c => {
    const l = leads.filter(r => r.location_id === c.location_id);
    const a = appts.filter(r => r.location_id === c.location_id);
    return {
      location_id: c.location_id,
      client: c.name,
      leads: count(l, LEAD_FILTERS, "all"),
      meta_leads: count(l, LEAD_FILTERS, "meta"),
      no_ad: count(l, LEAD_FILTERS, "no_ad"),
      deleted: count(l, LEAD_FILTERS, "deleted"),
      meta_tracked: true,
      meta_reported: count(l, LEAD_FILTERS, "meta") + 2,
      meta_received: count(l, LEAD_FILTERS, "meta"),
      never_reached: 0,
      appts: a.length,
      counted: a.filter(counted).length,
      not_counted: count(a, APPT_FILTERS, "not_counted"),
      twice: count(a, APPT_FILTERS, "twice"),
      not_tracked: a.filter(r => r.cockpit === "not_tracked").length,
      calendar: count(a, APPT_FILTERS, "calendar"),
      no_result: count(a, APPT_FILTERS, "no_result"),
      passed: a.filter(past).length,
      recorded: a.filter(r => !!r.result).length,
      showed: count(a, APPT_FILTERS, "showed"),
      upcoming: count(a, APPT_FILTERS, "upcoming"),
      cancelled: a.filter(r => r.status === "cancelled").length,
      won: a.filter(r => r.deal === "won").length,
    };
  });
  const sum = (k: keyof (typeof per)[number]) =>
    per.reduce((t, p) => t + Number(p[k]), 0);
  const sync = {
    newest: iso(NOW - 0.6 * HOUR),
    oldest: iso(NOW - 0.9 * HOUR),
    locations: 3,
    ok: 3,
    failing: [],
  };
  return {
    location_id: loc ?? null,
    days: n,
    from_day: new Date(since(n)).toISOString().slice(0, 10),
    to_day: "2026-10-11",
    clients: CLIENTS.map(c => ({ ...c, status: "Active", clickup_id: null })),
    freshness: {
      now: iso(NOW),
      leads: sync,
      appointments: sync,
      meta_last_day: "2026-10-10",
      bookings_last_day: "2026-10-10",
      bookings_imported_at: iso(NOW - HOUR),
      outcomes_last_at: iso(NOW - 3 * HOUR),
    },
    leads: {
      all: count(leads, LEAD_FILTERS, "all"),
      meta: count(leads, LEAD_FILTERS, "meta"),
      other: count(leads, LEAD_FILTERS, "other"),
      booked: count(leads, LEAD_FILTERS, "booked"),
      no_ad: count(leads, LEAD_FILTERS, "no_ad"),
      deleted: count(leads, LEAD_FILTERS, "deleted"),
    },
    appointments: {
      all: appts.length,
      upcoming: count(appts, APPT_FILTERS, "upcoming"),
      showed: count(appts, APPT_FILTERS, "showed"),
      not_counted: count(appts, APPT_FILTERS, "not_counted"),
      no_result: count(appts, APPT_FILTERS, "no_result"),
      calendar: count(appts, APPT_FILTERS, "calendar"),
      calendar_counted: 0,
      twice: count(appts, APPT_FILTERS, "twice"),
      not_tracked: 0,
      other_booking: 0,
      counted: sum("counted"),
      by_day: 0,
      meta_leads: sum("meta_leads"),
    },
    lineage: {
      meta_reported: sum("meta_reported"),
      meta_received: sum("meta_received"),
      meta_received_untracked: 0,
      tracked_clients: per.length,
      never_reached: 0,
      with_ad: sum("meta_leads") - sum("no_ad"),
      appts: appts.length,
      cockpit_rows: sum("counted") + sum("twice") * 2,
      passed: sum("passed"),
      recorded: sum("recorded"),
      compare_to: "2026-10-10",
      bookings: bookingLine(appts),
    },
    per_client: per,
    gap_days: [],
    meta_unmapped: null,
  };
}

function rows(args: Record<string, unknown>) {
  const kind = args.p_kind === "appointments" ? "appointments" : "leads";
  const filters = kind === "leads" ? LEAD_FILTERS : APPT_FILTERS;
  const keep = filters[String(args.p_filter ?? "all")] ?? filters.all;
  const q = String(args.p_search ?? "").toLowerCase();
  const matched = scoped(kind, args.p_location, args.p_days)
    .filter(keep)
    .filter(
      r =>
        !q ||
        `${r.name} ${r.phone} ${r.campaign_name ?? r.lead_campaign_name ?? ""}`
          .toLowerCase()
          .includes(q),
    );
  const from = Number(args.p_cursor ?? 0);
  const limit = Number(args.p_limit ?? 150);
  const page = matched.slice(from, from + limit);
  return {
    kind,
    total: matched.length,
    rows: page,
    next_cursor: from + limit < matched.length ? String(from + limit) : null,
  };
}

function record(id: unknown) {
  const appt = DATA.appts.find(a => a.id === id);
  const lead =
    DATA.leads.find(l => l.id === id || l.id === appt?.contact_id) ?? null;
  return {
    id: String(id),
    contact_id: (lead?.id as string) ?? null,
    location_id: String(
      lead?.location_id ?? appt?.location_id ?? CLIENTS[0].location_id,
    ),
    lead,
    appointments: DATA.appts.filter(a => a.contact_id === lead?.id),
    raw: { note: "Harness record: made-up data." },
    sync: {
      leads_synced_at: iso(NOW - HOUR),
      appointments_synced_at: iso(NOW - HOUR),
    },
  };
}

/**
 * Answer the data view's functions from the made-up rows, and give the
 * harness session a confirmed user, since the data view checks the signed-in
 * account around every call.
 */
export function installDataViewHarness(client: SupabaseClient) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("path") !== "/data") return;
  const delay = Number(params.get("delay") ?? 600);
  const user = {
    id: "harness-ceo",
    email: "ceo@example.test",
    email_confirmed_at: iso(NOW),
  };
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    auth: {
      onAuthStateChange: () => unknown;
      getUser: () => Promise<unknown>;
      getSession: () => Promise<unknown>;
    };
  };
  c.auth.onAuthStateChange = () => ({
    data: { subscription: { unsubscribe: () => {} } },
  });
  c.auth.getUser = async () => ({ data: { user }, error: null });
  c.auth.getSession = async () => ({
    data: { session: { user } },
    error: null,
  });
  const previous = c.rpc.bind(c);
  c.rpc = async (name, args = {}) => {
    // The shell's own reads, which run once the harness has a session.
    if (name === "cockpit_adopt_member") return { data: false, error: null };
    if (name === "cockpit_get_ask_ai_thread") return { data: [], error: null };
    if (!name.startsWith("cockpit_data_view_")) return previous(name, args);
    await new Promise(r => setTimeout(r, delay));
    if (name === "cockpit_data_view_summary")
      return { data: summary(args.p_location, args.p_days), error: null };
    if (name === "cockpit_data_view_rows")
      return { data: rows(args), error: null };
    if (name === "cockpit_data_view_record")
      return { data: record(args.p_id), error: null };
    if (name === "cockpit_data_view_export") {
      const all = rows({ ...args, p_limit: 5000 });
      return {
        data: {
          kind: all.kind,
          total: all.total,
          rows: all.rows,
          truncated: false,
        },
        error: null,
      };
    }
    return {
      data: null,
      error: { message: `The harness has no fixture for ${name}.` },
    };
  };
}
