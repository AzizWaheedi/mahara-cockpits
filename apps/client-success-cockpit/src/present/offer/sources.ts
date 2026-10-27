import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { launchAdSchema, problem } from "../sources";
import { OFFER_KEYS, type OfferKey } from "./kinds";
export type OfferClient = Pick<
  SupabaseClient,
  "rpc" | "functions" | "storage" | "auth"
>;
const nullableText = z.string().nullable();
export const pricesSchema = z.record(z.string(), z.number().positive());
const copyItem = z.object({ key: z.string(), text: z.string() });
export const catalogCopySchema = z.object({
  name: z.string(),
  deckTitle: z.string(),
  line: z.string(),
  parts: z.record(z.string(), z.string()),
  terms: z.string(),
  timing: z.string(),
  get: z.array(copyItem),
  need: z.array(copyItem),
  steps: z.array(copyItem),
  why: z.array(
    z.object({ key: z.string(), label: z.string(), text: z.string() }),
  ),
  button: z.string(),
  cta: z.string(),
  close: z.string(),
  work: z.array(
    z.object({ key: z.string(), label: z.string(), url: z.string() }),
  ),
  platforms: z.record(z.string(), z.string()).optional(),
});
export const catalogRowSchema = z.object({
  offerKey: z.enum(OFFER_KEYS),
  sort: z.number(),
  parts: z.array(
    z.object({
      key: z.string(),
      cadence: z.enum(["one_time", "monthly", "per_day", "per_90_days"]),
      amount: z.number().nullable(),
      hint: z.number(),
    }),
  ),
  locked: z.boolean(),
  splitAllowed: z.boolean(),
  splitParts: z.array(z.number()).nullable(),
  minMonths: z.number().nullable(),
  waitsOn: nullableText,
  copy: z
    .object({ en: catalogCopySchema, ar: catalogCopySchema })
    .or(z.object({}).strict()),
  revision: z.number().int(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type CatalogRow = z.infer<typeof catalogRowSchema>;
export type CatalogCopy = z.infer<typeof catalogCopySchema>;
export const copyOf = (
  row: CatalogRow,
  lang: "en" | "ar",
): CatalogCopy | null => ("en" in row.copy ? row.copy[lang] : null);
export const catalogSchema = z.object({
  rows: z.array(catalogRowSchema),
  settings: z.object({
    whatsappNumber: nullableText,
    validDays: z.number(),
    doorLive: z.boolean(),
  }),
  videos: z.array(z.record(z.string(), z.unknown())),
  isCeo: z.boolean(),
  at: z.string(),
});
export type Catalog = z.infer<typeof catalogSchema>;
const reason = z.object({
  key: z.string(),
  text: z.string(),
  source: z.string().nullable().optional(),
  at: z.string().nullable().optional(),
});
export const gateSchema = z.object({
  ok: z.boolean(),
  taskId: z.string(),
  checkedAt: z.string(),
  reasons: z.array(reason),
  passed: z.array(reason),
  win: z.object({
    kind: z.enum(["quotation", "signed", "csm_tick"]).nullable(),
    on: nullableText,
    text: nullableText,
  }),
  renewal: z.object({ date: nullableText, from: nullableText }),
  lastOffer: z
    .object({ kind: z.string(), offer: z.string(), on: z.string() })
    .nullable(),
});
export type Gate = z.infer<typeof gateSchema>;
export const fileSchema = z.object({
  id: z.string(),
  kind: z.literal("capture"),
  mime: z.string(),
  bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fileName: z
    .string()
    .nullable()
    .transform(value => value?.trim() || "Capture"),
  searchedAs: nullableText,
  capturedOn: z.string(),
  caption: nullableText,
  createdAt: z.string(),
  path: z.string(),
  url: z.string().nullable().optional(),
});
export type UpsellFile = z.infer<typeof fileSchema>;
export const pitchSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  taskId: z.string(),
  offerKey: z.enum(OFFER_KEYS),
  pitchedOn: z.string(),
  csm: z.string(),
  mode: z.enum(["proactive", "client_asked"]),
  clientWords: nullableText,
  clientAskedOn: nullableText,
  gate: z.unknown(),
  listPrice: z.record(z.string(), z.number().nullable()),
  openingPrice: pricesSchema.nullable(),
  openingReason: nullableText,
  heldFull: z.boolean(),
  finalPrice: pricesSchema.nullable(),
  finalReason: nullableText,
  split: z.boolean(),
  answer: z.enum(["yes_paid", "yes_unpaid", "not_now", "no"]).nullable(),
  followUpOn: nullableText,
  noReason: nullableText,
  paymentLink: nullableText,
  lang: z.enum(["en", "ar"]),
  videoCode: z.string(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
  videoUrl: nullableText.optional(),
});
export type Pitch = z.infer<typeof pitchSchema>;
const answer = z
  .object({ answer: z.string(), answeredOn: nullableText })
  .nullable();
export const offerSourcesSchema = z.object({
  mode: z.enum(["proactive", "client_asked", "refused"]),
  gate: gateSchema,
  catalog: catalogRowSchema.nullable(),
  prep: z
    .object({
      overrides: z.record(z.string(), z.unknown()),
      revision: z.number(),
      updatedAt: z.string(),
      updatedBy: z.string(),
    })
    .nullable(),
  priceProblem: nullableText.optional(),
  files: z.array(fileSchema),
  site: z.object({
    verdict: z.enum(["none_on_file", "not_checked", "ok", "failing", "broken"]),
    urls: z.array(z.object({ url: z.string(), from: z.string() })),
    checks: z.array(z.record(z.string(), z.unknown())),
    disagree: z.boolean(),
    instagramOnly: z.boolean(),
    note: z.string().nullable(),
  }),
  project: z.object({
    onboarding: answer,
    sheet: z
      .object({
        usd: z.number(),
        closes: z.number(),
        from: z.string(),
        window: z.string(),
      })
      .nullable(),
  }),
  goals: z.object({
    goal90: answer,
    goal12_24: answer,
    challenges: answer,
    why: answer,
  }),
  country: nullableText,
  currency: z.string(),
  fx: z.object({
    usdPer: z.number().nullable(),
    from: z.string(),
    note: nullableText.optional(),
  }),
  pitches: z.array(pitchSchema),
  heldFullRecently: z.boolean(),
  doorLive: z.boolean(),
  at: z.string(),
});
export type OfferSources = z.infer<typeof offerSourcesSchema>;
export const offerStatusSchema = z.object({
  gate: z.object({ ok: z.boolean(), reasons: z.array(reason) }),
  thisMonth: z.enum(OFFER_KEYS).nullable(),
  thisMonthWhy: nullableText,
  offers: z.array(
    z.object({
      key: z.enum(OFFER_KEYS),
      fit: z.object({ ok: z.boolean().nullable(), why: z.string() }),
      ready: z.object({
        ok: z.boolean(),
        missing: z.array(
          z.enum(["no_capture", "capture_old", "no_price", "no_payment_link"]),
        ),
      }),
      waitsOn: nullableText,
      lastPitch: z
        .object({ on: z.string(), answer: nullableText, mode: z.string() })
        .nullable(),
    }),
  ),
});
export type OfferStatus = z.infer<typeof offerStatusSchema>;
export async function offerRpc<T>(
  client: Pick<SupabaseClient, "rpc">,
  name: string,
  args: Record<string, unknown>,
  shape: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw Error(problem(error, "Try again."));
  const parsed = shape.safeParse(data);
  if (!parsed.success)
    throw Error(
      "The offer's answer could not be read. Refresh before making changes.",
    );
  return parsed.data;
}
export async function offerEdge<T>(
  client: OfferClient,
  operation: string,
  args: Record<string, unknown>,
  shape: z.ZodType<T>,
  requestId?: string,
): Promise<T> {
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: { operation, args, ...(requestId ? { requestId } : {}) },
  });
  if (error) {
    let message = "";
    try {
      const ctx = (error as { context?: Response }).context;
      message = ctx ? ((await ctx.clone().json()).error ?? "") : "";
    } catch {}
    throw Error(
      message || problem(error, "The server did not answer. Try again."),
    );
  }
  const out = shape.safeParse(data);
  if (!out.success)
    throw Error("The offer's answer could not be read. Try again.");
  return out.data;
}
export const readCatalog = (c: OfferClient) =>
  offerRpc(c, "cockpit_upsell_catalog_read", {}, catalogSchema);
export const saveCatalog = (
  c: OfferClient,
  offer: OfferKey,
  patch: Record<string, unknown>,
  revision: number,
) =>
  offerRpc(
    c,
    "cockpit_upsell_catalog_set",
    { p_offer: offer, p_patch: patch, p_base_revision: revision },
    catalogRowSchema,
  );
export const saveSetting = (c: OfferClient, key: string, value: string) =>
  offerRpc(
    c,
    "cockpit_upsell_setting_set",
    { p_key: key, p_value: value },
    z.unknown(),
  );
export const readOfferSources = (
  c: OfferClient,
  taskId: string,
  offer: OfferKey,
) =>
  offerRpc(
    c,
    "cockpit_csm_offer_sources",
    { p_task_id: taskId, p_offer: offer },
    offerSourcesSchema,
  );
export const readOfferStatus = (c: OfferClient, taskId: string) =>
  offerRpc(
    c,
    "cockpit_csm_offer_status",
    { p_task_id: taskId },
    offerStatusSchema,
  );
export const savePitch = (
  c: OfferClient,
  taskId: string,
  offer: OfferKey,
  requestId: string,
  patch: Record<string, unknown>,
  revision: number | null,
) =>
  offerRpc(
    c,
    "cockpit_upsell_pitch_save",
    {
      p_task_id: taskId,
      p_offer: offer,
      p_request_id: requestId,
      p_patch: patch,
      p_base_revision: revision,
    },
    pitchSchema,
  );
export const readPitchLog = (c: OfferClient, month: string) =>
  offerRpc(
    c,
    "cockpit_upsell_pitch_log",
    { p_month: month },
    z.object({
      month: z.string(),
      rows: z.array(
        z.object({
          id: z.string(),
          taskId: z.string(),
          clientName: z.string(),
          offerKey: z.enum(OFFER_KEYS),
          pitchedOn: z.string(),
          csm: z.string(),
          mode: z.string(),
          listPrice: z.record(z.string(), z.number().nullable()),
          openingPrice: pricesSchema.nullable(),
          openingReason: nullableText,
          finalPrice: pricesSchema.nullable(),
          finalReason: nullableText,
          answer: nullableText,
          followUpOn: nullableText,
        }),
      ),
    }),
  );
export const pitchVideo = (c: OfferClient, id: string) =>
  offerRpc(
    c,
    "cockpit_upsell_pitch_video",
    { p_id: id },
    z.object({
      url: nullableText,
      counted: z.boolean(),
      note: nullableText.optional(),
    }),
  );
export const markWin = (
  c: OfferClient,
  taskId: string,
  text: string,
  on: string,
) =>
  offerRpc(
    c,
    "cockpit_upsell_win_mark",
    { p_task_id: taskId, p_text: text, p_won_on: on },
    z.unknown(),
  );
export const listUpsellFiles = (c: OfferClient, taskId: string) =>
  offerEdge(
    c,
    "upsellFiles.list",
    { taskId },
    z.object({ rows: z.array(fileSchema) }),
  );
export const updateUpsellFile = (
  c: OfferClient,
  taskId: string,
  id: string,
  patch: Record<string, unknown>,
) =>
  offerRpc(
    c,
    "cockpit_upsell_file_update",
    { p_task_id: taskId, p_id: id, p_patch: patch },
    z.unknown(),
  );
export const removeUpsellFile = (c: OfferClient, taskId: string, id: string) =>
  offerEdge(c, "upsellFiles.remove", { taskId, id }, z.unknown());
export const runSiteCheck = (c: OfferClient, taskId: string, url?: string) =>
  offerEdge(
    c,
    "upsell.siteCheck",
    { taskId, ...(url ? { url } : {}) },
    z.object({
      checks: z.array(z.unknown()),
      verdict: z.unknown(),
      logoCandidates: z.array(z.unknown()),
    }),
  );
export const checkVideo = (c: OfferClient, url: string) =>
  offerEdge(
    c,
    "upsell.videoCheck",
    { url },
    z.object({
      ok: z.boolean(),
      refusal: z.string().optional(),
      provider: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      embedUrl: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      posterUrl: z.string().nullable().optional(),
      durationSeconds: z.number().nullable().optional(),
    }),
  );
export const findLogos = (c: OfferClient, taskId: string) =>
  offerEdge(
    c,
    "upsell.logoFind",
    { taskId },
    z.object({
      candidates: z.array(
        z.object({
          source: z.enum(["verified", "upload", "site"]),
          url: z.string(),
          adId: z.string().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
      note: z.string().nullable().optional(),
    }),
  );
export const pickLogo = (
  c: OfferClient,
  taskId: string,
  url: string,
  requestId: string,
) =>
  offerEdge(c, "upsell.logoPick", { taskId, url }, launchAdSchema, requestId);
export async function uploadUpsellFile(
  c: OfferClient,
  taskId: string,
  file: File,
  capturedOn: string,
  searchedAs: string,
  requestId: string,
): Promise<UpsellFile> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10485760
  )
    throw Error("Choose a PNG, JPEG or WebP capture under 10 MB.");
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width,
    height = bitmap.height;
  bitmap.close();
  const row = await offerEdge(
    c,
    "upsellFiles.reserve",
    {
      taskId,
      kind: "capture",
      mime: file.type,
      bytes: file.size,
      width,
      height,
      fileName: file.name,
      capturedOn,
      searchedAs: searchedAs || undefined,
    },
    z.object({
      id: z.string(),
      path: z.string(),
      status: z.string(),
      uploaded: z.boolean().optional(),
      uploadUrl: z.string().nullable(),
      token: z.string().nullable(),
    }),
    requestId,
  );
  if (row.status !== "ready" && !row.uploaded) {
    if (!row.token)
      throw Error("The upload link expired. Try this capture again.");
    const { error } = await c.storage
      .from("cockpit-upsell-files")
      .uploadToSignedUrl(row.path, row.token, file, { contentType: file.type });
    if (error)
      throw Error(problem(error, "The capture did not upload. Try again."));
  }
  if (row.status !== "ready")
    await offerEdge(
      c,
      "upsellFiles.ready",
      { taskId, id: row.id },
      z.unknown(),
    );
  const list = await listUpsellFiles(c, taskId);
  const accepted = list.rows.find(f => f.id === row.id);
  if (!accepted)
    throw Error(
      "The capture was uploaded but is not ready. Refresh the files before trying again.",
    );
  return accepted;
}
