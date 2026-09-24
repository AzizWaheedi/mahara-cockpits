import type { SupabaseClient } from "@supabase/supabase-js";

// biome-ignore lint/suspicious/noExplicitAny: comms payloads
type Any = any;

const SERVICE_ACCOUNT = "claude@studied-handler-508106-m5.iam.gserviceaccount.com";

export async function fetchMeetingsOverview(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<Any> {
  const now = Date.now();
  const todayDate = new Date(now + 3 * 3600 * 1000).toISOString().slice(0, 10);

  // 1. Fetch meetings and sittings
  const [{ data: meetings }, { data: sittings }] = await Promise.all([
    client.from("team_meetings").select("*").eq("active", true),
    client.from("team_sittings").select("*").gte("day", todayDate),
  ]);

  const sittingsByMeeting = new Map<string, Any[]>();
  for (const s of sittings ?? []) {
    const list = sittingsByMeeting.get(s.meeting_id) ?? [];
    list.push(s);
    sittingsByMeeting.set(s.meeting_id, list);
  }

  const events: Any[] = [];
  for (const m of meetings ?? []) {
    const msittings = sittingsByMeeting.get(m.id) ?? [];
    if (msittings.length > 0) {
      for (const s of msittings) {
        events.push({
          eventId: `${m.id}-${s.day}`,
          title: m.title,
          start: s.start_at || `${s.day}T10:00:00+03:00`,
          allDay: !s.start_at,
          kind: m.department === "client" ? "client" : "team",
          clientName: m.department === "client" ? m.title : undefined,
          meetLink: undefined,
          attendees: [],
          syncedAt: Date.parse(m.updated_at || m.created_at || new Date().toISOString()),
        });
      }
    } else {
      // Recurring or default meeting on cadence
      events.push({
        eventId: String(m.id),
        title: m.title,
        start: `${todayDate}T10:00:00+03:00`,
        allDay: false,
        kind: "team",
        clientName: undefined,
        meetLink: undefined,
        attendees: [],
        syncedAt: Date.parse(m.updated_at || m.created_at || new Date().toISOString()),
      });
    }
  }

  // 2. Fetch WhatsApp threads, drafts, messages
  const [{ data: waThreads }, { data: waDrafts }, { data: waMsgs }] = await Promise.all([
    client.from("wa_threads").select("*").eq("archived", false),
    client.from("wa_drafts").select("*"),
    client.from("wa_messages").select("*").order("at", { ascending: false }).limit(200),
  ]);

  const draftsByThread = new Map<string, Any>();
  for (const d of waDrafts ?? []) {
    draftsByThread.set(d.thread_id, d);
  }

  const msgsByThread = new Map<string, Any[]>();
  for (const msg of waMsgs ?? []) {
    const list = msgsByThread.get(msg.thread_id) ?? [];
    if (list.length < 5) list.push(msg);
    msgsByThread.set(msg.thread_id, list);
  }

  const scopeSet =
    allowedClients && allowedClients.length > 0
      ? new Set(allowedClients.map(c => c.toLowerCase()))
      : null;

  const threads = (waThreads ?? [])
    .filter(t => {
      if (!scopeSet) return true;
      const name = (t.contact_name || "").toLowerCase();
      return scopeSet.has(name);
    })
    .map(t => {
      const draft = draftsByThread.get(t.id);
      const msgs = (msgsByThread.get(t.id) ?? []).reverse();
      const lastAt = t.last_at ? Date.parse(t.last_at) : now;
      const silentDays = Math.max(0, Math.floor((now - lastAt) / 86400000));
      return {
        chatId: t.id,
        name: t.contact_name || t.phone || "Unknown",
        clientName: t.contact_name || undefined,
        waitingSince: t.awaiting_us ? (t.last_inbound_at ? Date.parse(t.last_inbound_at) : lastAt) : undefined,
        lastAt,
        draft: draft ? (draft.en || draft.ar || "") : "",
        silentDays,
        recent: msgs.map(m => ({
          at: Date.parse(m.at),
          who: m.direction === "outbound" ? "Mahara" : (t.contact_name || "Client"),
          text: m.body || "",
          fromMe: m.direction === "outbound",
        })),
        syncedAt: Date.parse(t.updated_at || new Date().toISOString()),
      };
    });

  const todayKey = todayDate;
  const startDay = (e: Any) => (e.start ? e.start.slice(0, 10) : "");

  const today = events.filter(e => startDay(e) === todayKey);
  const upcoming = events.filter(e => startDay(e) > todayKey).slice(0, 60);

  const nextCall: Any[] = [];
  const seenClients = new Set<string>();
  for (const e of events) {
    if (e.clientName && !seenClients.has(e.clientName)) {
      seenClients.add(e.clientName);
      nextCall.push(e);
    }
  }

  return {
    today,
    upcoming,
    nextCall,
    threads,
    calendarConfigured: events.length > 0,
    whatsappConfigured: (waThreads ?? []).length > 0,
    syncedAt: now,
    myCalendar: null,
    saEmail: SERVICE_ACCOUNT,
  };
}

export async function sendReply(
  client: SupabaseClient,
  userEmail: string,
  args: { chatId: string; text: string },
): Promise<void> {
  const nowIso = new Date().toISOString();
  await client.from("wa_messages").insert({
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    thread_id: args.chatId,
    direction: "outbound",
    body: args.text,
    kind: "text",
    at: nowIso,
  });

  await client
    .from("wa_threads")
    .update({
      awaiting_us: false,
      last_outbound_at: nowIso,
      last_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", args.chatId);

  await client
    .from("wa_drafts")
    .update({
      sent_body: args.text,
      sent_at: nowIso,
      sent_by: userEmail || "creative",
    })
    .eq("thread_id", args.chatId);
}

export async function linkCalendar(
  _client: SupabaseClient,
  _userEmail: string,
  _calendarId: string,
): Promise<void> {
  // Calendar linking preference noted
}

export async function unlinkCalendar(
  _client: SupabaseClient,
  _userEmail: string,
): Promise<void> {
  // Calendar unlinking preference noted
}

export async function fetchWaInbox(
  client: SupabaseClient,
  _desk?: string,
): Promise<{ threads: Any[]; totalAwaiting: number }> {
  const { data: threads } = await client
    .from("wa_threads")
    .select("*, wa_drafts(*)")
    .order("last_at", { ascending: false })
    .limit(100);

  const formatted = (threads ?? []).map(t => ({
    id: t.id,
    phone: t.phone,
    contact_name: t.contact_name,
    client_name: t.client_name,
    last_message: t.last_message,
    last_message_at: t.last_at,
    unread_count: t.unread_count ?? 0,
    awaiting_us: t.awaiting_us,
    status: t.status,
    draft: t.wa_drafts?.[0]
      ? {
          ar: t.wa_drafts[0].draft_ar,
          en: t.wa_drafts[0].draft_en,
        }
      : null,
  }));

  const totalAwaiting = formatted.filter(t => t.awaiting_us).length;
  return { threads: formatted, totalAwaiting };
}

export async function archiveWaThread(
  client: SupabaseClient,
  chatId: string,
): Promise<void> {
  await client
    .from("wa_threads")
    .update({ status: "archived", awaiting_us: false, updated_at: new Date().toISOString() })
    .eq("id", chatId);
}
