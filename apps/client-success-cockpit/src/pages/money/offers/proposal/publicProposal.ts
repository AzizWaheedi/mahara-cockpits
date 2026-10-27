import { z } from "zod";
import { OFFER_KEYS } from "../../../../present/offer/kinds";

const picture = z.object({
  bucket: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
});
export const publicProposalSchema = z.object({
  lang: z.enum(["en", "ar"]),
  offer: z.enum(OFFER_KEYS),
  title: z.string(),
  clientName: z.string(),
  logo: picture.extend({ alt: z.string() }).nullable(),
  csmFirstName: z.string().nullable(),
  date: z.string(),
  validUntil: z.string(),
  video: z
    .object({
      provider: z.string(),
      embedUrl: z.string(),
      posterUrl: z.string().nullable(),
      title: z.string().nullable(),
    })
    .nullable(),
  found: z.array(
    picture.extend({
      caption: z.string(),
      capturedOn: z.string(),
      searchedAs: z.string().nullable(),
    }),
  ),
  why: z.string().nullable(),
  get: z.array(z.string()),
  platforms: z.array(z.string()).nullable(),
  work: z.array(z.object({ label: z.string(), url: z.string() })),
  steps: z.string().nullable(),
  timing: z.string().nullable(),
  investment: z.object({
    parts: z.array(
      z.object({
        label: z.string(),
        amountUsd: z.number(),
        cadence: z.string(),
      }),
    ),
    terms: z.string(),
    split: z.array(z.number()).nullable(),
  }),
  button: z.object({ text: z.string(), whatsapp: z.string().nullable() }),
});
export type PublicProposal = z.infer<typeof publicProposalSchema>;

/** Explicit public allowlist. Zod strips unknown keys at every object level. */
export function publicProposal(value: unknown): PublicProposal {
  return publicProposalSchema.parse(value);
}
