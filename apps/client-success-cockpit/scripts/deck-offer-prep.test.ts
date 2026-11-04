import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { offerLoaded } from "../src/dev/offer/fixtures";
import { OFFER_PREP_KEYS } from "../src/present/offer/prepKeys";
import {
  checkVideo,
  fileSchema,
  type OfferClient,
  uploadUpsellFile,
} from "../src/present/offer/sources";
import {
  confirmOfferPrep,
  sameOfferPrepValue,
} from "../src/present/offer/useOffer";
import { refusedKey } from "../src/present/prep";

const sql = readFileSync(
  new URL(
    "../../../supabase/migrations/20261026v_upsell_offer_decks.sql",
    import.meta.url,
  ),
  "utf8",
);
test("all offer prep keys have a server boundary", () => {
  expect(new Set(OFFER_PREP_KEYS).size).toBe(OFFER_PREP_KEYS.length);
  const addition = readFileSync(
    new URL(
      "../../../supabase/migrations/20261027115820_offer_presentations_readiness.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const key of OFFER_PREP_KEYS)
    expect(key === "recruiter_name" ? addition : sql).toContain(`'${key}'`);
});
test("video refusal preserves the exact server sentence with null fields", async () => {
  const client = {
    functions: {
      invoke: async () => ({
        data: {
          ok: false,
          provider: null,
          url: null,
          embedUrl: null,
          refusal: "This video asks viewers to sign in.",
        },
        error: null,
      }),
    },
  } as unknown as OfferClient;
  expect(
    await checkVideo(client, "https://example.test/private"),
  ).toMatchObject({
    ok: false,
    refusal: "This video asks viewers to sign in.",
  });
});
test("a ready upload retry does not PUT or accept twice", async () => {
  const before = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () =>
    ({ width: 100, height: 100, close() {} }) as ImageBitmap;
  const ops: string[] = [];
  const file = {
    id: "x",
    kind: "capture",
    mime: "image/png",
    bytes: 1,
    width: 100,
    height: 100,
    fileName: "capture.png",
    searchedAs: null,
    capturedOn: "2026-10-26",
    caption: null,
    createdAt: "2026-10-26",
    path: "fixture/x.png",
    url: "https://example.test/capture.png",
  };
  const client = {
    functions: {
      invoke: async (_name: string, args: { body: { operation: string } }) => {
        ops.push(args.body.operation);
        return {
          data:
            args.body.operation === "upsellFiles.reserve"
              ? {
                  id: "x",
                  path: file.path,
                  status: "ready",
                  token: null,
                  uploadUrl: null,
                }
              : { rows: [file] },
          error: null,
        };
      },
    },
    storage: {
      from: () => {
        throw Error("Unexpected upload PUT");
      },
    },
  } as unknown as OfferClient;
  try {
    expect(
      (
        await uploadUpsellFile(
          client,
          "fixture",
          new File(["x"], "capture.png", { type: "image/png" }),
          "2026-10-26",
          "",
          "request",
        )
      ).id,
    ).toBe("x");
    expect(ops).toEqual(["upsellFiles.reserve", "upsellFiles.list"]);
  } finally {
    globalThis.createImageBitmap = before;
  }
});

test("offer keys stay isolated from the existing decks", () => {
  expect(refusedKey("opening_price", "offer_website")).toBeNull();
  expect(refusedKey("opening_price", "launch")).not.toBeNull();
  expect(refusedKey("budget_band", "offer_website")).not.toBeNull();
  expect(refusedKey("budget_band", "onboarding")).toBeNull();
});

test("offer prep registry exactly matches the server CASE", () => {
  const body = sql
    .split("CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_prep_value")[1]
    .split("END $$;")[0];
  const keys = [
    ...body.matchAll(/^ {2}WHEN ((?:'[a-z_]+'(?:, )?)+) THEN/gm),
  ].flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(v => v[1]));
  expect(
    [...OFFER_PREP_KEYS].filter(k => k !== "recruiter_name").sort(),
  ).toEqual(keys.sort());
  const addition = readFileSync(
    new URL(
      "../../../supabase/migrations/20261027115820_offer_presentations_readiness.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(addition).toContain("recruiter_name");
  expect(OFFER_PREP_KEYS).toContain("recruiter_name");
});

test("prep confirmation accepts JSONB key order but refuses a stale price", () => {
  expect(
    sameOfferPrepValue({ build: 2000, care: 200 }, { care: 200, build: 2000 }),
  ).toBe(true);
  expect(
    sameOfferPrepValue({ build: 1800, care: 200 }, { care: 200, build: 2000 }),
  ).toBe(false);
  expect(sameOfferPrepValue(" Existing assets ", "Existing assets")).toBe(true);
});

test("reserved captures can have a null file name without losing the file", () => {
  const row = {
    id: "capture",
    kind: "capture",
    mime: "image/png",
    bytes: 1024,
    width: 100,
    height: 100,
    fileName: null,
    searchedAs: null,
    capturedOn: "2026-10-26",
    caption: null,
    createdAt: "2026-10-26T12:00:00Z",
    path: "fixture/capture.png",
    url: null,
  };
  expect(fileSchema.parse(row).fileName).toBe("Capture");
  expect(
    fileSchema.parse({ ...row, fileName: "  Client website  " }).fileName,
  ).toBe("Client website");
});

test("Arabic pitch prep persists the presented language before flush and readback", async () => {
  const s = offerLoaded("full").offer!;
  const prep = structuredClone(s.prep!.overrides);
  const calls: string[] = [];
  await confirmOfferPrep(
    prep,
    "ar",
    (deck, patch) => {
      calls.push(`save:${deck}:${patch.language}`);
      Object.assign(s.prep!.overrides, patch);
    },
    async () => {
      calls.push("flush");
    },
    async () => {
      calls.push("read");
      return s;
    },
  );
  expect(calls).toEqual(["save:offer_website:ar", "flush", "read"]);
  expect(s.prep!.overrides.language).toBe("ar");
});
test("an unconfirmed language save stops pitch recording", async () => {
  const s = offerLoaded("full").offer!;
  s.prep!.overrides.language = "en";
  const prep = structuredClone(s.prep!.overrides);
  await expect(
    confirmOfferPrep(
      prep,
      "ar",
      () => {},
      async () => {},
      async () => s,
    ),
  ).rejects.toThrow("The latest prep has not saved");
});
