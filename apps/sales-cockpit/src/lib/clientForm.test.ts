import { describe, expect, test } from "bun:test";
import {
  type ClientFormSetting,
  type FormContext,
  fillFor,
  formLink,
  leadSourceFor,
  REF,
  railFor,
  rawPhone,
  readyCount,
  shortLabel,
  splitName,
  timezoneFor,
} from "./clientForm";
import type { Contract } from "./contracts";
import type { Lead, Recording } from "./types";

const lead = (over: Partial<Lead> = {}): Lead =>
  ({
    contact_id: "c1",
    name: "Fahad Al Sabah",
    email: "fahad@example.com",
    phone: "+965 9447 0600",
    phone8: "94470600",
    company: "Sabah Build",
    country: "KW",
    source: "ig ads",
    utm_source: "ig",
    booking_channel: null,
    ad_id: "123",
    setter_name: "Maria",
    ...over,
  }) as Lead;

const contract = (over: Partial<Contract> = {}): Contract =>
  ({
    document_id: "d1",
    contact_id: "c1",
    template_id: "6abe230d6bbbd5d9235bb774",
    template_name: "90 Day Agreement (7 Day Satisfaction Guarantee)",
    name: "Sabah Build Mahara Media",
    status: "completed",
    fields: {
      company_name: "Sabah Build Co.",
      payment_structure: "Split Pay (2x payments)",
    },
    ...over,
  }) as Contract;

const recording = (over: Partial<Recording> = {}): Recording =>
  ({
    recording_id: "r1",
    title: "Demo",
    started_at: "2026-10-01T10:00:00Z",
    share_url: "https://fathom.video/share/abc",
    contact_id: "c1",
    kind: "sales",
    transcript_path: "c1/r1.txt",
    transcript_chars: 41000,
    ...over,
  }) as Recording;

const ctx = (over: Partial<FormContext> = {}): FormContext => ({
  lead: lead(),
  closer: "Ahmed Abushaiba",
  contracts: [contract()],
  recordings: [recording()],
  ...over,
});

const q = (ref: string, choices?: string[]) => ({
  ref,
  title: "x",
  type: choices ? "dropdown" : "short_text",
  required: true,
  choices,
});

describe("the answers the cockpit already has", () => {
  test("names, numbers and the business come from the lead and the contract", () => {
    expect(splitName("Fahad Al Sabah")).toEqual({
      first: "Fahad",
      last: "Al Sabah",
    });
    expect(splitName("Fahad")).toEqual({ first: "Fahad", last: "" });
    expect(rawPhone("+965 9447 0600")).toBe("96594470600");
    expect(rawPhone("0096594470600")).toBe("96594470600");
    expect(fillFor(q(REF.business), ctx())).toEqual({
      kind: "copy",
      value: "Sabah Build Co.",
    });
    expect(fillFor(q(REF.business), ctx({ contracts: [] }))).toEqual({
      kind: "copy",
      value: "Sabah Build",
    });
    expect(
      fillFor(q(REF.lastName), ctx({ lead: lead({ name: "Fahad" }) })).kind,
    ).toBe("type");
  });

  test("a choice is offered only when the form has it", () => {
    const closers = [
      "Aziz Waheedi",
      "Maria",
      "Ahmed Abushaiba",
      "Ghanim Al Ghanim",
    ];
    expect(fillFor(q(REF.closer, closers), ctx())).toEqual({
      kind: "pick",
      value: "Ahmed Abushaiba",
    });
    expect(
      fillFor(q(REF.closer, closers), ctx({ closer: "Someone New" })),
    ).toEqual({
      kind: "type",
      hint: "Pick your name.",
    });
    const pay = [
      "Paid in full (90 days)",
      "Split Pay (2x payments)",
      "Monthly",
    ];
    expect(fillFor(q(REF.payment, pay), ctx())).toEqual({
      kind: "pick",
      value: "Split Pay (2x payments)",
    });
    const odd = contract({
      fields: { payment_structure: "1.0K Start / $2K Months After" },
    });
    expect(fillFor(q(REF.payment, pay), ctx({ contracts: [odd] }))).toEqual({
      kind: "type",
      hint: "1.0K Start / $2K Months After",
    });
  });

  test("country, time zone and lead source in the form's words", () => {
    const countries = ["KW", "SA", "AE", "BH", "QA", "OM"];
    expect(fillFor(q(REF.country, countries), ctx())).toEqual({
      kind: "pick",
      value: "KW",
    });
    expect(
      fillFor(
        q(REF.country, countries),
        ctx({ lead: lead({ country: null, phone: "+966 50 000 0000" }) }),
      ),
    ).toEqual({ kind: "pick", value: "SA" });
    const zones = ["Bahrain GMT+3", "Kuwait GMT+3", "Qatar GMT+3", "UAE GMT+4"];
    expect(timezoneFor("SA", zones)).toBe("Kuwait GMT+3");
    expect(timezoneFor("OM", zones)).toBe("UAE GMT+4");
    expect(timezoneFor("US", zones)).toBeNull();
    const sources = [
      "Meta ads",
      "TikTok ads",
      "Email",
      "Reactivation Campaign",
      "Referral",
    ];
    expect(leadSourceFor(lead(), sources)).toBe("Meta ads");
    expect(
      leadSourceFor(lead({ source: "ROASForm", ad_id: null }), sources),
    ).toBe("Meta ads");
    expect(leadSourceFor(lead({ source: "Reactivation" }), sources)).toBe(
      "Reactivation Campaign",
    );
    expect(
      leadSourceFor(
        lead({ source: "Whatsapp", utm_source: null, ad_id: null }),
        sources,
      ),
    ).toBeNull();
  });

  test("the agreement is NA - Already Sent only once the cockpit sent one", () => {
    const options = ["3 Month Program / No Guarantee", "NA - Already Sent"];
    expect(fillFor(q(REF.agreement, options), ctx())).toEqual({
      kind: "pick",
      value: "NA - Already Sent",
    });
    const draft = fillFor(
      q(REF.agreement, options),
      ctx({ contracts: [contract({ status: "draft" })] }),
    );
    expect(draft.kind).toBe("type");
    expect(draft.kind === "type" && draft.hint).toContain("Send the contract");
  });

  test("the money answers come from the contract's plan", () => {
    const split = contract({
      fields: {
        company_name: "Sabah Build Co.",
        payment_structure: "Split pay ($3,000 + $3,000 after 30 days)",
      },
    });
    const c = ctx({ contracts: [split] });
    const value = (ref: string) => {
      const f = fillFor(q(ref), c);
      return f.kind === "copy" ? f.value : null;
    };
    expect(value(REF.cashOnCall)).toBe("500");
    expect(value(REF.cashAtOnboarding)).toBe("2500");
    expect(value(REF.secondPayment)).toBe("3000");
    expect(value(REF.totalRevenue)).toBe("6000");
    expect(value(REF.paymentDetails)).toBe(
      "Split pay ($3,000 + $3,000 after 30 days): $500 on the call, $2,500 on or before the onboarding call, then $3,000 30 days later. Total $6,000.",
    );
    const f = fillFor(q(REF.cashOnCall), c);
    expect(f.kind === "copy" && f.note).toContain("Change it");

    const pif = contract({
      fields: { payment_structure: "Paid in full ($6,000)" },
    });
    const p = ctx({ contracts: [pif] });
    expect(fillFor(q(REF.cashAtOnboarding), p)).toMatchObject({
      kind: "copy",
      value: "5500",
    });
    expect(fillFor(q(REF.secondPayment), p)).toMatchObject({
      kind: "copy",
      value: "0",
    });
  });

  test("without a plan the money questions show both plans' amounts", () => {
    const old = contract({
      fields: { payment_structure: "Split Pay (2x payments)" },
    });
    expect(fillFor(q(REF.cashAtOnboarding), ctx({ contracts: [old] }))).toEqual(
      { kind: "type", hint: "Paid in full: 5500. Split pay: 2500." },
    );
    expect(fillFor(q(REF.totalRevenue), ctx({ contracts: [] }))).toEqual({
      kind: "type",
      hint: "Paid in full: 6000. Split pay: 6000.",
    });
  });

  test("a contract made in HighLevel, with no fields, does not hide the plan", () => {
    const madeThere = contract({
      document_id: "d2",
      template_id: null,
      source: "highlevel",
      fields: {},
    } as Partial<Contract>);
    const split = contract({
      fields: {
        payment_structure: "Split pay ($3,000 + $3,000 after 30 days)",
      },
    });
    expect(
      fillFor(q(REF.secondPayment), ctx({ contracts: [madeThere, split] })),
    ).toMatchObject({ kind: "copy", value: "3000" });
  });

  test("the Fathom link and transcript are the newest sales call's", () => {
    const old = recording({
      recording_id: "r0",
      started_at: "2026-09-01T10:00:00Z",
      share_url: "https://fathom.video/share/old",
    });
    const phone = recording({
      recording_id: "p",
      kind: "phone",
      share_url: null,
      started_at: "2026-10-02T10:00:00Z",
    });
    const c = ctx({ recordings: [old, phone, recording()] });
    expect(fillFor(q(REF.fathom), c)).toEqual({
      kind: "copy",
      value: "https://fathom.video/share/abc",
    });
    expect(fillFor(q(REF.transcript), c)).toEqual({
      kind: "transcript",
      path: "c1/r1.txt",
      chars: 41000,
    });
    expect(fillFor(q(REF.transcript), ctx({ recordings: [] })).kind).toBe(
      "type",
    );
  });
});

describe("the list beside the form", () => {
  const setting: ClientFormSetting = {
    form_id: "BTzMwXiw",
    url: "https://maharamedia.typeform.com/to/BTzMwXiw",
    screens: [
      {
        title: "General Information",
        questions: [
          {
            ref: REF.firstName,
            title: "Client First Name",
            type: "short_text",
            required: true,
          },
          {
            ref: "address",
            title: "Business Address",
            type: "short_text",
            required: false,
          },
        ],
      },
      {
        title: "Lead and Payment Details",
        questions: [
          {
            ref: REF.adSpend,
            title:
              "Daily Ad Spend - DO NOT include the $ symbol (currency: USD)",
            type: "number",
            required: false,
          },
        ],
      },
    ],
  };

  test("follows the form's screens and order, and counts what is ready", () => {
    const rail = railFor(setting, ctx());
    expect(rail.map(s => s.title)).toEqual([
      "General Information",
      "Lead and Payment Details",
    ]);
    expect(rail[0].rows.map(r => r.fill.kind)).toEqual(["copy", "type"]);
    expect(rail[1].rows[0].label).toBe("Daily Ad Spend");
    expect(readyCount(rail)).toEqual({ ready: 1, total: 3 });
    expect(railFor(null, ctx())).toEqual([]);
  });

  test("labels lose the form's instructions, and the link carries the hidden fields", () => {
    expect(shortLabel("Raw Phone (No+ e.g. 96594470600)")).toBe("Raw Phone");
    expect(shortLabel("Current Timezone (Saudi is the same as Kuwait)")).toBe(
      "Current Timezone",
    );
    expect(
      shortLabel(
        "Second Payment Amount After Initial Payment (IGNORE IF PIF) - DO NOT include the $ symbol (currency: USD) ",
      ),
    ).toBe("Second Payment Amount After Initial Payment");
    expect(
      formLink(setting, {
        contact_id: "c1",
        closer: "Ahmed Abushaiba",
        setter: "Maria",
      }),
    ).toBe(
      "https://maharamedia.typeform.com/to/BTzMwXiw#contact_id=c1&closer=Ahmed+Abushaiba&setter=Maria",
    );
  });
});
