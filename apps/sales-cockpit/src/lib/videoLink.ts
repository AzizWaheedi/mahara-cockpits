/**
 * When the cockpit offers a video link, and what it says before the room
 * is made: the pure half of P1's "Send a video link" (the dialer after a
 * call that did not connect, and the lead page's "Video call" menu).
 *
 * sales-api decides every room (roomlogic `createRefusal`); these helpers
 * only keep a button off the screen when the server would refuse it for
 * everyone (switched off, testing, a client), and say what the server will
 * most likely do with the link. A guess the browser cannot make is left
 * unsaid (null), never filled in.
 */
import {
  type CallKind,
  isFinal,
  type Presence,
  type Provider,
  providerName,
  type RoomView,
  type Sentence,
  sentenceText,
  type ZoomStatus,
  zoomNote,
} from "./rooms";

// ---------------------------------------------------------------------------
// The `rooms` and `live` settings, as the browser reads them
// ---------------------------------------------------------------------------

/** The switches of the `rooms` setting the screens need (glossary 1.4). */
export interface RoomsSwitches {
  enabled: boolean;
  test_only: boolean;
  test_contacts: string[];
  providers: Record<Provider, boolean>;
  default_provider: { setter: Provider; closer: Provider };
  send: { whatsapp_text: boolean; whatsapp_template: boolean; email: boolean };
  short_link: boolean;
  template_route: string;
  fallback: { scope: string; auto_on_miss: boolean; pilot_emails: string[] };
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Raw) : {};
const on = (v: unknown) => v === true;
const isProvider = (v: unknown): v is Provider => v === "meet" || v === "zoom";
const strList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];

/**
 * The setting as roomlogic `roomsSetting` reads it: anything not exactly
 * true is off, and testing stays on unless it is exactly false. Null when
 * the row is missing or is not an object, so a screen shows no button it
 * cannot vouch for.
 */
export function readRoomsSetting(raw: unknown): RoomsSwitches | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const r = raw as Raw;
  const prov = obj(r.providers);
  const def = obj(r.default_provider);
  const send = obj(r.send);
  const fb = obj(r.fallback);
  return {
    enabled: on(r.enabled),
    test_only: r.test_only !== false,
    test_contacts: strList(r.test_contacts),
    providers: { meet: on(prov.meet), zoom: on(prov.zoom) },
    default_provider: {
      setter: isProvider(def.setter) ? def.setter : "meet",
      closer: isProvider(def.closer) ? def.closer : "zoom",
    },
    send: {
      whatsapp_text: on(send.whatsapp_text),
      whatsapp_template: on(send.whatsapp_template),
      email: on(send.email),
    },
    short_link: on(r.short_link),
    template_route:
      typeof r.template_route === "string" && r.template_route.trim()
        ? r.template_route.trim()
        : "call_link",
    fallback: {
      scope: typeof fb.scope === "string" ? fb.scope : "intro",
      auto_on_miss: on(fb.auto_on_miss),
      pilot_emails: strList(fb.pilot_emails).map(e => e.toLowerCase()),
    },
  };
}

/** `live.enabled`: live handover is switched on. Anything else is off. */
export function liveSwitchOn(raw: unknown): boolean {
  return on(obj(raw).enabled);
}

/**
 * The WhatsApp gate (`whatsapp_guard`): open only once the WA Connector is
 * confirmed off and the single-copy test has passed, as sales-api and the
 * desk read it. Null when the setting could not be read.
 */
export function guardOpen(raw: unknown): boolean | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const g = raw as Raw;
  const at =
    typeof g.single_copy_ok_at === "string"
      ? Date.parse(g.single_copy_ok_at)
      : Number.NaN;
  if (g.connector_off !== true || !Number.isFinite(at)) return false;
  // A test from before the connector last went off proves nothing (sales-api
  // sendrules.ts gateOpen, the desk's wa_gate): the page reads it the same way.
  const off =
    typeof g.connector_off_at === "string"
      ? Date.parse(g.connector_off_at)
      : Number.NaN;
  return !Number.isFinite(off) || at >= off;
}

/** A WhatsApp template row as the cockpit reads it. */
export interface TemplateRow {
  key: string;
  active: boolean;
  workflow_id: string | null;
}

/**
 * The call link template is live: a row of the route (`call_link_en`,
 * `call_link_ar`) that is active and has its workflow. Null while the
 * templates are being read.
 */
export function callLinkLive(
  rows: readonly TemplateRow[] | null | undefined,
  route = "call_link",
): boolean | null {
  if (!rows) return null;
  return rows.some(
    t =>
      (t.key === route || t.key.startsWith(`${route}_`)) &&
      t.active &&
      Boolean(t.workflow_id),
  );
}

// ---------------------------------------------------------------------------
// Whether "Send a video link" shows
// ---------------------------------------------------------------------------

export type GateWhy =
  | "ok"
  | "unread"
  | "off"
  | "no_provider"
  | "no_lead"
  | "client"
  | "dnd"
  | "booked_demo"
  | "test_only"
  | "scope"
  | "pilot";

export interface GateInput {
  setting: RoomsSwitches | null;
  contactId: string | null | undefined;
  seatEmail: string | null | undefined;
  /** `fallback` after a call that did not connect; `manual` from the lead page. */
  purpose: "fallback" | "manual";
  /** The dialer's item is a booked intro (`fallback.scope` "intro" needs one). */
  bookedIntro?: boolean;
  /** The contact is tagged client: client success looks after them. */
  client?: boolean;
  /** Do-not-disturb is on for the whole contact in HighLevel. */
  dnd?: boolean;
  /**
   * The lead has a demo booked: its Zoom link comes from HighLevel, so no
   * room is made for it (P1, C2).
   */
  bookedDemo?: boolean;
}

/**
 * Whether the button shows, and why not. Off for every reason sales-api
 * would refuse for everyone alike: the switch, no provider on, testing
 * (only the test contacts), a client, do-not-disturb on every channel, a
 * booked demo, and for a missed call the scope and the pilot list. What depends on the
 * moment (one room per lead, the host's Zoom) stays the server's sentence.
 */
export function videoLinkGate(i: GateInput): { show: boolean; why: GateWhy } {
  const no = (why: GateWhy) => ({ show: false, why });
  const s = i.setting;
  if (!s) return no("unread");
  if (!s.enabled) return no("off");
  if (!s.providers.meet && !s.providers.zoom) return no("no_provider");
  const contact = String(i.contactId ?? "").trim();
  if (!contact) return no("no_lead");
  if (i.client) return no("client");
  if (i.dnd) return no("dnd");
  if (i.bookedDemo) return no("booked_demo");
  if (s.test_only && !s.test_contacts.includes(contact)) return no("test_only");
  if (i.purpose === "fallback") {
    if (s.fallback.scope !== "any" && !i.bookedIntro) return no("scope");
    const seat = String(i.seatEmail ?? "")
      .trim()
      .toLowerCase();
    if (
      s.fallback.pilot_emails.length &&
      !s.fallback.pilot_emails.includes(seat)
    )
      return no("pilot");
  }
  return { show: true, why: "ok" };
}

// ---------------------------------------------------------------------------
// The picker: Meet or Zoom, and where the link will go
// ---------------------------------------------------------------------------

export interface ProviderChoice {
  /** The main button's provider ("Meet"). */
  first: Provider;
  /** The quiet one ("Zoom instead"), when that provider is on. */
  other: Provider | null;
  /** A note before a Zoom room is made (a pending seat, Basic for a demo). */
  note: string | null;
}

/**
 * Meet is the setter's default and Zoom the closer's (updates 3). The
 * seat's own default from live.status comes first, because the database
 * view gives way to the provider the host can use (contract v2 S5); then
 * the setting's default for the role; then whichever provider is on.
 */
export function providerChoice(i: {
  setting: RoomsSwitches;
  role: "setter" | "closer";
  me?: Pick<Presence, "default_provider" | "zoom_status"> | null;
  kind?: CallKind;
}): ProviderChoice | null {
  const live = (["meet", "zoom"] as const).filter(p => i.setting.providers[p]);
  if (!live.length) return null;
  const wanted = i.me?.default_provider ?? i.setting.default_provider[i.role];
  const first = live.includes(wanted) ? wanted : live[0];
  const other = live.find(p => p !== first) ?? null;
  const zoom: ZoomStatus | null = i.me?.zoom_status ?? null;
  const note =
    first === "zoom" || other === "zoom"
      ? zoomNote(zoom, i.kind ?? "intro")
      : null;
  return { first, other, note };
}

/** "Send a Meet link" and "Use Zoom instead" (P1's picker): each says what it does. */
export function choiceLabels(c: ProviderChoice): {
  first: string;
  other: string | null;
} {
  return {
    first: `Send a ${providerName(c.first)} link`,
    other: c.other ? `Use ${providerName(c.other)} instead` : null,
  };
}

/** What the conversation says a channel can do now (Conversation's ChannelState). */
export interface Reach {
  on: boolean;
  dnd: boolean;
  reachable: boolean;
  window?: { open: boolean } | null;
}

/** How the link travels, as the picker line says it ("on WhatsApp", "by email"). */
const CHANNEL_WORDS = {
  whatsapp_text: "on WhatsApp",
  whatsapp_template: "on a WhatsApp template",
  email: "by email",
} as const;
type Channel = keyof typeof CHANNEL_WORDS;

export const PICKER_NONE =
  "No message can reach this lead. You can still make the room and read the link out.";

/**
 * P1's picker line, "The lead gets the link on WhatsApp.", worked out as
 * roomlogic `channelPlan` does: free WhatsApp inside the lead's 24 hours,
 * then the call link template, then email ("bad number" puts email first).
 * Each channel is yes, no, or not known yet; the line names the first yes
 * only when no channel before it is still unknown, and says "No message
 * can reach this lead." only when every channel is a clear no. Otherwise
 * it says nothing (null): the panel says where the link went once it has.
 */
export function linkPlanLine(i: {
  setting: RoomsSwitches;
  whatsapp: Reach | null | undefined;
  email: Reach | null | undefined;
  guardOpen: boolean | null;
  templateLive: boolean | null;
  emailFirst?: boolean;
}): string | null {
  const s = i.setting;
  const wa = i.whatsapp;
  const em = i.email;
  // WhatsApp at all: the cockpit's switch, a number, no do-not-disturb, the gate.
  let waOk: boolean | null;
  if (!wa) waOk = null;
  else if (!wa.on || !wa.reachable || wa.dnd || i.guardOpen === false)
    waOk = false;
  else waOk = i.guardOpen === null ? null : true;
  const and = (a: boolean | null, b: boolean | null): boolean | null =>
    a === false || b === false ? false : a === null || b === null ? null : true;
  const can: Record<Channel, boolean | null> = {
    whatsapp_text: and(
      s.send.whatsapp_text ? waOk : false,
      wa ? wa.window?.open === true : null,
    ),
    whatsapp_template: and(
      s.send.whatsapp_template && s.short_link ? waOk : false,
      i.templateLive,
    ),
    email: !s.send.email ? false : em ? em.reachable && !em.dnd : null,
  };
  const order: Channel[] = i.emailFirst
    ? ["email", "whatsapp_text", "whatsapp_template"]
    : ["whatsapp_text", "whatsapp_template", "email"];
  for (const ch of order) {
    if (can[ch] === null) return null;
    if (can[ch]) return `The lead gets the link ${CHANNEL_WORDS[ch]}.`;
  }
  return PICKER_NONE;
}

// ---------------------------------------------------------------------------
// The dialer: a call that did not connect, and automatic mode
// ---------------------------------------------------------------------------

/** What made a fallback room (roomlogic TRIGGERS). */
export type Trigger =
  | "no_answer"
  | "busy"
  | "did_not_connect"
  | "no_talk"
  | "hung_up"
  | "bad_number"
  | "manual"
  | "auto";

/**
 * The call did not connect, and how: Maqsam could not place it, or its
 * record says nobody answered (or the line was busy). Null for a call that
 * was answered, or one still ringing.
 */
export function missTrigger(i: {
  attemptFailed: boolean;
  call: { final: boolean; answered: boolean; words?: string | null } | null;
}): Trigger | null {
  if (i.attemptFailed) return "did_not_connect";
  const c = i.call;
  if (!c?.final || c.answered) return null;
  return /busy/i.test(String(c.words ?? "")) ? "busy" : "no_answer";
}

export const NOBODY_SPOKE_VIDEO =
  "Nobody spoke. Save it as No answer or Call back, or send a video link.";

/** Automatic mode waits this long, with Stop, before it sends (P1). */
export const AUTO_SEND_S = 10;

/** Whole seconds left before automatic mode sends; never below 0. */
export function autoLeft(startedAt: number, now: number): number {
  return Math.max(0, Math.ceil((startedAt + AUTO_SEND_S * 1000 - now) / 1000));
}

/** "Sending a video link to Faisal in 10 s.", the seconds set in Geist Mono. */
export function autoParts(
  name: string | null | undefined,
  left: number,
): Sentence {
  const who = String(name ?? "").trim() || "the lead";
  return [`Sending a video link to ${who} in `, { mono: String(left) }, " s."];
}

/** "Sending a video link to Faisal in 10 s." */
export function autoSentence(name: string | null | undefined, left: number) {
  return sentenceText(autoParts(name, left));
}

// ---------------------------------------------------------------------------
// The lead's room, and the lead page's "Video call" menu
// ---------------------------------------------------------------------------

const ms = (iso: string | null | undefined) => {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(v) ? v : 0;
};

/**
 * This seat's room for the lead: one that is not over yet, the newest
 * first, else the newest the read still lists. live.status lists only rooms
 * that are not final, so the second case is a read from before the room
 * closed (or the harness showing a closed state).
 */
export function roomForLead(
  rooms: readonly RoomView[] | null | undefined,
  contactId: string | null | undefined,
): RoomView | null {
  const id = String(contactId ?? "");
  if (!id || !rooms) return null;
  return (
    rooms
      .filter(r => r.contact_id === id)
      .sort(
        (a, b) =>
          Number(isFinal(a.state)) - Number(isFinal(b.state)) ||
          ms(b.created_at) - ms(a.created_at),
      )[0] ?? null
  );
}

export type MenuKey = "link" | "demo_now" | "intro_now";

export interface MenuItem {
  key: MenuKey;
  label: string;
  disabled: boolean;
}

export const LIVE_OFF = "Live handover is not switched on yet.";

/**
 * Whether sales-api's live.ask is built. Until it is, the two live options
 * are left out of the menu altogether (final review): with live on they
 * would only answer "not built yet" after the rep typed a note, and with it
 * off every lead showed two disabled items.
 */
export const LIVE_ASK_BUILT = false;

/**
 * C42's one "Video call" menu: "Send a video link", and, once live.ask is
 * built, "Demo now with a closer" and "Intro now with me" (disabled with a
 * sentence while live handover is off). Null when nothing in it can be
 * offered, so the header shows no empty menu.
 */
export function videoMenu(i: {
  linkShown: boolean;
  liveOn: boolean;
  askBuilt?: boolean;
}): {
  items: MenuItem[];
  note: string | null;
} | null {
  const items: MenuItem[] = [];
  if (i.linkShown)
    items.push({ key: "link", label: "Send a video link", disabled: false });
  if (!(i.askBuilt ?? LIVE_ASK_BUILT))
    return items.length ? { items, note: null } : null;
  items.push(
    { key: "demo_now", label: "Demo now with a closer", disabled: !i.liveOn },
    { key: "intro_now", label: "Intro now with me", disabled: !i.liveOn },
  );
  if (!i.linkShown && !i.liveOn) return null;
  return { items, note: i.liveOn ? null : LIVE_OFF };
}
