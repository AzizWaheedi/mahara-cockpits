/**
 * The kickoff's side panel (src/forms/formRail.ts, docs/csm-forms/
 * KICKOFF.md 3): every fact's source order and its plain sentence when
 * missing, the service in the onboarding deck's order, the card's Service
 * Advertised field never read, and a payment never computed.
 *
 * Run: bun test scripts/form-rail.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  FULL_ANSWERS,
  fixtureCall,
  fixtureContext,
  fixtureDeck,
  fixtureRow,
  fixtureTimeline,
  onboardingEntry,
} from "../src/dev/formFixtures";
import type { FormContext, RailPart } from "../src/forms/formConfig";
import { KICKOFF } from "../src/forms/formConfig";
import {
  CONTRACT_CHOICES,
  contractChoice,
  suggestedService,
} from "../src/forms/formRail";

const rail = (ctx: FormContext = fixtureContext()) =>
  KICKOFF.rail(ctx, KICKOFF.hidden(ctx));
const part = (parts: RailPart[], id: string) => parts.find(p => p.id === id);
const row = (parts: RailPart[], id: string) =>
  parts
    .flatMap(p => p.rows)
    .find(r => r.id === id && !r.id.startsWith("missing-"));

describe("the parts, in order", () => {
  test("a full record: nothing missing, then the client, the form's order and the sale", () => {
    const parts = rail();
    expect(parts.map(p => p.id)).toEqual(["client", "order", "sale"]);
    expect(part(parts, "sale")?.fold).toBe(true);
    expect(part(parts, "order")?.rows.map(r => r.id)).toEqual([
      "carries",
      "service",
      "consultation-types",
      "contract",
      "daily-budget",
      "facebook",
      "calendar",
      "content",
      "recording",
      "payment",
    ]);
  });

  test("Still missing comes first, with one line for each required fact the cockpit cannot suggest", () => {
    const ctx = fixtureContext({
      row: fixtureRow({ forms: {}, handover: {} }),
      deck: fixtureDeck({}),
      timeline: fixtureTimeline([]),
    });
    const parts = rail(ctx);
    expect(parts[0].id).toBe("missing");
    expect(parts[0].tone).toBe("warn");
    expect(parts[0].rows.map(r => [r.label, r.missing])).toEqual([
      [
        "Call Recording Link",
        "Not in the call store yet. It arrives a few minutes after the call ends. Check again, or paste it from Fathom.",
      ],
      ["Contract status", "Not on record. Ask on the call."],
      ["Service", "Not on record. Ask which of the five they want first."],
      [
        "Onboarding answers",
        "No onboarding answers: the form's read-backs will be empty.",
      ],
      ["Payment amount", "Not on record."],
    ]);
  });

  test("a missing fact is a sentence, never a zero or a dash", () => {
    const ctx = fixtureContext({
      row: fixtureRow({
        forms: {},
        handover: { daily_budget: 0 } as never,
        links: {},
      }),
      deck: null,
      timeline: null,
      failed: { deck: "down", timeline: "down" },
    });
    for (const r of rail(ctx).flatMap(p => p.rows))
      if (r.value === null) {
        expect(r.missing).toBeTruthy();
        expect(r.missing).not.toMatch(/^[-–—0]$/);
      }
    expect(row(rail(ctx), "daily-budget")?.value).toBeNull();
  });
});

describe("the client", () => {
  test("offer: the editor desk's offer and link, then the card's cheat sheet link, then not on record", () => {
    expect(row(rail(), "offer")).toMatchObject({
      value: "A full villa interior, designed and handed over in 12 weeks",
      href: "https://docs.example/cedar-offer",
      linkLabel: "Offer cheat sheet",
    });
    const card = row(rail(fixtureContext({ deck: null })), "offer");
    expect(card).toMatchObject({
      value: "On the offer cheat sheet.",
      source: "ClickUp card",
      href: "https://docs.example/cedar-offer",
    });
    const none = row(
      rail(fixtureContext({ deck: null, row: fixtureRow({ links: {} }) })),
      "offer",
    );
    expect(none?.value).toBeNull();
    expect(none?.missing).toBe("Not on record.");
  });

  test("a failed deck read is said once on the client part; the rest still shows", () => {
    const parts = rail(
      fixtureContext({ deck: null, failed: { deck: "timeout" } }),
    );
    expect(part(parts, "client")?.problem).toBe(
      "The offer and HighLevel details could not be read just now.",
    );
    expect(row(parts, "consultation-types")?.value).toBe("In-office, Online");
  });

  test("area: HighLevel's city and country, with their service areas under it; else the service areas answer", () => {
    expect(row(rail(), "area")).toMatchObject({
      value: "Salmiya, KW",
      source: "HighLevel",
      hint: "They serve: Kuwait City, Salmiya, Hawalli",
    });
    expect(row(rail(fixtureContext({ deck: null })), "area")).toMatchObject({
      value: "Kuwait City, Salmiya, Hawalli",
      source: "Onboarding form, 13 Oct",
    });
    expect(
      row(
        rail(fixtureContext({ deck: null, row: fixtureRow({ forms: {} }) })),
        "area",
      )?.value,
    ).toBeNull();
  });

  test("services: the five as the form's exact labels, the suggestion ringed, their own words under each", () => {
    const s = row(rail(), "services");
    expect(s?.choices?.options.map(o => o.label)).toEqual([
      "Design and build",
      "Interior design",
      "Architectural design",
      "Fit out and renovation",
      "Construction only",
    ]);
    expect(s?.choices?.picked).toBe("Interior design");
    const interior = s?.choices?.options.find(
      o => o.label === "Interior design",
    );
    expect(interior?.own).toContain("Villa interiors");
  });
});

describe("the service, in the onboarding deck's order", () => {
  test("slide 4's choice first", () => {
    const s = suggestedService(fixtureContext());
    expect(s.pick.key).toBe("interior");
    expect(s.source).toBe("Slide 4, onboarding deck");
  });

  test("then prep's line without the choice stamp", () => {
    const s = suggestedService(
      fixtureContext({
        deck: fixtureDeck({ service_focus: "Fit out and renovation" }),
      }),
    );
    expect(s.pick.key).toBe("fitout");
    expect(s.source).toBe("Prep, onboarding deck");
  });

  test("then the onboarding form's number-one service and its list", () => {
    const s = suggestedService(fixtureContext({ deck: fixtureDeck({}) }));
    expect(s.pick.key).toBe("interior");
    expect(s.source).toBe("Onboarding form, 13 Oct");
    const list = suggestedService(
      fixtureContext({
        deck: null,
        row: fixtureRow({
          forms: {
            onboarding: onboardingEntry({
              ...FULL_ANSWERS,
              serviceFocus: "",
              services: "Full turnkey villas",
            }),
          },
        }),
      }),
    );
    expect(list.pick.key).toBe("design-build");
  });

  test("the card's Service Advertised field is never read", () => {
    const ctx = fixtureContext({
      deck: fixtureDeck({}),
      row: fixtureRow({
        forms: {},
        handover: { service: "Interior design" } as never,
      }),
    });
    expect(suggestedService(ctx).pick.key).toBeNull();
    expect(row(rail(ctx), "service")?.value).toBeNull();
    expect(row(rail(ctx), "service")?.missing).toBe(
      "Not on record. Ask which of the five they want first.",
    );
  });

  test("a pick in words that fit none is Other, with their words", () => {
    const parts = rail(
      fixtureContext({
        deck: fixtureDeck({
          service_focus: "Yacht interiors refit",
          service_chosen_at: "2026-10-22T10:00:00Z",
        }),
      }),
    );
    // "interiors" fits interior design; a truly other line:
    const other = rail(
      fixtureContext({
        deck: fixtureDeck({
          service_focus: "Solar panels",
          service_chosen_at: "2026-10-22T10:00:00Z",
        }),
      }),
    );
    expect(row(parts, "service")?.value).toBe("Interior design");
    expect(row(other, "service")?.value).toBe("Other");
    expect(row(other, "service")?.hint).toBe("In their words: Solar panels");
  });
});

describe("in the form's order", () => {
  test("what the form carries: 22 values, each with its source, and a blank one said", () => {
    const c = row(rail(), "carries");
    expect(c?.label).toBe("What the form carries (22 of 22)");
    expect(c?.carries?.length).toBe(22);
    expect(c?.carries?.every(x => x.source === "Onboarding form, 13 Oct")).toBe(
      true,
    );
    const { notes: _gone, ...rest } = FULL_ANSWERS;
    const blank = row(
      rail(
        fixtureContext({
          row: fixtureRow({ forms: { onboarding: onboardingEntry(rest) } }),
        }),
      ),
      "carries",
    );
    expect(blank?.label).toBe("What the form carries (21 of 22)");
    expect(blank?.carries?.find(x => x.key === "client_notes")).toMatchObject({
      value: null,
      source: null,
    });
    expect(blank?.missing).toBe("The client left it blank.");
  });

  test("contract status: Contract Status first, then Contract Signed, as the form's five choices", () => {
    expect(
      contractChoice({
        contract_status: "Not sent yet",
        contract_signed: "Signed",
      }),
    ).toBe("Not sent yet");
    expect(contractChoice({ contract_signed: "Signed" })).toBe("Signed");
    expect(contractChoice({ contract_signed: "Sent" })).toBe(
      "Sent and waiting on client",
    );
    expect(
      contractChoice({ contract_status: "sent and waiting on client" }),
    ).toBe("Sent and waiting on client");
    expect(contractChoice({ contract_status: "NA - already signed" })).toBe(
      "NA - already signed",
    );
    expect(contractChoice({})).toBeNull();
    for (const c of CONTRACT_CHOICES)
      expect(contractChoice({ contract_status: c })).toBe(c);
    expect(row(rail(), "contract")).toMatchObject({
      value: "Signed",
      source: "ClickUp card",
      pick: true,
    });
  });

  test("daily budget: the card's, with a copy button", () => {
    expect(row(rail(), "daily-budget")).toMatchObject({
      value: "40",
      copy: true,
      source: "ClickUp card",
    });
  });

  test("calendar and content from the onboarding form", () => {
    expect(row(rail(), "calendar")).toMatchObject({
      value: "Calendly",
      hint: "Appointments: 45 minutes, 15 minute buffer",
    });
    expect(row(rail(), "content")).toMatchObject({
      href: "https://drive.example/cedar-content",
      linkLabel: "Their Drive link",
    });
    expect(row(rail(), "facebook")?.value).toBe("Yes, we ran ads before");
  });

  test("call recording: today's onboarding call with a recording, Kuwait day, with Check again", () => {
    const r = row(rail(), "recording");
    expect(r).toMatchObject({
      value: "https://fathom.example/share/cedar-onboarding",
      source: "Fathom, today 13:10",
      copy: true,
      recheck: true,
      required: true,
    });
    const yesterday = rail(
      fixtureContext({
        timeline: fixtureTimeline([
          fixtureCall({ startsAt: "2026-10-21T10:10:00Z" }),
        ]),
      }),
    );
    expect(row(yesterday, "recording")?.value).toBeNull();
    const checkin = rail(
      fixtureContext({
        timeline: fixtureTimeline([fixtureCall({ kind: "checkin" })]),
      }),
    );
    expect(row(checkin, "recording")?.value).toBeNull();
    const noLink = rail(
      fixtureContext({
        timeline: fixtureTimeline([fixtureCall({ recordingUrl: undefined })]),
      }),
    );
    expect(row(noLink, "recording")?.value).toBeNull();
    const failed = rail(
      fixtureContext({ timeline: null, failed: { timeline: "down" } }),
    );
    expect(row(failed, "recording")?.missing).toBe(
      "The call store could not be read just now. Check again, or paste it from Fathom.",
    );
  });

  test("payment: the card's Next Payment Amount only; billing lines and the plan are hints, never a number", () => {
    expect(row(rail(), "payment")).toMatchObject({
      value: "1000",
      source: "ClickUp card, Next Payment Amount",
      copy: true,
      hint: "Billing on the card: Cash collected: 500 · Next: 1,000 on launch. Payment plan: Split Pay (2x payments)",
    });
    const h = fixtureRow().handover;
    const none = rail(
      fixtureContext({
        row: fixtureRow({ handover: { ...h, next_payment_amount: undefined } }),
      }),
    );
    const p = row(none, "payment");
    expect(p?.value).toBeNull();
    expect(p?.missing).toBe("Not on record.");
    expect(p?.hint).toContain("Cash collected: 500");
    expect(part(none, "missing")?.rows.map(r => r.label)).toEqual([
      "Payment amount",
    ]);
  });
});
