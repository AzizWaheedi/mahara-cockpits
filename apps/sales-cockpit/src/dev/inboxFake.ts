/**
 * The Messages page in the harness: conversations built from the fixture
 * leads, filtered and counted the way cockpit_sales_conversations_list and
 * _counts do (migration 20261029d), with WhatsApp, email, Instagram and
 * Facebook threads, SMS copies, waits either side of the reply hour, an
 * automations-only thread, and Ahmed's and Aziz's leads.
 * /sales/harness.html?path=/messages
 */
import { LEADS } from "./fixtures";

type Row = Record<string, unknown>;
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const AHMED = "XhBe1lFpWEK58KisM5XD";
const AZIZ = "Q4DIfzNbhg1BXJCsipwW";

interface Spec {
  lead: number;
  channel: "whatsapp" | "email" | "instagram" | "facebook";
  in: number | null;
  reply: number | null;
  auto?: number;
  owner?: string | null;
  unread?: number;
  text: string;
  copies?: number;
  client?: boolean;
}

// Minutes ago (in, reply). null: never.
const SPECS: Spec[] = [
  {
    lead: 0,
    channel: "whatsapp",
    in: 6,
    reply: null,
    unread: 2,
    text: "السلام عليكم، شفت الإعلان. كم التكلفة للشهر؟",
    copies: 3,
  },
  {
    lead: 1,
    channel: "instagram",
    in: 42,
    reply: null,
    unread: 1,
    text: "Hi, do you work with interior design firms in Riyadh?",
  },
  {
    lead: 2,
    channel: "whatsapp",
    in: 95,
    reply: 400,
    owner: AHMED,
    unread: 1,
    text: "تمام، أرسل لي الموعد الجاي",
    copies: 6,
  },
  { lead: 3, channel: "facebook", in: 300, reply: null, text: "Get Started" },
  {
    lead: 4,
    channel: "email",
    in: 26 * 60,
    reply: null,
    owner: AZIZ,
    text: "Thanks for the proposal. Can we move the call to Sunday?",
  },
  {
    lead: 5,
    channel: "whatsapp",
    in: 3 * 24 * 60,
    reply: null,
    text: "متى تقدرون تبدون؟",
    copies: 2,
  },
  {
    lead: 6,
    channel: "whatsapp",
    in: 120,
    reply: 20,
    owner: AHMED,
    text: "Perfect, see you then.",
    copies: 4,
  },
  {
    lead: 7,
    channel: "instagram",
    in: 9 * 60,
    reply: 8 * 60,
    text: "من الصفر",
  },
  {
    lead: 8,
    channel: "email",
    in: null,
    reply: null,
    auto: 30,
    text: "تذكير سريع بخصوص رسالتي السابقة",
  },
  {
    lead: 9,
    channel: "whatsapp",
    in: 600,
    reply: 30,
    owner: AZIZ,
    text: "Contract signed, thank you!",
    client: true,
  },
  {
    lead: 10,
    channel: "facebook",
    in: 5 * 24 * 60,
    reply: 4 * 24 * 60,
    text: "شكرا",
  },
  {
    lead: 11,
    channel: "email",
    in: null,
    reply: null,
    auto: 2 * 60,
    text: "Your free guide: 5 ways to fill your calendar",
  },
];

function build(now: number) {
  return SPECS.map((s, i) => {
    const l = LEADS[s.lead] ?? LEADS[0];
    const inAt = s.in === null ? null : now - s.in * 60_000;
    const replyAt = s.reply === null ? null : now - s.reply * 60_000;
    const autoAt = s.auto ? now - s.auto * 60_000 : null;
    const lastAt = Math.max(inAt ?? 0, replyAt ?? 0, autoAt ?? 0);
    const lastIsIn = inAt !== null && inAt === lastAt;
    const owner = s.owner === undefined ? null : s.owner;
    const account =
      s.channel === "whatsapp"
        ? "whatsapp:+96590054963"
        : s.channel === "email"
          ? "email:aziz@info.maharamedia.com"
          : `${s.channel}:MaharaMedia`;
    return {
      conversation_id: `conv-${l.contact_id}`,
      contact_id: String(l.contact_id),
      name: l.name,
      phone: l.phone,
      email: l.email,
      assigned_to: owner,
      owner:
        owner === AHMED
          ? "Ahmed Abushaiba"
          : owner === AZIZ
            ? "Aziz Waheedi"
            : null,
      stage:
        i % 3 === 0
          ? "👀Intro Call REQUESTED"
          : i % 3 === 1
            ? "📅Demo Booked (Qualified)"
            : null,
      client: s.client === true,
      channels: [s.channel],
      accounts: [account],
      last_at: iso(lastAt),
      last_channel: s.channel,
      last_direction: lastIsIn ? "inbound" : "outbound",
      last_body: lastIsIn
        ? s.text
        : autoAt === lastAt
          ? s.text
          : "Happy to help. When suits you for a short call?",
      last_automated: autoAt === lastAt,
      last_in_at: inAt === null ? null : iso(inAt),
      last_in_channel: inAt === null ? null : s.channel,
      last_in_body: inAt === null ? null : s.text,
      last_reply_at: replyAt === null ? null : iso(replyAt),
      last_reply_by:
        replyAt === null
          ? null
          : owner === AHMED
            ? "Ahmed Abushaiba"
            : "Aziz Waheedi",
      needs_reply: inAt !== null && (replyAt === null || replyAt < inAt),
      unread: s.unread ?? 0,
      copies: s.copies ?? 0,
      read: true,
      has_person: inAt !== null || replyAt !== null,
    };
  });
}

const REPLY_DAYS = 14;

function matches(r: ReturnType<typeof build>[number], b: Row, now: number) {
  const person = b.p_person as string | null;
  if (person === "unassigned" && r.assigned_to) return false;
  if (person && person !== "unassigned" && r.assigned_to !== person)
    return false;
  if (b.p_channel && !r.channels.includes(b.p_channel as never)) return false;
  if (b.p_account && !r.accounts.includes(String(b.p_account))) return false;
  const state = String(b.p_state ?? "reply");
  if (state === "reply")
    return (
      r.needs_reply &&
      Date.parse(String(r.last_in_at)) > now - REPLY_DAYS * 24 * H
    );
  if (state === "unread") return r.unread > 0 && r.has_person;
  if (state === "all") return r.has_person;
  return !r.has_person;
}

export function inboxList(b: Row, now: number) {
  const q = String(b.p_q ?? "")
    .trim()
    .toLowerCase();
  const byIn = String(b.p_state ?? "reply") === "reply";
  const rows = build(now)
    .filter(r => matches(r, b, now))
    .filter(
      r =>
        !q ||
        String(r.name).toLowerCase().includes(q) ||
        String(r.phone).includes(q) ||
        String(r.last_in_body ?? r.last_body)
          .toLowerCase()
          .includes(q),
    )
    .map(r => ({ ...r, sort_at: byIn ? r.last_in_at : r.last_at }))
    .sort(
      (a, c) => Date.parse(String(c.sort_at)) - Date.parse(String(a.sort_at)),
    );
  return { rows, more: false };
}

export function inboxCounts(b: Row, now: number) {
  const all = build(now);
  const person = b.p_person as string | null;
  const scoped = all.filter(
    r =>
      !person ||
      (person === "unassigned" ? !r.assigned_to : r.assigned_to === person),
  );
  const ch = (r: (typeof all)[number]) =>
    !b.p_channel || r.channels.includes(b.p_channel as never);
  const waiting = (r: (typeof all)[number]) =>
    r.needs_reply &&
    Date.parse(String(r.last_in_at)) > now - REPLY_DAYS * 24 * H;
  const tally = (rows: typeof all) => ({
    reply: rows.filter(waiting).length,
    all: rows.filter(r => r.has_person).length,
  });
  const channels: Record<string, { reply: number; all: number }> = {};
  for (const c of ["whatsapp", "email", "instagram", "facebook"])
    channels[c] = tally(scoped.filter(r => r.channels.includes(c as never)));
  const sc = scoped.filter(ch);
  return {
    states: {
      reply: sc.filter(waiting).length,
      unread: sc.filter(r => r.unread > 0 && r.has_person).length,
      all: sc.filter(r => r.has_person).length,
      auto: sc.filter(r => !r.has_person).length,
    },
    channels,
    accounts: [
      {
        key: "email:aziz@info.maharamedia.com",
        ...tally(
          scoped.filter(r =>
            r.accounts.includes("email:aziz@info.maharamedia.com"),
          ),
        ),
      },
      {
        key: "facebook:MaharaMedia",
        ...tally(
          scoped.filter(r => r.accounts.includes("facebook:MaharaMedia")),
        ),
      },
      {
        key: "instagram:MaharaMedia",
        ...tally(
          scoped.filter(r => r.accounts.includes("instagram:MaharaMedia")),
        ),
      },
      {
        key: "whatsapp:+96590054963",
        ...tally(
          scoped.filter(r => r.accounts.includes("whatsapp:+96590054963")),
        ),
      },
    ],
    people: [
      {
        ghl_user_id: AHMED,
        name: "Ahmed Abushaiba",
        role: "closer",
        ...tally(all.filter(r => r.assigned_to === AHMED).filter(ch)),
      },
      {
        ghl_user_id: AZIZ,
        name: "Aziz Waheedi",
        role: "manager",
        ...tally(all.filter(r => r.assigned_to === AZIZ).filter(ch)),
      },
    ],
    unassigned: tally(all.filter(r => !r.assigned_to).filter(ch)),
    everyone: tally(all.filter(ch)),
    sync: {
      last_ok_at: iso(now - 40_000),
      last_run_at: iso(now - 40_000),
      last_error: null,
      full_done_at: iso(now - 8 * 60_000),
      conversations: 4810,
      unread_backlog: new URLSearchParams(location.search).get("backlog")
        ? 1630
        : 0,
    },
    sms_pause: {
      workflows: 9,
      steps: 31,
      since: iso(now - 50 * 60_000),
      copies_since: 0,
    },
    reply_days: REPLY_DAYS,
  };
}

/** The DM a fixture lead sent, for convo.read: Instagram or Facebook, or null. */
export function dmOf(contactId: string): "instagram" | "facebook" | null {
  const s = SPECS.find(x => String(LEADS[x.lead]?.contact_id) === contactId);
  return s && (s.channel === "instagram" || s.channel === "facebook")
    ? s.channel
    : null;
}

/** A DM lead's conversation as convo.read returns it. */
export function dmConversation(contactId: string, base: Row, now: number): Row {
  const s = SPECS.find(x => String(LEADS[x.lead]?.contact_id) === contactId);
  if (!s || (s.channel !== "instagram" && s.channel !== "facebook"))
    return base;
  const inAt = now - (s.in ?? 60) * 60_000;
  const thread: Row[] = [
    {
      id: `${contactId}-dm1`,
      conversation_id: `conv-${contactId}`,
      direction: "inbound",
      channel: s.channel,
      type: s.channel === "instagram" ? "TYPE_INSTAGRAM" : "TYPE_FACEBOOK",
      status: "delivered",
      at: iso(inAt),
      body: s.text,
      subject: null,
      attachments: [],
      error: null,
      source: null,
      copy: false,
    },
  ];
  if (s.reply !== null)
    thread.push({
      ...thread[0],
      id: `${contactId}-dm2`,
      direction: "outbound",
      at: iso(now - s.reply * 60_000),
      body: "أهلين! نعم نشتغل مع شركات التصميم. متى يناسبك اتصال قصير؟",
      source: "app",
    });
  const window = {
    open: now - inAt < 168 * H,
    closes_at: iso(inAt + 168 * H),
    last_inbound_at: iso(inAt),
  };
  return {
    ...base,
    thread,
    channels: {
      ...(base.channels as Row),
      whatsapp: { on: true, dnd: false, reachable: false },
      [s.channel]: { on: true, dnd: false, reachable: true, window },
    },
  };
}

/** Copied messages for a lead, with the WA2 Connector's SMS copies, for useCopiedThread. */
export function copiedMessages(now: number): Row[] {
  const out: Row[] = [];
  for (const s of SPECS) {
    const l = LEADS[s.lead];
    if (!l || s.channel !== "whatsapp" || !s.copies) continue;
    for (let k = 0; k < s.copies; k++) {
      const at = now - (k + 2) * 5 * H;
      const body =
        "إذا ما شفته للحين، هذا الفيديو بيعطيك فكرة ممتازة عن نظامنا";
      const base = {
        conversation_id: `conv-${l.contact_id}`,
        contact_id: l.contact_id,
        direction: "outbound",
        subject: null,
        attachments: [],
        error: null,
        source: "workflow",
      };
      out.push({
        ...base,
        id: `${l.contact_id}-wa-${k}`,
        channel: "whatsapp",
        type: "TYPE_WHATSAPP",
        status: "delivered",
        at: iso(at),
        body,
        copy: false,
      });
      out.push({
        ...base,
        id: `${l.contact_id}-sms-${k}`,
        channel: "sms",
        type: "TYPE_CUSTOM_SMS",
        status: "sent",
        at: iso(at + 1200),
        body,
        copy: true,
      });
    }
  }
  return out;
}
