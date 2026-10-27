import { z } from "zod";

export const proposalContentSchema = z.object({
  v: z.literal(1),
  logo: z.object({ on: z.boolean(), adId: z.string().nullable() }),
  video: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("default") }),
    z.object({
      kind: z.literal("custom"),
      url: z.string(),
      posterUrl: z.string().nullable(),
      title: z.string().nullable(),
      checkedAt: z.string(),
    }),
  ]),
  found: z
    .array(z.object({ fileId: z.string(), caption: z.string().max(120) }))
    .max(3),
  why: z.object({
    trigger: z.string().nullable(),
    text: z.string().max(400),
    edited: z.boolean(),
  }),
  get: z.array(
    z.object({
      key: z.string(),
      text: z.string().max(200),
      hidden: z.boolean(),
      edited: z.boolean(),
    }),
  ),
  platforms: z
    .array(z.enum(["instagram", "tiktok", "snapchat", "facebook"]))
    .nullable(),
  steps: z.object({ text: z.string().max(400), edited: z.boolean() }),
  button: z.object({ text: z.string().max(40), edited: z.boolean() }),
  showCsm: z.boolean(),
});
export type ProposalContent = z.infer<typeof proposalContentSchema>;
export const priceSchema = z.object({
  parts: z.record(z.string(), z.number()),
  split: z.boolean(),
});
export type ProposalPrice = z.infer<typeof priceSchema>;
export type ProposalPatch = {
  content?: ProposalContent;
  lang?: "en" | "ar";
  price?: ProposalPrice;
  price_reason?: string | null;
  valid_until?: string;
};

/** An empty input stays absent. The server validates complete prices at send. */
export function withPrice(
  price: ProposalPrice,
  key: string,
  value: string,
): ProposalPrice {
  const parts = { ...price.parts };
  if (value.trim() === "") delete parts[key];
  else if (Number.isFinite(Number(value))) parts[key] = Number(value);
  return { ...price, parts };
}
