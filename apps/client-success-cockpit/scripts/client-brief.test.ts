import { describe, expect, test } from "bun:test";
import {
  buildBrief,
  type Digest,
  kuwaitWhen,
  summarySections,
} from "../src/lib/clientBrief";
import type { Timeline, TimelineCall, TimelineEod } from "../src/lib/csmCalls";

// Monday 12 October 2026, 16:00 in Kuwait.
const NOW = Date.parse("2026-10-12T13:00:00Z");
const OK = new Date(NOW - 5 * 60_000).toISOString();

const FATHOM = [
  "## الغرض من الاجتماع",
  "",
  "[مراجعة أداء الحملة](https://fathom.video/share/x?t=1)",
  "",
  "## أبرز النقاط",
  "",
  "  - [**مشكلة الجودة:** حضر موعد واحد فقط.](https://fathom.video/share/x?t=2)",
  "    - تفصيل لا يظهر",
  "  - [**السبب:** توقف الإعلانات.](https://fathom.video/share/x?t=3)",
  "",
  "## المواضيع",
  "### أداء الحملة",
  "  - شيء آخر",
  "",
  "## الخطوات التالية",
  "  - **Abdullah:**",
  "    - Watch the training video.",
  "  - **MaharaMedia:**",
  "    - Send the new scripts.",
  "  - **مهارة:** كتابة نصوص جديدة.",
].join("\n");

let id = 1;
const call = (over: Partial<TimelineCall>): TimelineCall => ({
  id: id++,
  source: "ghl_appointment",
  kind: "checkin",
  status: "confirmed",
  upcoming: false,
  startsAt: "2026-10-11T10:00:00Z",
  endsAt: "2026-10-11T10:30:00Z",
  ...over,
});

const health = (over: Record<string, boolean> = {}) =>
  [
    "csm-ghl-calls",
    "csm-fathom",
    "csm-checkin-form",
    "csm-eod-mentions",
    "csm-meta-activities",
  ].map(key => ({ key, ok: over[key] ?? true, lastOkAt: OK }));

const timeline = (over: Partial<Timeline> = {}): Timeline => ({
  taskId: "86eyt1d33",
  clientName: "City Wood",
  calls: [],
  forms: [],
  changes: [],
  eods: [],
  health: health(),
  ...over,
});

const digest = (over: Partial<Digest>): Digest => ({
  kind: "call",
  at: Date.parse("2026-10-11T12:00:00Z"),
  summary: "",
  nextSteps: [],
  risks: [],
  clientRequests: [],
  dos: [],
  donts: [],
  ...over,
});

const eod = (over: Partial<TimelineEod>): TimelineEod => ({
  day: "2026-10-11",
  at: "2026-10-11T15:00:00Z",
  author: "Saleh",
  role: "media buyer",
  excerpt: "",
  source: "sheet",
  ...over,
});

const live = { name: "City Wood", stage: "Active" };

describe("reading a Fathom summary", () => {
  test("takes the outermost key points, and next steps with their owners", () => {
    const s = summarySections(FATHOM);
    expect(s.takeaways).toEqual([
      "مشكلة الجودة: حضر موعد واحد فقط.",
      "السبب: توقف الإعلانات.",
    ]);
    expect(s.nextSteps).toEqual([
      { owner: "Abdullah", text: "Watch the training video." },
      { owner: "MaharaMedia", text: "Send the new scripts." },
      { owner: "مهارة", text: "كتابة نصوص جديدة." },
    ]);
  });

  test("an empty summary has no sections", () => {
    expect(summarySections(null)).toEqual({ takeaways: [], nextSteps: [] });
  });
});

describe("the brief for a live client", () => {
  test("the last call is the newest day a call happened, with its key points", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({ status: "cancelled", startsAt: "2026-10-12T08:00:00Z" }),
          call({ summary: FATHOM }),
          call({ startsAt: "2026-09-20T10:00:00Z", endsAt: "2026-09-20T10:30:00Z" }),
        ],
      }),
    });
    expect(b.lastCall?.day).toBe("11 Oct");
    expect(b.call.lines[0].text).toContain("مشكلة الجودة");
    // Fathom's owners: ours by name, others kept with their owner.
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "Send the new scripts.",
      "كتابة نصوص جديدة.",
    ]);
    expect(b.promises.steps.map(l => `${l.label}: ${l.text}`)).toEqual([
      "Abdullah: Watch the training video.",
    ]);
  });

  test("a newest call with no notes points to the newest call that has them", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({ startsAt: "2026-10-11T10:00:00Z" }),
          call({ startsAt: "2026-09-28T10:00:00Z", endsAt: "2026-09-28T10:30:00Z", summary: FATHOM }),
        ],
      }),
    });
    expect(b.call.heading).toBe("Last call with notes, Mon 28 Sep");
    expect(b.call.empty).toBe("The 11 Oct call has no recording or notes.");
    expect(b.call.lines.length).toBe(2);
  });

  test("a call still to come is the next call, never the last one", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [call({ upcoming: true, status: "booked", startsAt: "2026-10-18T09:00:00Z" })],
      }),
    });
    expect(b.lastCall).toBeUndefined();
    expect(b.nextCall?.when).toBe(kuwaitWhen("2026-10-18T09:00:00Z"));
    expect(kuwaitWhen("2026-10-18T09:00:00Z")).toBe("Sun 18 Oct, 12:00");
  });

  test("promises split ours and theirs; ours are checked before asking theirs", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({ calls: [call({})] }),
      digests: [
        digest({ nextSteps: ["Mahara: Write new copy.", "Client: Fix the credit card.", "Share the scripts."] }),
      ],
    });
    expect(b.promises.ours.map(l => l.text)).toEqual(["Write new copy.", "Share the scripts."]);
    expect(b.promises.theirs.map(l => l.text)).toEqual(["Fix the credit card."]);
    const texts = b.raise.map(l => l.text);
    const ours = texts.findIndex(t => t.startsWith("Check our 2 next steps"));
    const theirs = texts.indexOf("Ask if they did it: Fix the credit card.");
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(theirs).toBeGreaterThan(ours);
  });

  test("an angry client comes first, then the at-risk mood and a double booking", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({}),
          call({ upcoming: true, status: "booked", startsAt: "2026-10-13T08:00:00Z" }),
          call({ upcoming: true, status: "booked", startsAt: "2026-10-13T13:30:00Z" }),
        ],
        eods: [eod({ role: "account manager", author: "Rasem", day: "2026-10-12", at: "2026-10-12T10:00:00Z", excerpt: "City Wood is very angry about the lead quality. Meeting booked Monday." })],
        forms: [
          {
            token: "t1",
            formId: "fRokTITH",
            kind: "checkin",
            submittedAt: "2026-10-11T11:00:00Z",
            answers: [
              { title: "Defcon Status", value: "At Risk" },
              { title: "Task Priority", value: "High" },
            ],
          },
        ],
      }),
    });
    expect(b.defcon).toEqual({ value: "At Risk", day: "11 Oct", risk: true, old: false });
    expect(b.raise[0].text).toStartWith("City Wood is very angry about the lead quality.");
    expect(b.raise[1].text).toStartWith("Marked At Risk, priority High, on 11 Oct.");
    expect(b.raise[2].text).toContain("2 calls are booked on 13 Oct (11:00 and 16:30)");
  });

  test("a change the client made to their own ads is raised; the team's are not", () => {
    const at = Date.parse("2026-10-12T06:00:00Z");
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      teamActors: ["Saleh Attale"],
      timeline: timeline({
        calls: [call({})],
        changes: [
          { day: "2026-10-12", at, kind: "update_campaign_run_status", action: "Campaign status updated", actor: "Wood Owner", source: "meta_activity" },
          { day: "2026-10-12", at, kind: "update_campaign_budget", action: "Campaign budget updated", actor: "Saleh Attale", source: "meta_activity" },
        ] as never,
      }),
    });
    expect(b.raise.some(l => l.text.startsWith("Someone on their side (Wood Owner) switched their ads on or off on 12 Oct"))).toBe(true);
  });

  test("a past booking nobody marked asks whether it was held", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [call({ status: "booked", startsAt: "2026-10-05T10:00:00Z", endsAt: "2026-10-05T10:30:00Z" })],
      }),
    });
    expect(b.lastCall).toBeUndefined();
    expect(b.raise.some(l => l.text.startsWith('Was the 5 Oct check-in call held? It is still "booked"'))).toBe(true);
  });

  test("a check-in a few days ago with no 1-1 form asks for one; an old silence asks for a booking", () => {
    const recent = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({ calls: [call({ startsAt: "2026-10-09T10:00:00Z", endsAt: "2026-10-09T10:30:00Z" })] }),
    });
    expect(recent.raise.some(l => l.text.startsWith("No 1-1 notes form after the 9 Oct check-in"))).toBe(true);
    const old = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({ calls: [call({ startsAt: "2026-09-20T10:00:00Z", endsAt: "2026-09-20T10:30:00Z" })] }),
    });
    const texts = old.raise.map(l => l.text);
    expect(texts.some(t => t.startsWith("No 1-1 notes form"))).toBe(false);
    expect(texts.some(t => t.startsWith("No next call is booked, and the last was 22 days ago"))).toBe(true);
  });

  test("status notes the cockpit wrote itself are not news", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({ calls: [call({})] }),
      digests: [
        digest({ kind: "note", summary: "City Wood's happiness status was set to At Risk.", at: NOW - 3_600_000 }),
        digest({ kind: "note", summary: "Client asked for new scripts. The comment notes nothing else.", at: NOW - 3_600_000 }),
      ],
    });
    expect(b.since.notes.map(n => n.text)).toEqual(["Client asked for new scripts."]);
  });

  test("Meta changes: creation side effects fold in, switches are never a talking point", () => {
    const at = Date.parse("2026-10-12T06:00:00Z");
    const later = at + 3 * 3_600_000;
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      teamActors: ["Nada Al Saed"],
      timeline: timeline({
        calls: [call({})],
        health: health({ "csm-meta-activities": false }),
        changes: [
          { day: "2026-10-12", at, kind: "create_ad", action: "Ad created", actor: "Nada Al Saed", source: "meta_activity" },
          { day: "2026-10-12", at, kind: "create_ad", action: "Ad created", actor: "Nada Al Saed", source: "meta_activity" },
          { day: "2026-10-12", at, kind: "update_ad_set_target_spec", action: "Ad set targeting updated", actor: "Nada Al Saed", source: "meta_activity" },
          { day: "2026-10-12", at: later, kind: "update_ad_set_target_spec", action: "Ad set targeting updated", actor: "Nada Al Saed", source: "meta_activity" },
          { day: "2026-10-12", at: later, kind: "update_ad_run_status", action: "Ad status updated", actor: "Nada Al Saed", source: "meta_activity" },
          { day: "2026-10-12", at, kind: "manual", action: "Expanded the radius to 25 km", source: "native_manual" },
        ] as never,
      }),
    });
    expect(b.since.changes[0].text).toBe("Nada: 2 new ads, 1 targeting change, 1 on/off switch");
    expect(b.since.notes[0]).toMatchObject({ text: "Expanded the radius to 25 km", source: "Media buyer note" });
    const tell = b.raise.find(l => l.text.startsWith("Tell them what we changed"));
    expect(tell?.text).toBe("Tell them what we changed on their ads (12 Oct): we launched 2 new ads, refined who the ads reach.");
    expect(tell?.text).not.toContain("Nada");
    // This client's Meta rows are fresh, so the log is not called behind for them.
    expect(b.since.stale).toBeUndefined();
  });

  test("an EOD roll-up keeps only this client's part", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      otherClients: ["City Wood", "Liwan Limited", "Atlantis Contracting"],
      timeline: timeline({
        calls: [call({ startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T10:30:00Z" })],
        eods: [
          eod({ excerpt: "Any client with CPL above $15 today: Liwan Limited at $20. City Wood delivered 2 new videos today. Atlantis Contracting paused." }),
          eod({ author: "Date", excerpt: "City Wood delivered 2 new videos today." }),
        ],
      }),
    });
    expect(b.since.team.map(l => l.text)).toEqual(["City Wood delivered 2 new videos today."]);
  });

  test("who they are keeps the allow-listed answers and says when the currency is missing", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        forms: [
          {
            token: "o1",
            formId: "KFRCXPFx",
            kind: "onboarding",
            submittedAt: "2026-09-01T10:00:00Z",
            answers: [
              { title: "Out of those what is the #1 service/type of project you want to focus on scaling?", value: "Villa fit-outs" },
              { title: "What is your realistic goal revenue in 90 Days?", value: 900000 },
              { title: "Any additional information we should know before starting?", value: "شكرا" },
              { title: "Phone | رقم التليفون", value: "+965 0000 0000" },
            ],
          },
        ],
      }),
    });
    expect(b.who.map(l => `${l.label}: ${l.text}`)).toEqual([
      "Wants to grow: Villa fit-outs",
      "90-day revenue goal: 900,000 (currency not stated)",
    ]);
  });

  test("with nothing on record, every section says so instead of showing nothing", () => {
    const b = buildBrief({ now: NOW, client: live, digests: [], timeline: timeline() });
    expect(b.call.empty).toContain("No call with this client is on record");
    expect(b.promises.empty).toBe("No next steps on record yet.");
    expect(b.since.empty).toBe("No ad changes, card notes or team mentions since then.");
    expect(b.raise[0].text).toBe("No call is on record and none is booked. Book one.");
  });
});

describe("the brief for a stopped or onboarding client", () => {
  test("a stopped client gets why they stopped, never a booking nag", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "Amheco", stage: "Stopped" },
      digests: [],
      timeline: timeline({
        calls: [call({ startsAt: "2026-07-20T10:00:00Z", endsAt: "2026-07-20T10:30:00Z" })],
        eods: [eod({ day: "2026-08-09", at: "2026-08-09T15:00:00Z", excerpt: "Clients Lost: Amheco paused after the payment issue." })],
      }),
    });
    expect(b.mode).toBe("stopped");
    expect(b.raise[0].text).toStartWith("Stopped: Amheco paused after the payment issue.");
    expect(b.raise.some(l => /book/i.test(l.text))).toBe(false);
    expect(b.promises.empty).toBe("No open promises: they are not a live client.");
  });

  test("a stopped client with no records is one sentence", () => {
    const b = buildBrief({ now: NOW, client: { name: "Gone Co", stage: "Stopped" }, digests: [], timeline: timeline() });
    expect(b.quiet).toBe("Stopped. Nothing on record since 1 Jun: no calls, forms, card notes or team mentions.");
  });

  test("a client needing contact is told to book the onboarding call", () => {
    const b = buildBrief({ now: NOW, client: { name: "New Co", stage: "Needs Contacting" }, digests: [], timeline: timeline() });
    expect(b.raise[0].text).toBe("Book their onboarding call.");
  });
});

describe("WhatsApp in the brief", () => {
  const msg = (at: string, body: string | null, over: Record<string, unknown> = {}) => ({
    direction: "inbound",
    body,
    kind: "text",
    speaker: null,
    at: Date.parse(at),
    today: Date.parse(at) >= Date.parse("2026-10-11T21:00:00Z"),
    ...over,
  });
  const chat = (over: Record<string, unknown> = {}) => ({
    name: "Ahmed City Wood",
    isGroup: false,
    archived: false,
    awaitingUs: true,
    lastInboundAt: Date.parse("2026-10-12T09:05:00Z"),
    messages: [
      msg("2026-10-10T08:00:00Z", "Thanks, all good."),
      msg("2026-10-12T09:05:00Z", "When do the new videos go live?"),
    ],
    ...over,
  });
  const lastCall = timeline({ calls: [call({ startsAt: "2026-10-09T10:00:00Z", endsAt: "2026-10-09T10:30:00Z" })] });

  test("a message waiting on our reply is raised with its words; what they wrote shows under since", () => {
    const b = buildBrief({ now: NOW, client: live, digests: [], timeline: lastCall, whatsapp: { threads: [chat()] } });
    const wait = b.raise.find(l => l.source === "WhatsApp");
    expect(wait?.text).toBe(
      'Ahmed City Wood is waiting on a WhatsApp reply since 12:05 today: "When do the new videos go live". Answer it before the call.',
    );
    expect(wait?.risk).toBe(false);
    expect(b.since.chats.map(l => l.text)).toEqual(["When do the new videos go live?", "Thanks, all good."]);
    expect(b.since.empty).toBeUndefined();
  });

  test("a reply already sent is not raised, a day-old wait is a risk, and an angry message comes first", () => {
    const answered = buildBrief({ now: NOW, client: live, digests: [], timeline: lastCall, whatsapp: { threads: [chat({ awaitingUs: false })] } });
    expect(answered.raise.some(l => l.source === "WhatsApp")).toBe(false);
    const old = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: { threads: [chat({ messages: [msg("2026-10-11T08:00:00Z", null, { kind: "audio" })] })] },
    });
    expect(old.raise.find(l => l.source === "WhatsApp")?.text).toBe(
      "Ahmed City Wood sent a voice note on WhatsApp on Sun 11 Oct, 11:00 and is waiting on a reply. Answer it before the call.",
    );
    expect(old.raise.find(l => l.source === "WhatsApp")?.risk).toBe(true);
    const angry = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: { threads: [chat({ messages: [msg("2026-10-12T08:00:00Z", "I am frustrated, no leads came this week")] })] },
    });
    expect(angry.raise[0].source).toBe("WhatsApp");
    expect(angry.raise[0].text).toEndWith("Open with it, calmly, before anything else.");
  });

  test("a group names who wrote; a stopped client who wrote is not quiet", () => {
    const g = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: { threads: [chat({ name: "City Wood x Mahara", isGroup: true, messages: [msg("2026-10-12T09:05:00Z", "Any update?", { speaker: "Sara" })] })] },
    });
    expect(g.raise.find(l => l.source === "WhatsApp")?.text).toStartWith("Sara in City Wood x Mahara is waiting");
    const s = buildBrief({
      now: NOW,
      client: { name: "Gone Co", stage: "Stopped" },
      digests: [],
      timeline: timeline(),
      whatsapp: { threads: [chat({ awaitingUs: false })] },
    });
    expect(s.quiet).toBeUndefined();
    expect(s.raise.some(l => l.text.startsWith("Ahmed City Wood wrote on WhatsApp on 12 Oct"))).toBe(true);
  });
});
