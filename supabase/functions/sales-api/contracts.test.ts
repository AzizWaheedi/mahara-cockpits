import { describe, expect, test } from "bun:test";
import {
  type ContractSetting,
  type ContractTemplate,
  cleanTemplates,
  keepPayments,
  paymentOptions,
  contactFill,
  contractName,
  contractPatch,
  contactFieldsFor,
  contactStatusFor,
  contractTerms,
  docKind,
  goneFrom,
  rowFromDoc,
  senderOf,
  sentAtOf,
  signerOf,
  signingLink,
} from "./contracts.ts";

const SETTING: ContractSetting = {
  fields: {
    daily_ad_spend: { id: "spend-id" },
    payment_structure: {
      id: "pay-id",
      options: ["Paid in full (90 days)", "Split Pay (2x payments)", "1.0K Start / $2K Months After", "Monthly"],
    },
  },
  link_base: "https://link.maharamedia.com/documents/v1/",
};
const NINETY: ContractTemplate = { id: "t90", name: "90 Day Agreement", fields: ["company_name", "payment_structure", "daily_ad_spend"] };
const SPECIAL: ContractTemplate = { id: "tso", name: "Special Offer", fields: ["company_name", "daily_ad_spend"] };

describe("contractTerms", () => {
  test("takes what the template prints, and nothing else", () => {
    const out = contractTerms(
      { company_name: "  Ardon   Studio ", payment_structure: "Monthly", daily_ad_spend: "$1,250" },
      NINETY,
      SETTING,
    );
    expect(out).toEqual({ ok: true, terms: { company_name: "Ardon Studio", payment_structure: "Monthly", daily_ad_spend: 1250 } });
    const special = contractTerms({ company_name: "Ardon", payment_structure: "Monthly", daily_ad_spend: 40 }, SPECIAL, SETTING);
    expect(special).toEqual({ ok: true, terms: { company_name: "Ardon", daily_ad_spend: 40 } });
  });
  test("refuses a missing company, an unknown payment structure, or no spend", () => {
    expect(contractTerms({ company_name: "A" }, SPECIAL, SETTING).ok).toBe(false);
    expect(contractTerms({ company_name: "Ardon", payment_structure: "Weekly", daily_ad_spend: 40 }, NINETY, SETTING).ok).toBe(false);
    expect(contractTerms({ company_name: "Ardon", daily_ad_spend: "" }, SPECIAL, SETTING).ok).toBe(false);
    expect(contractTerms({ company_name: "Ardon", daily_ad_spend: 0 }, SPECIAL, SETTING).ok).toBe(false);
    expect(contractTerms({ company_name: "Ardon", daily_ad_spend: 200000 }, SPECIAL, SETTING).ok).toBe(false);
  });

  test("every contract asks for the daily ad spend, even one that does not print it", () => {
    const seven: ContractTemplate = {
      id: "6abe230d6bbbd5d9235bb774",
      name: "90 Day Agreement (7 Day Satisfaction Guarantee)",
      fields: ["company_name", "payment_structure"],
    };
    expect(contractTerms({ company_name: "Ardon", payment_structure: "Monthly" }, seven, SETTING)).toEqual({
      ok: false,
      error: "Write the daily ad spend in dollars, for example 40.",
    });
    expect(contractTerms({ company_name: "Ardon", payment_structure: "Monthly", daily_ad_spend: "50" }, seven, SETTING)).toEqual({
      ok: true,
      terms: { company_name: "Ardon", payment_structure: "Monthly", daily_ad_spend: 50 },
    });
  });
});

describe("contactFill", () => {
  test("writes the company name and the template's custom fields", () => {
    const out = contactFill({ company_name: "Ardon", payment_structure: "Monthly", daily_ad_spend: 40 }, SETTING);
    expect(out).toEqual({
      ok: true,
      body: {
        companyName: "Ardon",
        customFields: [
          { id: "pay-id", field_value: "Monthly" },
          { id: "spend-id", field_value: 40 },
        ],
      },
    });
    expect(contactFill({ company_name: "Ardon" }, SETTING)).toEqual({ ok: true, body: { companyName: "Ardon" } });
  });
  test("refuses rather than leaving a field blank on the contract", () => {
    expect(contactFill({ company_name: "Ardon", daily_ad_spend: 40 }, {}).ok).toBe(false);
  });
});

describe("contractName", () => {
  test("the team's own naming, in the company's language", () => {
    expect(contractName("Ardon")).toBe("Ardon X Mahara Media");
    expect(contractName("شركة البلوك الذهبي")).toBe("شركة البلوك الذهبي X مهارة ميديا");
  });
});

describe("signingLink", () => {
  test("the signer's own link, else another lead's, never one that does not say whose", () => {
    const links = [
      { recipientId: "other", recipientCategory: "cc", referenceId: "ref-cc" },
      { recipientId: "c1", recipientCategory: "recipient", referenceId: "ref-1" },
    ];
    expect(signingLink(links, "c1", SETTING.link_base)).toBe("https://link.maharamedia.com/documents/v1/ref-1");
    expect(signingLink([{ recipientId: "x", recipientCategory: "recipient", referenceId: "ref-x" }], "c1", SETTING.link_base))
      .toBeNull();
    expect(
      signingLink([{ entityName: "contacts", recipientId: "x", recipientCategory: "recipient", referenceId: "ref-x" }], "c1", SETTING.link_base),
    ).toBe("https://link.maharamedia.com/documents/v1/ref-x");
    expect(signingLink([], "c1", SETTING.link_base)).toBeNull();
    expect(signingLink(links, "c1", undefined)).toBeNull();
  });
});

describe("contractPatch", () => {
  test("status, revision and the signer's dates, nothing personal", () => {
    const doc = {
      status: "completed",
      name: "Ardon X Mahara Media",
      documentRevision: 2,
      updatedAt: "2026-10-01T08:39:32.764Z",
      recipients: [
        { id: "c1", email: "x@example.com", firstName: "X", hasCompleted: true, signedDate: "2026-10-01T08:37:42.184Z", lastViewedAt: "" },
      ],
    };
    const p = contractPatch(doc, "c1", "2026-10-01T09:00:00.000Z");
    expect(p).toEqual({
      status: "completed",
      name: "Ardon X Mahara Media",
      revision: 2,
      ghl_updated_at: "2026-10-01T08:39:32.764Z",
      checked_at: "2026-10-01T09:00:00.000Z",
      signed_at: "2026-10-01T08:37:42.184Z",
    });
    expect(JSON.stringify(p)).not.toContain("example.com");
  });
  test("an opened, unsigned contract keeps no signed date", () => {
    const p = contractPatch(
      { status: "viewed", recipients: [{ id: "c1", hasCompleted: false, lastViewedAt: "2026-09-30T17:53:51.358Z" }] },
      "c1",
      "2026-10-01T09:00:00.000Z",
    );
    expect(p.status).toBe("viewed");
    expect(p.viewed_at).toBe("2026-09-30T17:53:51.358Z");
    expect(p.signed_at).toBeUndefined();
  });
});

describe("each template's own payment structures", () => {
  // Aziz, 2026-10-03: the 60 Day and Month To Month contracts get plans that fit their fees.
  const SIXTY: ContractTemplate = {
    id: "t60",
    name: "60 Day Agreement",
    fields: ["company_name", "payment_structure"],
    payments: ["Paid in full ($4,000)", "Split pay ($2,000 + $2,000 after 30 days)"],
  };
  const MONTHLY: ContractTemplate = {
    id: "tmm",
    name: "Month To Month Agreement",
    fields: ["company_name", "payment_structure"],
    payments: ["Monthly ($2,000 a month)"],
  };
  test("a pick must be one of the template's own plans", () => {
    expect(paymentOptions(SIXTY, SETTING)).toEqual(SIXTY.payments ?? []);
    expect(paymentOptions(NINETY, SETTING)).toEqual(SETTING.fields?.payment_structure?.options ?? []);
    const ok = contractTerms({ company_name: "Ardon", payment_structure: "Paid in full ($4,000)", daily_ad_spend: 40 }, SIXTY, SETTING);
    expect(ok.ok && ok.terms.payment_structure).toBe("Paid in full ($4,000)");
    const wrong = contractTerms({ company_name: "Ardon", payment_structure: "Monthly", daily_ad_spend: 40 }, SIXTY, SETTING);
    expect(wrong).toEqual({
      ok: false,
      error: "Pick how the client pays: Paid in full ($4,000), Split pay ($2,000 + $2,000 after 30 days).",
    });
    expect(contractTerms({ company_name: "Ardon", payment_structure: "Paid in full ($4,000)", daily_ad_spend: 40 }, MONTHLY, SETTING).ok).toBe(false);
  });

  test("the lists survive cleaning and a manager's save without them", () => {
    expect(
      cleanTemplates([{ id: "6995853c5831c3bd20e03db7", name: "60 Day Agreement", fields: ["payment_structure"], payments: [" Paid in full ($4,000) ", "", "Paid in full ($4,000)", 7] }]),
    ).toEqual([
      { id: "6995853c5831c3bd20e03db7", name: "60 Day Agreement", fields: ["company_name", "payment_structure"], payments: ["Paid in full ($4,000)", "7"] },
    ]);
    const saved = keepPayments(
      [
        { id: "t60", name: "60 Day Agreement", fields: ["company_name", "payment_structure"] },
        { id: "tnew", name: "New", fields: ["company_name"] },
      ],
      [SIXTY, MONTHLY],
    );
    expect(saved[0].payments).toEqual(SIXTY.payments);
    expect(saved[1].payments).toBeUndefined();
    const changed = keepPayments([{ ...SIXTY, payments: ["Paid in full ($4,000)"] }], [SIXTY]);
    expect(changed[0].payments).toEqual(["Paid in full ($4,000)"]);
  });
});

describe("cleanTemplates", () => {
  test("known fields, the company name always, no duplicates", () => {
    expect(
      cleanTemplates([
        { id: "6905c43fc69d72f15bd69206", name: " 90 Day Agreement ", fields: ["daily_ad_spend", "nonsense"] },
        { id: "6905c43fc69d72f15bd69206", name: "again" },
        { id: "bad id", name: "x" },
      ]),
    ).toEqual([{ id: "6905c43fc69d72f15bd69206", name: "90 Day Agreement", fields: ["company_name", "daily_ad_spend"] }]);
    expect(cleanTemplates(null)).toEqual([]);
  });
});

describe("goneFrom", () => {
  const floor = "2026-04-16T16:18:44.689Z";
  const rows = [
    { document_id: "newer", ghl_updated_at: "2026-10-01T14:24:48.941+00:00" },
    { document_id: "older", ghl_updated_at: "2026-03-01T09:00:00.000Z" },
    { document_id: "unknown", ghl_updated_at: null },
  ];
  test("a contract changed after the oldest change read had to be on the pages: absent, it is gone", () => {
    expect(goneFrom(rows, floor, false)).toEqual(["newer"]);
  });
  test("one last changed before the pages reached, or never seen, is not called gone", () => {
    expect(goneFrom(rows.slice(1), floor, false)).toEqual([]);
  });
  test("the same time as the oldest read is not enough: ties can sit on the next page", () => {
    expect(goneFrom([{ document_id: "tie", ghl_updated_at: floor }], floor, false)).toEqual([]);
  });
  test("when the whole list was read, anything absent is gone", () => {
    expect(goneFrom(rows, floor, true)).toEqual(["newer", "older", "unknown"]);
  });
  test("nothing read, nothing gone", () => {
    expect(goneFrom(rows, null, false)).toEqual([]);
  });
});

const STAFF = {
  names: ["Closer Contract", "CSM Contract", "Media Buyer - Template"],
  words: ["closer", "media buyer", "editor"],
};
const doc = (over: Record<string, unknown> = {}) => ({
  _id: "doc1",
  name: "Ardon X Mahara Media",
  status: "viewed",
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-21T09:00:00.000Z",
  documentRevision: 2,
  recipients: [
    { id: "lead1", entityName: "contacts", isPrimary: true, lastViewedAt: "2026-09-21T09:00:00.000Z", hasCompleted: false },
    { id: "user1", entityName: "users", isPrimary: false },
  ],
  links: [
    { entityName: "users", recipientId: "user1", recipientCategory: "recipient", referenceId: "SENDER", createdBy: "u-sara", createdAt: "2026-09-20T11:00:00.000Z" },
    { entityName: "contacts", recipientId: "lead1", recipientCategory: "recipient", referenceId: "CLIENT", createdBy: "u-sara", createdAt: "2026-09-20T11:00:01.000Z" },
  ],
  ...over,
});

describe("signingLink", () => {
  test("never the sender's own copy, even when the lead's link is missing", () => {
    const users = [{ entityName: "users", recipientId: "user1", recipientCategory: "recipient", referenceId: "SENDER" }];
    expect(signingLink(users, "lead1", "https://l/")).toBeNull();
    expect(signingLink(doc().links, "lead1", "https://l/")).toBe("https://l/CLIENT");
    expect(signingLink(doc().links, "someone-else", "https://l/")).toBe("https://l/CLIENT");
  });
});

describe("docKind", () => {
  test("a document nobody signs yet", () => {
    expect(docKind(doc({ recipients: [] }), STAFF)).toBe("nobody");
  });
  test("staff by a staff template's name, kept or extended", () => {
    expect(docKind(doc({ name: "Closer Contract" }), STAFF)).toBe("staff");
    expect(docKind(doc({ name: "closer contract - Ahmed" }), STAFF)).toBe("staff");
    expect(docKind(doc({ name: "CSM Contract (Arabic)" }), STAFF)).toBe("staff");
  });
  test("staff by a role word on its own", () => {
    expect(docKind(doc({ name: "Media Buyer" }), STAFF)).toBe("staff");
    expect(docKind(doc({ name: "Editor" }), STAFF)).toBe("staff");
  });
  test("a freelancer's engagement agreement is staff; a client who is a developer is not", () => {
    const rules = { names: [], words: ["engagement agreement"] };
    expect(docKind(doc({ name: "Web Developer — Engagement Agreement" }), rules)).toBe("staff");
    expect(docKind(doc({ name: "Al Noor Developers X Mahara Media" }), rules)).toBe("client");
  });
  test("a client's contract, even with a role word inside another word", () => {
    expect(docKind(doc(), STAFF)).toBe("client");
    expect(docKind(doc({ name: "Editorial Studio X Mahara Media" }), STAFF)).toBe("client");
    expect(docKind(doc({ name: "شركة البلوك الذهبي للمقاولات" }), STAFF)).toBe("client");
    expect(docKind(doc({ name: "Closer Contracting Co" }), { names: ["Closer Contract"] })).toBe("client");
  });
});

describe("a contract made in HighLevel", () => {
  test("who signs, when it was sent and by whom, from the lead's link only", () => {
    expect(signerOf(doc())).toBe("lead1");
    expect(sentAtOf(doc())).toBe("2026-09-20T11:00:01.000Z");
    expect(senderOf(doc())).toBe("u-sara");
  });
  test("kept as the cockpit keeps contracts, with no terms", () => {
    const r = rowFromDoc(doc(), {
      now: "2026-10-01T12:00:00.000Z",
      linkBase: "https://l/",
      templateNames: ["90 Day Agreement"],
      senderEmail: "sara@x.com",
    });
    expect(r).toMatchObject({
      document_id: "doc1",
      contact_id: "lead1",
      template_id: null,
      template_name: null,
      status: "viewed",
      fields: {},
      client_link: "https://l/CLIENT",
      created_by: "sara@x.com",
      sent_by: "sara@x.com",
      sent_at: "2026-09-20T11:00:01.000Z",
      viewed_at: "2026-09-21T09:00:00.000Z",
      created_at: "2026-09-20T10:00:00.000Z",
      source: "highlevel",
    });
  });
  test("a draft has no link and no send; a draft still named after a template keeps it", () => {
    const r = rowFromDoc(doc({ status: "draft", name: "90 day agreement", links: [] }), {
      now: "2026-10-01T12:00:00.000Z",
      linkBase: "https://l/",
      templateNames: ["90 Day Agreement"],
      senderEmail: null,
    });
    expect(r).toMatchObject({ status: "draft", client_link: null, sent_at: null, sent_by: null, created_by: "HighLevel", template_name: "90 Day Agreement" });
  });
});

describe("copied contracts in one insert", () => {
  test("every row carries the same keys, opened or not, signed or not", () => {
    const opts = { now: "2026-10-01T12:00:00.000Z", linkBase: "https://l/", templateNames: [], senderEmail: null };
    const draft = rowFromDoc(doc({ status: "draft", links: [], recipients: [{ id: "lead1", entityName: "contacts", isPrimary: true }] }), opts);
    const viewed = rowFromDoc(doc(), opts);
    const signed = rowFromDoc(
      doc({ status: "completed", recipients: [{ id: "lead1", entityName: "contacts", isPrimary: true, hasCompleted: true, signedDate: "2026-09-22T08:00:00.000Z" }] }),
      opts,
    );
    const keys = (r: Record<string, unknown> | null) => Object.keys(r ?? {}).sort().join(",");
    expect(keys(draft)).toBe(keys(viewed));
    expect(keys(viewed)).toBe(keys(signed));
    expect(draft?.viewed_at).toBeNull();
    expect(signed?.signed_at).toBe("2026-09-22T08:00:00.000Z");
  });
});

describe("Contract Status and Contract URL", () => {
  test("HighLevel's words for each step", () => {
    expect(contactStatusFor({ status: "draft" })).toBe("Working on it");
    expect(contactStatusFor({ status: "sent" })).toBe("Sent");
    expect(contactStatusFor({ status: "viewed" })).toBe("Waiting On Client");
    expect(contactStatusFor({ status: "completed" })).toBe("Signed");
    expect(contactStatusFor({ status: "viewed", signed_at: "2026-10-01" })).toBe("Signed");
    expect(contactStatusFor({ status: "declined" })).toBe("CANCELLED");
    expect(contactStatusFor({ status: "paid" })).toBeNull();
  });
  test("the latest contract that still exists decides; the link is the latest one sent", () => {
    const rows = [
      { document_id: "old", status: "completed", client_link: "https://l/OLD", created_at: "2026-06-01T00:00:00Z", signed_at: "2026-06-02" },
      { document_id: "renewal", status: "draft", client_link: null, created_at: "2026-09-30T00:00:00Z" },
      { document_id: "gone", status: "deleted", client_link: "https://l/GONE", created_at: "2026-10-01T00:00:00Z" },
    ];
    expect(contactFieldsFor(rows)).toEqual({ status: "Working on it", url: "https://l/OLD", document_id: "renewal" });
  });
  test("every contract deleted: no contract yet, and no link", () => {
    expect(contactFieldsFor([{ document_id: "gone", status: "deleted", client_link: "https://l/GONE", created_at: "2026-10-01T00:00:00Z" }])).toEqual({
      status: "No Contract Yet",
      url: "",
      document_id: null,
    });
  });
});
