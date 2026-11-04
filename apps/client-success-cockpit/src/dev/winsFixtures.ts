/**
 * Stand-ins for the waves 5-6 screens (docs/forms/WAVE56-CONTRACT.md 3.3):
 * wins in every stage and pay state, tie candidates with both chips, the
 * Today rows, the retire list and the reads behind Log a win. The tests and
 * the layout harness read these; nothing here reaches the database. Names
 * are made up; one is Arabic so the <bdi> and the right-to-left line show.
 */

import type { WinContext } from "@/forms/staff/formDefs";
import type {
  BandInput,
  RetireItem,
  TieCandidate,
  WinRow,
} from "@/lib/winsCore";

export const TASK = "86ewvnqj5";
export const CLIENT = "Ardon Interiors";
export const CLIENT_AR = "شركة العلا للتصميم";

const base: WinRow = {
  id: "00000000-0000-4000-8000-000000000001",
  taskId: TASK,
  client: CLIENT,
  kind: "review",
  kindLabel: "Google review",
  stage: "logged",
  wonOn: "2026-11-01",
  proofUrl: "https://g.page/r/example/review",
  quotedUsd: null,
  recurring: false,
  monthlyUsd: null,
  agreementUrl: null,
  tiedUsd: null,
  tiedCheckedUsd: null,
  tiePending: null,
  invoiceId: null,
  pay: { state: "proposed", why: null, amountUsd: 75 },
  loggedByRole: "the CSM",
  loggedAt: "2026-11-01T09:00:00Z",
  voidReason: null,
  offeredOn: null,
  acceptedOn: null,
  paidOn: null,
  proposalId: null,
  offerName: null,
};

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const WINS: WinRow[] = [
  base,
  {
    ...base,
    id: id(2),
    kind: "upsell_website",
    kindLabel: "Website",
    stage: "quote_given",
    wonOn: "2026-10-28",
    proofUrl: null,
    quotedUsd: 1500,
    offeredOn: "2026-10-28",
    pay: { state: "none", why: null, amountUsd: null },
    proposalId: "11111111-1111-4111-8111-111111111111",
    offerName: "Website",
  },
  {
    ...base,
    id: id(3),
    kind: "upsell_smm",
    kindLabel: "Social media management",
    stage: "signed",
    wonOn: "2026-10-20",
    proofUrl: null,
    quotedUsd: 600,
    recurring: true,
    monthlyUsd: 600,
    agreementUrl: "https://drive.google.com/file/d/agreement/view",
    offeredOn: "2026-10-20",
    acceptedOn: "2026-10-25",
    tiePending: { id: 7, usd: 600, paidOn: "2026-11-01" },
    pay: { state: "waiting", why: "Cash not checked yet.", amountUsd: null },
  },
  {
    ...base,
    id: id(4),
    kind: "upsell_backend",
    kindLabel: "Back-end programme",
    stage: "paid",
    wonOn: "2026-10-05",
    proofUrl: null,
    quotedUsd: 1500,
    recurring: true,
    monthlyUsd: 500,
    agreementUrl: "https://drive.google.com/file/d/agreement2/view",
    tiedUsd: 1500,
    tiedCheckedUsd: 1500,
    offeredOn: "2026-10-05",
    acceptedOn: "2026-10-08",
    paidOn: "2026-10-12",
    pay: { state: "proposed", why: null, amountUsd: 150 },
  },
  {
    ...base,
    id: id(5),
    kind: "referral",
    kindLabel: "Referral",
    stage: "logged",
    wonOn: "2026-10-30",
    proofUrl: null,
    pay: {
      state: "waiting",
      why: "The referred client has not paid yet.",
      amountUsd: null,
    },
  },
  {
    ...base,
    id: id(6),
    kind: "upsell_seo_geo",
    kindLabel: "SEO and AI search",
    stage: "void",
    wonOn: "2026-10-02",
    proofUrl: null,
    quotedUsd: 900,
    pay: { state: "none", why: null, amountUsd: null },
    voidReason: "The client chose another agency",
  },
];

export const CANDIDATES: TieCandidate[] = [
  {
    paymentId: "whop:pay_upsell_1",
    rail: "whop",
    usd: 600,
    paidOn: "2026-11-01",
    checked: true,
    inDealLedger: null,
    closerPaidMonth: null,
  },
  {
    paymentId: "transfer:tr_88",
    rail: "transfer",
    usd: 600,
    paidOn: "2026-10-31",
    checked: false,
    inDealLedger: null,
    closerPaidMonth: null,
  },
  {
    paymentId: "tap:chg_day30",
    rail: "tap",
    usd: 1500,
    paidOn: "2026-10-30",
    checked: true,
    inDealLedger: { closerRole: "the closer", month: "2026-10" },
    closerPaidMonth: null,
  },
];

export const CONTEXT: Pick<WinContext, "proposals" | "deals"> = {
  proposals: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      offerName: "Website",
      status: "sent",
      totalUsd: 1500,
      listUsd: 1800,
    },
  ],
  deals: [
    {
      responseId: "resp_ref_1",
      business: "Liwan Fit-out",
      signedOn: "2026-10-22",
    },
  ],
};

export const BAND_ROWS: BandInput[] = [
  {
    kind: "accepted_no_agreement",
    taskId: TASK,
    client: CLIENT,
    offer: "Website",
    proposalId: "11111111-1111-4111-8111-111111111111",
  },
  {
    kind: "invoice_paid_untied",
    taskId: TASK,
    client: CLIENT,
    offer: "Social media management",
    winId: id(3),
  },
  { kind: "tie_waiting", count: 2 },
  { kind: "receipt_in", taskId: "86eyreceipt", client: CLIENT_AR },
  {
    kind: "back",
    taskId: "86eyback01",
    client: "Dusk Arch",
    returnedOn: "2026-11-01",
  },
  {
    kind: "receipt_checked",
    taskId: TASK,
    client: CLIENT,
    part: "later",
    partNo: 2,
    dateIfConfirmed: "2026-12-05",
  },
  {
    kind: "due_no_money",
    taskId: "86eydue001",
    client: "Imperium Studio",
    dueOn: "2026-10-30",
    part: "later",
    partNo: 1,
    expectedAmount: 1500,
    currency: "USD",
  },
];

export const RETIRE: RetireItem[] = [
  {
    id: "make:9169735",
    kind: "make",
    externalId: "9169735",
    name: "Four Rs: client review to sheet",
    usedFor: "Four Rs to sheet, comment, Slack",
    ownerRole: "the systems manager",
    replacement: "Log a win",
    state: "on",
    offAt: null,
    archiveFrom: null,
    archivedAt: null,
    note: null,
  },
  {
    id: "make:9805665",
    kind: "make",
    externalId: "9805665",
    name: "Extension",
    usedFor: "extension, Confirm Charge",
    ownerRole: "the systems manager",
    replacement: "billing sheet Extend, Confirm paid",
    state: "off",
    offAt: "2026-11-01T10:00:00Z",
    archiveFrom: "2026-11-15T10:00:00Z",
    archivedAt: null,
    note: null,
  },
  {
    id: "typeform:CTUjv6l3",
    kind: "typeform",
    externalId: "CTUjv6l3",
    name: "Pause request",
    usedFor: "pause",
    ownerRole: "the systems manager",
    replacement: "pause sheet and pause consent",
    state: "closed",
    offAt: "2026-11-02T08:00:00Z",
    archiveFrom: "2026-11-16T08:00:00Z",
    archivedAt: null,
    note: null,
  },
  {
    id: "make:8963994",
    kind: "make",
    externalId: "8063994",
    name: "Monday ticketing",
    usedFor: "Monday-era ticketing",
    ownerRole: "the systems manager",
    replacement: "/requests",
    state: "archived",
    offAt: "2026-09-01T08:00:00Z",
    archiveFrom: "2026-09-15T08:00:00Z",
    archivedAt: "2026-11-02T09:00:00Z",
    note: null,
  },
  {
    id: "typeform:BTzMwXiw",
    kind: "typeform",
    externalId: "BTzMwXiw",
    name: "New Client Form",
    usedFor: "New Client Form",
    ownerRole: "the systems manager",
    replacement: "stays (D14)",
    state: "kept",
    offAt: null,
    archiveFrom: null,
    archivedAt: null,
    note: null,
  },
];
