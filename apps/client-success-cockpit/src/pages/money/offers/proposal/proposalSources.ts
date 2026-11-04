import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { OFFER_KEYS, type OfferKey } from "@/present/offer/kinds";
import {
  type CatalogRow,
  listUpsellFiles,
  readCatalog,
  type UpsellFile,
} from "@/present/offer/sources";
import { type LaunchAd, listLaunchAds } from "@/present/sources";
import {
  type ProposalPatch,
  priceSchema,
  proposalContentSchema,
} from "./proposalContent";
import { type PublicProposal, publicProposal } from "./publicProposal";

const nullableText = z.string().nullable();
export const issueSchema = z.object({
  field: z.string(),
  rule: z.string(),
  text: z.string(),
  block: z.boolean(),
});
export const warningSchema = z.object({ key: z.string(), text: z.string() });
export const proposalSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  taskId: z.string(),
  clientName: z.string(),
  offerKey: z.enum(OFFER_KEYS),
  lang: z.enum(["en", "ar"]),
  content: proposalContentSchema,
  price: priceSchema,
  priceReason: nullableText,
  listPrice: z.record(z.string(), z.number().nullable()),
  validUntil: z.string(),
  code: nullableText,
  url: nullableText,
  status: z.enum([
    "draft",
    "sent",
    "link_copied",
    "accepted",
    "not_now",
    "archived",
  ]),
  expired: z.boolean(),
  sentAt: nullableText,
  updatedAfterSend: z.boolean(),
  revision: z.number().int(),
  objection: nullableText,
  followUpOn: nullableText,
  warningsPassed: z.array(z.string()),
  updatedAt: z.string(),
  warnings: z.array(warningSchema).optional(),
  problems: z.array(issueSchema).optional(),
  heldFull: z.boolean().optional(),
  videoReady: z.boolean().optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export type ProposalIssue = z.infer<typeof issueSchema>;
export const proposalCardSchema = z.object({
  id: z.string(),
  offerKey: z.enum(OFFER_KEYS),
  lang: z.enum(["en", "ar"]),
  status: z.string(),
  opened: z
    .object({
      devices: z.number(),
      visits: z.number(),
      lastAt: nullableText,
      played: z.number(),
      pressedYes: z.number(),
      known: z.boolean(),
    })
    .nullable(),
  expired: z.boolean(),
  updatedAfterSend: z.boolean(),
  sentAt: nullableText,
  validUntil: z.string(),
  code: nullableText,
  revision: z.number(),
  updatedAt: z.string(),
});
export type ProposalCardRow = z.infer<typeof proposalCardSchema>;
export class ProposalError extends Error {
  code: string;
  issues: ProposalIssue[];
  constructor(message: string, code = "", issues: ProposalIssue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}
export async function proposalRpc<T>(
  client: Pick<SupabaseClient, "rpc">,
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    let issues: ProposalIssue[] = [];
    try {
      issues = z.array(issueSchema).parse(JSON.parse(error.details || "[]"));
    } catch {
      /* Some errors have no field list. */
    }
    throw new ProposalError(
      error.message || "The proposal did not save. Try again.",
      error.code,
      issues,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ProposalError(
      "The proposal response could not be read. Refresh before changing it.",
    );
  return parsed.data;
}
export type ProposalBundle = {
  proposal: Proposal;
  catalog: CatalogRow;
  files: UpsellFile[];
  logos: LaunchAd[];
};
export const getProposal = (c: SupabaseClient, id: string) =>
  proposalRpc(c, "cockpit_upsell_proposal_get", { p_id: id }, proposalSchema);
export const createProposal = (
  c: SupabaseClient,
  taskId: string,
  offer: OfferKey,
  lang: "en" | "ar",
  requestId: string,
) =>
  proposalRpc(
    c,
    "cockpit_upsell_proposal_create",
    {
      p_task_id: taskId,
      p_offer: offer,
      p_lang: lang,
      p_request_id: requestId,
    },
    z.object({ proposal: proposalSchema, warnings: z.array(warningSchema) }),
  );
export const readProposals = (c: SupabaseClient, taskId: string) =>
  proposalRpc(
    c,
    "cockpit_upsell_proposals_read",
    { p_task_id: taskId },
    z.object({ rows: z.array(proposalCardSchema) }),
  );
export async function loadProposal(
  c: SupabaseClient,
  id: string,
  taskId?: string,
): Promise<ProposalBundle> {
  const proposal = await getProposal(c, id);
  if (taskId && proposal.taskId !== taskId)
    throw new ProposalError(
      "This proposal belongs to another client. Open it from that client's profile.",
    );
  const [catalog, files, ads] = await Promise.all([
    readCatalog(c),
    listUpsellFiles(c, proposal.taskId),
    listLaunchAds(c, proposal.taskId),
  ]);
  const row = catalog.rows.find(x => x.offerKey === proposal.offerKey);
  if (!row)
    throw new ProposalError(
      "This offer is not in the catalog. Reload the page.",
    );
  return {
    proposal,
    catalog: row,
    files: files.rows,
    logos: ads.filter(x => x.kind === "logo" && x.status === "ready"),
  };
}
export const saveProposal = (
  c: SupabaseClient,
  id: string,
  patch: ProposalPatch,
  revision: number,
) =>
  proposalRpc(
    c,
    "cockpit_upsell_proposal_save",
    { p_id: id, p_patch: patch, p_base_revision: revision },
    proposalSchema,
  );
const sentSchema = z.object({
  code: z.string(),
  url: z.string().url(),
  status: z.string(),
  revision: z.number(),
  problems: z.array(issueSchema),
});
export const sendProposal = (
  c: SupabaseClient,
  id: string,
  revision: number,
  ack: string[],
  update = false,
) =>
  proposalRpc(
    c,
    update
      ? "cockpit_upsell_proposal_update_link"
      : "cockpit_upsell_proposal_send",
    {
      p_id: id,
      p_base_revision: revision,
      p_ack: ack,
      ...(update ? {} : { p_via: "copy" }),
    },
    sentSchema,
  );
export const markProposal = (
  c: SupabaseClient,
  id: string,
  revision: number,
  status: "accepted" | "not_now" | "archived",
  objection: string | null,
  followUpOn: string | null,
) =>
  proposalRpc(
    c,
    "cockpit_upsell_proposal_mark",
    {
      p_id: id,
      p_base_revision: revision,
      p_status: status,
      p_objection: objection,
      p_follow_up_on: followUpOn,
    },
    proposalSchema,
  );
export const previewProposalLink = (c: SupabaseClient, id: string) =>
  proposalRpc(
    c,
    "cockpit_upsell_proposal_preview",
    { p_id: id },
    z.object({ url: z.string().url(), until: z.string() }),
  );
export async function readPublicProposal(
  c: SupabaseClient,
  proposal: Proposal,
): Promise<PublicProposal> {
  const raw = await proposalRpc(
    c,
    "cockpit_upsell_proposal_public",
    { p_id: proposal.id, p_content: proposal.content, p_price: proposal.price },
    z.unknown(),
  );
  const p = publicProposal(raw);
  const signed = async (
    item: { bucket?: string; path?: string; url?: string },
    kind: "logo" | "capture",
  ): Promise<string> => {
    try {
      let url = item.url;
      if (item.bucket && item.path) {
        if (item.bucket === "cockpit-client-logos") {
          url = c.storage.from(item.bucket).getPublicUrl(item.path)
            .data.publicUrl;
        } else {
          const { data, error } = await c.storage
            .from(item.bucket)
            .createSignedUrl(item.path, 600);
          if (error) throw error;
          url = data?.signedUrl;
        }
      }
      if (!url) throw Error("Image unavailable");
      return url;
    } catch {
      throw new ProposalError(
        kind === "logo"
          ? "The selected logo could not be opened. Refresh captures and logos to try the preview again."
          : "A selected capture could not be opened. Refresh captures and logos to try the preview again.",
      );
    }
  };
  const logoUrl = p.logo ? await signed(p.logo, "logo") : null;
  const found = await Promise.all(
    p.found.map(async f => ({
      url: await signed(f, "capture"),
      caption: f.caption,
      capturedOn: f.capturedOn,
      searchedAs: f.searchedAs,
    })),
  );
  return publicProposal({
    ...p,
    logo: p.logo && logoUrl ? { url: logoUrl, alt: p.logo.alt } : null,
    found,
  });
}

export interface ProposalIO {
  load: () => Promise<ProposalBundle>;
  save: (patch: ProposalPatch, revision: number) => Promise<Proposal>;
  preview: (proposal: Proposal) => Promise<PublicProposal>;
  send: (
    revision: number,
    ack: string[],
    update: boolean,
  ) => Promise<z.infer<typeof sentSchema>>;
  mark: (
    revision: number,
    status: "accepted" | "not_now" | "archived",
    objection: string | null,
    followUpOn: string | null,
  ) => Promise<Proposal>;
  livePreview: () => Promise<{ url: string; until: string }>;
}
export const proposalIO = (
  c: SupabaseClient,
  id: string,
  taskId?: string,
): ProposalIO => ({
  load: () => loadProposal(c, id, taskId),
  save: (patch, rev) => saveProposal(c, id, patch, rev),
  preview: p => readPublicProposal(c, p),
  send: (rev, ack, update) => sendProposal(c, id, rev, ack, update),
  mark: (rev, status, objection, date) =>
    markProposal(c, id, rev, status, objection, date),
  livePreview: () => previewProposalLink(c, id),
});
