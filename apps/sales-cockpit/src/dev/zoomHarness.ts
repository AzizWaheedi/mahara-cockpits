/**
 * The harness's stand-in for sales-api's Zoom link and group actions
 * (zoomlinks.ts, groups.ts), with state between presses, so the "Zoom link"
 * card and the WhatsApp group kit can be walked without a server or Zoom.
 * Knobs, set in the address (src/dev/harness.tsx):
 *
 *   zoom   own | shared | busy | off | nokeys | fail   (shared by default)
 *          own: the seat hosts it (Start the meeting); shared: the shared
 *          host, both join; busy: shared, and the shared Zoom is in another
 *          meeting; off: the switch is off (no button); nokeys: Zoom's keys
 *          are missing on the server; fail: Zoom refuses the create
 *   group  none | made   (made: the group row is already there)
 *
 * Nothing here is a real meeting or a real lead.
 */
import { Refused } from "./liveHarness";

type Row = Record<string, unknown>;

export type ZoomKnobs = {
  zoom: "own" | "shared" | "busy" | "off" | "nokeys" | "fail";
  group: "none" | "made";
};

const ZOOMS = ["own", "shared", "busy", "off", "nokeys", "fail"] as const;

export function zoomKnobs(params: URLSearchParams): ZoomKnobs {
  const z = params.get("zoom");
  return {
    zoom: ZOOMS.find(k => k === z) ?? "shared",
    group: params.get("group") === "made" ? "made" : "none",
  };
}

// sales-api's own sentences (zoomlinks.ts), so the screens show the real words.
const OFF = "Zoom links are switched off. Ask Aziz to switch them on.";
const NO_KEYS =
  "Zoom is not connected on the server yet (its keys are missing). Ask Aziz.";
const BUSY =
  "The shared Zoom is in another meeting right now. Until it ends, they may see 'waiting for the host'. A Zoom licence of your own ends the sharing: ask Aziz.";
const INVITE_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,64}$/;

/** The rows the harness's tables read: kept here, so a press shows on the next read. */
const links: Row[] = [];
const groups: Row[] = [];
let seq = 81_234_567_890;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function seedGroups(k: ZoomKnobs, now: number) {
  if (k.group !== "made" || groups.length) return;
  groups.push({
    id: id(7001),
    // lead-11 has the fixtures' demo tomorrow (a11).
    contact_id: "lead-11",
    appointment_id: "a11",
    name: "Al Mutairi Contracting | Mahara Media",
    invite_link: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv",
    made_by: "sara@example.com",
    made_at: new Date(now - 40 * 60_000).toISOString(),
    updated_at: new Date(now - 40 * 60_000).toISOString(),
    crm_note: "written",
  });
}

/** sales-api's answer for zoom.link, zoom.start, zoom.link.shared and group.made; null for any other action. */
export function zoomAnswer(
  action: string,
  b: Row,
  k: ZoomKnobs,
  now: number,
): Row | null {
  if (action === "zoom.link") {
    if (k.zoom === "off") throw new Refused(OFF, 409, "off");
    if (k.zoom === "nokeys") throw new Refused(NO_KEYS, 503, "no_keys");
    if (k.zoom === "fail")
      throw new Refused(
        "Zoom did not make the meeting: Invalid meeting settings. Try again.",
        502,
      );
    const contact = String(b.contact_id ?? "");
    const kind = b.kind === "demo" ? "demo" : "intro";
    const own = k.zoom === "own";
    const kept =
      b.fresh === true
        ? null
        : links.find(
            r =>
              r.contact_id === contact &&
              r.call_kind === kind &&
              !r.deleted_at &&
              now - Date.parse(String(r.made_at)) < 12 * 3_600_000,
          );
    const row = kept ?? {
      id: id(seq % 1_000_000),
      contact_id: contact,
      seat_email: "aziz@maharamedia.com",
      call_kind: kind,
      host_kind: own ? "own" : "shared",
      host_email: "aziz@maharamedia.com",
      meeting_id: String(seq),
      join_url: `https://us06web.zoom.us/j/${seq}?pwd=bH2kRw9TqLm4XcVz7NpY1aSd3FgJ.1`,
      made_at: new Date(now).toISOString(),
      deleted_at: null,
      started_at: null,
    };
    if (!kept) {
      seq++;
      links.unshift(row);
    }
    return {
      link: {
        id: row.id,
        join_url: row.join_url,
        kind,
        host: row.host_kind,
        host_name: "Aziz Waheedi",
        made_at: row.made_at,
      },
      reused: Boolean(kept),
      warning: k.zoom === "busy" && !kept ? BUSY : null,
      rep: { name: "Aziz Waheedi", name_ar: "عزيز" },
    };
  }
  if (action === "zoom.start") {
    const row = links.find(r => r.id === b.id);
    if (!row) throw new Refused("That Zoom link is not in the cockpit.", 404);
    if (row.host_kind === "shared")
      throw new Refused(
        "On the shared Zoom nobody needs to start it: join with the link.",
        403,
        "shared",
      );
    row.started_at ??= new Date(now).toISOString();
    return { start_url: `https://us06web.zoom.us/s/${row.meeting_id}` };
  }
  if (action === "zoom.link.shared") {
    const row = links.find(r => r.id === b.id);
    if (row) {
      row.shared_at = new Date(now).toISOString();
      row.shared_how = b.how;
    }
    return { shared: { id: b.id, shared_how: b.how } };
  }
  if (action === "group.made") {
    let invite = String(b.invite_link ?? "")
      .trim()
      .replace(/[?#].*$/, "");
    if (/^chat\.whatsapp\.com\//i.test(invite)) invite = `https://${invite}`;
    if (invite && !INVITE_RE.test(invite))
      throw new Refused(
        "Paste the group's invite link: it starts with https://chat.whatsapp.com/",
        400,
        "bad_invite",
      );
    const contact = String(b.contact_id ?? "");
    const at = new Date(now).toISOString();
    let row = groups.find(g => g.contact_id === contact);
    if (!row) {
      row = {
        id: id(7000 + groups.length + 2),
        contact_id: contact,
        made_at: at,
        crm_note: "written",
      };
      groups.push(row);
    }
    Object.assign(row, {
      appointment_id: b.appointment_id ?? row.appointment_id ?? null,
      name: b.name ?? row.name ?? null,
      invite_link: invite || row.invite_link || null,
      // As sales-api: the setter who made it stays its maker.
      made_by: row.made_by ?? "aziz@maharamedia.com",
      updated_at: at,
    });
    return { group: { ...row } };
  }
  return null;
}

/**
 * The seeded cockpit_sales_zoom_links and cockpit_sales_groups rows (the
 * same arrays every press adds to). The zoom_links setting is apart, in
 * zoomSettings: spread into `tables`, a cockpit_sales_settings key here
 * would replace every other setting the harness serves.
 */
export function zoomTables(k: ZoomKnobs): Record<string, Row[]> {
  seedGroups(k, Date.now());
  return {
    cockpit_sales_zoom_links: links,
    cockpit_sales_groups: groups,
  };
}

/** The zoom_links setting row: on unless the knob says off. */
export function zoomSettings(k: ZoomKnobs): Row[] {
  return [
    {
      key: "zoom_links",
      value: {
        enabled: k.zoom !== "off",
        fallback_host: "aziz@maharamedia.com",
        per_seat_hour: 20,
        reuse_hours: 12,
        tidy_after_h: 24,
        lengths_min: { intro: 30, demo: 60 },
      },
      updated_by: "harness",
      updated_at: new Date().toISOString(),
    },
  ];
}
