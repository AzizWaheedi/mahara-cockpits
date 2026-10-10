// The instant Zoom link (2026-10-10, the CEO: "is there any reason we can't
// create the Zoom call straight away?"). One press makes a Zoom meeting and
// hands the rep its link: no room machine, no worker, no sweep, no waits, no
// webhook, no short link and nothing sent by itself. The rep sends it from
// their own WhatsApp, or copies it.
//
// Who hosts it (plan D1.4): the pressing rep's own Zoom user when Zoom says
// it is licensed (type 2) and active, else the shared host the zoom_links
// setting names (the CEO's licensed user). On the shared host both sides
// join as participants (join before host on, waiting room off), so the
// setter never holds the CEO's host identity; on the rep's own user the rep
// starts it as host (zoom.start reads a fresh start link, never stored).
//
// Zoom is called with the server-to-server app's keys (ZOOM_ACCOUNT_ID,
// ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, read by name) through index.ts's
// fetchWithin, 25 s a call, one token refresh on a 401, never a retry on a
// POST. Each press's outcome lands in cockpit_sales_worker_status
// (sales-api / zoom-links), sales-api's form of the health ledger.

import { cleanText, redact, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { CLIENT_REFUSAL, isClient } from "./clients.ts";

type Row = Record<string, unknown>;

export interface ZoomLinksDeps {
  svc: (path: string, init?: { method?: string; body?: unknown; prefer?: string }) => Promise<Row[]>;
  audit: (
    who: Who,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata?: Row,
  ) => Promise<void>;
  fetchWithin: (url: string, init: RequestInit, ms: number, what: string) => Promise<Response>;
  env: (name: string) => string;
  background: (p: Promise<unknown>) => void;
  /** The clock (tests move it). */
  now?: () => number;
}

export const ZOOM_KEYS = ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"] as const;
export const ZOOM_MS = 25_000;
const TOKEN_URL = "https://zoom.us/oauth/token";
const API = "https://api.zoom.us/v2";
const USER_CACHE_MS = 10 * 60_000;
const TIDY_MAX = 5;
const KUWAIT_MS = 3 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKS = "cockpit_sales_zoom_links";
const enc = encodeURIComponent;

export const ZOOM_OFF = "Zoom links are switched off. Ask Aziz to switch them on.";
export const ZOOM_UNREAD = "The Zoom setting could not be read. Try again in a minute.";
export const ZOOM_NO_KEYS = "Zoom is not connected on the server yet (its keys are missing). Ask Aziz.";
export const SHARED_DOWN = "The shared Zoom account is not available. Ask Aziz.";
export const ZOOM_TIMEOUT = "Zoom did not answer within 25 seconds. Try again; no link was saved.";
/**
 * The busy shared host (D1.6). The plan's last sentence said accepting the
 * setter's own Zoom invite stops the sharing; it does not (a Basic seat stays
 * on the shared host, D1.4), so it names the licence instead.
 */
export const SHARED_BUSY =
  "The shared Zoom is in another meeting right now. Until it ends, they may see 'waiting for the host'. A Zoom licence of your own ends the sharing: ask Aziz.";
export const BUSY_UNKNOWN = "Zoom did not say whether the shared Zoom is in another meeting right now.";

/** The zoom_links setting as the code reads it: off unless enabled is exactly true. */
export interface ZoomSetting {
  enabled: boolean;
  fallback_host: string | null;
  per_seat_hour: number;
  reuse_hours: number;
  tidy_after_h: number;
  lengths_min: { intro: number; demo: number };
}

const whole = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : d;
};

export function readZoomSetting(value: unknown): ZoomSetting {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
  const host = String(v.fallback_host ?? "").trim().toLowerCase();
  const len = v.lengths_min && typeof v.lengths_min === "object" ? (v.lengths_min as Row) : {};
  return {
    enabled: v.enabled === true,
    fallback_host: /^[^@\s]+@[^@\s]+$/.test(host) ? host : null,
    per_seat_hour: whole(v.per_seat_hour, 20, 1, 200),
    reuse_hours: whole(v.reuse_hours, 12, 0, 48),
    tidy_after_h: whole(v.tidy_after_h, 24, 1, 24 * 30),
    lengths_min: { intro: whole(len.intro, 30, 15, 240), demo: whole(len.demo, 60, 15, 240) },
  };
}

/**
 * The lead taps one link and is not asked for a passcode: Zoom's encrypted
 * passcode added when the join link has none (desk/rooms.py with_passcode).
 */
export function withPasscode(joinUrl: string, meeting: Row): string {
  const url = String(joinUrl ?? "");
  if (!url || url.includes("pwd=")) return url;
  const pwd = String(meeting.encrypted_password ?? "").trim();
  if (!pwd) return url;
  return `${url}${url.includes("?") ? "&" : "?"}pwd=${enc(pwd)}`;
}

/** The meeting Zoom is asked for (D1.5): join before host only on the shared host, never a waiting room. */
export function meetingBody(o: { first: string; kind: "intro" | "demo"; shared: boolean; minutes: number; now: number }): Row {
  return {
    topic: `Mahara Media: ${o.first || "call"} (${o.kind})`.slice(0, 200),
    type: 2,
    start_time: new Date(o.now).toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration: o.minutes,
    timezone: "Asia/Kuwait",
    settings: {
      join_before_host: o.shared,
      jbh_time: 0,
      waiting_room: false,
      approval_type: 2,
      meeting_authentication: false,
      email_notification: false,
      host_video: true,
      participant_video: true,
      mute_upon_entry: false,
      use_pmi: false,
      auto_recording: "none",
    },
  };
}

/** Licensed and active, as Zoom keeps a user. */
export function licensed(u: Row | null): boolean {
  return Boolean(u) && Number(u?.type) === 2 && String(u?.status ?? "").toLowerCase() === "active";
}

const firstName = (name: unknown) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

function kuwaitClock(ms: number): string {
  const d = new Date(ms + KUWAIT_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** A Zoom answer that was not a success (status 0: no answer in time). */
export class ZoomError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function makeZoomLinks(d: ZoomLinksDeps) {
  const now = d.now ?? (() => Date.now());
  let token: { value: string; until: number } | null = null;
  const users = new Map<string, { at: number; user: Row | null }>();

  const refuse = (message: string, status: number, code?: string) =>
    new ApiRefusal(message, status, code ? { code } : {});

  /** A database read the press needs, said in a sentence when it fails. */
  async function read(path: string, what: string): Promise<Row[]> {
    try {
      return await d.svc(path);
    } catch (e) {
      console.error("zoom links read", redact(String((e as Error)?.message ?? e)));
      throw refuse(`The cockpit could not read ${what}. Try again in a minute.`, 503);
    }
  }

  async function health(ok: boolean, detail: string): Promise<void> {
    try {
      await d.svc("cockpit_sales_worker_status?on_conflict=worker,job", {
        method: "POST",
        body: { worker: "sales-api", job: "zoom-links", ok, detail: detail.slice(0, 300), at: new Date(now()).toISOString() },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    } catch (e) {
      console.error("zoom links health row", redact(String((e as Error)?.message ?? e)));
    }
  }

  function keys(): { account: string; client: string; secret: string } | null {
    const [account, client, secret] = ZOOM_KEYS.map(k => d.env(k));
    return account && client && secret ? { account, client, secret } : null;
  }

  async function fetchZoom(url: string, init: RequestInit): Promise<Response> {
    try {
      return await d.fetchWithin(url, init, ZOOM_MS, "Zoom");
    } catch (e) {
      const status = (e as { status?: unknown })?.status;
      // A network failure's message carries the URL, and the token URL
      // carries the account id: never into a sentence, a log or the health row.
      const msg = redact(String((e as Error)?.message ?? e).replace(/(account_id=)[^&\s)"']+/gi, "$1[key]"));
      throw new ZoomError(msg, typeof status === "number" ? status : 0);
    }
  }

  async function accessToken(): Promise<string> {
    if (token && now() < token.until) return token.value;
    const k = keys();
    if (!k) throw new ZoomError("Zoom's keys are missing", 0);
    const res = await fetchZoom(`${TOKEN_URL}?grant_type=account_credentials&account_id=${enc(k.account)}`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${k.client}:${k.secret}`)}`, Accept: "application/json" },
    });
    const text = await res.text().catch(() => "");
    let out: Row = {};
    try {
      out = JSON.parse(text) as Row;
    } catch {
      out = {};
    }
    if (!res.ok || !out.access_token)
      throw new ZoomError(`Zoom refused the app's keys (${res.status}${out.reason ? `: ${redact(String(out.reason))}` : ""})`, res.ok ? 0 : res.status);
    const life = Number(out.expires_in);
    token = { value: String(out.access_token), until: now() + (Number.isFinite(life) && life > 120 ? life : 3600) * 1000 - 60_000 };
    return token.value;
  }

  /** One Zoom API call; a 401 asks for a new token once. Answers the JSON (null for an empty 2xx). */
  async function zoomCall(method: string, path: string, body?: unknown): Promise<Row | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchZoom(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text().catch(() => "");
      if (res.status === 401 && attempt === 0) {
        token = null;
        continue;
      }
      if (!res.ok) {
        let msg = text;
        try {
          const j = JSON.parse(text) as Row;
          msg = String(j.message ?? j.reason ?? text);
        } catch {
          // not JSON
        }
        throw new ZoomError(redact(msg || `status ${res.status}`), res.status);
      }
      if (!text) return null;
      try {
        const out = JSON.parse(text);
        return out && typeof out === "object" && !Array.isArray(out) ? (out as Row) : null;
      } catch {
        throw new ZoomError("Zoom's answer was not JSON", 0);
      }
    }
    throw new ZoomError("Zoom refused the app's token twice", 401);
  }

  /** A Zoom user by id or email, kept ten minutes; null when Zoom has no such user. */
  async function zoomUser(idOrEmail: string): Promise<Row | null> {
    const key = idOrEmail.toLowerCase();
    const hit = users.get(key);
    if (hit && now() - hit.at < USER_CACHE_MS) return hit.user;
    let user: Row | null;
    try {
      user = await zoomCall("GET", `/users/${enc(idOrEmail)}`);
    } catch (e) {
      if (e instanceof ZoomError && e.status === 404) user = null;
      else throw e;
    }
    users.set(key, { at: now(), user });
    return user;
  }

  function zoomRefusal(e: unknown, what: string): ApiRefusal {
    if (e instanceof ApiRefusal) return e;
    if (e instanceof ZoomError && e.status === 0 && /did not answer within/.test(e.message)) return refuse(ZOOM_TIMEOUT, 504);
    const why = e instanceof Error ? e.message : String(e);
    return refuse(`Zoom did not ${what}: ${redact(why).slice(0, 160)}. Try again.`, 502);
  }

  /** The setting, or the refusal that says why there is no press. */
  async function setting(): Promise<ZoomSetting> {
    let rows: Row[];
    try {
      rows = await d.svc("cockpit_sales_settings?key=eq.zoom_links&select=value");
    } catch {
      throw refuse(ZOOM_UNREAD, 503, "unread");
    }
    const s = readZoomSetting(rows[0]?.value);
    if (!rows[0] || !s.enabled) throw refuse(ZOOM_OFF, 409, "off");
    return s;
  }

  async function lead(contactId: string): Promise<Row> {
    const row = (await read(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,name,company,phone,tags`, "the lead"))[0];
    if (!row) throw refuse("That lead is not in the cockpit.", 404);
    if (isClient(row)) throw refuse(CLIENT_REFUSAL, 409, "client");
    return row;
  }

  /** Names for the answer: the rep's (and Arabic name) and the host's. */
  async function names(emails: string[]): Promise<Map<string, Row>> {
    const list = [...new Set(emails.filter(Boolean))];
    const out = new Map<string, Row>();
    if (!list.length) return out;
    try {
      const rows = await d.svc(`cockpit_sales_people?email=in.(${list.map(e => `"${e}"`).map(enc).join(",")})&select=email,name,name_ar`);
      for (const r of rows) out.set(String(r.email).toLowerCase(), r);
    } catch {
      // The names are a courtesy; the link stands without them.
    }
    return out;
  }

  function answer(row: Row, who: Who, people: Map<string, Row>, reused: boolean, warning: string | null): Row {
    const me = people.get(String(who.email ?? "").toLowerCase());
    const host = people.get(String(row.host_email ?? "").toLowerCase());
    const shared = row.host_kind === "shared";
    return {
      link: {
        id: row.id,
        join_url: row.join_url,
        kind: row.call_kind,
        host: shared ? "shared" : "own",
        host_name: shared
          ? String(host?.name ?? row.host_email ?? "the shared Zoom")
          : String(me?.name ?? who.name ?? who.email ?? ""),
        made_at: row.made_at,
      },
      reused,
      warning,
      rep: { name: String(me?.name ?? who.name ?? who.email ?? ""), name_ar: me?.name_ar ? String(me.name_ar) : null },
    };
  }

  /**
   * When Zoom held the meeting (its past-meeting record's start), or null
   * when Zoom has no past meeting for it (404): never held. Anything else
   * throws, so the tidy leaves the meeting alone.
   */
  async function heldAt(meetingId: string): Promise<string | null> {
    let past: Row | null;
    try {
      past = await zoomCall("GET", `/past_meetings/${enc(meetingId)}`);
    } catch (e) {
      if (e instanceof ZoomError && e.status === 404) return null;
      throw e;
    }
    if (!past) throw new ZoomError("Zoom's past-meeting answer was empty", 0);
    const at = Date.parse(String(past.start_time ?? ""));
    return new Date(Number.isFinite(at) ? at : now()).toISOString();
  }

  /**
   * D1.10: up to five of this host's cockpit meetings, never started and
   * older than the setting says, deleted in Zoom. A meeting that was held
   * and has ended reads "waiting" again on GET /meetings (checked on
   * Mahara's Zoom, 2026-10-10), so "waiting" alone never deletes it: Zoom's
   * past-meeting record must say it was never held (404). One that was held
   * is marked started and left in Zoom.
   */
  async function tidy(who: Who, hostEmail: string, afterH: number): Promise<number> {
    const before = new Date(now() - afterH * 3_600_000).toISOString();
    const rows = await d.svc(
      `${LINKS}?host_email=eq.${enc(hostEmail)}&deleted_at=is.null&started_at=is.null&made_at=lt.${enc(before)}&order=made_at.asc&limit=${TIDY_MAX}&select=id,meeting_id,made_at`,
    );
    let done = 0;
    for (const r of rows.slice(0, TIDY_MAX)) {
      let why: string | null = null;
      try {
        const m = await zoomCall("GET", `/meetings/${enc(String(r.meeting_id))}`);
        if (String(m?.status ?? "") !== "waiting") continue;
        const held = await heldAt(String(r.meeting_id));
        if (held) {
          // Held and ended: kept in Zoom, and out of the tidy's queue.
          await d.svc(`${LINKS}?id=eq.${enc(String(r.id))}&started_at=is.null`, {
            method: "PATCH",
            body: { started_at: held },
            prefer: "return=minimal",
          });
          await d.audit(who, "zoom.link.held", LINKS, String(r.id), { started_at: null }, { started_at: held }, { meeting_id: String(r.meeting_id) });
          continue;
        }
        await zoomCall("DELETE", `/meetings/${enc(String(r.meeting_id))}?schedule_for_reminder=false&cancel_meeting_reminder=false`);
        why = "tidied: never started";
      } catch (e) {
        if (e instanceof ZoomError && e.status === 404) why = "gone in Zoom";
        else {
          console.error("zoom tidy", redact(String((e as Error)?.message ?? e)));
          continue;
        }
      }
      const at = new Date(now()).toISOString();
      await d.svc(`${LINKS}?id=eq.${enc(String(r.id))}&deleted_at=is.null`, {
        method: "PATCH",
        body: { deleted_at: at, deleted_why: why },
        prefer: "return=minimal",
      });
      await d.audit(who, "zoom.link.tidy", LINKS, String(r.id), { deleted_at: null }, { deleted_at: at, deleted_why: why }, { meeting_id: String(r.meeting_id) });
      done++;
    }
    return done;
  }

  async function zoomLink(who: Who, b: Row): Promise<Row> {
    const s = await setting();
    const k = keys();
    if (!k) {
      await health(false, "Zoom keys are missing on sales-api");
      throw refuse(ZOOM_NO_KEYS, 503, "no_keys");
    }
    const contactId = cleanText(b.contact_id, 80);
    if (!contactId) throw refuse("Which lead?", 400);
    const kind = b.kind === "demo" ? "demo" : b.kind === "intro" ? "intro" : null;
    if (!kind) throw refuse("Say which call: intro or demo.", 400);
    const seat = String(who.email ?? "").toLowerCase();
    const l = await lead(contactId);
    const t = now();

    if (b.fresh !== true && s.reuse_hours > 0) {
      const since = new Date(t - s.reuse_hours * 3_600_000).toISOString();
      const kept = (
        await read(
          `${LINKS}?contact_id=eq.${enc(contactId)}&seat_email=eq.${enc(seat)}&call_kind=eq.${kind}&deleted_at=is.null&made_at=gte.${enc(since)}&order=made_at.desc&limit=1&select=*`,
          "your earlier links",
        )
      )[0];
      if (kept) return answer(kept, who, await names([seat, String(kept.host_email)]), true, null);
    }

    const hourAgo = new Date(t - 3_600_000).toISOString();
    const recent = await read(
      `${LINKS}?seat_email=eq.${enc(seat)}&made_at=gte.${enc(hourAgo)}&select=id&limit=${s.per_seat_hour + 1}`,
      "your links this hour",
    );
    if (recent.length >= s.per_seat_hour)
      throw refuse(`You made ${s.per_seat_hour} Zoom links in the last hour. Use one you made, or wait a few minutes.`, 429, "cap");

    // Who hosts it (D1.4).
    let host: { kind: "own" | "shared"; id: string; email: string };
    let warning: string | null = null;
    try {
      let own: Row | null = null;
      if (seat) {
        let ref = seat;
        try {
          const h = (await d.svc(`cockpit_sales_room_hosts?email=eq.${enc(seat)}&select=zoom_user_id`))[0];
          if (h?.zoom_user_id) ref = String(h.zoom_user_id);
        } catch {
          // The email finds the user too.
        }
        try {
          own = await zoomUser(ref);
        } catch (e) {
          // Zoom could not say about the rep's own user: the shared host
          // is asked next, and its answer decides.
          console.error("zoom own user", redact(String((e as Error)?.message ?? e)));
          own = null;
        }
      }
      if (licensed(own)) {
        host = { kind: "own", id: String(own?.id ?? seat), email: String(own?.email ?? seat).toLowerCase() };
      } else {
        if (!s.fallback_host) throw refuse(SHARED_DOWN, 503, "no_shared_host");
        const shared = await zoomUser(s.fallback_host);
        if (!licensed(shared)) throw refuse(SHARED_DOWN, 503, "shared_unlicensed");
        host = { kind: "shared", id: String(shared?.id ?? s.fallback_host), email: String(shared?.email ?? s.fallback_host).toLowerCase() };
        try {
          const live = await zoomCall("GET", `/users/${enc(host.id)}/meetings?type=live&page_size=1`);
          const list = live?.meetings;
          if (Array.isArray(list) && list.length > 0) warning = SHARED_BUSY;
          else if (!Array.isArray(list)) warning = BUSY_UNKNOWN;
        } catch {
          warning = BUSY_UNKNOWN;
        }
      }
    } catch (e) {
      const r = zoomRefusal(e, "say who hosts the meeting");
      await health(false, r.message);
      throw r;
    }

    // Make it (no retry on a POST: a second try could make two meetings).
    let meeting: Row | null;
    try {
      meeting = await zoomCall(
        "POST",
        `/users/${enc(host.id)}/meetings`,
        meetingBody({ first: firstName(l.name), kind, shared: host.kind === "shared", minutes: s.lengths_min[kind], now: t }),
      );
    } catch (e) {
      const r = zoomRefusal(e, "make the meeting");
      await health(false, r.message);
      throw r;
    }
    const joinUrl = withPasscode(String(meeting?.join_url ?? ""), meeting ?? {});
    const meetingId = meeting?.id === undefined || meeting?.id === null ? "" : String(meeting.id);
    if (!/^https:\/\/[^\s]*zoom\.us\//.test(joinUrl) || !meetingId) {
      const r = refuse("Zoom did not make the meeting: its answer had no join link. Try again.", 502);
      await health(false, r.message);
      throw r;
    }

    let row: Row | undefined;
    try {
      row = (
        await d.svc(LINKS, {
          method: "POST",
          body: {
            contact_id: contactId,
            seat_email: seat,
            call_kind: kind,
            host_kind: host.kind,
            host_email: host.email,
            meeting_id: meetingId,
            join_url: joinUrl,
            topic: String(meeting?.topic ?? "").slice(0, 200) || null,
            made_at: new Date(t).toISOString(),
          },
          prefer: "return=representation",
        })
      )[0];
    } catch (e) {
      console.error("zoom link save", redact(String((e as Error)?.message ?? e)));
    }
    if (!row) {
      // A meeting nobody can find again is removed, so no orphan sits in Zoom.
      d.background(zoomCall("DELETE", `/meetings/${enc(meetingId)}?schedule_for_reminder=false&cancel_meeting_reminder=false`).catch(() => null));
      await health(false, "A meeting was made but the cockpit could not save it");
      throw refuse("Zoom made the meeting but the cockpit could not save it, so it was removed. Try again.", 503);
    }
    await d.audit(who, "zoom.link.create", LINKS, String(row.id), null, {
      id: row.id,
      host_kind: host.kind,
      call_kind: kind,
      meeting_id: meetingId,
    }, { contact_id: contactId, host_email: host.email, warning: warning ? "shared_busy" : null });
    await health(true, `Made a meeting at ${kuwaitClock(t)} (Kuwait time)`);
    d.background(tidy(who, host.email, s.tidy_after_h));
    return answer(row, who, await names([seat, host.email]), false, warning);
  }

  async function linkRow(id: unknown): Promise<Row> {
    const key = cleanText(id, 40);
    if (!UUID.test(key)) throw refuse("Which link?", 400);
    const row = (await read(`${LINKS}?id=eq.${enc(key)}&select=*`, "that link"))[0];
    if (!row) throw refuse("That Zoom link is not in the cockpit.", 404);
    return row;
  }

  async function zoomStart(who: Who, b: Row): Promise<Row> {
    const row = await linkRow(b.id);
    const me = String(who.email ?? "").toLowerCase();
    // A start link is the host's own key to the meeting (D1.9): the shared
    // host's goes to nobody but the shared host.
    if (row.host_kind === "shared" && me !== String(row.host_email).toLowerCase())
      throw refuse("On the shared Zoom nobody needs to start it: join with the link.", 403, "shared");
    if (!(row.host_kind === "own" && String(row.seat_email).toLowerCase() === me) && !who.manager && me !== String(row.host_email).toLowerCase())
      throw refuse("Only the rep who made this link can start it as host.", 403, "not_yours");
    if (row.deleted_at) throw refuse("That meeting was removed. Make a new link.", 410, "gone");
    if (!keys()) {
      await health(false, "Zoom keys are missing on sales-api");
      throw refuse(ZOOM_NO_KEYS, 503, "no_keys");
    }
    let m: Row | null;
    try {
      m = await zoomCall("GET", `/meetings/${enc(String(row.meeting_id))}`);
    } catch (e) {
      if (e instanceof ZoomError && e.status === 404) {
        const at = new Date(now()).toISOString();
        await d.svc(`${LINKS}?id=eq.${enc(String(row.id))}&deleted_at=is.null`, {
          method: "PATCH",
          body: { deleted_at: at, deleted_why: "gone in Zoom" },
          prefer: "return=minimal",
        }).catch(() => null);
        await d.audit(who, "zoom.link.gone", LINKS, String(row.id), { deleted_at: null }, { deleted_at: at, deleted_why: "gone in Zoom" });
        throw refuse("Zoom no longer has this meeting. Make a new link.", 410, "gone");
      }
      throw zoomRefusal(e, "give the start link");
    }
    const startUrl = String(m?.start_url ?? "");
    if (!/^https:\/\//.test(startUrl)) throw refuse("Zoom did not give a start link. Open Zoom and start it from your meetings.", 502);
    const at = new Date(now()).toISOString();
    if (!row.started_at) {
      try {
        await d.svc(`${LINKS}?id=eq.${enc(String(row.id))}&started_at=is.null`, {
          method: "PATCH",
          body: { started_at: at },
          prefer: "return=minimal",
        });
      } catch (e) {
        console.error("zoom start mark", redact(String((e as Error)?.message ?? e)));
      }
    }
    // The start link itself is never written down anywhere.
    await d.audit(who, "zoom.link.start", LINKS, String(row.id), { started_at: row.started_at ?? null }, { started_at: row.started_at ?? at }, { meeting_id: String(row.meeting_id) });
    return { start_url: startUrl };
  }

  const HOW = ["whatsapp", "copy_message", "copy_link"];

  async function zoomShared(who: Who, b: Row): Promise<Row> {
    const how = String(b.how ?? "");
    if (!HOW.includes(how)) throw refuse("Say how it was shared: whatsapp, copy_message or copy_link.", 400);
    const row = await linkRow(b.id);
    const me = String(who.email ?? "").toLowerCase();
    if (String(row.seat_email).toLowerCase() !== me && !who.manager) throw refuse("That is another rep's link.", 403);
    const at = new Date(now()).toISOString();
    await d.svc(`${LINKS}?id=eq.${enc(String(row.id))}`, {
      method: "PATCH",
      body: { shared_at: at, shared_how: how },
      prefer: "return=minimal",
    });
    await d.audit(who, "zoom.link.shared", LINKS, String(row.id), { shared_at: row.shared_at ?? null, shared_how: row.shared_how ?? null }, { shared_at: at, shared_how: how });
    return { shared: { id: row.id, shared_at: at, shared_how: how } };
  }

  return {
    actions: {
      "zoom.link": zoomLink,
      "zoom.start": zoomStart,
      "zoom.link.shared": zoomShared,
    } as Record<string, (who: Who, b: Row) => Promise<Row>>,
    /** For the tests. */
    tidy,
  };
}
