import { describe, expect, test } from "bun:test";
import {
  buildBrief,
  clientWaiting,
  type Digest,
  kuwaitWhen,
  summarySections,
  teamSpeaker,
} from "../src/lib/clientBrief";
import type { Timeline, TimelineCall, TimelineEod } from "../src/lib/csmCalls";

// Monday 12 October 2026, 16:00 in Kuwait.
const NOW = Date.parse("2026-10-12T13:00:00Z");
const DAY_MS = 86_400_000;
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
          call({
            startsAt: "2026-09-20T10:00:00Z",
            endsAt: "2026-09-20T10:30:00Z",
          }),
        ],
      }),
    });
    expect(b.lastCall?.day).toBe("11 Oct");
    expect(b.call.lines[0].text).toContain("مشكلة الجودة");
    // Fathom's owners: ours by name; a name that is not on the team is
    // theirs (it used to sit unsorted under "steps", review 2, defect 1).
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "Send the new scripts.",
      "كتابة نصوص جديدة.",
    ]);
    expect(b.promises.theirs.map(l => l.text)).toEqual([
      "Watch the training video.",
    ]);
    expect(b.promises.steps).toEqual([]);
  });

  test("a newest call with no notes points to the newest call that has them", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({ startsAt: "2026-10-11T10:00:00Z" }),
          call({
            startsAt: "2026-09-28T10:00:00Z",
            endsAt: "2026-09-28T10:30:00Z",
            summary: FATHOM,
          }),
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
        calls: [
          call({
            upcoming: true,
            status: "booked",
            startsAt: "2026-10-18T09:00:00Z",
          }),
        ],
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
        digest({
          nextSteps: [
            "Mahara: Write new copy.",
            "Client: Fix the credit card.",
            "Share the scripts.",
          ],
        }),
      ],
    });
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "Write new copy.",
      "Share the scripts.",
    ]);
    expect(b.promises.theirs.map(l => l.text)).toEqual([
      "Fix the credit card.",
    ]);
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
          call({
            upcoming: true,
            status: "booked",
            startsAt: "2026-10-13T08:00:00Z",
          }),
          call({
            upcoming: true,
            status: "booked",
            startsAt: "2026-10-13T13:30:00Z",
          }),
        ],
        eods: [
          eod({
            role: "account manager",
            author: "Rasem",
            day: "2026-10-12",
            at: "2026-10-12T10:00:00Z",
            excerpt:
              "City Wood is very angry about the lead quality. Meeting booked Monday.",
          }),
        ],
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
    expect(b.defcon).toEqual({
      value: "At Risk",
      day: "11 Oct",
      risk: true,
      old: false,
    });
    // The at-risk mark folds into the escalation line (review 2, defect 70).
    expect(b.raise[0].text).toStartWith(
      "City Wood is very angry about the lead quality.",
    );
    expect(b.raise[0].text).toContain(
      "Marked At Risk, priority High, on 11 Oct.",
    );
    expect(
      b.raise.filter(l => l.text.includes("before anything else")).length,
    ).toBe(1);
    expect(b.raise[1].text).toContain(
      "2 calls are booked on 13 Oct (11:00 and 16:30)",
    );
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
          {
            day: "2026-10-12",
            at,
            kind: "update_campaign_run_status",
            action: "Campaign status updated",
            actor: "Wood Owner",
            source: "meta_activity",
          },
          {
            day: "2026-10-12",
            at,
            kind: "update_campaign_budget",
            action: "Campaign budget updated",
            actor: "Saleh Attale",
            source: "meta_activity",
          },
        ] as never,
      }),
    });
    expect(
      b.raise.some(l =>
        l.text.startsWith(
          "Someone on their side (Wood Owner) switched their ads on or off on 12 Oct",
        ),
      ),
    ).toBe(true);
  });

  test("a past booking nobody marked asks whether it was held", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            status: "booked",
            startsAt: "2026-10-05T10:00:00Z",
            endsAt: "2026-10-05T10:30:00Z",
          }),
        ],
      }),
    });
    expect(b.lastCall).toBeUndefined();
    expect(
      b.raise.some(l =>
        l.text.startsWith(
          'Was the 5 Oct check-in call held? It is still "booked"',
        ),
      ),
    ).toBe(true);
  });

  test("a check-in a few days ago with no 1-1 form asks for one; an old silence asks for a booking", () => {
    const recent = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-09T10:00:00Z",
            endsAt: "2026-10-09T10:30:00Z",
          }),
        ],
      }),
    });
    expect(
      recent.raise.some(l =>
        l.text.startsWith("No 1-1 notes form after the 9 Oct check-in"),
      ),
    ).toBe(true);
    const old = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-20T10:00:00Z",
            endsAt: "2026-09-20T10:30:00Z",
          }),
        ],
      }),
    });
    const texts = old.raise.map(l => l.text);
    expect(texts.some(t => t.startsWith("No 1-1 notes form"))).toBe(false);
    expect(
      texts.some(t =>
        t.startsWith("No next call is booked, and the last was 22 days ago"),
      ),
    ).toBe(true);
  });

  test("status notes the cockpit wrote itself are not news", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({ calls: [call({})] }),
      digests: [
        digest({
          kind: "note",
          summary: "City Wood's happiness status was set to At Risk.",
          at: NOW - 3_600_000,
        }),
        digest({
          kind: "note",
          summary:
            "Client asked for new scripts. The comment notes nothing else.",
          at: NOW - 3_600_000,
        }),
      ],
    });
    expect(b.since.notes.map(n => n.text)).toEqual([
      "Client asked for new scripts.",
    ]);
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
          {
            day: "2026-10-12",
            at,
            kind: "create_ad",
            action: "Ad created",
            actor: "Nada Al Saed",
            source: "meta_activity",
          },
          {
            day: "2026-10-12",
            at,
            kind: "create_ad",
            action: "Ad created",
            actor: "Nada Al Saed",
            source: "meta_activity",
          },
          {
            day: "2026-10-12",
            at,
            kind: "update_ad_set_target_spec",
            action: "Ad set targeting updated",
            actor: "Nada Al Saed",
            source: "meta_activity",
          },
          {
            day: "2026-10-12",
            at: later,
            kind: "update_ad_set_target_spec",
            action: "Ad set targeting updated",
            actor: "Nada Al Saed",
            source: "meta_activity",
          },
          {
            day: "2026-10-12",
            at: later,
            kind: "update_ad_run_status",
            action: "Ad status updated",
            actor: "Nada Al Saed",
            source: "meta_activity",
          },
          {
            day: "2026-10-12",
            at,
            kind: "manual",
            action: "Expanded the radius to 25 km",
            source: "native_manual",
          },
        ] as never,
      }),
    });
    expect(b.since.changes[0].text).toBe(
      "Nada: 2 new ads, 1 targeting change, 1 on/off switch",
    );
    expect(b.since.notes[0]).toMatchObject({
      text: "Expanded the radius to 25 km",
      source: "Media buyer note",
    });
    const tell = b.raise.find(l =>
      l.text.startsWith("Tell them what we changed"),
    );
    expect(tell?.text).toBe(
      "Tell them what we changed on their ads (12 Oct): we launched 2 new ads, refined who the ads reach.",
    );
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
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        eods: [
          eod({
            excerpt:
              "Any client with CPL above $15 today: Liwan Limited at $20. City Wood delivered 2 new videos today. Atlantis Contracting paused.",
          }),
          eod({
            author: "Date",
            excerpt: "City Wood delivered 2 new videos today.",
          }),
        ],
      }),
    });
    expect(b.since.team.map(l => l.text)).toEqual([
      "City Wood delivered 2 new videos today.",
    ]);
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
              {
                title:
                  "Out of those what is the #1 service/type of project you want to focus on scaling?",
                value: "Villa fit-outs",
              },
              {
                title: "What is your realistic goal revenue in 90 Days?",
                value: 900000,
              },
              {
                title:
                  "Any additional information we should know before starting?",
                value: "شكرا",
              },
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
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline(),
    });
    expect(b.call.empty).toContain("No call with this client is on record");
    expect(b.promises.empty).toBe("No next steps on record yet.");
    expect(b.since.empty).toBe(
      "No ad changes, card notes or team mentions since then.",
    );
    expect(b.raise[0].text).toBe(
      "No call is on record and none is booked. Book one.",
    );
  });
});

describe("the brief for a stopped or onboarding client", () => {
  test("a stopped client gets why they stopped, never a booking nag", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "Amheco", stage: "Stopped" },
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-07-20T10:00:00Z",
            endsAt: "2026-07-20T10:30:00Z",
          }),
        ],
        eods: [
          eod({
            day: "2026-08-09",
            at: "2026-08-09T15:00:00Z",
            excerpt: "Clients Lost: Amheco paused after the payment issue.",
          }),
        ],
      }),
    });
    expect(b.mode).toBe("stopped");
    expect(b.raise[0].text).toStartWith(
      "Stopped: Amheco paused after the payment issue.",
    );
    expect(b.raise.some(l => /book/i.test(l.text))).toBe(false);
    expect(b.promises.empty).toBe(
      "No open promises: they are not a live client.",
    );
  });

  test("a stopped client with no records is one sentence", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "Gone Co", stage: "Stopped" },
      digests: [],
      timeline: timeline(),
    });
    expect(b.quiet).toBe(
      "Stopped. Nothing on record since 1 Jun: no calls, forms, card notes or team mentions.",
    );
  });

  test("a client needing contact is told to book the onboarding call", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "New Co", stage: "Needs Contacting" },
      digests: [],
      timeline: timeline(),
    });
    expect(b.raise[0].text).toBe("Book their onboarding call.");
  });
});

describe("WhatsApp in the brief", () => {
  const msg = (
    at: string,
    body: string | null,
    over: Record<string, unknown> = {},
  ) => ({
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
  const lastCall = timeline({
    calls: [
      call({
        startsAt: "2026-10-09T10:00:00Z",
        endsAt: "2026-10-09T10:30:00Z",
      }),
    ],
  });

  test("a message waiting on our reply is raised with its words; what they wrote shows under since", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: { threads: [chat()] },
    });
    const wait = b.raise.find(l => l.source === "WhatsApp");
    expect(wait?.text).toBe(
      'Ahmed City Wood is waiting on a WhatsApp reply since 12:05 today: "When do the new videos go live". Answer it before the call.',
    );
    expect(wait?.risk).toBe(false);
    expect(b.since.chats.map(l => l.text)).toEqual([
      "When do the new videos go live?",
      "Thanks, all good.",
    ]);
    expect(b.since.empty).toBeUndefined();
  });

  test("a reply already sent is not raised, a day-old wait is a risk, and an angry message comes first", () => {
    const answered = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: { threads: [chat({ awaitingUs: false })] },
    });
    expect(answered.raise.some(l => l.source === "WhatsApp")).toBe(false);
    const old = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: {
        threads: [
          chat({
            messages: [msg("2026-10-11T08:00:00Z", null, { kind: "audio" })],
          }),
        ],
      },
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
      whatsapp: {
        threads: [
          chat({
            messages: [
              msg(
                "2026-10-12T08:00:00Z",
                "I am frustrated, no leads came this week",
              ),
            ],
          }),
        ],
      },
    });
    expect(angry.raise[0].source).toBe("WhatsApp");
    expect(angry.raise[0].text).toEndWith(
      "Open with it, calmly, before anything else.",
    );
  });

  test("a group names who wrote; a stopped client who wrote is not quiet", () => {
    const g = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: lastCall,
      whatsapp: {
        threads: [
          chat({
            name: "City Wood x Mahara",
            isGroup: true,
            messages: [
              msg("2026-10-12T09:05:00Z", "Any update?", { speaker: "Sara" }),
            ],
          }),
        ],
      },
    });
    expect(g.raise.find(l => l.source === "WhatsApp")?.text).toStartWith(
      "Sara in City Wood x Mahara is waiting",
    );
    const s = buildBrief({
      now: NOW,
      client: { name: "Gone Co", stage: "Stopped" },
      digests: [],
      timeline: timeline(),
      whatsapp: { threads: [chat({ awaitingUs: false })] },
    });
    expect(s.quiet).toBeUndefined();
    expect(
      s.raise.some(l =>
        l.text.startsWith("Ahmed City Wood wrote on WhatsApp on 12 Oct"),
      ),
    ).toBe(true);
  });
});

// ---- Review 2 (53 clients, 73 defects): one test group per rule. ----------

const fathomCall = (summary: string, at = "2026-10-08T12:00:00Z") =>
  call({
    source: "fathom",
    kind: "checkin",
    status: "held",
    startsAt: at,
    endsAt: at,
    summary,
    recordingUrl: "https://fathom.video/x",
  });

describe("names: one matcher per client", () => {
  const team = (b: ReturnType<typeof buildBrief>) =>
    b.since.team.map(l => l.text);
  test("stop words between parts are optional and all-caps names match any case", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "Lina and Rami Company", stage: "Active" },
      digests: [],
      otherClients: ["Lina and Rami Company", "ZENTRO"],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        eods: [
          eod({ excerpt: "Delivered three reels for Lina & Rami today." }),
          eod({
            day: "2026-10-10",
            at: "2026-10-10T15:00:00Z",
            excerpt: "Fixed the form for lina and rami after the review.",
          }),
        ],
      }),
    });
    expect(team(b)).toEqual([
      "Delivered three reels for Lina & Rami today.",
      "Fixed the form for lina and rami after the review.",
    ]);
    const a = buildBrief({
      now: NOW,
      client: { name: "ZENTRO", stage: "Stopped" },
      digests: [],
      timeline: timeline({
        eods: [
          eod({
            excerpt: "Zentro paused their ads because the owner is travelling.",
          }),
        ],
      }),
    });
    expect(a.raise[0].text).toBe(
      "Stopped: Zentro paused their ads because the owner is travelling.",
    );
  });

  test("a long legal name matches its first distinctive word; another client's short name cuts a roll-up", () => {
    const b = buildBrief({
      now: NOW,
      client: {
        name: "Varnak Limited Construction and Finishing Of Buildings",
        stage: "Active",
      },
      digests: [],
      otherClients: [
        "Varnak Limited Construction and Finishing Of Buildings",
        "Morvane Industries",
        "Halvor Technology",
      ],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        eods: [
          eod({
            excerpt:
              "Delivered 3 videos for Morvane. Finalized the new video for Varnak. Halvor Tech's video was completed. Tomorrow, I will work on Varnak again.",
          }),
        ],
      }),
    });
    expect(team(b)).toEqual(["Finalized the new video for Varnak."]);
  });

  test("an ordinary-word name matches as written or where a name sits, never as the word", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "Vision", stage: "Active" },
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        eods: [
          eod({ excerpt: "Fixed the vision of the report in the dashboard." }),
          eod({
            day: "2026-10-10",
            at: "2026-10-10T15:00:00Z",
            excerpt:
              "Jumped on a meeting with vision and agreed the account setup.",
          }),
        ],
      }),
    });
    expect(team(b)).toEqual([
      "Jumped on a meeting with vision and agreed the account setup.",
    ]);
  });

  test("a duplicated card name in the client list counts as one other client", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      otherClients: ["City Wood", "South Reef Systems", "South Reef Systems"],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        eods: [
          eod({
            excerpt:
              "Sent the new scripts to City Wood and South Reef Systems for review.",
          }),
        ],
      }),
    });
    expect(team(b)).toEqual([
      "Sent the new scripts to City Wood and South Reef Systems for review.",
    ]);
  });
});

describe("EODs: only what names the client", () => {
  const since = (excerpt: string, over: Partial<TimelineEod> = {}) =>
    buildBrief({
      now: NOW,
      client: live,
      digests: [],
      otherClients: ["City Wood", "Atlantis Contracting"],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        eods: [eod({ excerpt, ...over })],
      }),
    }).since.team.map(l => `${l.text} [${l.source}]`);

  test("a passage that never names the client is not theirs", () => {
    expect(
      since(
        "Built a tool bridge on a separate port; it had never made a call in its life.",
      ),
    ).toEqual([]);
  });

  test("dash lists keep this client's items; a name-only item says nothing", () => {
    expect(
      since(
        "Account Summary: Atlantis new form - City Wood activating two new videos - Meeting with the team - City Wood",
      ),
    ).toEqual(["City Wood activating two new videos [Saleh, media buyer]"]);
  });

  test("the client's own name and dash at the start go; a cut-off part never starts a line", () => {
    expect(
      since(
        "City Wood — launched the retargeting campaign;\n2,000) and City Wood(1,300), fixed the runner",
      ),
    ).toEqual(["Launched the retargeting campaign [Saleh, media buyer]"]);
  });

  test("a call-centre win is a meeting for one of their leads, never contact", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-20T10:00:00Z",
            endsAt: "2026-09-20T10:30:00Z",
          }),
        ],
        eods: [
          eod({
            role: "client sales rep",
            author: "Daniya",
            excerpt: "Wins: Meeting with City Wood",
          }),
        ],
      }),
    });
    expect(b.since.team.map(l => l.text)).toEqual([
      "Call centre booked a meeting for one of their leads",
    ]);
    expect(
      b.raise.find(l => l.text.startsWith("No next call is booked"))?.text,
    ).toContain("the last was 22 days ago");
  });

  test("the EOD on the call's own day counts by Kuwait day; one KPI line shows the trend", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-15T13:00:00Z",
            endsAt: "2026-09-15T13:30:00Z",
          }),
        ],
        eods: [
          eod({
            day: "2026-09-15",
            at: "2026-09-15T20:00:00Z",
            source: "cockpit",
            author: null,
            excerpt:
              "account Summary: • City Wood — cost per booking $249 → Judge the ads on bookings.",
          }),
          eod({
            day: "2026-10-07",
            at: "2026-10-07T20:00:00Z",
            source: "cockpit",
            author: null,
            excerpt:
              "account Summary: • City Wood — cost per booking $89 → Judge the ads on bookings.",
          }),
          eod({
            day: "2026-09-15",
            at: "2026-09-15T09:00:00Z",
            author: "Muhammed",
            role: "systems manager",
            excerpt:
              "Created the reactivation campaign for City Wood's old leads.",
          }),
        ],
      }),
    });
    expect(b.since.team.map(l => `${l.text} [${l.source}]`)).toEqual([
      "Cost per booking: $249 (15 Sep) → $89 (7 Oct) [Media buyer cockpit (auto)]",
      "Created the reactivation campaign for City Wood's old leads. [Muhammed, systems manager]",
    ]);
  });
});

describe("stopped and paused: why, in their own sentence", () => {
  const stopped = (eods: TimelineEod[], over: Partial<Timeline> = {}) =>
    buildBrief({
      now: NOW,
      client: { name: "City Wood", stage: "Stopped" },
      digests: [],
      timeline: timeline({ eods, ...over }),
    });

  test("a payment line is a billing note, never the reason; the reason quotes the sentence that names them", () => {
    const b = stopped([
      eod({
        day: "2026-08-08",
        at: "2026-08-08T15:00:00Z",
        author: "Muhammed",
        role: "systems manager",
        excerpt:
          "Summary: City Wood: issued INV-7, $2,000 paid, filed to Drive. Another client renewed. City Wood has no launch date, so month two won't be chased.",
      }),
    ]);
    expect(b.raise[0].text).toBe(
      "Stopped: City Wood has no launch date, so month two won't be chased.",
    );
    expect(b.raise[1].text).toBe(
      "Last billing note: Issued INV-7, $2,000 paid, filed to Drive.",
    );
  });

  test("a line with the cause wins; stopping an ad is not the client stopping; nothing twice", () => {
    const b = stopped([
      eod({
        day: "2026-07-15",
        at: "2026-07-15T06:00:00Z",
        author: "Saleh",
        role: "account manager",
        excerpt:
          "Call Summary: - City Wood paused their ads because they are moving office and will relaunch next month",
      }),
      eod({
        day: "2026-07-25",
        at: "2026-07-25T06:00:00Z",
        author: "Saleh",
        role: "account manager",
        excerpt:
          "Call Summary: - City Wood needs time to finish payment as he said",
      }),
      eod({
        day: "2026-07-25",
        at: "2026-07-25T06:05:00Z",
        author: "Date",
        role: "csms",
        source: "slack",
        excerpt: "- City Wood needs time to finish payment as he said",
      }),
      eod({
        day: "2026-08-01",
        at: "2026-08-01T15:00:00Z",
        author: "Nada",
        role: "media buyer",
        excerpt:
          "Account Summary: Stopped high-cost videos for City Wood and two others.",
      }),
    ]);
    expect(b.raise[0].text).toBe(
      "Stopped: City Wood paused their ads because they are moving office and will relaunch next month.",
    );
    const all = [
      ...b.raise.map(l => l.text),
      ...b.since.team.map(l => l.text),
      b.call.empty ?? "",
    ].join("\n");
    expect(all.match(/needs time to finish payment/g)?.length).toBe(1);
    expect(
      b.raise.some(
        l => /high-cost videos/.test(l.text) && l.text.startsWith("Stopped:"),
      ),
    ).toBe(false);
  });

  test("no exit word: the newest renewal or no-reply line, and the last activity", () => {
    const b = stopped(
      [
        eod({
          day: "2026-07-22",
          at: "2026-07-22T06:00:00Z",
          author: "Saleh",
          role: "account manager",
          excerpt:
            "Call Summary: - Requested a meeting about City Wood renewal and no response till now",
        }),
      ],
      {
        changes: [
          {
            day: "2026-09-23",
            at: Date.parse("2026-09-23T09:00:00Z"),
            kind: "touch",
            action: "Client updated: shared the week's result",
            source: "decision",
          },
        ] as never,
      },
    );
    expect(b.raise[0].text).toBe(
      "Stopped. No stop reason is on record. Last on record: Requested a meeting about City Wood renewal and no response till now.",
    );
    expect(b.raise[1].text).toBe(
      "Last activity on record, 23 Sep: Client updated: shared the week's result.",
    );
    // A request with no reply is not a held meeting.
    expect(b.call.empty).toBe("No call with them is on record since 1 Jun.");
  });
});

describe("owners and the contact", () => {
  const summary = [
    "## Key takeaways",
    "  - **Billing:** a dispute over the contract length.",
    "## Next steps",
    "  - **Faris:**",
    "    - Log post-meeting notes for every appointment.",
    "    - Finish the sales course.",
    "  - **Abdulaziz:**",
    "    - Send the corrected invoice.",
    "  - **عبد العزيز:**",
    "    - إصلاح النموذج.",
    "  - **Both:**",
    "    - Follow-up meeting on Sat 26 Sep.",
  ].join("\n");
  test("the booking names the contact; team first names are ours, any other name is theirs", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      teamActors: ["Abdulaziz Waheedi"],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-15T13:00:00Z",
            endsAt: "2026-09-15T13:30:00Z",
            summary,
            recordingUrl: "https://fathom.video/x",
          }),
          call({
            upcoming: true,
            status: "booked",
            startsAt: "2026-10-14T09:00:00Z",
            title: "Faris Haddad - Check In",
          }),
        ],
      }),
    });
    expect(b.contact).toBe("Faris Haddad");
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "Send the corrected invoice.",
      "إصلاح النموذج.",
    ]);
    expect(b.promises.theirs.map(l => l.text)).toEqual([
      "Log post-meeting notes for every appointment.",
      "Finish the sales course.",
    ]);
    // The joint meeting's date has passed: it is not a step any more.
    expect(b.promises.steps).toEqual([]);
    const texts = b.raise.map(l => l.text);
    expect(texts).toContain(
      "Check our 2 next steps are done before the call, starting with: Send the corrected invoice.",
    );
    expect(texts).toContain(
      "Ask if they did it: Log post-meeting notes for every appointment. (and 1 more step of theirs)",
    );
  });

  test("a booking titled with the client's own name is not a contact", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({ title: "City Wood - Check In" }),
          call({
            startsAt: "2026-09-28T10:00:00Z",
            endsAt: "2026-09-28T10:30:00Z",
            title: "Yusuf Kamal - Check In",
          }),
        ],
      }),
    });
    expect(b.contact).toBe("Yusuf Kamal");
  });
});

describe("last contact and calls", () => {
  test("an EOD meeting after the last call counts as contact, said with both days", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "City Wood", stage: "Ready For Launch" },
      digests: [],
      timeline: timeline({
        calls: [
          call({
            source: "fathom",
            kind: "onboarding",
            title: "Official Onboarding (City Wood)",
            startsAt: "2026-07-29T10:00:00Z",
            endsAt: "2026-07-29T11:00:00Z",
          }),
        ],
        eods: [
          eod({
            day: "2026-09-13",
            at: "2026-09-13T15:00:00Z",
            author: "Muhammed",
            role: "systems manager",
            excerpt:
              "Jumped on a meeting with City Wood and agreed to create the accounts.",
          }),
        ],
      }),
    });
    expect(b.raise.find(l => l.text.startsWith("Still onboarding"))?.text).toBe(
      "Still onboarding. Last call on record 29 Jul; the systems manager's EOD records a meeting on 13 Sep. Nothing is booked: book their launch call.",
    );
  });

  test("call data, a postponed meeting and a request are not meetings", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "City Wood", stage: "Stopped" },
      digests: [],
      timeline: timeline({
        eods: [
          eod({
            author: "Muhammed",
            role: "systems manager",
            excerpt:
              "Confirmed we have enough call data from City Wood to build the packs.",
          }),
          eod({
            day: "2026-07-25",
            at: "2026-07-25T06:00:00Z",
            role: "account manager",
            excerpt:
              "Call Summary: - City Wood meeting at 9:30AM but they didn't attend so we postpone it to Sunday",
          }),
        ],
      }),
    });
    expect(b.call.empty).toBe("No call with them is on record since 1 Jun.");
  });

  test("a meeting the team booked outside GoHighLevel is said, not 'book one'", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-30T12:00:00Z",
            endsAt: "2026-09-30T12:30:00Z",
          }),
        ],
        eods: [
          eod({
            day: "2026-10-10",
            at: "2026-10-10T15:00:00Z",
            role: "account manager",
            author: "Rasem",
            excerpt:
              "Roll Up: following up with City Wood, booked a meeting on monday at 3PM to discuss their concern.",
          }),
        ],
      }),
    });
    const line = b.raise.find(l =>
      l.text.startsWith("No call is booked in GoHighLevel"),
    );
    expect(line?.text).toContain(
      '"booked a meeting on monday at 3PM to discuss their concern"',
    );
    expect(b.raise.some(l => l.text.startsWith("No next call is booked"))).toBe(
      false,
    );
  });

  test("a promised meeting is one with us, never a lead's appointment", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-30T12:00:00Z",
            endsAt: "2026-09-30T12:30:00Z",
          }),
        ],
      }),
      digests: [
        digest({
          at: Date.parse("2026-09-30T14:00:00Z"),
          nextSteps: [
            "Mahara: Book every appointment as a site visit and offer a free call with the engineer.",
          ],
        }),
      ],
    });
    const line = b.raise.find(l => l.text.startsWith("No next call is booked"));
    expect(line?.text).toBe(
      "No next call is booked, and the last was 12 days ago. Book a check-in.",
    );
  });

  test("the recording on any row of the call's day is linked before saying there is none", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            source: "checkin_form",
            status: "held",
            startsAt: "2026-10-05T10:00:00Z",
            endsAt: "2026-10-05T10:00:00Z",
            recordingUrl: "https://fathom.video/share/abc",
          }),
        ],
      }),
    });
    expect(b.call.lines[0]).toMatchObject({
      text: "Recording on Fathom; no summary was pulled from it.",
      href: "https://fathom.video/share/abc",
    });
  });
});

describe("the raise list", () => {
  test("Next: is the step that answers the risk, a passed weekday is flagged, a client step waiting on our delivery is not asked", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-08T12:00:00Z",
            endsAt: "2026-10-08T12:30:00Z",
          }),
        ],
      }),
      digests: [
        digest({
          at: Date.parse("2026-10-08T14:00:00Z"),
          summary: "The call summary mentions Meta receipts.",
          nextSteps: [
            "Mahara: Send Hani official Meta spending receipts since July.",
            "Mahara: If Safety campaigns remain underperforming by Sunday, pause them and move the budget to Plans.",
            "Client: Confirm receipt of the Meta receipts.",
            "Client: Attend next week's review and decide on Safety.",
          ],
          risks: [
            "Safety campaign underperformance may lead to a pause by Sunday.",
          ],
        }),
      ],
    });
    const risk = b.raise.find(l => l.text.startsWith("Safety campaign"));
    expect(risk?.text).toBe(
      "Safety campaign underperformance may lead to a pause by Sunday (that was Sun 11 Oct: check it was done). Next: If Safety campaigns remain underperforming by Sunday, pause them and move the budget to Plans.",
    );
    expect(b.raise.some(l => l.text.startsWith("Ask if they did it"))).toBe(
      false,
    );
    expect(b.raise.some(l => l.text.startsWith("Meta:"))).toBe(false);
  });

  test("a money takeaway says what happened since and asks if it was paid", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          fathomCall(
            "## Key takeaways\n  - **Billing:** a dispute over the invoice period.",
            "2026-09-15T13:00:00Z",
          ),
        ],
        eods: [
          eod({
            day: "2026-10-03",
            at: "2026-10-03T15:00:00Z",
            author: "Muhammed",
            role: "systems manager",
            excerpt:
              "Summary: Corrected the City Wood invoice to $1,450 and prepared the payment link.",
          }),
        ],
      }),
    });
    expect(
      b.raise.find(l => l.text.startsWith("From the 15 Sep call"))?.text,
    ).toBe(
      "From the 15 Sep call: Billing: a dispute over the invoice period. Since then: Corrected the City Wood invoice to $1,450 and prepared the payment link. (Muhammed, systems manager, 3 Oct) Check it was paid.",
    );
  });

  test("a risk gets the figure its note gives; kickoff facts about the business go under who they are", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({ calls: [call({})] }),
      digests: [
        digest({
          kind: "note",
          at: NOW - DAY_MS,
          summary:
            "On a special offer: the next USD 3,000 payment is due when they close a deal.",
          risks: ["The next payment depends on the client closing a deal."],
        }),
        digest({
          kind: "kickoff",
          at: NOW - DAY_MS,
          summary: "Kickoff.",
          risks: [
            "The business has no completed projects to show.",
            "Engineer details have not yet been provided.",
          ],
        }),
      ],
    });
    const texts = b.raise.map(l => l.text);
    expect(texts).toContain(
      "The next payment depends on the client closing a deal (USD 3,000, special offer).",
    );
    expect(texts).toContain("Engineer details have not yet been provided.");
    expect(texts.some(t => t.includes("no completed projects"))).toBe(false);
    expect(b.who.map(l => `${l.label}: ${l.text}`)).toContain(
      "From the kickoff: The business has no completed projects to show.",
    );
  });

  test("two billing notices are one line, and the other's step is not raised again", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-09-10T10:00:00Z",
            endsAt: "2026-09-10T10:30:00Z",
          }),
        ],
      }),
      digests: [
        digest({
          kind: "note",
          at: NOW - DAY_MS,
          summary: "Unsettled balance.",
          nextSteps: [
            "Mahara: Open Meta Billing to verify the unsettled account balance.",
          ],
          risks: ["Meta reports an unsettled account balance."],
        }),
        digest({
          kind: "note",
          at: NOW - DAY_MS - 60_000,
          summary: "Grace period.",
          nextSteps: [
            "Mahara: Open Meta Billing to verify the payment grace-period notice.",
          ],
          risks: ["The payment grace period requires action."],
        }),
      ],
    });
    expect(b.raise.filter(l => /Meta Billing/.test(l.text)).length).toBe(1);
  });
});

describe("problems, offers and plans", () => {
  test("a Problem bullet under the topics is followed up with its root cause", () => {
    const s = [
      "## Key takeaways",
      "  - **Content:** fix the spelling in the ads.",
      "## Topics",
      "### Performance",
      "  - **المشكلة:** لم يتم إغلاق أي صفقات حتى الآن.",
      "  - **السبب الجذري:** عدم وجود ملاحظات ما بعد الاجتماع.",
    ].join("\n");
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({ calls: [fathomCall(s)] }),
    });
    expect(b.raise.find(l => l.text.startsWith("Follow up on"))?.text).toBe(
      'Follow up on "لم يتم إغلاق أي صفقات حتى الآن" from the 8 Oct call (root cause noted: "عدم وجود ملاحظات ما بعد الاجتماع"): has it improved since?',
    );
  });

  test("0% and worries count as problems; a label quotes only when it is the problem", () => {
    const zero = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          fathomCall(
            "## Key takeaways\n  - **Primary Bottleneck:** A 0% show rate is the main constraint.",
          ),
        ],
      }),
    });
    expect(
      zero.raise.find(l => l.text.startsWith("Follow up on"))?.text,
    ).toContain('"A 0% show rate is the main constraint"');
    const worry = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          fathomCall(
            "## Key takeaways\n  - **تصحيح المسار:** أثار العميل مخاوف جدية بشأن جودة الإعلانات.",
          ),
        ],
      }),
    });
    expect(
      worry.raise.find(l => l.text.startsWith("Follow up on"))?.text,
    ).toContain("أثار العميل مخاوف جدية بشأن جودة الإعلانات");
  });

  test("an offer is an open decision with their step, not a problem", () => {
    const s = [
      "## Key takeaways",
      "  - **فرصة SEO/GEO:** عرضت MaharaMedia حزمة SEO/GEO بعد أن لاحظت ضعف حضورها.",
      "## Next steps",
      "  - **City Wood:**",
      "    - تقييم عرض SEO/GEO مع مطور الموقع.",
    ].join("\n");
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({ calls: [fathomCall(s)] }),
    });
    const texts = b.raise.map(l => l.text);
    expect(texts).toContain(
      'Open offer from the 8 Oct call: "فرصة SEO/GEO". Did they decide? Their step: تقييم عرض SEO/GEO مع مطور الموقع.',
    );
    expect(texts.some(t => t.startsWith("Follow up on"))).toBe(false);
  });

  test("with no next steps, the plan is split by owner and a promised targeting change is checked in Meta", () => {
    const s =
      "## Key takeaways\n  - **الخطة:** ستعمل MaharaMedia على تحسين استهداف الحملة، وستقوم City Wood بتوفير محتوى جديد.";
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({ calls: [fathomCall(s)] }),
    });
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "ستعمل MaharaMedia على تحسين استهداف الحملة",
    ]);
    expect(b.promises.theirs.map(l => l.text)).toEqual([
      "ستقوم City Wood بتوفير محتوى جديد",
    ]);
    expect(
      b.raise.some(l =>
        l.text.startsWith(
          'Promised on the 8 Oct call: "ستعمل MaharaMedia على تحسين استهداف الحملة". No targeting change',
        ),
      ),
    ).toBe(true);
  });
});

describe("ad changes and numbers", () => {
  const at = Date.parse("2026-10-10T06:00:00Z");
  test("decision notes alone are not ad changes; identical decision rows are one", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        changes: [1, 2, 3].map(() => ({
          day: "2026-10-10",
          at,
          kind: "touch",
          action: "Client updated",
          evidence: "CPL $11.66 is under the $15 gate on $210 spend.",
          source: "decision",
        })) as never,
      }),
    });
    expect(b.since.notes.map(n => n.text)).toEqual([
      "Sent the client an update",
    ]);
    expect(
      b.raise.some(l => l.text.startsWith("No ad changes are recorded")),
    ).toBe(true);
  });

  test("an edit to an ad made that day is part of making it; edits count per ad; a budget note gives the figure", () => {
    const row = (kind: string, evidence: string, plus = 0) => ({
      day: "2026-10-10",
      at: at + plus,
      kind,
      action: kind,
      evidence,
      actor: "Saleh Attale",
      source: "meta_activity",
    });
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      teamActors: ["Saleh Attale"],
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-01T10:00:00Z",
            endsAt: "2026-10-01T10:30:00Z",
          }),
        ],
        changes: [
          row("create_ad", "ad-1"),
          row("update_ad_creative", "ad-1", 240_000),
          row("update_ad_creative", "ad-9", 300_000),
          row("update_ad_creative", "ad-9", 360_000),
          row("update_campaign_budget", "Campaign A", 400_000),
          {
            day: "2026-10-10",
            at: at + 400_000,
            kind: "manual",
            action: "Set the campaign's daily budget to $38",
            source: "legacy_manual",
          },
          {
            day: "2026-10-10",
            at: at + 500_000,
            kind: "alternative",
            action: "Duplicate the winner",
            evidence: "CPL $10.50 is under the $15 gate on $105 spend.",
            source: "decision",
          },
        ] as never,
      }),
    });
    expect(b.raise.find(l => l.text.startsWith("Tell them"))?.text).toBe(
      "Tell them what we changed on their ads (10 Oct): we launched 1 new ad, set the daily budget to $38, updated 1 ad.",
    );
    expect(b.since.notes.map(n => n.text)).toContain(
      "Duplicate the winner (that ad set's cost per lead is under the $15 gate on $105 spend.)",
    );
  });
});

describe("who they are", () => {
  const onboardingForm = (answers: { title: string; value: unknown }[]) => ({
    token: "o1",
    formId: "KFRCXPFx",
    kind: "onboarding",
    submittedAt: "2026-09-01T10:00:00Z",
    answers,
  });
  test("a goal's currency comes from the call or the form's other answers, with where it came from", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          fathomCall(
            "## Key takeaways\n  - **الهدف:** تحقيق 2 مليون ريال سعودي خلال 90 يومًا.",
          ),
        ],
        forms: [
          onboardingForm([
            {
              title: "What is your realistic goal revenue in 90 Days?",
              value: 2000000,
            },
          ]),
        ],
      }),
    });
    expect(b.who.find(l => l.label === "90-day revenue goal")?.text).toBe(
      "2,000,000 (SAR, from the 8 Oct call)",
    );
  });

  test("no 'wants to grow': what they do and where; damaged Arabic is skipped", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        forms: [
          onboardingForm([
            {
              title:
                "Out of those what is the #1 service/type of project you want to focus on scaling?",
              value: "نقدم ح خدمات ب التصميم و ل التنفيذ في كل المناطق",
            },
            {
              title: "1) What services do you offer list all of them?",
              value:
                "Joinery, fit-out & installation of kitchens. Also wardrobes.",
            },
            {
              title: "What service areas do you cover? Please list all cities",
              value: "Kuwait, Bahrain",
            },
          ]),
        ],
      }),
    });
    expect(b.who.map(l => `${l.label}: ${l.text}`)).toEqual([
      "What they do: Joinery, fit-out & installation of kitchens.",
      "Where: Kuwait, Bahrain",
    ]);
  });

  test("a repeated kickoff title is read in full: links skipped, goal lines parsed; old leads with no list are asked for", () => {
    const b = buildBrief({
      now: NOW,
      client: { name: "City Wood", stage: "Brand Blueprint Booked" },
      digests: [],
      timeline: timeline({
        forms: [
          {
            token: "k1",
            formId: "kick",
            kind: "kickoff",
            submittedAt: "2026-10-04T10:00:00Z",
            answers: [
              {
                title: "Anything to add?",
                value:
                  "Will change office location here is google maps: https://share.google/x",
              },
              {
                title: "Anything to add?",
                value:
                  "Last Year's Total Revenue: 45000KWD\n90-Day Goal Revenue: 25000KWD\n12-24 Month Revenue Goal: 250000KWD",
              },
              { title: "Do you have pre-existing leads?", value: true },
              {
                title: "Do you want us to reach out to those leads?",
                value: true,
              },
              { title: "Provide link or notes for those leads.", value: "n/a" },
              { title: "WhatsApp Status", value: "Access confirmed." },
              {
                title: "Whatsapp synced to Mahara OS?",
                value: "Needs Integrating",
              },
              { title: "Mahara OS Access Status", value: "Tech Issue" },
              { title: "Facebook Access Status?", value: "Requested" },
            ],
          },
          {
            token: "c1",
            formId: "fRokTITH",
            kind: "checkin",
            submittedAt: "2026-10-04T11:00:00Z",
            answers: [
              {
                title: "Additional Notes",
                value:
                  "The calendar link is glitching and the portal isn't working on mobile.",
              },
            ],
          },
        ],
      }),
    });
    const who = b.who.map(l => `${l.label}: ${l.text}`);
    expect(
      who.some(t => t.startsWith("Kickoff notes: Last Year's Total Revenue")),
    ).toBe(true);
    expect(who).toContain(
      "90-day revenue goal: 25,000 KWD (from the kickoff notes)",
    );
    const texts = b.raise.map(l => l.text);
    expect(texts).toContain(
      'Still open from the 4 Oct kickoff: Facebook access, Mahara OS access, WhatsApp sync to Mahara OS. Your 1-1 notes add: "The calendar link is glitching and the portal isn\'t working on mobile."',
    );
    expect(texts.some(t => t.startsWith("Ask for their old leads list"))).toBe(
      true,
    );
  });

  test("1-1 note fragments join their neighbours; imperatives to us are our promises", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: timeline({
        calls: [
          call({
            source: "checkin_form",
            status: "held",
            startsAt: "2026-10-05T10:00:00Z",
            endsAt: "2026-10-05T10:00:00Z",
          }),
        ],
        forms: [
          {
            token: "c1",
            formId: "fRokTITH",
            kind: "checkin",
            submittedAt: "2026-10-05T10:00:00Z",
            answers: [
              {
                title: "Client Notes",
                value:
                  "صور اوضح - من مشاريعنا السابقة - فيديو قصير يعرض خدمة التصميم الداخلي للفلل",
              },
              {
                title: "Additional Notes",
                value:
                  "- Send them the welcome survey.\n- Send them a QR code to scan.",
              },
            ],
          },
        ],
      }),
    });
    expect(b.call.lines.map(l => l.text)).toEqual([
      "صور اوضح - من مشاريعنا السابقة",
      "فيديو قصير يعرض خدمة التصميم الداخلي للفلل",
    ]);
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "Send them the welcome survey.",
      "Send them a QR code to scan.",
    ]);
  });
});

describe("mood and billing carry-overs", () => {
  test("a testimonial mood asks for the testimonial; a card billing step from before the call stays ours", () => {
    const b = buildBrief({
      now: NOW,
      client: live,
      timeline: timeline({
        calls: [
          call({
            startsAt: "2026-10-09T10:00:00Z",
            endsAt: "2026-10-09T10:30:00Z",
          }),
        ],
        forms: [
          {
            token: "c1",
            formId: "f",
            kind: "checkin",
            submittedAt: "2026-09-14T10:00:00Z",
            answers: [
              { title: "Defcon Status", value: "Very Happy (testimonial)" },
            ],
          },
        ],
      }),
      digests: [
        digest({
          kind: "note",
          at: Date.parse("2026-10-06T10:00:00Z"),
          summary: "A USD 1,900 payment was logged.",
          nextSteps: [
            "Mahara: Set the next payment date once it is agreed with the client.",
          ],
        }),
      ],
    });
    const texts = b.raise.map(l => l.text);
    expect(texts).toContain(
      "They were marked ready for a testimonial on 14 Sep. Ask for it.",
    );
    expect(texts.some(t => t.startsWith("Their mood was last recorded"))).toBe(
      false,
    );
    expect(b.promises.ours.map(l => l.text)).toEqual([
      "Set the next payment date once it is agreed with the client.",
    ]);
  });
});

describe("the team writing in a client group", () => {
  const team = [
    "Rasem Abdel Al",
    "Nada Ali",
    "Sabry Hassan",
    "Ahmed Fathy",
    "Daniya Saleh",
  ];
  test("the team is told apart from the client's people by name", () => {
    expect(teamSpeaker("Rasem Abdel all", team)).toBe(true);
    expect(teamSpeaker("Nada | MaharaMedia", team)).toBe(true);
    expect(teamSpeaker("Karim@Maharamedia", team)).toBe(true);
    expect(teamSpeaker("Sabry", team)).toBe(true);
    expect(teamSpeaker("DANIYA", team)).toBe(true);
    // A client contact who shares a team member's first name is the client.
    expect(teamSpeaker("Ahmed Salama", team)).toBe(false);
    expect(teamSpeaker("Malak Rahal", team)).toBe(false);
    expect(teamSpeaker("M", team)).toBe(false);
    expect(teamSpeaker(null, team)).toBe(false);
  });

  test("a lone name matches a team member's name letter for letter, never by its consonants", () => {
    const roster = ["Ahmed Sabry", "Abdulaziz Waheedi", "Maria Lopez"];
    expect(teamSpeaker("Sabry", roster)).toBe(true);
    expect(teamSpeaker("Aziz", roster)).toBe(true);
    // "Umar" and "Maria" share their consonants; a client named Umar is not the team.
    expect(teamSpeaker("Umar", roster)).toBe(false);
    expect(teamSpeaker("Mo", roster)).toBe(false);
  });

  test("a chat waits on us only when the client wrote last, not a team member", () => {
    const m = (direction: string, speaker: string | null, at: number) => ({
      direction,
      speaker,
      at,
    });
    expect(
      clientWaiting(
        [m("inbound", "Malak Rahal", 1), m("inbound", "Rasem Abdel all", 2)],
        team,
      ),
    ).toBeUndefined();
    expect(
      clientWaiting(
        [m("inbound", "Rasem Abdel all", 1), m("inbound", "Malak Rahal", 2)],
        team,
      )?.at,
    ).toBe(2);
    expect(
      clientWaiting([m("inbound", null, 1), m("outbound", null, 2)], team),
    ).toBeUndefined();
    expect(
      clientWaiting([m("outbound", null, 1), m("inbound", null, 2)], team)?.at,
    ).toBe(2);
  });

  test("the brief does not raise a group waiting on a team member's own message", () => {
    const at = (iso: string) => Date.parse(iso);
    const msg = (iso: string, body: string, speaker: string | null) => ({
      direction: "inbound",
      body,
      kind: "text",
      speaker,
      at: at(iso),
      today: at(iso) >= at("2026-10-11T21:00:00Z"),
    });
    const group = (messages: ReturnType<typeof msg>[]) => ({
      name: "Mahara | City Wood",
      isGroup: true,
      archived: false,
      awaitingUs: true,
      lastInboundAt: messages[messages.length - 1].at,
      messages,
    });
    const base = timeline({
      calls: [
        call({
          startsAt: "2026-10-09T10:00:00Z",
          endsAt: "2026-10-09T10:30:00Z",
        }),
      ],
    });
    const teamLast = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: base,
      teamActors: team,
      whatsapp: {
        threads: [
          group([
            msg("2026-10-12T08:00:00Z", "Can we talk today?", "Malak Rahal"),
            msg(
              "2026-10-12T09:00:00Z",
              "https://app.leadsie.com/connect/x",
              "Rasem Abdel all",
            ),
          ]),
        ],
      },
    });
    expect(teamLast.raise.some(l => l.source === "WhatsApp")).toBe(false);
    expect(teamLast.since.chats.map(l => l.text)).toEqual([
      "Can we talk today?",
    ]);
    const clientLast = buildBrief({
      now: NOW,
      client: live,
      digests: [],
      timeline: base,
      teamActors: team,
      whatsapp: {
        threads: [
          group([
            msg("2026-10-12T08:00:00Z", "On it", "Rasem Abdel all"),
            msg(
              "2026-10-12T09:00:00Z",
              "https://app.leadsie.com/connect/x",
              "Malak Rahal",
            ),
          ]),
        ],
      },
    });
    expect(clientLast.raise.find(l => l.source === "WhatsApp")?.text).toBe(
      'Malak Rahal in Mahara | City Wood is waiting on a WhatsApp reply since 12:00 today: "A link (app.leadsie.com)". Answer it before the call.',
    );
  });
});

describe("a client request already raised", () => {
  // Invented: a kickoff that has old leads and no list, and a later call
  // where the same ask was logged in the client's own words.
  const kickoff = {
    token: "k9",
    formId: "kick",
    kind: "kickoff",
    submittedAt: "2026-10-04T10:00:00Z",
    answers: [
      { title: "Do you have pre-existing leads?", value: true },
      { title: "Do you want us to reach out to those leads?", value: true },
      { title: "Provide link or notes for those leads.", value: "n/a" },
    ],
  };
  const asked = (clientRequests: string[]) =>
    buildBrief({
      now: NOW,
      client: { name: "Cedar Joinery", stage: "Active" },
      digests: [digest({ clientRequests })],
      timeline: timeline({ clientName: "Cedar Joinery", forms: [kickoff] }),
    }).raise.map(l => l.text);

  test("is not asked again as a request: the old leads list says it once", () => {
    const texts = asked(["Have Mahara contact pre-existing leads."]);
    expect(texts.some(t => t.startsWith("Ask for their old leads list"))).toBe(
      true,
    );
    expect(texts.some(t => t.startsWith("They asked for:"))).toBe(false);
  });

  test("the next request is asked instead, and one shared word is not enough", () => {
    expect(
      asked([
        "Have Mahara contact pre-existing leads.",
        "Send the new price list for wardrobes.",
      ]),
    ).toContain("They asked for: Send the new price list for wardrobes.");
    expect(asked(["More leads from Ahmadi."])).toContain(
      "They asked for: More leads from Ahmadi.",
    );
  });
});
