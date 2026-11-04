/** Real isolated SQL responses through the browser's production schemas. No live services. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import {
  SEATS,
  TASKS,
  upsellHelpers,
  upsellTestDb,
  uuid,
} from "../../media-buyer-cockpit/scripts/lib/upsellTestDb";
import {
  proposalCardSchema,
  proposalSchema,
  warningSchema,
} from "../src/pages/money/offers/proposal/proposalSources";
import {
  catalogRowSchema,
  catalogSchema,
  fileSchema,
  offerSourcesSchema,
  offerStatusSchema,
  pitchSchema,
} from "../src/present/offer/sources";

let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;
const { CSM_A, CEO } = SEATS;
const { A, C } = TASKS;
const SOURCE = "SELECT public.cockpit_csm_offer_sources($1,$2) r";
const STATUS = "SELECT public.cockpit_csm_offer_status($1) r";
const GET = "SELECT public.cockpit_upsell_proposal_get($1::uuid) r";
const CARDS = "SELECT public.cockpit_upsell_proposals_read($1) r";
function read<T>(name: string, shape: z.ZodType<T>, value: unknown): T {
  const result = shape.safeParse(value);
  if (!result.success)
    throw Error(
      `${name}: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return result.data;
}
const today = async () =>
  (
    await h.owner<{ today: string }>(
      "SELECT to_char(public.cockpit_upsell_today(),'YYYY-MM-DD') AS today",
    )
  )[0].today;
beforeAll(async () => {
  db = await upsellTestDb();
  h = upsellHelpers(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});

test("catalog with all seven offers accepts unset prices and optional settings", async () => {
  const catalog = read(
    "catalog",
    catalogSchema,
    await h.one(CEO, "SELECT public.cockpit_upsell_catalog_read() r"),
  );
  expect(catalog.rows).toHaveLength(7);
  expect(catalog.rows.every(r => r.parts.every(p => p.amount === null))).toBe(
    true,
  );
  expect(catalog.settings.whatsappNumber).toBeNull();
  expect(catalog.videos).toEqual([]);
});

test("refused and client-asked sources preserve nullable context and status", async () => {
  const refused = read(
    "refused sources",
    offerSourcesSchema,
    await h.one(CEO, SOURCE, [C, "website"]),
  );
  expect(refused.mode).toBe("refused");
  expect(refused.catalog).toBeNull();
  expect(refused.prep).toBeNull();
  expect(
    read("refused status", offerStatusSchema, await h.one(CEO, STATUS, [C]))
      .offers,
  ).toHaveLength(7);
  await h.one(
    CEO,
    "SELECT public.cockpit_csm_deck_prep_save($1,$2,$3::jsonb) r",
    [
      C,
      "offer_website",
      JSON.stringify({
        client_asked: {
          words: "Please show us a website option.",
          on: await today(),
        },
      }),
    ],
  );
  const asked = read(
    "client-asked sources",
    offerSourcesSchema,
    await h.one(CEO, SOURCE, [C, "website"]),
  );
  expect(asked.mode).toBe("client_asked");
  expect(asked.catalog?.offerKey).toBe("website");
  expect(asked.prep?.overrides.client_asked).toBeDefined();
});

test("fully prepared sources and status accept real captures including absent filenames", async () => {
  const catalog = read(
    "catalog",
    catalogSchema,
    await h.one(CEO, "SELECT public.cockpit_upsell_catalog_read() r"),
  );
  const website = catalog.rows.find(r => r.offerKey === "website")!;
  const price = read(
    "catalog update",
    catalogRowSchema,
    await h.one(
      CEO,
      "SELECT public.cockpit_upsell_catalog_set($1,$2::jsonb,$3) r",
      [
        "website",
        JSON.stringify({
          parts: [
            { key: "build", amount: 2000 },
            { key: "care", amount: 200 },
          ],
        }),
        website.revision,
      ],
    ),
  );
  expect(price.parts[0].amount).toBe(2000);
  const capture = await h.capture(CSM_A, A, uuid(6000));
  await h.owner(
    "UPDATE public.cockpit_upsell_files SET file_name=NULL WHERE id=$1",
    [capture.id],
  );
  await h.one(
    CSM_A,
    "SELECT public.cockpit_csm_deck_prep_save($1,$2,$3::jsonb) r",
    [
      A,
      "offer_website",
      JSON.stringify({
        site_thin: true,
        opening_price: { build: 2000, care: 200 },
        payment_link: "https://whop.com/checkout/plan_example/",
        captures: [{ id: capture.id }],
      }),
    ],
  );
  const raw = await h.one(CSM_A, SOURCE, [A, "website"]);
  expect(raw.files[0].fileName).toBeNull();
  read("capture", fileSchema, raw.files[0]);
  const source = read("prepared sources", offerSourcesSchema, raw);
  expect(source.mode).toBe("proactive");
  expect(source.files).toHaveLength(1);
  expect(source.goals.goal90?.answer).toBeTruthy();
  const status = read(
    "prepared status",
    offerStatusSchema,
    await h.one(CSM_A, STATUS, [A]),
  );
  expect(status.offers.find(o => o.key === "website")?.ready).toEqual({
    ok: true,
    missing: [],
  });
});

test("pitch response, reopened sources and last-pitch status use the same browser shapes", async () => {
  const pitch = read(
    "pitch save",
    pitchSchema,
    await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_pitch_save($1,$2,$3::uuid,$4::jsonb,$5) r",
      [A, "website", uuid(6001), JSON.stringify({ held_full: true }), null],
    ),
  );
  expect(pitch.answer).toBeNull();
  expect(pitch.finalPrice).toBeNull();
  expect(pitch.heldFull).toBe(true);
  const source = read(
    "sources with pitch",
    offerSourcesSchema,
    await h.one(CSM_A, SOURCE, [A, "website"]),
  );
  expect(source.pitches[0].id).toBe(pitch.id);
  expect(source.heldFullRecently).toBe(true);
  const status = read(
    "status with pitch",
    offerStatusSchema,
    await h.one(CSM_A, STATUS, [A]),
  );
  expect(
    status.offers.find(o => o.key === "website")?.lastPitch?.answer,
  ).toBeNull();
});

test("proposal create, draft, save, sent and cards match the real browser schemas", async () => {
  const created = read(
    "proposal create",
    z.object({ proposal: proposalSchema, warnings: z.array(warningSchema) }),
    await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_proposal_create($1,$2,$3,$4::uuid) r",
      [A, "website", "en", uuid(6002)],
    ),
  );
  let proposal = read(
    "draft get",
    proposalSchema,
    await h.one(CSM_A, GET, [created.proposal.id]),
  );
  const cardsShape = z.object({ rows: z.array(proposalCardSchema) });
  expect(
    read("draft cards", cardsShape, await h.one(CSM_A, CARDS, [A])).rows[0]
      .opened,
  ).toBeNull();
  const content = {
    ...proposal.content,
    video: {
      kind: "custom",
      url: "https://www.youtube.com/watch?v=ABCDEFGHIJK",
      posterUrl: null,
      title: "Example website",
      checkedAt: new Date().toISOString(),
    },
  };
  proposal = read(
    "saved draft",
    proposalSchema,
    await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_proposal_save($1::uuid,$2::jsonb,$3) r",
      [proposal.id, JSON.stringify({ content }), proposal.revision],
    ),
  );
  await h.one(
    CEO,
    "SELECT public.cockpit_upsell_setting_set('whatsapp_number','96550000000') r",
  );
  proposal = read(
    "ready get",
    proposalSchema,
    await h.one(CSM_A, GET, [proposal.id]),
  );
  await h.one(
    CSM_A,
    "SELECT public.cockpit_upsell_proposal_send($1::uuid,$2,$3,$4::text[]) r",
    [
      proposal.id,
      proposal.revision,
      "copy",
      (proposal.warnings ?? []).map(w => w.key),
    ],
  );
  const sent = read(
    "sent get",
    proposalSchema,
    await h.one(CSM_A, GET, [proposal.id]),
  );
  expect(sent.status).toBe("link_copied");
  expect(sent.code).toHaveLength(12);
  expect(sent.videoReady).toBe(false);
  const card = read(
    "sent cards",
    cardsShape,
    await h.one(CSM_A, CARDS, [A]),
  ).rows.find(r => r.id === proposal.id)!;
  expect(card.opened).toMatchObject({
    devices: 0,
    visits: 0,
    played: 0,
    pressedYes: 0,
    known: false,
  });
});
