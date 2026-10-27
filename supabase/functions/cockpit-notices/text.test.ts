import { describe, expect, test } from "bun:test";
import { SERVICE_LABEL as BRIEF_SERVICE_LABEL } from "../../../apps/client-success-cockpit/src/present/blueprintBrief";
import {
  cleanStatus, escapeSlack, kuwaitClock, kuwaitDay, kuwaitWhen, NOTICE_KINDS, type NoticeFacts, type NoticeKind, noticeLinks, noticeText, sampleFacts, SERVICE_LABEL,
  type SlackBlock, type TextMention, VARIANTS, type Variant,
} from "./text";

// Every client, card and person here is invented. 2026-10-25 is a Sunday; 11:02Z is 14:02 in Kuwait.
const REF = "CN-1a2b3c4d";
const TASK = "task0001";
const CREATIVE: TextMention = { label: "the creative director", slackId: "U0B2SHGS1JA" };
const CSM: TextMention = { label: "the CSM", slackId: "U0C5JHUCTPG" };
const SYSTEMS: TextMention = { label: "the systems manager", slackId: "U0AS90SHMH8" };
const base = (extra: Record<string, unknown> = {}): NoticeFacts => ({ ref: REF, taskId: TASK, client: "Acme Interiors", ...extra });

const section = (blocks: SlackBlock[]) => ((blocks[0] as { text: { text: string } }).text.text);
const contexts = (blocks: SlackBlock[]) => blocks.slice(1).map(b => ((b as { elements: { text: string }[] }).elements[0].text));
const lines = (blocks: SlackBlock[]) => section(blocks).split("\n");
const L = noticeLinks(TASK);

describe("Kuwait time and the small helpers", () => {
  test("kuwaitWhen, kuwaitClock and kuwaitDay are UTC+3", () => {
    expect(kuwaitWhen("2026-10-25T11:02:00Z")).toBe("Sun 25 Oct, 14:02");
    expect(kuwaitClock("2026-10-25T11:02:00Z")).toBe("14:02");
    expect(kuwaitDay("2026-10-31T21:30:00Z")).toBe("Sun 1 Nov");
    expect(kuwaitWhen("2026-10-31T21:30:00Z")).toBe("Sun 1 Nov, 00:30");
    expect(kuwaitWhen("2026-10-25T14:02:00+03:00")).toBe("Sun 25 Oct, 14:02");
    expect(kuwaitWhen("not a time")).toBe("an unknown time");
  });
  test("escapeSlack turns & < > into entities and nothing else", () => {
    expect(escapeSlack("A & B <C> *d*")).toBe("A &amp; B &lt;C&gt; *d*");
  });
  test("cleanStatus keeps letters, numbers, spaces and hyphens", () => {
    expect(cleanStatus("Brand Blueprint Booked♠️")).toBe("Brand Blueprint Booked");
    expect(cleanStatus("Ready For Launch🚀")).toBe("Ready For Launch");
    expect(cleanStatus("  SALES TEAM TO CONTACT ")).toBe("SALES TEAM TO CONTACT");
    expect(cleanStatus("<b>Active</b> & co")).toBe("b Active b co");
  });
  test("the links", () => {
    expect(L).toEqual({
      cockpit: "https://cockpit.maharamedia.com/client-success/clients/task0001?tab=onboarding",
      card: "https://app.clickup.com/t/task0001",
      blueprint: "https://cockpit.maharamedia.com/client-success/clients/task0001/present/blueprint?view=prep",
    });
  });
  test("SERVICE_LABEL is blueprintBrief.ts's, key for key", () => {
    expect(SERVICE_LABEL).toEqual(BRIEF_SERVICE_LABEL);
  });
});

describe("every row of the copy table (contract 4.5)", () => {
  const kickoffFacts = base({ submittedAt: "2026-10-25T11:02:00Z", filledByRole: "the CSM", clientStatus: "Brand Blueprint Booked♠️", blueprintLink: true, handoffAt: "2026-10-25T11:04:00Z", commentCheck: "found", second: false, mentions: [CREATIVE] });

  test("kickoff, complete", () => {
    const { text, blocks } = noticeText("kickoff", "complete", kickoffFacts);
    expect(text).toBe(`Kickoff complete: Acme Interiors. Next is the Brand Blueprint call. Ref ${REF}`);
    expect(lines(blocks)).toEqual([
      "*Kickoff complete: Acme Interiors*",
      "Filled by the CSM on Sun 25 Oct, 14:02.",
      "The card shows Brand Blueprint Booked, and the Brand Blueprint link.",
      "The Kickoff Handoff comment is on the card (14:04).",
      "Next is the Brand Blueprint call. <@U0B2SHGS1JA>",
    ]);
    expect(contexts(blocks)).toEqual([`<${L.cockpit}|Open in the cockpit> · <${L.card}|Open the ClickUp card>`, `Client success · Ref ${REF}`]);
  });
  test("kickoff, complete: in Typeform, no link yet, a second kickoff", () => {
    const { blocks } = noticeText("kickoff", "complete", { ...kickoffFacts, filledByRole: null, blueprintLink: false, second: true, mentions: [CREATIVE, CSM] });
    expect(lines(blocks)).toEqual([
      "*Kickoff complete: Acme Interiors*",
      "Filled in Typeform on Sun 25 Oct, 14:02.",
      "The card shows Brand Blueprint Booked.",
      "The Kickoff Handoff comment is on the card (14:04).",
      "This is the second kickoff for this client. The card has a new Kickoff Handoff comment, so check it for a second Technical and Creative task, and do not send it a third time.",
      "Next is the Brand Blueprint call. <@U0B2SHGS1JA> <@U0C5JHUCTPG>",
    ]);
  });
  test("kickoff, late: missing, then unread, then a second kickoff", () => {
    const late = { ...kickoffFacts, commentCheck: "missing", handoffAt: null, mentions: [CSM, SYSTEMS] };
    const missing = noticeText("kickoff", "late", late);
    expect(missing.text).toBe(`Kickoff in, card not updated: Acme Interiors. Open the card and check it. Ref ${REF}`);
    expect(lines(missing.blocks)).toEqual([
      "*Kickoff in, card not updated: Acme Interiors*",
      "Filled by the CSM on Sun 25 Oct, 14:02.",
      "The card has no Kickoff Handoff comment 20 minutes after the kickoff. Open the card and check it. Do not send the kickoff again. <@U0C5JHUCTPG> <@U0AS90SHMH8>",
    ]);
    expect(contexts(missing.blocks)).toEqual([`<${L.cockpit}|Open in the cockpit> · <${L.card}|Open the ClickUp card>`, `Client success · Ref ${REF}`]);
    const unread = noticeText("kickoff", "late", { ...late, commentCheck: "unread" });
    expect(lines(unread.blocks)[2]).toBe("The cockpit could not read the card's comments 20 minutes after the kickoff. Open the card and check it for the Kickoff Handoff comment. Do not send the kickoff again. <@U0C5JHUCTPG> <@U0AS90SHMH8>");
    const second = noticeText("kickoff", "late", { ...late, second: true });
    expect(lines(second.blocks).at(-1)).toBe("This is the second kickoff for this client. Do not send it a third time.");
  });
  test("kickoff, late with the comment there: Make broke before it moved the card", () => {
    // The Kickoff Handoff comment is written first (module 11); the card's
    // stage and link later (module 21). A run that stopped between them is late.
    const half = { ...kickoffFacts, commentCheck: "found", clientStatus: "Onboarding Booked", mentions: [CSM, SYSTEMS] };
    const late = noticeText("kickoff", "late", half);
    expect(late.text).toBe(`Kickoff in, card not updated: Acme Interiors. Open the card and check it. Ref ${REF}`);
    expect(lines(late.blocks)[2]).toBe(
      "The Kickoff Handoff comment is on the card, but 20 minutes after the kickoff the card shows Onboarding Booked, not Brand Blueprint Booked. Open the card and check it. Do not send the kickoff again. <@U0C5JHUCTPG> <@U0AS90SHMH8>",
    );
    // At the stage already, but the cockpit saw no change since the kickoff.
    const stale = noticeText("kickoff", "late", { ...half, clientStatus: "Brand Blueprint Booked♠️" });
    expect(lines(stale.blocks)[2]).toStartWith(
      "The Kickoff Handoff comment is on the card, but the cockpit has not seen the card change since the kickoff.",
    );
    expect(lines(noticeText("kickoff", "late", { ...half, clientStatus: "<b>x</b>" }).blocks)[2]).toContain("shows b x b,");
  });
  test("kickoff.updated, thread and top: it names what caught up", () => {
    const f = base({ cardUpdatedAt: "2026-10-25T11:40:00Z", clientStatus: "Brand Blueprint Booked♠️" });
    const thread = noticeText("kickoff.updated", "thread", f);
    expect(thread.text).toBe(`Card updated at 14:40. It has the Kickoff Handoff comment and shows Brand Blueprint Booked. Ref ${REF}`);
    expect(thread.blocks).toHaveLength(1);
    expect(section(thread.blocks)).toBe("Card updated at 14:40. It has the Kickoff Handoff comment and shows Brand Blueprint Booked.");
    const top = noticeText("kickoff.updated", "top", f);
    expect(top.text).toBe(`Kickoff card updated: Acme Interiors, at Sun 25 Oct, 14:40. Ref ${REF}`);
    expect(lines(top.blocks)).toEqual([
      "*Kickoff card updated: Acme Interiors*",
      "Card updated at Sun 25 Oct, 14:40. It has the Kickoff Handoff comment and shows Brand Blueprint Booked.",
    ]);
    expect(contexts(top.blocks)).toEqual([`<${L.cockpit}|Open in the cockpit>`, `Client success · Ref ${REF}`]);
  });
  test("blueprint.close, done: phase 4, then phase 6, then no launch call", () => {
    const f = base({ closedByRole: "the creative director", closedAt: "2026-10-26T12:40:00Z", mapPhase: 4, launchCallAt: "2026-10-28T07:00:00Z", mentions: [CSM] });
    const done = noticeText("blueprint.close", "done", f);
    expect(done.text).toBe(`Brand Blueprint complete: Acme Interiors. Next is the launch call. Ref ${REF}`);
    expect(lines(done.blocks)).toEqual([
      "*Brand Blueprint complete: Acme Interiors*",
      "Closed by the creative director on Mon 26 Oct, 15:40. Scripts and custom creative can start.",
      "<@U0C5JHUCTPG> next: send the phase 5 WhatsApp from your comment on the card, then book the launch call.",
      "Launch call booked for Wed 28 Oct, 10:00.",
    ]);
    expect(contexts(done.blocks)).toEqual([`<${L.cockpit}|Open in the cockpit> · <${L.blueprint}|Read the Blueprint> · <${L.card}|Open the ClickUp card>`, `Client success · Ref ${REF}`]);
    // A client already live (the map past phase 4): the same rule as the
    // media notice's live variant, so the two posts of one close agree.
    const past = noticeText("blueprint.close", "done", { ...f, mapPhase: 6, launchCallAt: null, closedByRole: null });
    expect(past.text).toBe(`Brand Blueprint complete: Acme Interiors. The client is already live. Ref ${REF}`);
    expect(lines(past.blocks).slice(1)).toEqual([
      "Closed by the creative director on Mon 26 Oct, 15:40. The client is already live, so nothing new starts from this close.",
      "<@U0C5JHUCTPG> next: the Onboarding Map is already at phase 6, so there is no phase 5 WhatsApp to send and no launch call to book.",
    ]);
    const media = noticeText("blueprint.media", "live", { ...f, mapPhase: 6, mentions: [] });
    expect(lines(media.blocks).at(-1)).toBe("The client is already live; nothing new starts from this close.");
    // Active with the map below phase 5: no launch call, and the paste is checked first.
    const active = noticeText("blueprint.close", "done", { ...f, mapPhase: 4, clientStatus: "Active" });
    expect(lines(active.blocks).slice(1)).toEqual([
      "Closed by the creative director on Mon 26 Oct, 15:40. The client is already live, so nothing new starts from this close.",
      "<@U0C5JHUCTPG> next: there is no launch call to book. Check the card before you send the phase 5 WhatsApp from your comment.",
    ]);
    expect(JSON.stringify(active)).not.toContain("Scripts and custom creative can start");
    expect(JSON.stringify(active)).not.toContain("Launch call");
    const nobody = noticeText("blueprint.close", "done", { ...f, mentions: [] });
    expect(lines(nobody.blocks)[2]).toBe("Next: send the phase 5 WhatsApp from your comment on the card, then book the launch call.");
  });
  test("blueprint.close, reconcile and typeform", () => {
    const reconcile = noticeText("blueprint.close", "reconcile", base({ mentions: [CSM] }));
    expect(reconcile.text).toBe(`Blueprint closed: Acme Interiors. The card update needs a check. Ref ${REF}`);
    expect(lines(reconcile.blocks)).toEqual(["*Blueprint closed: Acme Interiors*", "The card update needs a check. Open the call page. <@U0C5JHUCTPG>"]);
    expect(contexts(reconcile.blocks)[0]).toContain("Read the Blueprint");
    const typeform = noticeText("blueprint.close", "typeform", base({ mentions: [CSM] }));
    expect(typeform.text).toBe(`Brand Blueprint complete: Acme Interiors. Next is the launch call. Ref ${REF}`);
    expect(lines(typeform.blocks)).toEqual(["*Brand Blueprint complete: Acme Interiors*", "The Blueprint form is in. Next is the launch call. <@U0C5JHUCTPG>"]);
  });
  test("blueprint.media, new: Make 9748311 [5] parity", () => {
    const { text, blocks } = noticeText("blueprint.media", "new", base({ service: "interior", launchTaskId: "launch01" }));
    expect(text).toBe(`Brand Blueprint completed: Acme Interiors. Scripts and custom creative can start. Ref ${REF}`);
    expect(lines(blocks)).toEqual([
      "*Brand Blueprint completed*",
      "Client: Acme Interiors",
      "Service focus: Interior design",
      `<${L.card}|card> · <https://app.clickup.com/t/launch01|launch task>`,
      "Scripts and custom creative can start.",
    ]);
    expect(contexts(blocks)).toEqual([`Media · Ref ${REF}`]);
    const plain = noticeText("blueprint.media", "new", base({ service: null, launchTaskId: null }));
    expect(lines(plain.blocks).slice(2, 4)).toEqual(["Service focus: not chosen", `<${L.card}|card>`]);
  });
  test("blueprint.media, live: the already-live line", () => {
    const { text, blocks } = noticeText("blueprint.media", "live", base({ service: "fitout" }));
    expect(text).toBe(`Brand Blueprint completed: Acme Interiors. The client is already live. Ref ${REF}`);
    expect(lines(blocks).at(-1)).toBe("The client is already live; nothing new starts from this close.");
    expect(lines(blocks)).toContain("Service focus: Fit-out and renovation");
  });
  test("blueprint.updated, thread and top", () => {
    const thread = noticeText("blueprint.updated", "thread", base());
    expect(thread.text).toBe(`The card update is confirmed. Ref ${REF}`);
    expect(thread.blocks).toHaveLength(1);
    expect(section(thread.blocks)).toBe("The card update is confirmed.");
    const top = noticeText("blueprint.updated", "top", base());
    expect(top.text).toBe(`Blueprint card confirmed: Acme Interiors. Ref ${REF}`);
    expect(lines(top.blocks)).toEqual(["*Blueprint card confirmed: Acme Interiors*", "The card update is confirmed."]);
    expect(contexts(top.blocks)).toEqual([`<${L.cockpit}|Open in the cockpit>`, `Client success · Ref ${REF}`]);
  });
  test("blueprint.offer, thread and top", () => {
    const thread = noticeText("blueprint.offer", "thread", base({ offeredByRole: "the CEO", dnaComplete: true }));
    expect(thread.text).toBe(`Offer locked by the CEO. Brand DNA is complete. Ref ${REF}`);
    expect(section(thread.blocks)).toBe("Offer locked by the CEO. Brand DNA is complete.");
    expect(thread.blocks).toHaveLength(1);
    const top = noticeText("blueprint.offer", "top", base({ dnaComplete: false }));
    expect(top.text).toBe(`Offer locked: Acme Interiors. Ref ${REF}`);
    expect(lines(top.blocks)).toEqual(["*Offer locked: Acme Interiors*", "Offer locked by the creative director. Brand DNA is still missing."]);
  });
  test("a reply with tags puts them at the end of its last line", () => {
    const { blocks } = noticeText("blueprint.offer", "thread", base({ dnaComplete: true, mentions: [CSM] }));
    expect(section(blocks)).toBe("Offer locked by the creative director. Brand DNA is complete. <@U0C5JHUCTPG>");
  });
  test("an unknown kind or a variant the kind has no wording for is refused", () => {
    expect(() => noticeText("kickoff", "done" as Variant, base())).toThrow("There is no done wording for kickoff.");
    expect(() => noticeText("blueprint.nope" as NoticeKind, "top", base())).toThrow("There is no notice called");
  });
});

describe("rules every notice keeps", () => {
  const all: [NoticeKind, Variant][] = NOTICE_KINDS.flatMap(k => VARIANTS[k].map(v => [k, v] as [NoticeKind, Variant]));
  const nasty = {
    ...sampleFacts("kickoff"),
    ref: REF,
    taskId: TASK,
    client: "Ali & Sons <!channel> @here",
    clientStatus: "Active <script>",
    filledByRole: "the CSM <@U999>",
    closedByRole: "the creative director & co",
    offeredByRole: "<!here>",
    // None of these may ever reach Slack.
    answers: { budget: "SECRET-ANSWER-1" },
    budget: "SECRET-BUDGET-2",
    daily_budget: { usd: 4242, said: "SECRET-BUDGET-3" },
    phone: "+96599990001",
    email: "client.secret@example.test",
    whatsapp: "SECRET-WHATSAPP-4",
    summary: "SECRET-SUMMARY-5",
    payment: "SECRET-PAYMENT-6",
    price: "SECRET-PRICE-7",
    mentions: [{ label: "the CSM & <friends>", slackId: null }, { label: "x", slackId: "<!channel>" }],
  };
  test.each(all)("%s %s: text ends with the Ref, everything is escaped, no secret key is read, no broadcast", (kind, variant) => {
    const { text, blocks } = noticeText(kind, variant, nasty);
    expect(text.endsWith(`Ref ${REF}`)).toBe(true);
    const everything = `${text}\n${JSON.stringify(blocks)}`;
    for (const secret of ["SECRET-", "4242", "+96599990001", "client.secret@example.test"]) expect(everything).not.toContain(secret);
    for (const raw of ["<!channel>", "<!here>", "<script>", "<@U999>", "<friends>"]) expect(everything).not.toContain(raw);
    if (everything.includes("Ali")) expect(everything).toContain("Ali &amp; Sons &lt;!channel&gt;");
  });
  test.each(all)("%s %s: house copy, no exclamation marks, no em or en dashes", (kind, variant) => {
    const { text, blocks } = noticeText(kind, variant, { ...sampleFacts(kind), ref: REF, mentions: [CSM] });
    const words = `${text}\n${JSON.stringify(blocks)}`;
    expect(words).not.toMatch(/[!–—]/);
    expect(words).not.toMatch(/\bMake (has|did|booked|sent)\b/);
  });
  test("a mention is a tag only for a real U or W id; anything else is its role label in plain text", () => {
    const f = base({ submittedAt: "2026-10-25T11:02:00Z", mentions: [{ label: "the creative director", slackId: null }] });
    expect(lines(noticeText("kickoff", "complete", f).blocks).at(-1)).toBe("Next is the Brand Blueprint call. The creative director");
    const two = base({ mentions: [{ label: "the CSM", slackId: null }, { label: "the systems manager", slackId: "not-an-id" }] });
    expect(lines(noticeText("kickoff", "late", two).blocks)[2]).toEndWith("Do not send the kickoff again. The CSM and the systems manager");
    const mixed = base({ mentions: [CSM, { label: "the systems manager", slackId: null }] });
    expect(lines(noticeText("kickoff", "late", mixed).blocks)[2]).toEndWith("again. <@U0C5JHUCTPG> the systems manager");
    const lead = base({ mentions: [{ label: "the CSM", slackId: null }] });
    expect(lines(noticeText("blueprint.close", "done", lead).blocks)[2]).toBe("The CSM next: send the phase 5 WhatsApp from your comment on the card, then book the launch call.");
    expect(JSON.stringify(noticeText("kickoff", "late", two))).not.toContain("<@");
  });
  test("a rehearsal says so first, tags nobody, says who it would tag, and leaves the links out", () => {
    for (const [kind, variant] of all) {
      const { text, blocks } = noticeText(kind, variant, { ...sampleFacts(kind), ref: REF, rehearsal: true, mentions: [CSM, SYSTEMS] });
      expect(text.startsWith("[Rehearsal] ")).toBe(true);
      expect(text.endsWith(`Ref ${REF}`)).toBe(true);
      expect(section(blocks).startsWith("[Rehearsal] ")).toBe(true);
      expect(JSON.stringify(blocks)).not.toContain("<@");
      expect(JSON.stringify(blocks)).not.toContain("https://");
      expect(section(blocks)).toContain("This would tag the CSM and the systems manager.");
      const hadLinks = contexts(noticeText(kind, variant, { ...sampleFacts(kind), ref: REF }).blocks).some(c => c.includes("https://")) || kind === "blueprint.media";
      expect(contexts(blocks).includes("Links are left out of a test.")).toBe(hadLinks);
    }
  });
  test("sample facts name a sample client and no real ids", () => {
    const s = sampleFacts("blueprint.close", new Date("2026-10-25T11:00:00Z"));
    expect(s.client).toBe("Sample client");
    expect(s.taskId).toBe("sample");
    expect(s.launchTaskId).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/U0[A-Z0-9]{8}|C0[A-Z0-9]{8}/);
  });
  test("a client with no name still reads as a sentence", () => {
    expect(noticeText("blueprint.offer", "top", base({ client: "  " })).text).toBe(`Offer locked: an unnamed card. Ref ${REF}`);
  });
});
