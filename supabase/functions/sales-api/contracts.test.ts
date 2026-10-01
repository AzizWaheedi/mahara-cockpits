import { describe, expect, test } from "bun:test";
import {
  type ContractSetting,
  type ContractTemplate,
  cleanTemplates,
  contactFill,
  contractName,
  contractPatch,
  contractTerms,
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
  test("the signer's own link, else the first recipient's", () => {
    const links = [
      { recipientId: "other", recipientCategory: "cc", referenceId: "ref-cc" },
      { recipientId: "c1", recipientCategory: "recipient", referenceId: "ref-1" },
    ];
    expect(signingLink(links, "c1", SETTING.link_base)).toBe("https://link.maharamedia.com/documents/v1/ref-1");
    expect(signingLink([{ recipientId: "x", recipientCategory: "recipient", referenceId: "ref-x" }], "c1", SETTING.link_base))
      .toBe("https://link.maharamedia.com/documents/v1/ref-x");
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
