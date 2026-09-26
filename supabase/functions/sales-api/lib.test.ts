// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import {
  dndFor,
  redact,
  type Appointment,
  applyFills,
  fillPaths,
  checkCoachReview,
  checkGoals,
  checkLink,
  checkOffer,
  checkPay,
  checkReference,
  checkSnippet,
  checkTemplateRoute,
  cors,
  crmDecision,
  fillSnippet,
  greetingName,
  needsPerson,
  refuseMark,
  renderTemplate,
  templateLine,
  trimMessages,
} from "./lib.ts";

const NOW = Date.parse("2026-09-24T09:00:00Z");
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  appointment_id: "a1",
  contact_id: "c1",
  call_type: "demo",
  start_at: "2026-09-24T07:00:00Z",
  status: "confirmed",
  assigned_user_id: "ghl-closer",
  calendar_id: "cal",
  ...over,
});
const rep = { signed_in: true, email: "rep@x.com", seat: true, manager: false, role: "closer", ghl_user_id: "ghl-closer" };
const manager = { signed_in: true, email: "boss@x.com", seat: true, manager: true, role: "manager", ghl_user_id: null };

describe("who may mark a call", () => {
  test("the rep the call is booked with", () => {
    expect(refuseMark(rep, appt(), "showed", NOW)).toBeNull();
  });
  test("not another rep's call", () => {
    expect(refuseMark(rep, appt({ assigned_user_id: "other" }), "showed", NOW)).toContain("another rep");
  });
  test("a manager may mark any call", () => {
    expect(refuseMark(manager, appt({ assigned_user_id: "other" }), "noshow", NOW)).toBeNull();
  });
  test("a seat with no HighLevel user is told how to fix it", () => {
    expect(refuseMark({ ...rep, ghl_user_id: null }, appt(), "showed", NOW)).toContain("Team page");
  });
  test("a future call can be cancelled but not attended", () => {
    const later = appt({ start_at: "2026-09-25T09:00:00Z" });
    expect(refuseMark(rep, later, "showed", NOW)).toContain("not happened yet");
    expect(refuseMark(rep, later, "cancelled", NOW)).toBeNull();
  });
  test("only the four statuses", () => {
    expect(refuseMark(rep, appt(), "rescheduled", NOW)).toContain("Choose");
  });
});

describe("whether a mark goes to HighLevel (Aziz: yes for today's calls)", () => {
  test("switched off means off", () => {
    expect(crmDecision({ dispositions: false }, appt(), NOW)).toBe("off");
    expect(crmDecision(null, appt(), NOW)).toBe("off");
  });
  test("a recent call is written", () => {
    expect(crmDecision({ dispositions: true, backlog_days: 7 }, appt(), NOW)).toBe("write");
  });
  test("an old call stays in the cockpit, so no old lead gets a no-show message", () => {
    const old = appt({ start_at: "2026-09-10T07:00:00Z" });
    // An older call goes quietly (no automations), unless that is switched off.
    expect(crmDecision({ dispositions: true, backlog_days: 7 }, old, NOW)).toBe("quiet");
    expect(crmDecision({ dispositions: true, backlog_days: 7, quiet_backlog: false }, old, NOW)).toBe("skipped");
  });
});

describe("pay rules", () => {
  test("Aziz's closer rule: 10% of cash as it is collected, plus $250 paid in full", () => {
    const r = checkPay({ cash_rate: "0.10", pif_bonus: 250 });
    expect(r).toEqual({ ok: true, pay: { cash_rate: 0.1, pif_bonus: 250, currency: "USD" } });
  });
  test("a rate over 100% is refused with the fix", () => {
    const r = checkPay({ cash_rate: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("0.10");
  });
  test("no rule is an empty rule, never zero", () => {
    expect(checkPay(null)).toEqual({ ok: true, pay: {} });
  });
});

describe("goals", () => {
  test("weekly and monthly units and cash", () => {
    expect(checkGoals({ weekly: { booked: 20, cash: "3000" }, monthly: { closes: 4 } })).toEqual({
      ok: true,
      goals: { weekly: { booked: 20, cash: 3000 }, monthly: { closes: 4 } },
    });
  });
  test("a negative goal is refused", () => {
    expect(checkGoals({ weekly: { booked: -1 } }).ok).toBe(false);
  });
});

describe("links", () => {
  test("https only, with a name", () => {
    expect(checkLink({ label: "Deck", url: "http://x.com" }).ok).toBe(false);
    expect(checkLink({ label: "", url: "https://x.com" }).ok).toBe(false);
    const ok = checkLink({ label: "Deck", url: "https://pitch.com/v/x", kind: "deck" });
    expect(ok.ok && ok.row.kind).toBe("deck");
    const blank = checkLink({ label: "Deck", url: "https://x.com", sort: "" });
    expect(blank.ok && blank.row.sort).toBe(100);
  });
});

describe("the closer's offer choices", () => {
  test("guarantee and a payment plan", () => {
    expect(checkOffer({ guarantee: true, payment: "plan_3" })).toEqual({
      ok: true,
      offer: { guarantee: true, payment: "plan_3" },
    });
  });
  test("defaults to paid in full with no guarantee", () => {
    expect(checkOffer(undefined)).toEqual({ ok: true, offer: { guarantee: false, payment: "pif" } });
  });
  test("an odd length is refused", () => {
    expect(checkOffer({ months: 2.5 }).ok).toBe(false);
  });
});

test("messages are trimmed to what the page shows", () => {
  const out = trimMessages([{ id: "m", direction: "inbound", messageType: "TYPE_WHATSAPP", body: "x".repeat(5000), attachments: ["a"] }]);
  expect(out[0].type).toBe("TYPE_WHATSAPP");
  expect(String(out[0].body).length).toBe(2000);
  expect(out[0].has_attachments).toBe(true);
});

test("only the cockpit's own addresses may call it from a browser", () => {
  expect(cors("https://cockpit.maharamedia.com")["Access-Control-Allow-Origin"]).toBe("https://cockpit.maharamedia.com");
  expect(cors("https://evil.example")["Access-Control-Allow-Origin"]).toBe("null");
});

describe("filling the blanks a draft left", () => {
  const deal = {
    headline: "Your next FILL projects",
    investment: { rows: [{ label: "Program", amount: "FILL" }], total: 6000 },
    quotes: [{ en: "We need more leads" }],
  };
  test("every FILL is found by its path", () => {
    expect(fillPaths(deal)).toEqual(["headline", "investment.rows.0.amount"]);
  });
  test("a figure replaces a bare FILL as a number, words replace text", () => {
    const out = applyFills(deal, { "investment.rows.0.amount": "6,000", headline: "Your next 12 projects" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const d = out.deal as typeof deal;
      expect(d.investment.rows[0].amount as unknown).toBe(6000);
      expect(d.headline).toBe("Your next 12 projects");
      expect(deal.headline).toContain("FILL");
    }
  });
  test("settled text cannot be rewritten through a fill", () => {
    expect(applyFills(deal, { "quotes.0.en": "made up" }).ok).toBe(false);
    expect(applyFills(deal, { "investment.total": "1" }).ok).toBe(false);
  });
  test("a fill that still says FILL is refused", () => {
    expect(applyFills(deal, { headline: "Your next FILL" }).ok).toBe(false);
  });
});

describe("Aziz's call reviews", () => {
  test("a link or a line of lessons is enough, cleaned", () => {
    const r = checkCoachReview({ title: " Handling 'too expensive' ", url: "https://www.skool.com/mahara/post-1", tags: "Price, objections, price" });
    expect(r.ok && r.row).toMatchObject({ title: "Handling 'too expensive'", url: "https://www.skool.com/mahara/post-1", tags: ["price", "objections"], score: null });
  });
  test("what cannot be saved says why", () => {
    expect(checkCoachReview({ title: "x" }).ok).toBe(false);
    expect(checkCoachReview({ title: "No link" }).ok).toBe(false);
    expect(checkCoachReview({ title: "Bad link", url: "skool.com/x" }).ok).toBe(false);
    expect(checkCoachReview({ title: "Bad type", url: "https://a.b", call_type: "webinar" }).ok).toBe(false);
    expect(checkCoachReview({ title: "Bad score", url: "https://a.b", score: 140 }).ok).toBe(false);
    expect(checkCoachReview({ title: "For one rep", lessons: "Slow down at the price", for_email: "Tahreer@maharamedia.com" }).ok).toBe(true);
  });
});

describe("WhatsApp templates", () => {
  const preview = "هلا {{1}}، معاك {{2}} من مهارة ميديا.\n{{3}}\nإذا حاب نكمل، رد علي هني.";
  const variables = ["first_name", "rep_name", "line"] as const;

  test("a line loses its line breaks, tabs and runs of spaces (Meta refuses them)", () => {
    expect(templateLine("first\nsecond\r\n\tthird     fourth")).toBe("first second third fourth");
    expect(templateLine("x".repeat(900)).length).toBe(700);
    expect(templateLine(null)).toBe("");
  });

  test("the approved text reads with the values in, and a missing value stays visible", () => {
    expect(renderTemplate(preview, variables, { first_name: "أحمد", rep_name: "سارة", line: "حبيت أتابع معاك." }))
      .toBe("هلا أحمد، معاك سارة من مهارة ميديا.\nحبيت أتابع معاك.\nإذا حاب نكمل، رد علي هني.");
    expect(renderTemplate(preview, variables, { first_name: "أحمد" })).toContain("{{2}}");
  });

  test("a lead is greeted by their first name, else the first word of their name", () => {
    expect(greetingName("Omar", "Omar Saleh")).toBe("Omar");
    expect(greetingName("", "عبد الله الواحد")).toBe("عبد");
    expect(greetingName(null, null)).toBe("");
  });

  test("a ready-made message takes what is known and leaves the rest marked", () => {
    expect(fillSnippet("هلا {name}، موعدنا {day} الساعة {time}", { name: "سارة", day: "باجر" }))
      .toBe("هلا سارة، موعدنا باجر الساعة {time}");
  });

  test("a template route needs matching {{n}}, a real workflow before it goes on, and known kinds", () => {
    const base = { key: "line_ar", name: "cockpit_line_ar", language: "ar", purpose: "Any follow-up", preview, variables: [...variables] };
    expect(checkTemplateRoute(base).ok).toBe(true);
    expect(checkTemplateRoute({ ...base, active: true })).toEqual({ ok: false, error: "Pick the workflow that sends it before switching it on." });
    expect(checkTemplateRoute({ ...base, workflow_id: "c5467d7f-0692-4fef-b0c0-f286011db66b", active: true }).ok).toBe(true);
    expect(checkTemplateRoute({ ...base, variables: ["first_name", "line"] }).ok).toBe(false);
    expect(checkTemplateRoute({ ...base, name: "Cockpit Line" }).ok).toBe(false);
    expect(checkTemplateRoute({ ...base, segments: ["reply", "somewhere"] }).ok).toBe(false);
    expect(checkTemplateRoute({ ...base, workflow_id: "not-an-id" }).ok).toBe(false);
  });

  test("a ready-made message needs a moment, a language and words", () => {
    expect(checkSnippet({ moment: "no_show", language: "ar", body: "هلا {name}" }).ok).toBe(true);
    expect(checkSnippet({ moment: "whenever", language: "ar", body: "هلا" }).ok).toBe(false);
    expect(checkSnippet({ moment: "no_show", language: "fr", body: "salut" }).ok).toBe(false);
    expect(checkSnippet({ moment: "no_show", language: "en", body: " " }).ok).toBe(false);
  });
});

describe("client references", () => {
  test("a reference needs a client and a clear consent; proof by slug", () => {
    const ok = checkReference({ client_name: "Example Contracting", consent: "yes", asset_slugs: "case-one, Case-Two" });
    expect(ok.ok && ok.row.asset_slugs).toEqual(["case-one", "case-two"]);
    expect(checkReference({ client_name: "X" }).ok).toBe(false);
    expect(checkReference({ client_name: "Example", consent: "maybe" }).ok).toBe(false);
    expect(checkReference({ client_name: "Example", asset_slugs: ["https://x.com"] }).ok).toBe(false);
  });
});

describe("what a draft sent without a person may not carry", () => {
  test("money, promises, percentages and links wait for a person", () => {
    expect(needsPerson("هلا عمر، نقدر نعطيك خصم ٢٠٪ إذا بديت هالشهر")).not.toBeNull();
    expect(needsPerson("Hi Omar, it is only $500 to start")).toBe("it mentions money");
    expect(needsPerson("We guarantee results in 30 days")).toBe("it mentions a price, a discount or a promise");
    expect(needsPerson("Watch this: https://example.com/x")).toBe("it mentions a link");
    expect(needsPerson("Hi Omar, 50% of firms see this")).toBe("it mentions a percentage");
  });
  test("an ordinary follow-up may go", () => {
    expect(needsPerson("هلا عمر، شكله صار عندك شي وقت المكالمة. تبيني أرسل لك أوقات ثانية؟")).toBeNull();
    expect(needsPerson("Hi Omar, did something come up? Shall I send a couple of new times?")).toBeNull();
  });
});

describe("redact", () => {
  test("keys in query strings and bearer headers are cut out", () => {
    expect(redact("GET /x?api_key=abc123&page=2 -> 500")).toBe("GET /x?api_key=[key]&page=2 -> 500");
    expect(redact("Authorization: Bearer sk-live.abc_DEF")).toBe("Authorization: Bearer [key]");
    expect(redact("pit-1234-abcd refused")).toBe("[key] refused");
  });
});

describe("do-not-disturb by channel", () => {
  test("active and permanent both close the channel; inactive leaves it open", () => {
    const c = (status: string) => ({ dndSettings: { WhatsApp: { status } } });
    expect(dndFor(c("active"), "whatsapp")).toBe(true);
    expect(dndFor(c("permanent"), "whatsapp")).toBe(true);
    expect(dndFor(c("inactive"), "whatsapp")).toBe(false);
    expect(dndFor(c("permanent"), "email")).toBe(false);
    expect(dndFor({ dnd: true }, "email")).toBe(true);
  });
});
