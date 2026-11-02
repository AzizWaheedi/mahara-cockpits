/**
 * The offer gate, the deck's sources and status, wins and pitches
 * (20261026v_upsell_offer_decks.sql, docs/upsell-studio/BACKEND.md sections
 * 2.3 to 2.6), on an isolated PostgreSQL with Supabase's default privileges
 * on, every upsell file applied twice. Acme passes the gate as seeded; each
 * test takes one thing away and puts it back. Every person and client is
 * invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  EMAILS,
  type Row,
  SEATS,
  setClient,
  TASKS,
  upsellHelpers,
  upsellTestDb,
  uuid,
} from "./lib/upsellTestDb";

const { CSM_A, CSM_B, CSM_ALL, BUYER, CEO } = SEATS;
const { A, B, C } = TASKS;
let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;

const GATE = "SELECT public.cockpit_csm_offer_gate($1) r";
const gate = (task: string, who: string = CSM_A) => h.one(who, GATE, [task]);
const keys = (g: Row) => g.reasons.map((r: Row) => r.key);
const SOURCES = "SELECT public.cockpit_csm_offer_sources($1,$2) r";
const STATUS = "SELECT public.cockpit_csm_offer_status($1) r";
const PITCH =
  "SELECT public.cockpit_upsell_pitch_save($1,$2,$3::uuid,$4::jsonb,$5) r";
const pitch = (
  who: string,
  task: string,
  offer: string,
  request: string,
  patch: Row,
  rev: number | null,
) => h.one(who, PITCH, [task, offer, request, JSON.stringify(patch), rev]);
const pitchFails = (
  who: string,
  task: string,
  offer: string,
  request: string,
  patch: Row,
  rev: number | null,
) => h.failure(who, PITCH, [task, offer, request, JSON.stringify(patch), rev]);
const day = async (sql: string) =>
  (
    await h.owner<{ d: string }>(`SELECT public.cockpit_upsell_day(${sql}) d`)
  )[0].d;
const iso = async (sql: string) =>
  (await h.owner<{ d: string }>(`SELECT to_char(${sql}, 'YYYY-MM-DD') d`))[0].d;
const SAVE = "SELECT public.cockpit_csm_deck_prep_save($1,$2,$3::jsonb) r";
const prep = (who: string, task: string, deck: string, patch: unknown) =>
  h.one(who, SAVE, [task, deck, JSON.stringify(patch)]);
const CATALOG_SET =
  "SELECT public.cockpit_upsell_catalog_set($1,$2::jsonb,$3) r";
const setList = async (offer: string, patch: Row) => {
  const rev = (
    await h.owner<{ revision: number }>(
      "SELECT revision FROM public.cockpit_upsell_catalog WHERE offer_key=$1",
      [offer],
    )
  )[0].revision;
  return h.one(CEO, CATALOG_SET, [offer, JSON.stringify(patch), rev]);
};
/** Every key of a JSON value, at any depth. */
const allKeys = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap(allKeys)
    : v && typeof v === "object"
      ? Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)])
      : [];

beforeAll(async () => {
  db = await upsellTestDb({ through: "v" });
  h = upsellHelpers(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("the gate", () => {
  test("Acme passes every check, in order, and says where each came from", async () => {
    const g = await gate(A);
    expect(g.ok).toBe(true);
    expect(g.reasons).toEqual([]);
    expect(g.passed.map((p: Row) => p.key)).toEqual([
      "not_active",
      "too_new",
      "no_win",
      "not_happy",
      "happiness_stale",
      "red",
      "pause_required",
      "raised_on_last_call",
      "recent_offer",
      "renewal_window",
    ]);
    const by = Object.fromEntries(g.passed.map((p: Row) => [p.key, p]));
    expect(by.not_active).toMatchObject({
      text: "Active on the card.",
      source: "ClickUp card",
    });
    expect(by.too_new.text).toBe(
      `Live 45 days, launched ${await day("public.cockpit_upsell_today() - 45")}.`,
    );
    expect(by.no_win).toMatchObject({
      text: `A quotation on ${await day("public.cockpit_upsell_today() - 12")}, from their sheet.`,
      source: "Client sheet",
      at: await iso("public.cockpit_upsell_today() - 12"),
    });
    expect(by.not_happy.text).toBe("Happy on the card.");
    expect(by.happiness_stale).toMatchObject({
      text: `Happiness confirmed ${await day("public.cockpit_upsell_today() - 5")}.`,
      source: "Call log",
    });
    expect(by.raised_on_last_call).toMatchObject({
      text: `Nothing raised on the last call, ${await day("public.cockpit_upsell_today() - 5")}.`,
      source: "Call log",
    });
    expect(by.recent_offer).toMatchObject({
      text: "No offer made yet.",
      source: "Offer log",
    });
    expect(by.renewal_window).toMatchObject({
      text: `Renewal due ${await day("public.cockpit_upsell_today() + 45")}, outside its 30 days.`,
      source: "Launch date + 90 days",
    });
    expect(g.win).toEqual({
      kind: "quotation",
      on: await iso("public.cockpit_upsell_today() - 12"),
      text: `A quotation on ${await day("public.cockpit_upsell_today() - 12")}, from their sheet.`,
    });
    expect(g.renewal).toEqual({
      date: await iso("public.cockpit_upsell_today() + 45"),
      from: "launch_plus_90",
    });
    expect(g.lastOffer).toBeNull();
    expect(g.taskId).toBe(A);
    // Every source is a plain label the CSM reads, never a table name.
    for (const c of g.passed) expect(c.source).not.toMatch(/_|upsell/i);
  });

  test("the client gate comes first: another client's seat, a media buyer and signed out are refused", async () => {
    expect((await h.failure(CSM_A, GATE, [B])).message).toBe(
      "That client is not on your access list",
    );
    expect((await h.failure(BUYER, GATE, [A])).message).toBe(
      "Current confirmed client-success access is required",
    );
    expect((await h.failure(null, GATE, [A])).message).toContain(
      "permission denied",
    );
    expect((await gate(B, CSM_B)).ok).toBe(false);
    expect((await gate(C, CEO)).ok).toBe(false);
  });

  test("not_active: a stage other than Active, or a paused client", async () => {
    await setClient(db, "A", { stage: "Stopped" });
    let g = await gate(A);
    expect(keys(g)).toEqual(["not_active"]);
    expect(g.reasons[0]).toMatchObject({
      key: "not_active",
      text: "The card says Stopped. Offers wait for Active clients.",
      source: "ClickUp card",
    });
    await setClient(db, "A", { stage: "Active", happiness: "Paused" });
    g = await gate(A);
    expect(keys(g)).toEqual(["not_active", "not_happy"]);
    expect(g.reasons[0].text).toBe(
      "The card says Active, but the client is paused.",
    );
    await setClient(db, "A", { stage: "", happiness: "Happy" });
    expect((await gate(A)).reasons[0].text).toBe(
      "No stage on the card. Set it in ClickUp.",
    );
    await setClient(db, "A", { stage: "active" });
    expect((await gate(A)).ok).toBe(true);
    await setClient(db, "A", { stage: "Active" });
  });

  test("too_new: 30 days or fewer live, or no launch date", async () => {
    await setClient(db, "A", {}, 30);
    let g = await gate(A);
    expect(keys(g)).toEqual(["too_new"]);
    expect(g.reasons[0].text).toBe(
      `Live 30 days (launched ${await day("public.cockpit_upsell_today() - 30")}). Offers open after day 30, from ${await day("public.cockpit_upsell_today() + 1")}.`,
    );
    await setClient(db, "A", { launchDate: null });
    g = await gate(A);
    expect(keys(g)).toEqual(["too_new"]);
    expect(g.reasons[0].text).toBe(
      "No launch date on the card. Add it in ClickUp.",
    );
    expect(g.renewal).toEqual({ date: null, from: null });
    await setClient(db, "A", {}, 31);
    expect((await gate(A)).ok).toBe(true);
    await setClient(db, "A", {}, 45);
  });

  test("no_win: a quotation in 30 days, a signed project on any day, or the CSM's tick in 30 days", async () => {
    await h.owner(
      "UPDATE public.cockpit_client_days SET day = public.cockpit_upsell_today() - 31 WHERE location_id='locA' AND quotations > 0",
    );
    let g = await gate(A);
    expect(keys(g)).toEqual(["no_win"]);
    expect(g.reasons[0]).toMatchObject({
      text: 'No quotation in 30 days, no signed project on their sheet and no win ticked. If they have had one, tick "They\'ve had a win" and write it in.',
    });
    expect(g.win).toEqual({ kind: null, on: null, text: null });
    // A signed project long ago still counts.
    await h.owner(
      "INSERT INTO public.cockpit_client_days(location_id, day, closes, closes_with_value, revenue_usd) VALUES('locA', public.cockpit_upsell_today() - 300, 1, 0, NULL)",
    );
    g = await gate(A);
    expect(g.ok).toBe(true);
    expect(g.win).toEqual({
      kind: "signed",
      on: await iso("public.cockpit_upsell_today() - 300"),
      text: `A signed project on ${await day("public.cockpit_upsell_today() - 300")}, from their sheet.`,
    });
    await h.owner(
      "DELETE FROM public.cockpit_client_days WHERE location_id='locA' AND closes > 0",
    );
    // The CSM's tick: within 30 days, never in the future, with the win written in.
    const WIN = "SELECT public.cockpit_upsell_win_mark($1,$2,$3::date) r";
    expect(
      await h.failure(CSM_A, WIN, [
        A,
        "They signed a villa",
        await iso("public.cockpit_upsell_today() - 31"),
      ]),
    ).toEqual({
      code: "22023",
      message: "A win counts when it happened in the last 30 days.",
    });
    expect(
      await h.failure(CSM_A, WIN, [
        A,
        "They signed a villa",
        await iso("public.cockpit_upsell_today() + 1"),
      ]),
    ).toEqual({
      code: "22023",
      message: "A win counts when it happened in the last 30 days.",
    });
    expect(
      await h.failure(CSM_A, WIN, [
        A,
        "ok",
        await iso("public.cockpit_upsell_today()"),
      ]),
    ).toEqual({
      code: "22023",
      message: "The win is too short. Use at least 3 characters.",
    });
    expect(
      (
        await h.failure(CSM_A, WIN, [
          B,
          "They signed a villa",
          await iso("public.cockpit_upsell_today()"),
        ])
      ).message,
    ).toBe("That client is not on your access list");
    const w = await h.one(CSM_A, WIN, [
      A,
      " A villa client signed after our call ",
      await iso("public.cockpit_upsell_today() - 30"),
    ]);
    expect(w).toMatchObject({
      taskId: A,
      text: "A villa client signed after our call",
      wonOn: await iso("public.cockpit_upsell_today() - 30"),
      createdBy: EMAILS.CSM_A,
    });
    g = await gate(A);
    expect(g.ok).toBe(true);
    expect(g.win).toEqual({
      kind: "csm_tick",
      on: await iso("public.cockpit_upsell_today() - 30"),
      text: "A villa client signed after our call",
    });
    expect(g.passed.find((p: Row) => p.key === "no_win").source).toBe(
      "Win ticked in the cockpit",
    );
    const audit = (await h.audits("cockpit_upsell_wins")).at(-1)!;
    expect(audit).toMatchObject({
      action: "upsellWin.mark",
      actor_email: EMAILS.CSM_A,
    });
    expect(audit.metadata.line).toBe(
      `Win ticked for Acme Interiors: A villa client signed after our call (${await day("public.cockpit_upsell_today() - 30")})`,
    );
    // The quotation back: the newest win wins.
    await h.owner(
      "UPDATE public.cockpit_client_days SET day = public.cockpit_upsell_today() - 12 WHERE location_id='locA' AND quotations > 0",
    );
    expect((await gate(A)).win.kind).toBe("quotation");
  });

  test("not_happy: only Happy or Very Happy pass, never unhappy", async () => {
    for (const [happy, ok] of [
      ["Neutral", false],
      ["Unhappy", false],
      ["At Risk", false],
      ["", false],
      ["Very Happy (testimonial)", true],
      ["happy", true],
    ] as const) {
      await setClient(db, "A", { happiness: happy });
      const g = await gate(A);
      expect({ happy, keys: keys(g) }).toEqual({
        happy,
        keys: ok ? [] : ["not_happy"],
      });
      if (!ok)
        expect(g.reasons[0].text).toBe(
          happy
            ? `Happiness is ${happy} on the card. Offers wait for Happy or Very Happy.`
            : "No happiness on the card. Set it after your next call.",
        );
    }
    await setClient(db, "A", { happiness: "Happy" });
  });

  test("happiness_stale: no confirmed override and no held call in 14 days", async () => {
    await h.owner(
      "UPDATE public.cockpit_csm_calls SET starts_at = now() - interval '15 days' WHERE task_id='taskA1'",
    );
    let g = await gate(A);
    expect(keys(g)).toEqual(["happiness_stale"]);
    expect(g.reasons[0].text).toBe(
      `Happiness last confirmed ${await day("public.cockpit_upsell_today() - 15")}, more than 14 days ago. Confirm it on the client page after your next call.`,
    );
    await h.owner(
      "INSERT INTO public.cockpit_csm_client_overrides(task_id, client_name, data, confirmed_at) VALUES('taskA1','Acme Interiors','{\"happiness\":\"Happy\"}', now() - interval '3 days')",
    );
    g = await gate(A);
    expect(g.ok).toBe(true);
    expect(
      g.passed.find((p: Row) => p.key === "happiness_stale"),
    ).toMatchObject({ source: "Happiness confirmed in the cockpit" });
    await h.owner("DELETE FROM public.cockpit_csm_client_overrides");
    await h.owner(
      "UPDATE public.cockpit_csm_calls SET status='cancelled' WHERE task_id='taskA1'",
    );
    expect((await gate(A)).reasons[0].text).toBe(
      "Happiness has never been confirmed on a call. Confirm it on the client page after your next call.",
    );
    await h.owner(
      "UPDATE public.cockpit_csm_calls SET status='held', starts_at = now() - interval '5 days' WHERE task_id='taskA1'",
    );
    // An override confirmed after the sync is the client's happiness.
    await h.owner(
      "INSERT INTO public.cockpit_csm_client_overrides(task_id, client_name, data, confirmed_at) VALUES('taskA1','Acme Interiors','{\"happiness\":\"Neutral\"}', now())",
    );
    expect(keys(await gate(A))).toEqual(["not_happy"]);
    await h.owner("DELETE FROM public.cockpit_csm_client_overrides");
  });

  test("red and pause_required, from the card", async () => {
    await setClient(db, "A", { level: "red" });
    expect((await gate(A)).reasons).toEqual([
      {
        key: "red",
        text: "The client is at red. Bring them back first.",
        source: "ClickUp card",
        at: expect.any(String),
      },
    ]);
    await setClient(db, "A", { level: "amber", pauseRequired: true });
    expect((await gate(A)).reasons.map((r: Row) => [r.key, r.text])).toEqual([
      [
        "pause_required",
        "The card says a pause is needed. Sort the pause first.",
      ],
    ]);
    await setClient(db, "A", { level: "green", pauseRequired: false });
  });

  test("raised_on_last_call: escalation, a problem or money words, in English and Arabic, quoted with the call's date", async () => {
    const cases: [string, string | null][] = [
      [
        "Good call. The client is upset about the slow replies. Next step photos.",
        "The client is upset about the slow replies.",
      ],
      [
        "They are frustrated with the agency.",
        "They are frustrated with the agency.",
      ],
      ["Lead quality is poor this month.", "Lead quality is poor this month."],
      ["Show rate was 0% this week.", "Show rate was 0% this week."],
      [
        "They want to postpone the next invoice.",
        "They want to postpone the next invoice.",
      ],
      ["العميل زعلان من التأخير. باقي الأمور تمام", "العميل زعلان من التأخير."],
      ["فيه مشكلة في المواعيد", "فيه مشكلة في المواعيد"],
      ["يبون تأجيل الدفع للشهر الجاي", "يبون تأجيل الدفع للشهر الجاي"],
      ["All good. Next step more villa photos. 10% more calls answered.", null],
      ["", null],
    ];
    for (const [summary, quoted] of cases) {
      await h.owner(
        "UPDATE public.cockpit_csm_calls SET summary=$1 WHERE task_id='taskA1'",
        [summary],
      );
      const g = await gate(A);
      if (quoted === null)
        expect({ summary, keys: keys(g) }).toEqual({ summary, keys: [] });
      else
        expect({ summary, reasons: g.reasons }).toEqual({
          summary,
          reasons: [
            {
              key: "raised_on_last_call",
              text: `Raised on the last call, ${await day("public.cockpit_upsell_today() - 5")}: "${quoted}"`,
              source: "Call log",
              at: expect.any(String),
            },
          ],
        });
    }
    // A booked call ahead does not count; a long sentence is cut at 160 characters.
    await h.owner(
      `INSERT INTO public.cockpit_csm_calls(task_id, kind, starts_at, status, summary) VALUES('taskA1','checkin', now() + interval '2 days','booked','They are angry.')`,
    );
    await h.owner(
      "UPDATE public.cockpit_csm_calls SET summary=$1 WHERE task_id='taskA1' AND status='held'",
      [`They have a problem ${"x".repeat(200)}`],
    );
    const long = (await gate(A)).reasons[0].text;
    expect(long.length).toBeLessThan(220);
    expect(long.endsWith('…"')).toBe(true);
    await h.owner("DELETE FROM public.cockpit_csm_calls WHERE status='booked'");
    await h.owner(
      "UPDATE public.cockpit_csm_calls SET summary='They liked the new kitchen ads. Next step: more villa shots.' WHERE task_id='taskA1'",
    );
    expect((await gate(A)).ok).toBe(true);
  });

  test("renewal_window: 30 days either side of the renewal, cleared by an outcome; from a plan or launch + 90", async () => {
    await h.owner(
      "INSERT INTO public.cockpit_csm_renewal_plans(task_id, client_name, renewal_date, data) VALUES('taskA1','Acme Interiors', public.cockpit_upsell_today() + 20, '{\"status\":\"planned\"}')",
    );
    let g = await gate(A);
    expect(keys(g)).toEqual(["renewal_window"]);
    expect(g.reasons[0]).toMatchObject({
      source: "Renewal plan",
      text: `Renewal is due ${await day("public.cockpit_upsell_today() + 20")}. Offers wait until the renewal plan has an outcome, or until ${await day("public.cockpit_upsell_today() + 51")}. The website can ride in the renewal as the free care-plan month.`,
    });
    expect(g.renewal).toEqual({
      date: await iso("public.cockpit_upsell_today() + 20"),
      from: "plan",
    });
    for (const status of ["renewed", "resold", "not_this_cycle", "lost"]) {
      await h.owner(
        "UPDATE public.cockpit_csm_renewal_plans SET data = jsonb_build_object('status', $1::text)",
        [status],
      );
      expect((await gate(A)).ok).toBe(true);
    }
    await h.owner(
      'UPDATE public.cockpit_csm_renewal_plans SET data=\'{"status":"call_booked"}\', renewal_date = public.cockpit_upsell_today() - 29',
    );
    expect(keys(await gate(A))).toEqual(["renewal_window"]);
    await h.owner(
      "UPDATE public.cockpit_csm_renewal_plans SET renewal_date = public.cockpit_upsell_today() - 31",
    );
    expect((await gate(A)).ok).toBe(true);
    await h.owner(
      "UPDATE public.cockpit_csm_renewal_plans SET renewal_date = public.cockpit_upsell_today() + 31",
    );
    expect((await gate(A)).ok).toBe(true);
    await h.owner("DELETE FROM public.cockpit_csm_renewal_plans");
    // No plan: launch + 90. Live 70 days puts the renewal 20 days out.
    await setClient(db, "A", {}, 70);
    g = await gate(A);
    expect(keys(g)).toEqual(["renewal_window"]);
    expect(g.renewal).toEqual({
      date: await iso("public.cockpit_upsell_today() + 20"),
      from: "launch_plus_90",
    });
    // Without a plan the date is a guess from the launch, and the text says so.
    expect(g.reasons[0]).toMatchObject({
      source: "Launch date + 90 days",
      text: `No renewal plan on file, so renewal counts as launch + 90 days: ${await day("public.cockpit_upsell_today() + 20")}. Offers wait until ${await day("public.cockpit_upsell_today() + 51")}. The website can ride in the renewal as the free care-plan month.`,
    });
    await setClient(db, "A", {}, 45);
  });

  test("the JSON carries no leads, cost per lead, spend or budget, and no client contact details", async () => {
    for (const task of [A, B, C]) {
      const g = await gate(task, CEO);
      const s = await h.one(CEO, SOURCES, [task, "website"]);
      const st = await h.one(CEO, STATUS, [task]);
      for (const v of [g, s, st]) {
        expect(
          allKeys(v).filter(k => /lead|cpl|spend|budget/i.test(k)),
        ).toEqual([]);
        const text = JSON.stringify(v);
        for (const leak of [
          "SECRET",
          "+96500000000",
          "contracts.example",
          "panel",
        ])
          expect(text.includes(leak)).toBe(false);
      }
    }
  });
});

describe("sources and status", () => {
  test("the three modes: proactive, refused (with what the CSM needs to type client asked) and client asked", async () => {
    const a = await h.one(CSM_A, SOURCES, [A, "website"]);
    expect(a.mode).toBe("proactive");
    expect(a.catalog.offerKey).toBe("website");
    const b = await h.one(CSM_B, SOURCES, [B, "website"]);
    expect(b).toMatchObject({
      mode: "refused",
      catalog: null,
      prep: null,
      files: [],
      site: { verdict: "none_on_file" },
    });
    expect(keys(b.gate)).toEqual(["no_win", "happiness_stale"]);
    await prep(CSM_B, B, "offer_website", {
      client_asked: {
        words: "Can you make us a website?",
        on: await iso("public.cockpit_upsell_today() - 2"),
      },
    });
    const asked = await h.one(CSM_B, SOURCES, [B, "website"]);
    expect(asked.mode).toBe("client_asked");
    expect(asked.catalog.offerKey).toBe("website");
    expect(asked.prep.overrides.client_asked.words).toBe(
      "Can you make us a website?",
    );
    // An ask older than 30 days no longer opens the deck.
    await h.owner(`UPDATE public.cockpit_csm_deck_prep SET overrides = jsonb_set(overrides, '{client_asked,on}', to_jsonb(to_char(public.cockpit_upsell_today() - 31, 'YYYY-MM-DD')))
      WHERE task_id='taskB1' AND deck='offer_website'`);
    expect((await h.one(CSM_B, SOURCES, [B, "website"])).mode).toBe("refused");
    await prep(CSM_B, B, "offer_website", {
      client_asked: {
        words: "Can you make us a website?",
        on: await iso("public.cockpit_upsell_today() - 2"),
      },
    });
    expect(await h.failure(CSM_A, SOURCES, [A, "renewal"])).toEqual({
      code: "22023",
      message: "Choose one of the seven offers.",
    });
  });

  test("the typical project, the onboarding goals, the currency and its fixed rate", async () => {
    let a = await h.one(CSM_A, SOURCES, [A, "website"]);
    expect(a.project).toEqual({
      onboarding: {
        answer: "Villa fit out, typical project 18,000 KWD",
        answeredOn: "2026-09-03",
      },
      sheet: null,
    });
    expect(a.goals).toEqual({
      goal90: {
        answer: "Three villa projects signed",
        answeredOn: "2026-09-03",
      },
      goal12_24: { answer: "Open a Riyadh branch", answeredOn: "2026-09-03" },
      challenges: {
        answer: "Clients find us on Instagram only",
        answeredOn: "2026-09-03",
      },
      why: { answer: "We want steady projects", answeredOn: "2026-09-03" },
    });
    expect(a).toMatchObject({
      country: "KW",
      currency: "KWD",
      fx: { usdPer: 3.26, from: "cockpit_pay_usd_per", note: null },
      doorLive: false,
      heldFullRecently: false,
    });
    await h.owner(
      "INSERT INTO public.cockpit_client_days(location_id, day, closes, closes_with_value, revenue_usd) VALUES('locA', public.cockpit_upsell_today() - 20, 2, 2, 36000)",
    );
    a = await h.one(CSM_A, SOURCES, [A, "website"]);
    expect(a.project.sheet).toEqual({
      usd: 18000,
      closes: 2,
      withValue: 2,
      from: "cockpit_client_days",
      window: "180 days",
    });
    expect(a.goals.goal90.answer).toBe("Three villa projects signed");
    await h.owner(
      "DELETE FROM public.cockpit_client_days WHERE location_id='locA' AND closes > 0",
    );
    const b = await h.one(CSM_B, SOURCES, [B, "website"]);
    expect(b).toMatchObject({
      country: "SA",
      currency: "SAR",
      fx: { usdPer: 0.2666 },
      project: { onboarding: null, sheet: null },
      goals: { goal90: null, goal12_24: null, challenges: null, why: null },
    });
    const c = await h.one(CEO, SOURCES, [C, "website"]);
    expect(c).toMatchObject({
      country: "BH",
      currency: "BHD",
      fx: {
        usdPer: null,
        note: "No fixed rate for BHD: the figure stays in US dollars.",
      },
    });
  });

  test("status: this month's offer and why, the others with what they wait on, and what is missing before the website is ready", async () => {
    let s = await h.one(CSM_A, STATUS, [A]);
    expect(s.gate).toEqual({ ok: true, reasons: [] });
    expect(s.offers.map((o: Row) => o.key)).toEqual([
      "website",
      "second_campaign",
      "seo_geo",
      "smm",
      "cameraman",
      "ugc",
      "closer",
    ]);
    const web = () => s.offers[0];
    expect(web().fit).toEqual({ ok: null, why: "Site not checked yet" });
    expect(web().ready).toEqual({
      ok: false,
      missing: ["no_capture", "no_price", "no_payment_link"],
    });
    expect(s.thisMonth).toBeNull();
    expect(s.thisMonthWhy).toBe("No offer fits yet: site not checked yet.");
    for (const o of s.offers.slice(1))
      expect(o.fit).toEqual({ ok: null, why: o.waitsOn });
    expect(s.offers[2].ready.missing).toContain("no_price");
    // A thin site fits; so does a broken one, worded with its two days.
    await prep(CSM_A, A, "offer_website", { site_thin: true });
    s = await h.one(CSM_A, STATUS, [A]);
    expect(web().fit).toEqual({
      ok: true,
      why: "Their site is thin, ticked in prep",
    });
    expect([s.thisMonth, s.thisMonthWhy]).toEqual([
      "website",
      "Their site is thin, ticked in prep",
    ]);
    await prep(CSM_A, A, "offer_website", { site_thin: null });
    const RECORD =
      "SELECT public.cockpit_client_site_check_record($1,$2,'card',$3::jsonb) r";
    await h.one(CSM_A, RECORD, [
      A,
      "https://acme-interiors.example",
      JSON.stringify({ status: "parked" }),
    ]);
    await h.owner(
      "UPDATE public.cockpit_client_site_checks SET checked_at = now() - interval '1 day' WHERE task_id='taskA1'",
    );
    await h.one(CSM_A, RECORD, [
      A,
      "https://acme-interiors.example",
      JSON.stringify({ status: "parked" }),
    ]);
    s = await h.one(CSM_A, STATUS, [A]);
    const two = (
      await h.owner<{ d: string }>(
        "SELECT public.cockpit_upsell_two_days(public.cockpit_upsell_today() - 1, public.cockpit_upsell_today()) d",
      )
    )[0].d;
    expect(web().fit).toEqual({
      ok: true,
      why: `No working site, checked twice, ${two}`,
    });
    expect(s.thisMonth).toBe("website");
    await h.one(CSM_A, RECORD, [
      A,
      "https://acme-interiors.example",
      JSON.stringify({ status: "ok", httpStatus: 200 }),
    ]);
    s = await h.one(CSM_A, STATUS, [A]);
    expect(web().fit).toEqual({ ok: false, why: "Their site works" });
    await h.owner(
      "DELETE FROM public.cockpit_client_site_checks WHERE task_id='taskA1' AND status='ok'",
    );
    // Ready, piece by piece: a capture (old at 8 days), a price, a payment link.
    await h.capture(CSM_A, A, uuid(40), 8);
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].ready.missing).toEqual([
      "capture_old",
      "no_price",
      "no_payment_link",
    ]);
    await h.capture(CSM_A, A, uuid(41), 7);
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].ready.missing).toEqual([
      "no_price",
      "no_payment_link",
    ]);
    await prep(CSM_A, A, "offer_website", {
      opening_price: { build: 2000, care: 200 },
      payment_link: "https://whop.com/checkout/plan_acme01/",
    });
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].ready).toEqual({
      ok: true,
      missing: [],
    });
    // An opening price typed while the list was blank, then the CEO sets a
    // higher list: the stored price no longer passes, so it is not ready and
    // the sources say what to fix.
    await prep(CSM_A, A, "offer_website", {
      opening_price: { build: 1500, care: 150 },
    });
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].ready.ok).toBe(true);
    expect(
      (await h.one(CSM_A, SOURCES, [A, "website"])).priceProblem,
    ).toBeNull();
    await setList("website", {
      parts: [
        { key: "build", amount: 2000 },
        { key: "care", amount: 200 },
      ],
    });
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].ready).toEqual({
      ok: false,
      missing: ["no_price"],
    });
    expect((await h.one(CSM_A, SOURCES, [A, "website"])).priceProblem).toBe(
      "Website build: below the list price (2,000). Add a one-line reason.",
    );
    await prep(CSM_A, A, "offer_website", { opening_price: null });
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].ready.ok).toBe(true);
    expect(
      (await h.one(CSM_A, SOURCES, [A, "website"])).priceProblem,
    ).toBeNull();
    // Beta: no site on file fits, but the gate says not this month.
    const b = await h.one(CSM_B, STATUS, [B]);
    expect(b.offers[0].fit).toEqual({ ok: true, why: "No website on file" });
    expect(b.thisMonth).toBeNull();
    expect(b.thisMonthWhy).toBe(`Not this month: ${b.gate.reasons[0].text}`);
  });
});

describe("pitches", () => {
  let first: Row;
  test("the first save creates the row and stamps it from the gate and the offer's prep", async () => {
    await prep(CSM_A, A, "offer_website", {
      opening_price: { build: 1800, care: 200 },
      opening_reason: "Second site for them",
      language: "ar",
    });
    first = await pitch(CSM_A, A, "website", uuid(100), {}, 0);
    expect(first).toMatchObject({
      taskId: A,
      offerKey: "website",
      pitchedOn: await iso("public.cockpit_upsell_today()"),
      csm: EMAILS.CSM_A,
      mode: "proactive",
      clientWords: null,
      clientAskedOn: null,
      listPrice: { build: 2000, care: 200 },
      openingPrice: { build: 1800, care: 200 },
      openingReason: "Second site for them",
      heldFull: false,
      finalPrice: null,
      split: false,
      answer: null,
      paymentLink: "https://whop.com/checkout/plan_acme01/",
      lang: "ar",
      revision: 1,
      changed: true,
      videoUrl: null,
    });
    expect(first.gate).toMatchObject({ ok: true, reasons: [] });
    expect(first.videoCode).toMatch(/^[a-hj-km-np-z2-9]{10}$/);
    const audit = (await h.audits("cockpit_upsell_pitches")).at(-1)!;
    expect(audit).toMatchObject({
      action: "upsellPitch.create",
      entity_id: first.id,
      actor_email: EMAILS.CSM_A,
    });
    expect(audit.metadata.line).toBe(
      "Website offered to Acme Interiors; Opening price 1,800 + 200 below list 2,000 + 200: Second site for them",
    );
    // The same request id again, as if new: a conflict, never a second row.
    expect(await pitchFails(CSM_A, A, "website", uuid(100), {}, 0)).toEqual({
      code: "40001",
      message: "Someone else saved this. Read it again.",
    });
    expect(await pitchFails(CSM_A, A, "smm", uuid(100), {}, 1)).toEqual({
      code: "42501",
      message: "This request id belongs to another pitch.",
    });
    expect(
      (await h.failure(CSM_B, PITCH, [A, "website", uuid(101), "{}", 0]))
        .message,
    ).toBe("That client is not on your access list");
    // The gate now waits 30 days for Acme.
    const g = await gate(A);
    expect(keys(g)).toEqual(["recent_offer"]);
    expect(g.lastOffer).toEqual({
      kind: "pitch",
      offer: "website",
      on: await iso("public.cockpit_upsell_today()"),
    });
    expect(g.reasons[0]).toMatchObject({
      text: `Website offered on ${await day("public.cockpit_upsell_today()")}, on a call. The next offer can open from ${await day("public.cockpit_upsell_today() + 31")}.`,
      source: "Offer log",
    });
    // The website's own pitch is the same talk: its deck still opens (the
    // notes window, a reload, a follow-up), and no other offer's does.
    const own = await h.one(CSM_A, SOURCES, [A, "website"]);
    expect(own.mode).toBe("proactive");
    expect(own.catalog.offerKey).toBe("website");
    expect(own.gate.reasons.map((r: Row) => r.key)).toEqual(["recent_offer"]);
    expect((await h.one(CSM_A, SOURCES, [A, "seo_geo"])).mode).toBe("refused");
  });

  test("held full price before a lower number, with a reason; no split on the website", async () => {
    expect(
      await pitchFails(
        CSM_A,
        A,
        "website",
        uuid(100),
        { final_price: { build: 1500, care: 200 } },
        1,
      ),
    ).toEqual({
      code: "22023",
      message: 'Tap "Held full price" before saying a lower price.',
    });
    expect(
      await pitchFails(
        CSM_A,
        A,
        "website",
        uuid(100),
        { held_full: true, final_price: { build: 1500, care: 200 } },
        1,
      ),
    ).toEqual({
      code: "22023",
      message: "A price below the opening price needs a one-line reason.",
    });
    expect(
      await pitchFails(
        CSM_A,
        A,
        "website",
        uuid(100),
        { final_price: { build: 1500 } },
        1,
      ),
    ).toEqual({
      code: "22023",
      message:
        "Type the final price for the website build and the website care plan.",
    });
    const r = await pitch(
      CSM_A,
      A,
      "website",
      uuid(100),
      {
        held_full: true,
        final_price: { build: 1500, care: 200 },
        final_reason: "Cash flow this month",
      },
      1,
    );
    expect(r).toMatchObject({
      heldFull: true,
      finalPrice: { build: 1500, care: 200 },
      finalReason: "Cash flow this month",
      revision: 2,
    });
    expect(
      (await h.audits("cockpit_upsell_pitches")).at(-1)!.metadata.line,
    ).toBe(
      "Held full price; Final price 1,500 + 200 below opening 1,800 + 200: Cash flow this month",
    );
    expect(
      await pitchFails(CSM_A, A, "website", uuid(100), { split: true }, 2),
    ).toEqual({ code: "22023", message: "This offer has no split." });
    expect(
      await pitchFails(
        CSM_A,
        A,
        "website",
        uuid(100),
        { answer: "yes_paid" },
        1,
      ),
    ).toEqual({
      code: "40001",
      message: "Someone else saved this. Read it again.",
    });
    expect(
      await pitchFails(CSM_A, A, "website", uuid(100), { discount: 10 }, 2),
    ).toEqual({ code: "22023", message: 'A pitch does not keep "discount".' });
    const same = await pitch(
      CSM_A,
      A,
      "website",
      uuid(100),
      { held_full: true },
      2,
    );
    expect(same).toMatchObject({ revision: 2, changed: false });
  });

  test("the answers: not now needs a follow-up date within 120 days, no needs a reason", async () => {
    expect(
      await pitchFails(
        CSM_A,
        A,
        "website",
        uuid(100),
        { answer: "not_now" },
        2,
      ),
    ).toEqual({
      code: "22023",
      message: "Pick a follow-up date in the next 120 days.",
    });
    expect(
      await pitchFails(
        CSM_A,
        A,
        "website",
        uuid(100),
        {
          answer: "not_now",
          follow_up_on: await iso("public.cockpit_upsell_today() + 121"),
        },
        2,
      ),
    ).toEqual({
      code: "22023",
      message: "Pick a follow-up date in the next 120 days.",
    });
    let r = await pitch(
      CSM_A,
      A,
      "website",
      uuid(100),
      {
        answer: "not_now",
        follow_up_on: await iso("public.cockpit_upsell_today() + 30"),
      },
      2,
    );
    expect(r).toMatchObject({
      answer: "not_now",
      followUpOn: await iso("public.cockpit_upsell_today() + 30"),
      revision: 3,
    });
    expect(
      (await h.audits("cockpit_upsell_pitches")).at(-1)!.metadata.line,
    ).toBe(
      `Answer: not now, follow up ${await day("public.cockpit_upsell_today() + 30")}`,
    );
    expect(
      await pitchFails(CSM_A, A, "website", uuid(100), { answer: "no" }, 3),
    ).toEqual({ code: "22023", message: "Say why they said no, in a line." });
    r = await pitch(
      CSM_A,
      A,
      "website",
      uuid(100),
      { answer: "no", no_reason: "They have a nephew who builds sites" },
      3,
    );
    expect(
      (await h.audits("cockpit_upsell_pitches")).at(-1)!.metadata.line,
    ).toBe("Answer: no, They have a nephew who builds sites");
    r = await pitch(CSM_A, A, "website", uuid(100), { answer: "yes_paid" }, 4);
    expect(r).toMatchObject({ answer: "yes_paid", revision: 5 });
    expect(
      await pitchFails(CSM_A, A, "website", uuid(100), { answer: "maybe" }, 5),
    ).toEqual({
      code: "22023",
      message: "The answer must be one of: yes_paid, yes_unpaid, not_now, no.",
    });
  });

  test("a locked offer: the final price is the list; the split comes only after held full price", async () => {
    await setList("seo_geo", { parts: [{ key: "program", amount: 5000 }] });
    await prep(CSM_A, A, "offer_seo_geo", { opening_price: { program: 5000 } });
    const p = await pitch(CSM_A, A, "seo_geo", uuid(110), {}, 0);
    expect(p).toMatchObject({
      mode: "proactive",
      openingPrice: { program: 5000 },
      listPrice: { program: 5000 },
      lang: "en",
    });
    expect(p.gate.ok).toBe(false);
    expect(p.gate.reasons.map((r: Row) => r.key)).toEqual(["recent_offer"]);
    expect(
      (await h.audits("cockpit_upsell_pitches")).at(-1)!.metadata.line,
    ).toBe("SEO and GEO offered to Acme Interiors (gate not passed)");
    expect(
      await pitchFails(
        CSM_A,
        A,
        "seo_geo",
        uuid(110),
        { held_full: true, final_price: { program: 4000 }, final_reason: "x" },
        1,
      ),
    ).toEqual({
      code: "22023",
      message: "This price is locked at the list price.",
    });
    expect(
      await pitchFails(CSM_A, A, "seo_geo", uuid(110), { split: true }, 1),
    ).toEqual({
      code: "22023",
      message: 'The split comes only after "Held full price".',
    });
    const s = await pitch(
      CSM_A,
      A,
      "seo_geo",
      uuid(110),
      { held_full: true, split: true, final_price: { program: 5000 } },
      1,
    );
    expect(s).toMatchObject({
      heldFull: true,
      split: true,
      finalPrice: { program: 5000 },
    });
    expect(
      (await h.audits("cockpit_upsell_pitches")).at(-1)!.metadata.line,
    ).toBe("Held full price; Final price 5,000; Split in two payments");
    expect((await h.one(CSM_A, SOURCES, [A, "seo_geo"])).heldFullRecently).toBe(
      true,
    );
    expect((await h.one(CSM_A, SOURCES, [A, "website"])).heldFullRecently).toBe(
      true,
    );
    await setList("seo_geo", { parts: [{ key: "program", amount: null }] });
  });

  test("client asked: a client who fails the gate is pitched as asked, with their words", async () => {
    const p = await pitch(CSM_B, B, "website", uuid(120), {}, 0);
    expect(p).toMatchObject({
      mode: "client_asked",
      clientWords: "Can you make us a website?",
      clientAskedOn: await iso("public.cockpit_upsell_today() - 2"),
    });
    expect(p.gate.ok).toBe(false);
    expect(
      (await h.audits("cockpit_upsell_pitches")).at(-1)!.metadata.line,
    ).toBe("Website offered to Beta Build (they asked)");
    const c = await pitch(CEO, C, "website", uuid(130), {}, 0);
    expect(c).toMatchObject({ mode: "proactive", gate: { ok: false } });
  });

  test("the video link: the offer's own video when the door is off, the door's counted link when it is on", async () => {
    const VIDEO = "SELECT public.cockpit_upsell_pitch_video($1::uuid) r";
    expect(await h.one(CSM_A, VIDEO, [first.id])).toEqual({
      url: null,
      counted: false,
      note: "No Arabic video saved for this offer yet. The CEO adds it on Money > Offers.",
    });
    const VSAVE =
      "SELECT public.cockpit_csm_deck_video_save($1,'demo',$2,$3,NULL,NULL,0) r";
    await h.one(CEO, VSAVE, [
      "offer_website",
      "en",
      "https://fast.wistia.net/embed/iframe/abcdefghij",
    ]);
    expect((await h.one(CSM_A, VIDEO, [first.id])).url).toBeNull();
    // The door never stands in for a missing video: with only the English
    // cut saved, an Arabic pitch gets no link even while the door is live.
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_setting_set('door_live','true') r",
    );
    expect(await h.one(CSM_A, VIDEO, [first.id])).toEqual({
      url: null,
      counted: false,
      note: "No Arabic video saved for this offer yet. The CEO adds it on Money > Offers.",
    });
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_setting_set('door_live','false') r",
    );
    await h.one(CEO, VSAVE, [
      "offer_website",
      "ar",
      "https://fast.wistia.net/embed/iframe/klmnopqrst",
    ]);
    expect(await h.one(CSM_A, VIDEO, [first.id])).toEqual({
      url: "https://fast.wistia.net/embed/iframe/klmnopqrst",
      counted: false,
      note: null,
    });
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_setting_set('door_live','true') r",
    );
    expect(await h.one(CSM_A, VIDEO, [first.id])).toEqual({
      url: `https://offer.maharamedia.com/v/${first.videoCode}`,
      counted: true,
    });
    const again = await pitch(
      CSM_A,
      A,
      "website",
      uuid(100),
      { answer: "yes_unpaid" },
      5,
    );
    expect(again.videoUrl).toBe(
      `https://offer.maharamedia.com/v/${first.videoCode}`,
    );
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_setting_set('door_live','false') r",
    );
    expect((await h.failure(CSM_B, VIDEO, [first.id])).message).toBe(
      "That client is not on your access list",
    );
    expect(await h.failure(CSM_A, VIDEO, [uuid(999)])).toEqual({
      code: "42501",
      message: "That pitch is not one you can open.",
    });
  });

  test("the pitch log: the CEO sees every client, a CSM their own; one month at a time", async () => {
    const LOG = "SELECT public.cockpit_upsell_pitch_log($1::date) r";
    const month = await iso("public.cockpit_upsell_today()");
    const ceo = await h.one(CEO, LOG, [month]);
    expect(ceo.month).toBe(month.slice(0, 7));
    expect(ceo.rows.map((r: Row) => [r.clientName, r.offerKey]).sort()).toEqual(
      [
        ["Acme Interiors", "seo_geo"],
        ["Acme Interiors", "website"],
        ["Beta Build", "website"],
        ["Cedar Homes", "website"],
      ],
    );
    const row = ceo.rows.find((r: Row) => r.id === first.id);
    expect(row).toMatchObject({
      taskId: A,
      csm: EMAILS.CSM_A,
      mode: "proactive",
      listPrice: { build: 2000, care: 200 },
      openingPrice: { build: 1800, care: 200 },
      openingReason: "Second site for them",
      finalPrice: { build: 1500, care: 200 },
      finalReason: "Cash flow this month",
      answer: "yes_unpaid",
    });
    expect(
      (await h.one(CSM_A, LOG, [month])).rows
        .map((r: Row) => r.clientName)
        .sort(),
    ).toEqual(["Acme Interiors", "Acme Interiors"]);
    expect(
      (await h.one(CSM_B, LOG, [month])).rows.map((r: Row) => r.clientName),
    ).toEqual(["Beta Build"]);
    expect((await h.one(CSM_ALL, LOG, [month])).rows.length).toBe(4);
    await h.owner(
      "UPDATE public.cockpit_upsell_pitches SET pitched_on = (date_trunc('month', public.cockpit_upsell_today()) - interval '1 day')::date WHERE task_id='taskC1'",
    );
    expect((await h.one(CEO, LOG, [month])).rows.length).toBe(3);
    expect(
      (
        await h.one(CEO, LOG, [
          await iso(
            "(date_trunc('month', public.cockpit_upsell_today()) - interval '1 day')::date",
          ),
        ])
      ).rows.map((r: Row) => r.clientName),
    ).toEqual(["Cedar Homes"]);
    expect((await h.failure(BUYER, LOG, [month])).message).toBe(
      "Active client-success access required",
    );
    const read = await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_pitches_read($1) r",
      [A],
    );
    expect(read.rows.length).toBe(2);
    expect(
      (await h.one(CSM_A, SOURCES, [A, "website"])).pitches.map(
        (p: Row) => p.id,
      ),
    ).toEqual([first.id]);
    expect((await h.one(CSM_A, STATUS, [A])).offers[0].lastPitch).toEqual({
      on: await iso("public.cockpit_upsell_today()"),
      answer: "yes_unpaid",
      mode: "proactive",
    });
    // A pitch more than 30 days ago lets the gate open again.
    await h.owner(
      "UPDATE public.cockpit_upsell_pitches SET pitched_on = public.cockpit_upsell_today() - 31 WHERE task_id='taskA1'",
    );
    expect((await gate(A)).ok).toBe(true);
  });
});
