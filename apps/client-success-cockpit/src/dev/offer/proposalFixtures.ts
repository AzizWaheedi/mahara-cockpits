import type {
  Proposal,
  ProposalBundle,
  ProposalIO,
} from "../../pages/money/offers/proposal/proposalSources";
import { ProposalError } from "../../pages/money/offers/proposal/proposalSources";
import type { PublicProposal } from "../../pages/money/offers/proposal/publicProposal";
import type { CatalogRow } from "../../present/offer/sources";
import { WEBSITE_COPY } from "./catalogFixture";

const stamp = "2026-10-26T12:00:00Z";
export function proposalFixture(
  fixture = "full",
  lang: "en" | "ar" = "en",
  sent = false,
): ProposalBundle {
  const copy = WEBSITE_COPY[lang];
  const catalog: CatalogRow = {
    offerKey: "website",
    sort: 1,
    parts: [
      {
        key: "build",
        cadence: "one_time",
        amount: fixture === "noprice" ? null : 2000,
        hint: 2000,
      },
      {
        key: "care",
        cadence: "monthly",
        amount: fixture === "noprice" ? null : 200,
        hint: 200,
      },
    ],
    locked: false,
    splitAllowed: false,
    splitParts: null,
    minMonths: null,
    waitsOn: null,
    copy: WEBSITE_COPY,
    revision: 1,
    updatedAt: stamp,
    updatedBy: "example@example.test",
  };
  const proposal: Proposal = {
    id: `fictional-${fixture}-${lang}`,
    requestId: "0e7f1683-610f-4310-80c7-0011f2570748",
    taskId: "fictional-hosh",
    clientName:
      lang === "ar"
        ? "حوش للتصميم والبناء، مثال"
        : "Hosh Design & Build, Example",
    offerKey: "website",
    lang,
    content: {
      v: 1,
      logo: { on: false, adId: null },
      video: { kind: "default" },
      found: [],
      why: { trigger: "no_site", text: copy.why[0].text, edited: false },
      get: copy.get.map(g => ({ ...g, hidden: false, edited: false })),
      platforms: null,
      steps: { text: copy.steps.map(s => s.text).join("\n"), edited: false },
      button: { text: copy.button, edited: false },
      showCsm: true,
    },
    price: {
      parts: fixture === "noprice" ? {} : { build: 2000, care: 200 },
      split: false,
    },
    priceReason: null,
    listPrice: {
      build: catalog.parts[0].amount,
      care: catalog.parts[1].amount,
    },
    validUntil: "2026-11-09",
    code: sent ? "abcdefghjkmn" : null,
    url: sent ? "https://offer.example/abcdefghjkmn" : null,
    status: sent ? "link_copied" : "draft",
    expired: false,
    sentAt: sent ? stamp : null,
    updatedAfterSend: false,
    revision: 1,
    objection: null,
    followUpOn: null,
    warningsPassed: [],
    updatedAt: stamp,
    warnings:
      fixture === "warning"
        ? [
            {
              key: "capture_old",
              text: "This capture is more than seven days old. Check it still represents the client's site.",
            },
          ]
        : [],
    problems: [],
    heldFull: false,
    videoReady: fixture !== "sparse",
  };
  return { proposal, catalog, files: [], logos: [] };
}
export function fixturePublic(
  bundle: ProposalBundle,
  p = bundle.proposal,
): PublicProposal {
  const copy = WEBSITE_COPY[p.lang];
  return {
    lang: p.lang,
    offer: p.offerKey,
    title: copy.deckTitle,
    clientName: p.clientName,
    logo: null,
    csmFirstName: p.content.showCsm ? "Sara" : null,
    date: "2026-10-26",
    validUntil: p.validUntil,
    video:
      p.videoReady || p.content.video.kind === "custom"
        ? {
            provider: "youtube",
            embedUrl: "https://www.youtube-nocookie.com/embed/example0001",
            posterUrl: null,
            title: copy.deckTitle,
          }
        : null,
    found: [],
    why: p.content.why.text || null,
    get: p.content.get.filter(g => !g.hidden).map(g => g.text),
    platforms: null,
    work: [],
    steps: p.content.steps.text || null,
    timing: copy.timing,
    investment: {
      parts: bundle.catalog.parts
        .filter(part => p.price.parts[part.key] !== undefined)
        .map(part => ({
          label: copy.parts[part.key],
          amountUsd: p.price.parts[part.key],
          cadence: part.cadence,
        })),
      terms: copy.terms,
      split: null,
    },
    button: {
      text: p.content.button.text,
      whatsapp: "https://wa.me/00000000000?text=Fictional%20example",
    },
  };
}

/** In-memory only. This cannot call Supabase, send a message or create a client link. */
export function fixtureProposalIO(seed: ProposalBundle, mode = ""): ProposalIO {
  const bundle = structuredClone(seed);
  let failed = false;
  const delay = () =>
    new Promise(resolve => setTimeout(resolve, mode === "slow" ? 1800 : 80));
  const expectRevision = (revision: number) => {
    if (revision !== bundle.proposal.revision || mode === "conflict")
      throw new ProposalError(
        "This proposal changed in another window. Reload before saving.",
        "40001",
      );
  };
  return {
    load: async () => structuredClone(bundle),
    save: async (patch, revision) => {
      await delay();
      expectRevision(revision);
      if (mode === "fail" && !failed) {
        failed = true;
        throw new ProposalError(
          "The connection dropped. Your changes have not been saved.",
        );
      }
      const p = bundle.proposal;
      if (patch.lang && patch.lang !== p.lang) {
        const copy = WEBSITE_COPY[patch.lang];
        p.lang = patch.lang;
        p.content.get = p.content.get.map(g =>
          g.edited
            ? g
            : {
                ...g,
                text: copy.get.find(x => x.key === g.key)?.text ?? g.text,
              },
        );
        if (!p.content.why.edited)
          p.content.why.text =
            copy.why.find(x => x.key === p.content.why.trigger)?.text ??
            copy.why[0].text;
        if (!p.content.steps.edited)
          p.content.steps.text = copy.steps.map(x => x.text).join("\n");
        if (!p.content.button.edited) p.content.button.text = copy.button;
      }
      if (patch.content) p.content = structuredClone(patch.content);
      if (patch.price) p.price = structuredClone(patch.price);
      if (patch.price_reason !== undefined) p.priceReason = patch.price_reason;
      if (patch.valid_until) p.validUntil = patch.valid_until;
      p.revision += 1;
      p.updatedAfterSend = !!p.code;
      p.updatedAt = new Date().toISOString();
      return structuredClone(p);
    },
    preview: async p => fixturePublic(bundle, p),
    send: async (revision, ack) => {
      expectRevision(revision);
      const p = bundle.proposal;
      if (!p.videoReady && p.content.video.kind === "default")
        throw new ProposalError("Add a video in this language before sharing.");
      if (p.warnings?.some(w => !ack.includes(w.key)))
        throw new ProposalError("Review each point before sharing.");
      if (bundle.catalog.parts.some(part => !p.price.parts[part.key]))
        throw new ProposalError("Enter a price for each part before sharing.");
      p.code = "abcdefghjkmn";
      p.url = "https://offer.example/abcdefghjkmn";
      p.status = "link_copied";
      p.sentAt = stamp;
      p.revision += 1;
      p.updatedAfterSend = false;
      return {
        code: p.code,
        url: p.url,
        status: p.status,
        revision: p.revision,
        problems: [],
      };
    },
    mark: async (revision, status, objection, followUpOn) => {
      expectRevision(revision);
      bundle.proposal = {
        ...bundle.proposal,
        status,
        objection,
        followUpOn,
        revision: revision + 1,
      };
      return structuredClone(bundle.proposal);
    },
    livePreview: async () => ({ url: "about:blank", until: stamp }),
  };
}
