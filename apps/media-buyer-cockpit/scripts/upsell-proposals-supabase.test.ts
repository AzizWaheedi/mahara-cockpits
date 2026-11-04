/**
 * Proposals, their views and the door (20261026w_upsell_proposals.sql,
 * docs/upsell-studio/BACKEND.md section 3), plus the grants census of all
 * three upsell files. On an isolated PostgreSQL with Supabase's default
 * privileges on, every upsell file applied twice (and a third time here).
 * The website's copy below is a test fixture, never client copy. Every
 * person and client is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import {
  EMAILS,
  type Row,
  SEATS,
  TASKS,
  UPSELL_FILES,
  upsellHelpers,
  upsellTestDb,
  uuid,
} from "./lib/upsellTestDb";

const { CSM_A, CSM_A2, CSM_B, CEO } = SEATS;
const { A, B } = TASKS;
let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;

const COPY_EN = {
  name: "Your website",
  deckTitle: "Your website",
  line: "A site that shows your work.",
  parts: { build: "Website build", care: "Care plan, monthly" },
  terms: "Paid in full. The care plan is billed monthly.",
  timing: "Live four weeks after payment and your content.",
  get: [
    { key: "pages", text: "Six pages in English and Arabic" },
    { key: "whatsapp", text: "A WhatsApp button on every page" },
    { key: "form", text: "An enquiry form that reaches your team" },
  ],
  need: [{ key: "logo", text: "Your logo" }],
  steps: [
    { key: "pay", text: "You pay and send your content." },
    { key: "build", text: "We build it in four weeks." },
  ],
  why: [
    {
      key: "search",
      label: "Search",
      text: "People search your name after they see your ad.",
    },
  ],
  button: "Yes, build our site",
  cta: "We want the website",
  close: "Shall we start?",
  work: [],
};
const COPY_AR = { ...COPY_EN, cta: "موقع" };
const CREATE =
  "SELECT public.cockpit_upsell_proposal_create($1,$2,$3,$4::uuid) r";
const SAVE =
  "SELECT public.cockpit_upsell_proposal_save($1::uuid,$2::jsonb,$3) r";
const SEND =
  "SELECT public.cockpit_upsell_proposal_send($1::uuid,$2,$3,$4::text[]) r";
const UPDATE_LINK =
  "SELECT public.cockpit_upsell_proposal_update_link($1::uuid,$2,$3::text[]) r";
const MARK =
  "SELECT public.cockpit_upsell_proposal_mark($1::uuid,$2,$3,$4::date,$5) r";
const READ = "SELECT public.cockpit_upsell_proposals_read($1) r";
const GET = "SELECT public.cockpit_upsell_proposal_get($1::uuid) r";
const PUBLIC =
  "SELECT public.cockpit_upsell_proposal_public($1::uuid,$2::jsonb,$3::jsonb) r";
const PREVIEW = "SELECT public.cockpit_upsell_proposal_preview($1::uuid) r";
const OPEN = "SELECT public.cockpit_upsell_door_open($1,$2,$3,$4,$5) r";
const EVENT = "SELECT public.cockpit_upsell_door_event($1,$2,$3,$4,$5)";
const DEVICE = "device-0001";
const IP = "a".repeat(64);
const create = (
  who: string,
  task: string,
  offer: string,
  lang: string,
  request: string,
) => h.one(who, CREATE, [task, offer, lang, request]);
const save = (who: string, id: string, patch: Row, rev: number) =>
  h.one(who, SAVE, [id, JSON.stringify(patch), rev]);
const saveFails = (who: string, id: string, patch: Row, rev: number) =>
  h.failure(who, SAVE, [id, JSON.stringify(patch), rev]);
const send = (who: string, id: string, rev: number, ack: string[] = []) =>
  h.one(who, SEND, [id, rev, "copy", ack]);
const sendFails = (
  who: string,
  id: string,
  rev: number,
  ack: string[] = [],
  via = "copy",
) => h.failure(who, SEND, [id, rev, via, ack]);
const get = (who: string, id: string) => h.one(who, GET, [id]);
const open = (code: string, preview: string | null = null) =>
  h.svc(OPEN, [code, DEVICE, IP, "phone", preview]);
const iso = async (sql: string) =>
  (await h.owner<{ d: string }>(`SELECT to_char(${sql}, 'YYYY-MM-DD') d`))[0].d;
const allKeys = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap(allKeys)
    : v && typeof v === "object"
      ? Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)])
      : [];
const setList = async (offer: string, patch: Row) => {
  const rev = (
    await h.owner<{ revision: number }>(
      "SELECT revision FROM public.cockpit_upsell_catalog WHERE offer_key=$1",
      [offer],
    )
  )[0].revision;
  return h.one(
    CEO,
    "SELECT public.cockpit_upsell_catalog_set($1,$2::jsonb,$3) r",
    [offer, JSON.stringify(patch), rev],
  );
};
const WISTIA_EN = "https://fast.wistia.net/embed/iframe/abcdefghij";
const LOOM = "e2d83bffee614d9aa035d898d37d8989";

let cap: Row;
let capB: Row;
let logoA: Row;
let logoB: Row;

async function logo(who: string, task: string, request: string): Promise<Row> {
  const r = await h.one(
    who,
    "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'logo','image/png',2048) r",
    [request, task],
  );
  await h.putObject("cockpit-launch-ads", r.path, 2048, "image/png");
  return h.one(
    who,
    "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid) r",
    [task, r.id],
  );
}

beforeAll(async () => {
  db = await upsellTestDb({ through: "w" });
  h = upsellHelpers(db);
  await h.owner(
    "UPDATE public.cockpit_upsell_catalog SET copy=$1::jsonb WHERE offer_key='website'",
    [JSON.stringify({ en: COPY_EN, ar: COPY_AR })],
  );
  await setList("website", {
    parts: [
      { key: "build", amount: 2000 },
      { key: "care", amount: 200 },
    ],
  });
  await h.one(
    CEO,
    "SELECT public.cockpit_csm_deck_video_save('offer_website','demo','en',$1,'Your website',60,0) r",
    [WISTIA_EN],
  );
  cap = await h.capture(CSM_A, A, uuid(1));
  await h.one(
    CSM_A,
    'SELECT public.cockpit_upsell_file_update($1,$2::uuid,\'{"caption":"Their site today"}\'::jsonb) r',
    [A, cap.id],
  );
  capB = await h.capture(CSM_B, B, uuid(2));
  logoA = await logo(CSM_A, A, uuid(3));
  logoB = await logo(CSM_B, B, uuid(4));
}, 60000);
afterAll(async () => {
  await db?.close();
});

let p1: Row;

describe("create", () => {
  test("a draft filled from the catalog's copy, with the list price where it is set", async () => {
    const r = await create(CSM_A, A, "website", "en", uuid(100));
    p1 = r.proposal;
    expect(r.warnings).toEqual([]);
    expect(p1).toMatchObject({
      taskId: A,
      clientName: "Acme Interiors",
      offerKey: "website",
      lang: "en",
      status: "draft",
      code: null,
      url: null,
      price: { parts: { build: 2000, care: 200 }, split: false },
      priceReason: null,
      listPrice: { build: 2000, care: 200 },
      validUntil: await iso("public.cockpit_upsell_today() + 30"),
      revision: 1,
      createdBy: EMAILS.CSM_A,
      updatedAfterSend: false,
      expired: false,
    });
    expect(p1.content).toEqual({
      v: 1,
      logo: { on: true, adId: null },
      video: { kind: "default" },
      found: [],
      why: {
        trigger: "search",
        text: "People search your name after they see your ad.",
        edited: false,
      },
      get: COPY_EN.get.map(g => ({ ...g, hidden: false, edited: false })),
      platforms: null,
      steps: {
        text: "You pay and send your content.\nWe build it in four weeks.",
        edited: false,
      },
      button: { text: "Yes, build our site", edited: false },
      showCsm: true,
    });
    expect(
      (await create(CSM_A, A, "website", "en", uuid(100))).proposal.id,
    ).toBe(p1.id);
    expect(
      await h.failure(CSM_A2, CREATE, [A, "website", "en", uuid(100)]),
    ).toEqual({
      code: "42501",
      message: "This request id belongs to another proposal.",
    });
    const audit = (await h.audits("cockpit_upsell_proposals")).at(-1)!;
    expect(audit).toMatchObject({
      action: "upsellProposal.create",
      entity_id: p1.id,
      actor_email: EMAILS.CSM_A,
    });
    expect(audit.metadata.line).toBe(
      "Proposal for Website started for Acme Interiors",
    );
  });

  test("the gate's reasons come back as warnings and never stop a draft; social media starts with Instagram", async () => {
    const b = await create(CSM_B, B, "website", "en", uuid(101));
    expect(b.warnings.map((w: Row) => w.key)).toEqual([
      "no_win",
      "happiness_stale",
    ]);
    expect(b.proposal.content.logo).toEqual({ on: false, adId: null });
    const smm = await create(CSM_A, A, "smm", "ar", uuid(102));
    expect(smm.proposal).toMatchObject({
      lang: "ar",
      price: { parts: {}, split: false },
      listPrice: { monthly: null },
    });
    expect(smm.proposal.content).toMatchObject({
      platforms: ["instagram"],
      why: { trigger: null, text: "" },
      get: [],
      button: { text: "" },
    });
    for (const [args, message] of [
      [[A, "renewal", "en", uuid(103)], "Choose one of the seven offers."],
      [[A, "website", "fr", uuid(103)], "Choose English or Arabic."],
      [[A, "website", "en", null], "A proposal request id is required."],
    ] as const)
      expect(await h.failure(CSM_A, CREATE, [...args])).toEqual({
        code: "22023",
        message,
      });
    expect(
      (await h.failure(CSM_A, CREATE, [B, "website", "en", uuid(104)])).message,
    ).toBe("That client is not on your access list");
  });
});

describe("save", () => {
  test("a draft saves whatever is typed; copy problems come back and never stop the save", async () => {
    const content = {
      ...p1.content,
      found: [{ fileId: cap.id, caption: "" }],
      get: p1.content.get.map((g: Row, i: number) =>
        i === 0
          ? {
              ...g,
              text: "Six pages that turn visits into leads",
              edited: true,
            }
          : g,
      ),
    };
    const r = await save(CSM_A, p1.id, { content }, 1);
    expect(r).toMatchObject({
      revision: 2,
      changed: true,
      updatedAfterSend: false,
    });
    expect(r.problems).toEqual([
      {
        field: "get.1",
        rule: "lead_word",
        block: true,
        text: 'What you get, line 1: Says lead. Say enquiry or client. ("leads")',
      },
    ]);
    const audit = (await h.audits("cockpit_upsell_proposals")).at(-1)!;
    expect(audit.action).toBe("upsellProposal.save");
    expect(Object.keys(audit.after).sort()).toEqual([
      "content",
      "id",
      "revision",
      "updated_at",
    ]);
    expect(Object.keys(audit.before).sort()).toEqual([
      "content",
      "id",
      "revision",
      "updated_at",
    ]);
    p1 = r;
  });

  test("a stale revision, a bad shape, someone else's picture or logo, an unknown line or part: each refused plainly", async () => {
    expect(await saveFails(CSM_A, p1.id, { lang: "ar" }, 1)).toEqual({
      code: "40001",
      message: "Someone else saved this. Read it again.",
    });
    const bad: [Row, string][] = [
      [{ stage: "x" }, 'A proposal does not keep "stage".'],
      [
        { content: { ...p1.content, showCsm: undefined } },
        "The proposal's content is not in the shape the page reads. Reload the builder.",
      ],
      [
        { content: { ...p1.content, frozen: {} } },
        "The proposal's content is not in the shape the page reads. Reload the builder.",
      ],
      [
        { content: { ...p1.content, platforms: ["instagram"] } },
        "The proposal's content is not in the shape the page reads. Reload the builder.",
      ],
      [
        {
          content: {
            ...p1.content,
            button: { text: "x".repeat(41), edited: true },
          },
        },
        "The proposal's content is not in the shape the page reads. Reload the builder.",
      ],
      [
        {
          content: {
            ...p1.content,
            video: {
              kind: "custom",
              url: "https://evil.example/v",
              posterUrl: null,
              title: null,
              checkedAt: "2026-10-26T10:00:00Z",
            },
          },
        },
        "The proposal's content is not in the shape the page reads. Reload the builder.",
      ],
      [
        {
          content: { ...p1.content, found: [{ fileId: capB.id, caption: "" }] },
        },
        "Pick one of this client's own captures.",
      ],
      [
        { content: { ...p1.content, logo: { on: true, adId: logoB.id } } },
        "Pick one of this client's own logos.",
      ],
      [
        {
          content: {
            ...p1.content,
            get: [{ key: "seo", text: "x", hidden: false, edited: true }],
          },
        },
        "What you get has a line this offer does not have. Reload the builder.",
      ],
      [
        {
          content: {
            ...p1.content,
            why: { trigger: "money", text: "x", edited: true },
          },
        },
        '"Why this, for you" names a reason this offer does not have. Reload the builder.',
      ],
      [
        { price: { parts: { build: 0, care: 200 }, split: false } },
        "A price is a dollar amount from 1 to 1,000,000 for each part, with at most two decimals.",
      ],
      [
        { price: { parts: { build: 2000, hosting: 5 }, split: false } },
        "The price names a part this offer does not have.",
      ],
      [
        { price_reason: "x".repeat(141) },
        "The reason is too long. Keep it to 140 characters.",
      ],
      [
        { valid_until: await iso("public.cockpit_upsell_today() + 400") },
        'Pick a "Valid until" date within a year.',
      ],
      [{ lang: "fr" }, "The language must be one of: en, ar."],
    ];
    for (const [patch, message] of bad)
      expect({
        patch: Object.keys(patch),
        got: await saveFails(CSM_A, p1.id, patch, 2),
      }).toEqual({
        patch: Object.keys(patch),
        got: { code: "22023", message },
      });
    expect((await saveFails(CSM_B, p1.id, { lang: "ar" }, 2)).message).toBe(
      "That client is not on your access list",
    );
    expect(await saveFails(CSM_A, uuid(999), { lang: "ar" }, 2)).toEqual({
      code: "42501",
      message: "That proposal is not one you can open.",
    });
    const same = await save(CSM_A, p1.id, { lang: "en" }, 2);
    expect(same).toMatchObject({ changed: false, revision: 2 });
    p1 = await save(
      CSM_A,
      p1.id,
      { content: { ...p1.content, logo: { on: true, adId: logoA.id } } },
      2,
    );
    p1 = await save(
      CSM_A,
      p1.id,
      { content: { ...p1.content, logo: { on: true, adId: null } } },
      3,
    );
    expect(p1.revision).toBe(4);
  });
});

describe("send", () => {
  test("each refusal names the line and the reason; nothing is frozen", async () => {
    let f = await sendFails(CSM_A, p1.id, 4);
    expect(f).toMatchObject({
      code: "22023",
      message:
        'What you get, line 1: Says lead. Say enquiry or client. ("leads")',
    });
    expect(JSON.parse(f.detail!)).toEqual([
      {
        field: "get.1",
        rule: "lead_word",
        block: true,
        text: 'What you get, line 1: Says lead. Say enquiry or client. ("leads")',
      },
    ]);
    const clean = {
      ...p1.content,
      get: p1.content.get.map((g: Row, i: number) =>
        i === 0 ? { ...g, text: "Six pages that show your projects" } : g,
      ),
    };
    p1 = await save(
      CSM_A,
      p1.id,
      {
        content: clean,
        price: { parts: { build: 1800, care: 200 }, split: false },
      },
      4,
    );
    expect((await sendFails(CSM_A, p1.id, 5)).message).toBe(
      "Website build: below the list price (2,000). Add a one-line reason.",
    );
    p1 = await save(
      CSM_A,
      p1.id,
      {
        price_reason: "Second site for them",
        valid_until: await iso("public.cockpit_upsell_today() - 1"),
      },
      5,
    );
    expect((await sendFails(CSM_A, p1.id, 6)).message).toBe(
      '"Valid until" has passed. Pick a new date.',
    );
    p1 = await save(
      CSM_A,
      p1.id,
      {
        valid_until: await iso("public.cockpit_upsell_today() + 30"),
        lang: "ar",
      },
      6,
    );
    expect((await sendFails(CSM_A, p1.id, 7)).message).toBe(
      "This offer has no Arabic video yet. The CEO saves it on Money > Offers, or paste a custom video.",
    );
    p1 = await save(
      CSM_A,
      p1.id,
      { lang: "en", price: { parts: { build: 1800 }, split: false } },
      7,
    );
    expect((await sendFails(CSM_A, p1.id, 8)).message).toBe(
      "Type a price for the website care plan.",
    );
    p1 = await save(
      CSM_A,
      p1.id,
      { price: { parts: { build: 1800, care: 200 }, split: true } },
      8,
    );
    expect((await sendFails(CSM_A, p1.id, 9)).message).toBe(
      "This offer has no split.",
    );
    p1 = await save(
      CSM_A,
      p1.id,
      {
        price: { parts: { build: 1800, care: 200 }, split: false },
        content: {
          ...p1.content,
          get: p1.content.get.map((g: Row) => ({ ...g, hidden: true })),
          button: { text: " ", edited: true },
        },
      },
      9,
    );
    f = await sendFails(CSM_A, p1.id, 10);
    expect(f.message).toBe("Show at least one line under What you get.");
    expect(JSON.parse(f.detail!).map((p: Row) => p.text)).toEqual([
      "Show at least one line under What you get.",
      "Type the words on the button.",
    ]);
    expect((await sendFails(CSM_A, p1.id, 10, [], "whatsapp")).message).toBe(
      '"Copy link" is the only way to send for now.',
    );
    expect((await sendFails(CSM_A, p1.id, 9)).code).toBe("40001");
    expect(await get(CSM_A, p1.id)).toMatchObject({
      code: null,
      status: "draft",
      sentAt: null,
    });
  });

  test("a locked offer's price is its list, and its split waits for full price held", async () => {
    await setList("seo_geo", { parts: [{ key: "program", amount: 5000 }] });
    const s = (await create(CSM_A, A, "seo_geo", "en", uuid(110))).proposal;
    expect(s.price).toEqual({ parts: { program: 5000 }, split: false });
    const custom = {
      kind: "custom",
      url: `https://www.loom.com/share/${LOOM}`,
      posterUrl: null,
      title: "Your plan",
      checkedAt: "2026-10-26T10:00:00Z",
    };
    let r = await save(
      CSM_A,
      s.id,
      {
        content: { ...s.content, video: custom },
        price: { parts: { program: 4000 }, split: false },
        price_reason: "x",
      },
      1,
    );
    expect((await sendFails(CSM_A, s.id, 2)).message).toBe(
      "This price is locked at the list price (5,000).",
    );
    r = await save(
      CSM_A,
      s.id,
      { price: { parts: { program: 5000 }, split: true } },
      2,
    );
    expect((await sendFails(CSM_A, s.id, 3)).message).toBe(
      "The split shows only after full price was held: on a call, or in a proposal sent at full price, in the last 60 days.",
    );
    // Held on a call (a pitch): the split may show.
    await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_pitch_save($1,'seo_geo',$2::uuid,'{\"held_full\":true}'::jsonb,0) r",
      [A, uuid(111)],
    );
    expect((await sendFails(CSM_A, s.id, 3)).message).toBe(
      "Show at least one line under What you get.",
    );
    expect(r.revision).toBe(3);
    await setList("seo_geo", { parts: [{ key: "program", amount: null }] });
    expect((await sendFails(CSM_A, s.id, 3)).message).toBe(
      "This price is locked. The CEO sets it on Money > Offers.",
    );
  });

  test("the gate's warnings must each be ticked; the ticks are kept", async () => {
    const b = (await create(CSM_B, B, "website", "en", uuid(101))).proposal;
    let f = await sendFails(CSM_B, b.id, 1);
    expect(f.message).toMatch(
      /^Tick the warning first: No quotation in 30 days/,
    );
    expect(JSON.parse(f.detail!).map((p: Row) => p.rule)).toEqual([
      "no_win",
      "happiness_stale",
    ]);
    f = await sendFails(CSM_B, b.id, 1, ["no_win"]);
    expect(f.message).toMatch(/^Tick the warning first: Happiness /);
    const r = await send(CSM_B, b.id, 1, [
      "no_win",
      "happiness_stale",
      "made_up",
    ]);
    expect(r.status).toBe("link_copied");
    expect((await get(CSM_B, b.id)).warningsPassed).toEqual([
      "happiness_stale",
      "no_win",
    ]);
    expect(
      (await h.audits("cockpit_upsell_proposals")).at(-1)!.metadata.line,
    ).toBe(
      "Proposal for Website sent at 2,000 + 200 (list 2,000 + 200), warnings ticked: no win in 30 days, happiness not confirmed in 14 days",
    );
  });

  test("a line marked unedited is checked unless it is the catalog's own text, and so is what we found", async () => {
    const d = (await create(CSM_A, A, "website", "en", uuid(105))).proposal;
    // The catalog's own lines, as created: nothing to report.
    expect((await get(CSM_A, d.id)).problems).toEqual([]);
    // The browser's flag says unedited; the server compares with the catalog.
    let r = await save(
      CSM_A,
      d.id,
      {
        content: {
          ...d.content,
          get: d.content.get.map((g: Row, i: number) =>
            i === 0
              ? { ...g, text: "We guarantee 10 new projects", edited: false }
              : g,
          ),
        },
      },
      1,
    );
    expect(
      r.problems.filter((p: Row) => p.block).map((p: Row) => [p.field, p.rule]),
    ).toEqual([["get.1", "result_guarantee"]]);
    let f = await sendFails(CSM_A, d.id, 2, ["recent_offer"]);
    expect(f.message).toBe(
      'What you get, line 1: Guarantees a result. We never promise results. ("guarantee 10 new projects")',
    );
    expect(JSON.parse(f.detail!).map((p: Row) => [p.field, p.rule])).toEqual([
      ["get.1", "result_guarantee"],
    ]);
    // The same for why, the steps and the button, each marked unedited.
    r = await save(
      CSM_A,
      d.id,
      {
        content: {
          ...d.content,
          why: { ...d.content.why, text: "Your CPL drops.", edited: false },
          steps: {
            text: "You pay. We keep working for free until it works.",
            edited: false,
          },
          button: { text: "Get 20 leads now", edited: false },
        },
      },
      2,
    );
    f = await sendFails(CSM_A, d.id, 3, ["recent_offer"]);
    expect([
      ...new Set(JSON.parse(f.detail!).map((p: Row) => p.field)),
    ]).toEqual(["why", "steps", "button"]);
    // What we found: the file's own caption shows when none is typed, and
    // what it was searched as shows too; both are checked at send.
    r = await save(
      CSM_A,
      d.id,
      { content: { ...d.content, found: [{ fileId: cap.id, caption: "" }] } },
      3,
    );
    expect(r.problems).toEqual([]);
    await h.owner(
      "UPDATE public.cockpit_upsell_files SET caption='CPL went up', searched_as='leads Kuwait' WHERE id=$1",
      [cap.id],
    );
    f = await sendFails(CSM_A, d.id, 4, ["recent_offer"]);
    expect(f.message).toBe(
      'What we found, picture 1: Names an ad metric like CPL or ROAS. Clients never see those. ("CPL")',
    );
    expect(JSON.parse(f.detail!).map((p: Row) => [p.field, p.rule])).toEqual([
      ["found.1", "metric_word"],
      ["found.1.searchedAs", "lead_word"],
    ]);
    await h.owner(
      "UPDATE public.cockpit_upsell_files SET caption='Their site today', searched_as='Kuwait City' WHERE id=$1",
      [cap.id],
    );
    expect((await sendFails(CSM_A, d.id, 4)).message).toMatch(
      /^Tick the warning first: /,
    );
  });

  test("a language switch brings the catalog's lines along; a catalog line left in the other language stops Send", async () => {
    // Arabic catalog lines that differ from the English ones (taken from the
    // content builder's copy, 20261026x), on this file's line keys.
    const ar = {
      ...COPY_AR,
      get: [
        { key: "pages", text: "لغاية ٦ صفحات، بالعربي والإنجليزي" },
        { key: "whatsapp", text: "زر واتساب، بضغطة من أي صفحة" },
        { key: "form", text: "نموذج استفسار يوصلكم مباشرة" },
      ],
      steps: [
        {
          key: "pay",
          text: "ترسلون لنا الشعار وصور المشاريع وقائمة الخدمات.",
        },
        {
          key: "build",
          text: "نبني الموقع بالعربي والإنجليزي، ونوريكم المسودة.",
        },
      ],
      why: [
        {
          key: "search",
          label: "ما يطلع لكم موقع",
          text: "اللي يشوف إعلانكم يدور على اسمكم قبل لا يتواصل معكم. والحين ما فيه موقع يلقاه، فما يشوف شغلكم.",
        },
      ],
      button: "خلونا نبدي",
    };
    const setCopy = (copy: Row) =>
      h.owner(
        "UPDATE public.cockpit_upsell_catalog SET copy=$1::jsonb WHERE offer_key='website'",
        [JSON.stringify(copy)],
      );
    await setCopy({ en: COPY_EN, ar });
    try {
      const d = (await create(CSM_A, A, "website", "en", uuid(106))).proposal;
      const typed = "Six pages that show your projects";
      let r = await save(
        CSM_A,
        d.id,
        {
          content: {
            ...d.content,
            get: d.content.get.map((g: Row, i: number) =>
              i === 2 ? { ...g, text: typed, edited: true } : g,
            ),
          },
        },
        1,
      );
      // The language alone: every catalog line follows it, a typed line stays.
      r = await save(CSM_A, d.id, { lang: "ar" }, 2);
      expect(r.lang).toBe("ar");
      expect(r.content.why).toEqual({
        trigger: "search",
        text: ar.why[0].text,
        edited: false,
      });
      expect(r.content.get.map((g: Row) => g.text)).toEqual([
        ar.get[0].text,
        ar.get[1].text,
        typed,
      ]);
      expect(r.content.steps.text).toBe(ar.steps.map(x => x.text).join("\n"));
      expect(r.content.button.text).toBe(ar.button);
      expect(r.problems).toEqual([]);
      // An English catalog line put back on the Arabic page: named, and Send
      // refuses it.
      r = await save(
        CSM_A,
        d.id,
        {
          content: {
            ...r.content,
            get: r.content.get.map((g: Row, i: number) =>
              i === 0 ? { ...g, text: COPY_EN.get[0].text, edited: false } : g,
            ),
          },
        },
        3,
      );
      expect(r.problems).toEqual([
        {
          field: "get.1",
          rule: "wrong_language",
          block: true,
          text: "What you get, line 1: still in English. Write it in Arabic.",
        },
      ]);
      const f = await sendFails(CSM_A, d.id, 4, ["recent_offer"]);
      expect(f.code).toBe("22023");
      expect(
        JSON.parse(f.detail!).map((p: Row) => [p.field, p.rule]),
      ).toContainEqual(["get.1", "wrong_language"]);
      // Back to English: the Arabic catalog lines follow, nothing is left over.
      r = await save(CSM_A, d.id, { lang: "en" }, 4);
      expect(r.content.get.map((g: Row) => g.text)).toEqual([
        COPY_EN.get[0].text,
        COPY_EN.get[1].text,
        typed,
      ]);
      expect(r.content.why.text).toBe(COPY_EN.why[0].text);
      expect(r.content.button.text).toBe(COPY_EN.button);
      expect(r.problems).toEqual([]);
    } finally {
      await setCopy({ en: COPY_EN, ar: COPY_AR });
    }
  });

  test("a clean draft sends: the code, the link, the status, and the warnings that only warn", async () => {
    p1 = await save(
      CSM_A,
      p1.id,
      {
        content: {
          ...p1.content,
          get: p1.content.get.map((g: Row) => ({ ...g, hidden: false })),
          button: { text: "Yes, build our site", edited: false },
          why: {
            trigger: "search",
            text: "We guarantee the build is done in four weeks.",
            edited: true,
          },
        },
      },
      10,
    );
    const r = await send(CSM_A, p1.id, 11, ["recent_offer"]);
    expect(r.code).toMatch(/^[a-hj-km-np-z2-9]{12}$/);
    expect(r).toMatchObject({
      url: `https://offer.maharamedia.com/${r.code}`,
      status: "link_copied",
      revision: 12,
    });
    expect(r.problems).toEqual([
      {
        field: "why",
        rule: "mention",
        block: false,
        text: 'Why this, for you: Mentions a guarantee or something free. Check it is the agreed terms and never a result. ("guarantee")',
      },
    ]);
    const after = await get(CSM_A, p1.id);
    expect(after).toMatchObject({
      code: r.code,
      status: "link_copied",
      sentLang: "en",
      sentRev: 12,
      sentBy: EMAILS.CSM_A,
      sentPrice: { parts: { build: 1800, care: 200 }, split: false },
      sentListPrice: { build: 2000, care: 200 },
      updatedAfterSend: false,
    });
    expect(after.sentContent.frozen).toMatchObject({
      title: "Your website",
      terms: COPY_EN.terms,
      csmFirstName: "Noura",
      cta: "We want the website",
      video: {
        provider: "wistia",
        embedUrl: `${WISTIA_EN}?seo=false`,
        posterUrl: null,
        title: "Your website",
      },
    });
    const audit = (await h.audits("cockpit_upsell_proposals")).at(-1)!;
    expect(audit.action).toBe("upsellProposal.send");
    expect(audit.after.sent_content.frozen.title).toBe("Your website");
    expect(audit.metadata.line).toBe(
      "Proposal for Website sent at 1,800 + 200 (list 2,000 + 200): Second site for them, warnings ticked: offered in the last 30 days",
    );
    // Earlier saves never recorded a frozen copy.
    expect(
      (await h.audits("cockpit_upsell_proposals"))
        .filter(a => a.action === "upsellProposal.save")
        .some(a => "sent_content" in (a.after ?? {})),
    ).toBe(false);
    p1 = after;
    // The gate now counts the proposal as this month's offer talk.
    const g = await h.one(CSM_A, "SELECT public.cockpit_csm_offer_gate($1) r", [
      A,
    ]);
    expect(g.lastOffer).toMatchObject({ kind: "pitch", offer: "seo_geo" });
    await h.owner(
      "DELETE FROM public.cockpit_upsell_pitches WHERE task_id='taskA1'",
    );
    const g2 = await h.one(
      CSM_A,
      "SELECT public.cockpit_csm_offer_gate($1) r",
      [A],
    );
    expect(g2.lastOffer).toEqual({
      kind: "proposal",
      offer: "website",
      on: await iso("public.cockpit_upsell_today()"),
    });
    expect(g2.reasons.find((x: Row) => x.key === "recent_offer")).toMatchObject(
      {
        text: expect.stringContaining(", in a proposal."),
        source: "Proposals",
      },
    );
  });

  test("with no list price yet, the CEO card's line says so instead of blank + blank", async () => {
    await setList("website", {
      parts: [
        { key: "build", amount: null },
        { key: "care", amount: null },
      ],
    });
    try {
      const d = (await create(CSM_A, A, "website", "en", uuid(107))).proposal;
      expect(d.price).toEqual({ parts: {}, split: false });
      const r = await save(
        CSM_A,
        d.id,
        { price: { parts: { build: 1500, care: 150 }, split: false } },
        1,
      );
      await send(CSM_A, d.id, r.revision, ["recent_offer"]);
      expect(
        (await h.audits("cockpit_upsell_proposals")).at(-1)!.metadata.line,
      ).toBe("Proposal for Website sent at 1,500 + 150 (no list price yet)");
    } finally {
      await setList("website", {
        parts: [
          { key: "build", amount: 2000 },
          { key: "care", amount: 200 },
        ],
      });
    }
  });
});

describe("the freeze, update link and mark", () => {
  let first: Row;
  test("a later list, copy or draft change never alters the sent page", async () => {
    first = await open(p1.code);
    expect(first.state).toBe("open");
    await setList("website", { parts: [{ key: "build", amount: 2500 }] });
    await h.owner(
      `UPDATE public.cockpit_upsell_catalog SET copy = jsonb_set(jsonb_set(copy, '{en,deckTitle}', '"Your new website"'), '{en,terms}', '"New terms."') WHERE offer_key='website'`,
    );
    p1 = await save(
      CSM_A,
      p1.id,
      { price: { parts: { build: 1900, care: 200 }, split: false } },
      12,
    );
    expect(p1.updatedAfterSend).toBe(true);
    // The capture's own caption and search change in prep after the send.
    const FILE =
      "SELECT public.cockpit_upsell_file_update($1,$2::uuid,$3::jsonb) r";
    await h.one(CSM_A, FILE, [
      A,
      cap.id,
      JSON.stringify({ caption: "Their site last week", searched_as: null }),
    ]);
    expect((await open(p1.code)).proposal).toEqual(first.proposal);
    expect(first.proposal.found[0]).toMatchObject({
      caption: "Their site today",
      searchedAs: "Kuwait City",
    });
    await h.one(CSM_A, FILE, [
      A,
      cap.id,
      JSON.stringify({
        caption: "Their site today",
        searched_as: "Kuwait City",
      }),
    ]);
    expect(
      (await h.one(CSM_A, READ, [A])).rows.find((x: Row) => x.id === p1.id)
        .updatedAfterSend,
    ).toBe(true);
  });

  test("update link: the same checks, a new freeze on the same code", async () => {
    expect(
      await h.failure(CSM_A, UPDATE_LINK, [
        (await create(CSM_A, A, "website", "en", uuid(120))).proposal.id,
        1,
        [],
      ]),
    ).toEqual({ code: "22023", message: "Copy the link once first." });
    const r = await h.one(CSM_A, UPDATE_LINK, [p1.id, 13, []]);
    expect(r).toMatchObject({
      code: p1.code,
      status: "link_copied",
      revision: 14,
    });
    const page = (await open(p1.code)).proposal;
    expect(page.title).toBe("Your new website");
    expect(page.investment).toEqual({
      parts: [
        { label: "Website build", amountUsd: 1900, cadence: "one_time" },
        { label: "Care plan, monthly", amountUsd: 200, cadence: "monthly" },
      ],
      terms: "New terms.",
      split: null,
    });
    p1 = await get(CSM_A, p1.id);
    expect(p1).toMatchObject({
      updatedAfterSend: false,
      sentListPrice: { build: 2500, care: 200 },
    });
    expect((await h.audits("cockpit_upsell_proposals")).at(-1)!).toMatchObject({
      action: "upsellProposal.updateLink",
    });
    expect(
      (await h.audits("cockpit_upsell_proposals")).at(-1)!.metadata.line,
    ).toBe(
      "Proposal for Website updated at 1,900 + 200 (list 2,500 + 200): Second site for them",
    );
  });

  test("mark: accepted and not now need the link sent; not now needs the objection and a date; archived closes the page", async () => {
    const draft = (await create(CSM_A, A, "website", "en", uuid(120))).proposal;
    expect(
      await h.failure(CSM_A, MARK, [draft.id, "accepted", null, null, 1]),
    ).toEqual({
      code: "22023",
      message: "Copy the link first, then mark their answer.",
    });
    expect(
      await h.failure(CSM_A, MARK, [p1.id, "maybe", null, null, 14]),
    ).toEqual({
      code: "22023",
      message: "Mark it accepted, not now or archived.",
    });
    expect(
      await h.failure(CSM_A, MARK, [p1.id, "not_now", null, null, 14]),
    ).toEqual({
      code: "22023",
      message: "Write what held them back, in a line.",
    });
    expect(
      await h.failure(CSM_A, MARK, [
        p1.id,
        "not_now",
        "After Ramadan",
        await iso("public.cockpit_upsell_today() + 121"),
        14,
      ]),
    ).toEqual({
      code: "22023",
      message: "Pick a follow-up date in the next 120 days.",
    });
    let r = await h.one(CSM_A, MARK, [
      p1.id,
      "not_now",
      "After Ramadan",
      await iso("public.cockpit_upsell_today() + 30"),
      14,
    ]);
    expect(r).toMatchObject({
      status: "not_now",
      objection: "After Ramadan",
      followUpOn: await iso("public.cockpit_upsell_today() + 30"),
      revision: 15,
    });
    // The client page's card reads the answer without opening the proposal.
    const rows = (await h.one(CSM_A, READ, [A])).rows;
    expect(rows.find((x: Row) => x.id === p1.id)).toMatchObject({
      status: "not_now",
      objection: "After Ramadan",
      followUpOn: await iso("public.cockpit_upsell_today() + 30"),
    });
    expect(rows.find((x: Row) => x.id === draft.id)).toMatchObject({
      objection: null,
      followUpOn: null,
    });
    expect(
      (await h.audits("cockpit_upsell_proposals")).at(-1)!.metadata.line,
    ).toMatch(
      /^Proposal for Website marked not now: After Ramadan, follow up /,
    );
    r = await h.one(CSM_A, MARK, [p1.id, "accepted", null, null, 15]);
    expect(r.status).toBe("accepted");
    expect((await open(p1.code)).state).toBe("open");
    r = await h.one(CSM_A, MARK, [draft.id, "archived", null, null, 1]);
    expect(r.status).toBe("archived");
    expect(await saveFails(CSM_A, draft.id, { lang: "ar" }, 2)).toEqual({
      code: "22023",
      message: "This proposal is archived. Make a new one.",
    });
    expect((await sendFails(CSM_A, draft.id, 2)).message).toBe(
      "This proposal is archived. Make a new one.",
    );
    p1 = await get(CSM_A, p1.id);
  });
});

describe("the door", () => {
  test("service key only: a signed-in seat and signed out cannot call any door function", async () => {
    for (const [sql, params] of [
      [OPEN, [p1.code, DEVICE, IP, "phone", null]],
      [EVENT, [p1.code, "play", DEVICE, IP, "phone"]],
      [
        "SELECT public.cockpit_upsell_door_video($1,$2,$3,$4)",
        ["abcdefghjk", DEVICE, IP, "phone"],
      ],
      ["SELECT public.cockpit_upsell_door_status_set('p', true, NULL)", []],
    ] as [string, unknown[]][]) {
      for (const who of [CSM_A, CEO, null]) {
        const f = await h.failure(who, sql, params);
        expect(f.code).toBe("42501");
        expect(f.message).toContain("permission denied");
      }
    }
  });

  test("the states: unknown, a draft, expired, archived, open; the contact is the setting's number", async () => {
    expect(await open("nope")).toEqual({
      state: "unknown",
      proposal: null,
      contact: { whatsapp: null },
    });
    expect(await open("abcdefghjkmn")).toEqual({
      state: "unknown",
      proposal: null,
      contact: { whatsapp: null },
    });
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_setting_set('whatsapp_number','96550000000') r",
    );
    expect((await open(p1.code)).contact).toEqual({ whatsapp: "96550000000" });
    await h.owner(
      "UPDATE public.cockpit_upsell_proposals SET valid_until = public.cockpit_upsell_today() - 1, sent_content = jsonb_set(sent_content, '{frozen,validUntil}', to_jsonb(to_char(public.cockpit_upsell_today() - 1, 'YYYY-MM-DD'))) WHERE id=$1",
      [p1.id],
    );
    expect(await open(p1.code)).toEqual({
      state: "expired",
      proposal: null,
      contact: { whatsapp: "96550000000" },
    });
    // An accepted answer does not extend the published link's validity.
    expect(
      (await h.one(CSM_A, READ, [A])).rows.find((x: Row) => x.id === p1.id)
        .expired,
    ).toBe(true);
    await h.owner(
      "UPDATE public.cockpit_upsell_proposals SET status='link_copied' WHERE id=$1",
      [p1.id],
    );
    expect(
      (await h.one(CSM_A, READ, [A])).rows.find((x: Row) => x.id === p1.id)
        .expired,
    ).toBe(true);
    await h.owner(
      "UPDATE public.cockpit_upsell_proposals SET valid_until = public.cockpit_upsell_today() + 30, sent_content = jsonb_set(sent_content, '{frozen,validUntil}', to_jsonb(to_char(public.cockpit_upsell_today() + 30, 'YYYY-MM-DD'))) WHERE id=$1",
      [p1.id],
    );
    const archived = (
      await h.owner<{ code: string }>(
        "SELECT code FROM public.cockpit_upsell_proposals WHERE task_id='taskB1' AND code IS NOT NULL",
      )
    )[0].code;
    await h.owner(
      "UPDATE public.cockpit_upsell_proposals SET status='archived' WHERE code=$1",
      [archived],
    );
    expect((await open(archived)).state).toBe("archived");
  });

  test("opens, plays and Yes presses are counted per proposal; a preview token is not; the card knows when it cannot trust the count", async () => {
    await h.owner("DELETE FROM public.cockpit_upsell_views");
    await open(p1.code);
    await h.svc(OPEN, [
      p1.code,
      "device-0002",
      "b".repeat(64),
      "computer",
      null,
    ]);
    await h.svc(OPEN, [p1.code, "bad device!", "not-a-hash", "fridge", null]);
    await h.svc(EVENT, [p1.code, "play", DEVICE, IP, "phone"]);
    await h.svc(EVENT, [p1.code, "cta", DEVICE, IP, "phone"]);
    await h.svc(EVENT, ["abcdefghjkmn", "play", DEVICE, IP, "phone"]);
    await h.svc(EVENT, ["nope", "cta", DEVICE, IP, "phone"]);
    expect(
      await h.failure("service", EVENT, [
        p1.code,
        "scroll",
        DEVICE,
        IP,
        "phone",
      ]),
    ).toEqual({ code: "22023", message: "An event is play or cta." });
    const stored = await h.owner(
      "SELECT kind, device, ip_hash, device_kind FROM public.cockpit_upsell_views WHERE proposal_id=$1 ORDER BY id",
      [p1.id],
    );
    expect(stored).toEqual([
      { kind: "open", device: DEVICE, ip_hash: IP, device_kind: "phone" },
      {
        kind: "open",
        device: "device-0002",
        ip_hash: "b".repeat(64),
        device_kind: "computer",
      },
      { kind: "open", device: null, ip_hash: null, device_kind: null },
      { kind: "play", device: DEVICE, ip_hash: IP, device_kind: "phone" },
      { kind: "cta", device: DEVICE, ip_hash: IP, device_kind: "phone" },
    ]);
    // Preview: a 30-minute token, never counted, never an edit.
    const rev = (await get(CSM_A, p1.id)).revision;
    const pv = await h.one(CSM_A, PREVIEW, [p1.id]);
    const token = new URL(pv.url).searchParams.get("pv")!;
    expect(pv.url).toBe(`https://offer.maharamedia.com/${p1.code}?pv=${token}`);
    expect(token).toMatch(/^[a-hj-km-np-z2-9]{24}$/);
    expect((await get(CSM_A, p1.id)).revision).toBe(rev);
    expect((await open(p1.code, token)).state).toBe("open");
    await h.owner(
      "UPDATE public.cockpit_upsell_proposals SET valid_until = public.cockpit_upsell_today() - 1, sent_content = jsonb_set(sent_content, '{frozen,validUntil}', to_jsonb(to_char(public.cockpit_upsell_today() - 1, 'YYYY-MM-DD'))) WHERE id=$1",
      [p1.id],
    );
    expect((await open(p1.code, token)).state).toBe("open");
    await h.owner(
      "UPDATE public.cockpit_upsell_proposals SET valid_until = public.cockpit_upsell_today() + 30, sent_content = jsonb_set(sent_content, '{frozen,validUntil}', to_jsonb(to_char(public.cockpit_upsell_today() + 30, 'YYYY-MM-DD'))) WHERE id=$1",
      [p1.id],
    );
    await open(p1.code, "wrong-token");
    const stored2 = await h.owner<{ n: number }>(
      "SELECT count(*)::int n FROM public.cockpit_upsell_views WHERE proposal_id=$1 AND kind='open'",
      [p1.id],
    );
    expect(stored2[0].n).toBe(4);
    expect(
      await h.failure(CSM_A, PREVIEW, [
        (await create(CSM_A, A, "website", "en", uuid(130))).proposal.id,
      ]),
    ).toEqual({
      code: "22023",
      message: "Copy the link once, then open the live page.",
    });
    // The card: nothing known until the door has reported working.
    const card = async () =>
      (await h.one(CSM_A, READ, [A])).rows.find((x: Row) => x.id === p1.id)
        .opened;
    expect(await card()).toMatchObject({
      devices: 3,
      visits: 4,
      played: 1,
      pressedYes: 1,
      known: false,
    });
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('p', true, NULL)",
    );
    expect((await card()).known).toBe(true);
    await h.owner(
      "UPDATE public.cockpit_upsell_door_status SET last_ok_at = now() - interval '2 minutes'",
    );
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('p', false, 'The service key is missing.')",
    );
    expect((await card()).known).toBe(false);
    expect(
      (await h.one(CSM_A, READ, [A])).rows.find(
        (x: Row) => x.status === "draft",
      ).opened,
    ).toBeNull();
    expect((await h.audits("cockpit_upsell_views")).length).toBe(0);
    expect((await h.audits("cockpit_upsell_door_status")).length).toBe(0);
  });

  test("the door's status is written when it changes, or at most once a minute", async () => {
    await h.owner("DELETE FROM public.cockpit_upsell_door_status");
    const row = async () =>
      (
        await h.owner(
          "SELECT last_ok_at, last_error_at, sentence FROM public.cockpit_upsell_door_status WHERE route='v'",
        )
      )[0];
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('v', true, NULL)",
    );
    const a = await row();
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('v', true, NULL)",
    );
    expect(await row()).toEqual(a);
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('v', false, ' OFFER_IP_SALT is missing. ')",
    );
    const b = await row();
    expect(b.sentence).toBe("OFFER_IP_SALT is missing.");
    expect(b.last_error_at).not.toBeNull();
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('v', false, 'Again')",
    );
    expect((await row()).sentence).toBe("OFFER_IP_SALT is missing.");
    await h.owner(
      "UPDATE public.cockpit_upsell_door_status SET last_error_at = now() - interval '61 seconds'",
    );
    await h.svc(
      "SELECT public.cockpit_upsell_door_status_set('v', false, 'Again')",
    );
    expect((await row()).sentence).toBe("Again");
    expect(
      await h.failure(
        "service",
        "SELECT public.cockpit_upsell_door_status_set('x', true, NULL)",
      ),
    ).toEqual({ code: "22023", message: "A door route is p, event or v." });
  });

  test("a pitch's video link: the offer's video in its language, one counted view; an unknown code is unknown", async () => {
    const p = await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_pitch_save($1,'website',$2::uuid,'{}'::jsonb,0) r",
      [A, uuid(140)],
    );
    const VIDEO = "SELECT public.cockpit_upsell_door_video($1,$2,$3,$4) r";
    expect(await h.svc(VIDEO, [p.videoCode, DEVICE, IP, "tablet"])).toEqual({
      state: "open",
      url: WISTIA_EN,
    });
    expect(
      await h.owner(
        "SELECT kind, pitch_id, proposal_id FROM public.cockpit_upsell_views WHERE pitch_id=$1",
        [p.id],
      ),
    ).toEqual([{ kind: "video", pitch_id: p.id, proposal_id: null }]);
    expect(await h.svc(VIDEO, ["abcdefghjk", DEVICE, IP, "tablet"])).toEqual({
      state: "unknown",
      url: null,
    });
    expect(await h.svc(VIDEO, ["../../etc", DEVICE, IP, "tablet"])).toEqual({
      state: "unknown",
      url: null,
    });
  });

  test("views older than 90 days go when the proposal is opened", async () => {
    await h.owner(
      "INSERT INTO public.cockpit_upsell_views(proposal_id, kind, at) VALUES($1,'open', now() - interval '91 days'), ($1,'play', now() - interval '89 days')",
      [p1.id],
    );
    await open(p1.code);
    const left = await h.owner<{ kind: string; old: boolean }>(
      "SELECT kind, at < now() - interval '90 days' old FROM public.cockpit_upsell_views WHERE proposal_id=$1 AND at < now() - interval '1 day'",
      [p1.id],
    );
    expect(left).toEqual([{ kind: "play", old: false }]);
  });
});

describe("PublicProposal", () => {
  test("its exact shape for the website, from the sent copy", async () => {
    const page = (await open(p1.code)).proposal;
    expect(Object.keys(page).sort()).toEqual(
      [
        "button",
        "clientName",
        "csmFirstName",
        "date",
        "found",
        "get",
        "investment",
        "lang",
        "logo",
        "offer",
        "platforms",
        "steps",
        "timing",
        "title",
        "validUntil",
        "video",
        "why",
        "work",
      ].sort(),
    );
    expect(page).toMatchObject({
      lang: "en",
      offer: "website",
      title: "Your new website",
      clientName: "Acme Interiors",
      logo: {
        bucket: "cockpit-client-logos",
        path: "verified/taskA1/0123456789abcdef.png",
        alt: "Acme Interiors",
      },
      csmFirstName: "Noura",
      date: await iso("public.cockpit_upsell_today()"),
      validUntil: await iso("public.cockpit_upsell_today() + 30"),
      video: {
        provider: "wistia",
        embedUrl: `${WISTIA_EN}?seo=false`,
        posterUrl: null,
        title: "Your website",
      },
      found: [
        {
          bucket: "cockpit-upsell-files",
          path: cap.path,
          caption: "Their site today",
          capturedOn: cap.capturedOn,
          searchedAs: "Kuwait City",
        },
      ],
      why: "We guarantee the build is done in four weeks.",
      get: [
        "Six pages that show your projects",
        "A WhatsApp button on every page",
        "An enquiry form that reaches your team",
      ],
      platforms: null,
      work: [],
      steps: "You pay and send your content.\nWe build it in four weeks.",
      timing: COPY_EN.timing,
      button: {
        text: "Yes, build our site",
        whatsapp: "https://wa.me/96550000000?text=We-want-the-website".replace(
          /-/g,
          "%20",
        ),
      },
    });
  });

  test("never a list price, a reason, an id, an email, the task id, a warning or a view, at any depth", async () => {
    const pages = [
      (await open(p1.code)).proposal,
      await h.one(CSM_A, PUBLIC, [p1.id, null, null]),
    ];
    for (const page of pages) {
      expect(
        allKeys(page).filter(k =>
          /reason|list|email|taskid|warning|view|^id$|revision|code/i.test(k),
        ),
      ).toEqual([]);
      const text = JSON.stringify(page);
      for (const leak of [
        "Second site for them",
        "2500",
        "2,500",
        EMAILS.CSM_A,
        "upsellProposal",
        p1.id,
      ])
        expect(text.includes(leak)).toBe(false);
    }
  });

  test("the draft as typed: the builder's content and price; the CSM's name and the logo can be turned off; Arabic is percent-encoded", async () => {
    const draft = (await create(CSM_A, A, "website", "ar", uuid(150))).proposal;
    let page = await h.one(CSM_A, PUBLIC, [draft.id, null, null]);
    expect(page).toMatchObject({
      lang: "ar",
      title: "Your website",
      date: await iso("public.cockpit_upsell_today()"),
      found: [],
      button: {
        whatsapp: "https://wa.me/96550000000?text=%D9%85%D9%88%D9%82%D8%B9",
      },
      video: null,
    });
    page = await h.one(CSM_A, PUBLIC, [
      draft.id,
      JSON.stringify({
        ...draft.content,
        showCsm: false,
        logo: { on: true, adId: logoA.id },
      }),
      JSON.stringify({ parts: { build: 2100 }, split: false }),
    ]);
    expect(page.csmFirstName).toBeNull();
    expect(page.logo).toEqual({
      bucket: "cockpit-launch-ads",
      path: logoA.path,
      alt: "Acme Interiors",
    });
    expect(page.investment.parts).toEqual([
      { label: "Website build", amountUsd: 2100, cadence: "one_time" },
    ]);
    page = await h.one(CSM_A, PUBLIC, [
      draft.id,
      JSON.stringify({ ...draft.content, logo: { on: false, adId: null } }),
      null,
    ]);
    expect(page.logo).toBeNull();
    expect(
      await h.failure(CSM_A, PUBLIC, [
        draft.id,
        JSON.stringify({ v: 2 }),
        null,
      ]),
    ).toEqual({
      code: "22023",
      message:
        "The proposal's content is not in the shape the page reads. Reload the builder.",
    });
    expect(
      (await h.failure(CSM_B, PUBLIC, [draft.id, null, null])).message,
    ).toBe("That client is not on your access list");
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_setting_set('whatsapp_number','') r",
    );
    expect(
      (await h.one(CSM_A, PUBLIC, [draft.id, null, null])).button.whatsapp,
    ).toBeNull();
  });
});

describe("the grants census of all three files", () => {
  test("every new table: row security on, no browser privileges, the service key without delete", async () => {
    const tables = (
      await h.owner<{
        t: string;
      }>(`SELECT c.relname t FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
      AND (c.relname LIKE 'cockpit_upsell%' OR c.relname = 'cockpit_client_site_checks') ORDER BY 1`)
    ).map(r => r.t);
    expect(tables).toEqual([
      "cockpit_client_site_checks",
      "cockpit_upsell_catalog",
      "cockpit_upsell_door_status",
      "cockpit_upsell_files",
      "cockpit_upsell_pitches",
      "cockpit_upsell_proposals",
      "cockpit_upsell_settings",
      "cockpit_upsell_views",
      "cockpit_upsell_wins",
    ]);
    for (const t of tables) {
      const has = async (role: string, p: string) =>
        (
          await h.owner<{ ok: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) ok",
            [role, `public.${t}`, p],
          )
        )[0].ok;
      for (const role of ["anon", "authenticated"])
        for (const p of [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
        ])
          expect({ t, role, p, ok: await has(role, p) }).toEqual({
            t,
            role,
            p,
            ok: false,
          });
      for (const p of ["SELECT", "INSERT", "UPDATE"])
        expect({ t, p, ok: await has("service_role", p) }).toEqual({
          t,
          p,
          ok: true,
        });
      for (const p of ["DELETE", "TRUNCATE"])
        expect({ t, p, ok: await has("service_role", p) }).toEqual({
          t,
          p,
          ok: false,
        });
      expect(
        (
          await h.owner<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [`public.${t}`],
          )
        )[0].rls,
      ).toBe(true);
      expect(
        (
          await h.owner(
            "SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=$1",
            [t],
          )
        ).length,
      ).toBe(0);
    }
  });

  test("every new function: a definer with search_path '' (the copy check excepted), and the ACL of its kind", async () => {
    const fns = await h.owner<{
      sig: string;
      name: string;
      definer: boolean;
      config: string[] | null;
    }>(`
      SELECT p.oid::regprocedure::text sig, p.proname name, p.prosecdef definer, p.proconfig config FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace
         AND (p.proname LIKE 'cockpit_upsell%' OR p.proname LIKE 'cockpit_csm_offer%' OR p.proname LIKE 'cockpit_client_site%' OR p.proname = 'cockpit_client_copy_problems')`);
    const browser = new Set([
      "cockpit_upsell_catalog_read",
      "cockpit_upsell_catalog_set",
      "cockpit_upsell_setting_set",
      "cockpit_upsell_object_allowed",
      "cockpit_upsell_file_reserve",
      "cockpit_upsell_file_accept",
      "cockpit_upsell_file_update",
      "cockpit_upsell_file_remove",
      "cockpit_upsell_files_read",
      "cockpit_upsell_files_stale",
      "cockpit_upsell_win_mark",
      "cockpit_client_site_check_record",
      "cockpit_csm_offer_gate",
      "cockpit_csm_offer_sources",
      "cockpit_csm_offer_status",
      "cockpit_upsell_pitch_save",
      "cockpit_upsell_pitches_read",
      "cockpit_upsell_pitch_log",
      "cockpit_upsell_pitch_video",
      "cockpit_upsell_proposal_create",
      "cockpit_upsell_proposal_save",
      "cockpit_upsell_proposal_send",
      "cockpit_upsell_proposal_update_link",
      "cockpit_upsell_proposal_mark",
      "cockpit_upsell_proposals_read",
      "cockpit_upsell_proposal_get",
      "cockpit_upsell_proposal_public",
      "cockpit_upsell_proposal_preview",
    ]);
    // The table CHECKs call these, so the service key runs them.
    const checks = new Set([
      "cockpit_upsell_usd_ok",
      "cockpit_upsell_parts_ok",
      "cockpit_upsell_split_ok",
      "cockpit_upsell_copy_text_ok",
      "cockpit_upsell_copy_ok",
      "cockpit_upsell_proposal_content_ok",
      "cockpit_upsell_price_ok",
    ]);
    const service = new Set([
      "cockpit_upsell_file_purged",
      "cockpit_upsell_door_open",
      "cockpit_upsell_door_event",
      "cockpit_upsell_door_video",
      "cockpit_upsell_door_status_set",
    ]);
    expect(fns.length).toBe(91);
    const seen = new Set<string>();
    for (const fn of fns) {
      seen.add(fn.name);
      expect({
        fn: fn.sig,
        path: fn.config?.includes('search_path=""'),
      }).toEqual({ fn: fn.sig, path: true });
      const can = async (role: string) =>
        (
          await h.owner<{ ok: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
            [role, fn.sig],
          )
        )[0].ok;
      const acl = [
        await can("anon"),
        await can("authenticated"),
        await can("service_role"),
      ];
      if (fn.name === "cockpit_client_copy_problems") {
        expect(fn.definer).toBe(false);
        expect(acl).toEqual([false, true, true]);
      } else {
        expect({ fn: fn.sig, definer: fn.definer }).toEqual({
          fn: fn.sig,
          definer: true,
        });
        expect({ fn: fn.sig, acl }).toEqual({
          fn: fn.sig,
          acl: browser.has(fn.name)
            ? [false, true, false]
            : service.has(fn.name) || checks.has(fn.name)
              ? [false, false, true]
              : [false, false, false],
        });
      }
    }
    for (const name of [...browser, ...service, ...checks])
      expect(seen.has(name)).toBe(true);
    const pub = await h.owner<{
      n: number;
    }>(`SELECT count(*)::int n FROM pg_proc p, aclexplode(p.proacl) a WHERE p.pronamespace='public'::regnamespace
      AND (p.proname LIKE 'cockpit_upsell%' OR p.proname LIKE 'cockpit_csm_offer%' OR p.proname LIKE 'cockpit_client_site%' OR p.proname='cockpit_client_copy_problems') AND a.grantee = 0`);
    expect(pub[0].n).toBe(0);
  });

  test("the service key's update passes the proposal's table checks and leaves an audit row", async () => {
    const d = (await create(CSM_A, A, "website", "en", uuid(160))).proposal;
    expect(
      await h.svc(
        "UPDATE public.cockpit_upsell_proposals SET status = 'archived' WHERE id = $1 RETURNING status r",
        [d.id],
      ),
    ).toBe("archived");
    expect((await h.audits("cockpit_upsell_proposals")).at(-1)).toMatchObject({
      action: "update",
      entity_id: d.id,
    });
  });

  test("each file applies again, in order, without an error and without a new seed", async () => {
    const counts = async () =>
      (
        await h.owner<{
          a: number;
          c: number;
          s: number;
        }>(`SELECT (SELECT count(*)::int FROM public.cockpit_audit_log) a,
      (SELECT count(*)::int FROM public.cockpit_upsell_catalog) c, (SELECT count(*)::int FROM public.cockpit_upsell_settings) s`)
      )[0];
    const before = await counts();
    for (const f of [UPSELL_FILES.u, UPSELL_FILES.v, UPSELL_FILES.w])
      await db.exec(migration(f));
    expect(await counts()).toEqual(before);
    expect(
      (
        await h.owner<{ title: string }>(
          "SELECT copy->'en'->>'deckTitle' title FROM public.cockpit_upsell_catalog WHERE offer_key='website'",
        )
      )[0].title,
    ).toBe("Your new website");
  });
});


describe("sent validity is separate from the editable draft", () => {
  test("draft date edits cannot change, close or reopen a sent page until Update link", async () => {
    const originalDate = await iso("public.cockpit_upsell_today() + 30");
    const nextDate = await iso("public.cockpit_upsell_today() + 14");
    const pastDate = await iso("public.cockpit_upsell_today() - 1");
    let draft = (await create(CSM_A, A, "website", "en", uuid(900))).proposal;
    const acknowledgements = (await get(CSM_A, draft.id)).warnings.map((w: Row) => w.key);
    await send(CSM_A, draft.id, draft.revision, acknowledgements);
    draft = await get(CSM_A, draft.id);
    expect(draft.sentContent.frozen.validUntil).toBe(originalDate);
    const card = async () => (await h.one(CSM_A, READ, [A])).rows.find((r: Row) => r.id === draft.id);

    draft = await save(CSM_A, draft.id, {valid_until: nextDate}, draft.revision);
    expect(draft.validUntil).toBe(nextDate);
    expect(draft.updatedAfterSend).toBe(true);
    expect((await open(draft.code)).proposal.validUntil).toBe(originalDate);
    expect((await card()).validUntil).toBe(originalDate);
    expect((await h.one(CSM_A, PUBLIC, [draft.id, null, null])).validUntil).toBe(nextDate);

    draft = await save(CSM_A, draft.id, {valid_until: pastDate}, draft.revision);
    expect((await open(draft.code)).state).toBe("open");
    expect((await get(CSM_A, draft.id)).expired).toBe(false);
    expect((await card()).expired).toBe(false);
    expect((await h.failure(CSM_A, UPDATE_LINK, [draft.id, draft.revision, acknowledgements])).code).toBe("22023");

    draft = await save(CSM_A, draft.id, {valid_until: nextDate}, draft.revision);
    await h.one(CSM_A, UPDATE_LINK, [draft.id, draft.revision, acknowledgements]);
    draft = await get(CSM_A, draft.id);
    expect(draft.sentContent.frozen.validUntil).toBe(nextDate);
    expect((await open(draft.code)).proposal.validUntil).toBe(nextDate);
    expect((await card()).validUntil).toBe(nextDate);
    expect(draft.updatedAfterSend).toBe(false);

    // Time has passed for the sent snapshot. Extending only the draft cannot reopen it.
    await h.owner("UPDATE public.cockpit_upsell_proposals SET sent_content=jsonb_set(sent_content, '{frozen,validUntil}', to_jsonb($2::text)) WHERE id=$1", [draft.id, pastDate]);
    draft = await save(CSM_A, draft.id, {valid_until: originalDate}, draft.revision);
    expect((await open(draft.code)).state).toBe("expired");
    expect((await get(CSM_A, draft.id)).expired).toBe(true);
    expect((await card()).expired).toBe(true);
    expect((await card()).validUntil).toBe(pastDate);
    await h.one(CSM_A, UPDATE_LINK, [draft.id, draft.revision, acknowledgements]);
    expect((await open(draft.code)).state).toBe("open");
    expect((await open(draft.code)).proposal.validUntil).toBe(originalDate);
  });
});


test("NULL entries cannot acknowledge a missing warning on send or Update link", async () => {
  const original = (await h.owner<{data: Row}>("SELECT data FROM public.cockpit_csm_sources WHERE table_name='clients' AND data->>'taskId'=$1", [A]))[0].data;
  await h.owner("UPDATE public.cockpit_csm_sources SET data=jsonb_set(data,'{pauseRequired}','true') WHERE table_name='clients' AND data->>'taskId'=$1", [A]);
  try {
    let draft = (await create(CSM_A, A, "website", "en", uuid(901))).proposal;
    const current = await get(CSM_A, draft.id);
    expect(current.warnings.some((w: Row) => w.key === 'pause_required')).toBe(true);
    const ack = current.warnings.map((w: Row) => w.key);
    for (const invalid of [[null], ['unrelated', null]]) {
      const error = await h.failure(CSM_A, SEND, [draft.id, draft.revision, 'copy', invalid]);
      expect(error.code).toBe('22023'); expect(error.message).toContain('Tick the warning first:');
      expect((await get(CSM_A, draft.id)).code).toBeNull();
    }
    await send(CSM_A, draft.id, draft.revision, ack);
    draft = await get(CSM_A, draft.id);
    for (const invalid of [[null], ['unrelated', null]]) {
      const error = await h.failure(CSM_A, UPDATE_LINK, [draft.id, draft.revision, invalid]);
      expect(error.code).toBe('22023'); expect(error.message).toContain('Tick the warning first:');
      expect((await get(CSM_A, draft.id)).revision).toBe(draft.revision);
    }
  } finally {
    await h.owner("UPDATE public.cockpit_csm_sources SET data=$2::jsonb WHERE table_name='clients' AND data->>'taskId'=$1", [A, JSON.stringify(original)]);
  }
});


test("published accepted and not-now proposals report the same expiry as their client page", async () => {
  let draft = (await create(CSM_A, A, "website", "en", uuid(902))).proposal;
  expect((await get(CSM_A, draft.id)).expired).toBe(false);
  const ack = (await get(CSM_A, draft.id)).warnings.map((w: Row) => w.key);
  await send(CSM_A, draft.id, draft.revision, ack);
  draft = await get(CSM_A, draft.id);
  await h.owner("UPDATE public.cockpit_upsell_proposals SET sent_content=jsonb_set(sent_content, '{frozen,validUntil}', to_jsonb(to_char(public.cockpit_upsell_today() - 1, 'YYYY-MM-DD'))) WHERE id=$1", [draft.id]);
  const followUp = await iso("public.cockpit_upsell_today() + 7");
  for (const status of ['accepted', 'not_now']) {
    draft = await h.one(CSM_A, MARK, [draft.id, status, status === 'not_now' ? 'We need more time.' : null, status === 'not_now' ? followUp : null, draft.revision]);
    const current = await get(CSM_A, draft.id);
    const card = (await h.one(CSM_A, READ, [A])).rows.find((r: Row) => r.id === draft.id);
    expect(current.status).toBe(status); expect(current.expired).toBe(true);
    expect(card.status).toBe(status); expect(card.expired).toBe(true);
    expect((await open(current.code)).state).toBe('expired');
  }
  await h.one(CSM_A, MARK, [draft.id, 'archived', null, null, draft.revision]);
  const archived = await get(CSM_A, draft.id);
  expect(archived.expired).toBe(false); expect((await open(archived.code)).state).toBe('archived');
});
