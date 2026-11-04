/**
 * The kickoff's side panel (src/forms/formRail.ts, docs/csm-forms/
 * KICKOFF.md 3): every fact's source order and its plain sentence when
 * missing, the service in the onboarding deck's order, the card's Service
 * Advertised field never read, and a payment never computed. Stage 4 plan
 * B5: the Content row falls back to the card's Drive folder, and "Check
 * with the client" lists only the flags that hold, each a fixed sentence,
 * display only. Synthetic answers only.
 *
 * Run: bun test scripts/form-rail.test.ts
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type Answers,
  FULL_ANSWERS,
  fixtureCall,
  fixtureContext,
  fixtureDeck,
  fixtureRow,
  fixtureTimeline,
  onboardingEntry,
} from "../src/dev/formFixtures";
import { CheckPart, RailView } from "../src/forms/FormPanel";
import type { FormContext, RailPart } from "../src/forms/formConfig";
import {
  CHECK_SAYS,
  CONTRACT_CHOICES,
  clientChecks,
  contractChoice,
  countryName,
  foldEmpty,
  hostOf,
  isDriveLink,
  NOT_DRIVE,
  sameName,
  suggestedService,
} from "../src/forms/formRail";
import { KICKOFF } from "../src/forms/kickoff";

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
    // Typeform reads the carried values back itself, so they come last.
    expect(part(parts, "order")?.rows.map(r => r.id)).toEqual([
      "service",
      "consultation-types",
      "contract",
      "daily-budget",
      "facebook",
      "calendar",
      "content",
      "recording",
      "payment",
      "carries",
    ]);
    // The five services are drawn once, on Q10, not again on The client.
    expect(part(parts, "client")?.rows.map(r => r.id)).toEqual([
      "offer",
      "area",
    ]);
  });

  test("a portal onboarding answer (form_id native) reads as a full record, never as the form not filled (F1)", () => {
    const typeform = onboardingEntry();
    const native = { ...typeform, form_id: "native" };
    const parts = rail(
      fixtureContext({ row: fixtureRow({ forms: { onboarding: native } }) }),
    );
    expect(parts.map(p => p.id)).toEqual(["client", "order", "sale"]);
    expect(JSON.stringify(parts)).not.toContain(
      "has not filled the onboarding form",
    );
    // The same rail as the same answers through Typeform.
    expect(JSON.stringify(parts)).toBe(
      JSON.stringify(
        rail(
          fixtureContext({
            row: fixtureRow({ forms: { onboarding: typeform } }),
          }),
        ),
      ),
    );
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
    // Short pointers to their rows; the full sentence is said once, there.
    expect(parts[0].rows.map(r => [r.label, r.missing, r.anchor])).toEqual([
      ["Call recording link", "Not in the call store yet.", "recording"],
      ["Contract status", "Ask on the call.", "contract"],
      ["Service", "Ask on the call.", "service"],
      [
        "Onboarding answers",
        "Cedar & Stone Interiors has not filled the onboarding form, so the kickoff opens with their name and card only.",
        undefined,
      ],
      ["Payment amount", "Not on the card.", "payment"],
    ]);
    // Their onboarding link to send is in the same row.
    expect(parts[0].rows[3].action?.label).toBe("Copy their onboarding link");
    expect(row(parts, "recording")?.missing).toBe(
      "Not in the call store yet. It arrives a few minutes after the call ends. Check again, or paste it from Fathom.",
    );
    // One casing in both lists.
    expect(row(parts, "recording")?.label).toBe("Call recording link");
    expect(row(parts, "payment")?.label).toBe("Payment amount");
    // Empty rows in a row are one line; a row Still missing points to stays.
    const order = part(parts, "order")?.rows ?? [];
    const empties = order.find(r => r.empties);
    expect(empties?.empties).toEqual([
      "Daily budget at the sale",
      "Facebook access",
      "Calendar",
      "Content",
    ]);
    expect(order.map(r => r.id)).toContain("payment");
    expect(order.map(r => r.id)).toContain("contract");
  });

  test("foldEmpty: two or more plain empty rows become one line, one stays itself", () => {
    const empty = (id: string) => ({
      id,
      label: id,
      value: null,
      source: null,
      missing: "Not on record.",
    });
    const full = { id: "x", label: "X", value: "1", source: null };
    expect(foldEmpty([empty("a"), full, empty("b")], new Set())).toEqual([
      empty("a"),
      full,
      empty("b"),
    ]);
    const folded = foldEmpty([empty("a"), empty("b"), full], new Set());
    expect(folded[0].empties).toEqual(["a", "b"]);
    expect(folded[0].missing).toBe("Not on record.");
    expect(
      foldEmpty([empty("a"), empty("b")], new Set(["b"])).map(r => r.id),
    ).toEqual(["a", "b"]);
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
    expect(row(rail(ctx), "daily-budget")).toBeUndefined();
    expect(
      rail(ctx)
        .flatMap(p => p.rows)
        .find(r => r.empties?.includes("Daily budget at the sale")),
    ).toBeTruthy();
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
      value: "Salmiya, Kuwait",
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

  test("a country code reads as the country's name", () => {
    expect(countryName("KW")).toBe("Kuwait");
    expect(countryName("sa")).toBe("Saudi Arabia");
    expect(countryName("Kuwait")).toBe("Kuwait");
    expect(countryName(null)).toBeNull();
  });

  test("services, on Q10: the five as the form's exact labels, the suggestion ringed, their own words under each", () => {
    const s = row(rail(), "service");
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
    // The shared source is said once, in the title.
    expect(c?.label).toBe(
      "What the form carries · 22 of 22 · onboarding form, 13 Oct",
    );
    expect(c?.carriesFrom).toBe("Onboarding form, 13 Oct");
    expect(c?.blank).toBe("Left blank");
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
    expect(blank?.label).toBe(
      "What the form carries · 21 of 22 · onboarding form, 13 Oct",
    );
    expect(blank?.carries?.find(x => x.key === "client_notes")).toMatchObject({
      value: null,
      source: null,
    });
    expect(blank?.missing).toBe("The client left it blank.");
    // No onboarding answers: the card name is the one value, and its source.
    const none = row(
      rail(fixtureContext({ row: fixtureRow({ forms: {} }) })),
      "carries",
    );
    expect(none?.label).toBe(
      "What the form carries · 1 of 22 · ClickUp card name",
    );
    expect(none?.blank).toBe("Not on record");
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
    // A fact from the card, not a suggestion.
    expect(row(rail(), "contract")).toMatchObject({
      value: "Signed",
      source: "ClickUp card",
    });
    expect(row(rail(), "contract")?.suggest).toBeUndefined();
    expect(row(rail(), "consultation-types")?.suggest).toBe(true);
  });

  test("daily budget: the card's, said as the sale's figure (CEO item 5), in its dollars, with a copy button that copies digits", () => {
    expect(row(rail(), "daily-budget")).toMatchObject({
      label: "Daily budget at the sale",
      value: "$40 a day",
      copyValue: "40",
      copy: true,
      source: "ClickUp card (the sale)",
    });
    expect(row(rail(), "daily-budget")?.hint).toBeUndefined();
    // 1,000 or more looks like a month or another currency (the media buyers' guard).
    const big = rail(
      fixtureContext({
        row: fixtureRow({
          handover: { ...fixtureRow().handover, daily_budget: 1500 },
        }),
      }),
    );
    expect(row(big, "daily-budget")).toMatchObject({
      value: "$1,500 a day",
      hint: "Looks like a month or another currency. Ask the client for the daily amount.",
    });
  });

  test("daily budget after a kickoff: said as the card's, never the sale's (card_facts may have filled it from the kickoff)", () => {
    const kickoff = {
      form_id: "native-kickoff",
      response_id: "kickresponse000001",
      submitted_at: "2026-10-20T08:00:00Z",
      answers: [],
    };
    const after = rail(
      fixtureContext({
        row: fixtureRow({
          forms: { onboarding: onboardingEntry(), kickoff },
        }),
      }),
    );
    expect(row(after, "daily-budget")).toMatchObject({
      label: "Daily Budget on the card",
      value: "$40 a day",
      source: "ClickUp card",
      hint: "May be the last kickoff's figure: an empty Daily Budget is filled from the kickoff.",
    });
    expect(JSON.stringify(after)).not.toContain("Daily budget at the sale");
    expect(JSON.stringify(after)).not.toContain("ClickUp card (the sale)");
    // An empty card folds under the neutral label, never a zero.
    const empty = rail(
      fixtureContext({
        row: fixtureRow({
          forms: { onboarding: onboardingEntry(), kickoff },
          handover: { ...fixtureRow().handover, daily_budget: undefined },
        }),
      }),
    );
    const slot = empty
      .flatMap(p => p.rows)
      .find(
        r =>
          r.id === "daily-budget" ||
          r.empties?.includes("Daily Budget on the card"),
      );
    expect(slot).toBeTruthy();
    if (slot?.id === "daily-budget")
      expect(slot).toMatchObject({
        label: "Daily Budget on the card",
        value: null,
        missing: "Not on record.",
      });
  });

  test("calendar and content from the onboarding form", () => {
    expect(row(rail(), "calendar")).toMatchObject({
      value: "Calendly",
      hint: "Appointments: 45 minutes, 15 minute buffer",
    });
    // The fixture's answer is a link, but not a Drive one, and the card has none.
    expect(row(rail(), "content")).toMatchObject({
      href: "https://drive.example/cedar-content",
      linkLabel: "Their link",
      hint: NOT_DRIVE,
    });
    expect(row(rail(), "facebook")?.value).toBe("Yes, we ran ads before");
  });

  test("call recording: today's onboarding call with a recording, Kuwait day, with Check again", () => {
    const r = row(rail(), "recording");
    expect(r).toMatchObject({
      value: "https://fathom.example/share/cedar-onboarding",
      href: "https://fathom.example/share/cedar-onboarding",
      linkLabel: "Open the recording",
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
      value: "$1,000",
      copyValue: "1000",
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

// ---- Stage 4 plan B5 ---------------------------------------------------

/** The fixture's record with some onboarding answers changed (synthetic). */
const withAnswers = (
  change: Answers,
  over: Parameters<typeof fixtureRow>[0] = {},
) =>
  fixtureContext({
    row: fixtureRow({
      forms: { onboarding: onboardingEntry({ ...FULL_ANSWERS, ...change }) },
      ...over,
    }),
  });
const CARD_DRIVE = "https://drive.google.com/drive/folders/fixtureCardDrive";
const CARD_FOLDER = "https://drive.google.com/drive/folders/fixtureCardFolder";
const THEIR_DRIVE = "https://drive.google.com/drive/folders/fixtureTheirs";
const cardLinks = (more: Record<string, string>) => ({
  links: { ...fixtureRow().links, ...more },
});
const checkIds = (answers: Answers, name = "Cedar & Stone Interiors") =>
  clientChecks(onboardingEntry({ ...FULL_ANSWERS, ...answers }), name).map(
    c => c.id,
  );

describe("content: their Drive link, else the card's Drive folder", () => {
  test("their own Drive or Docs link stays first, even when the card has one", () => {
    for (const theirs of [
      THEIR_DRIVE,
      "https://docs.google.com/document/d/fixture",
    ]) {
      const c = row(
        rail(withAnswers({ drive: theirs }, cardLinks({ drive: CARD_DRIVE }))),
        "content",
      );
      expect(c).toMatchObject({
        value: theirs,
        href: theirs,
        linkLabel: "Their Drive link",
        source: "Onboarding form, 13 Oct",
      });
      expect(c?.hint).toBeUndefined();
    }
  });

  test("a blank answer shows the card's Drive link, with its field as the source", () => {
    const { drive: _gone, ...rest } = FULL_ANSWERS;
    const ctx = fixtureContext({
      row: fixtureRow({
        forms: { onboarding: onboardingEntry(rest) },
        ...cardLinks({ drive: CARD_DRIVE }),
      }),
    });
    expect(row(rail(ctx), "content")).toMatchObject({
      value: CARD_DRIVE,
      href: CARD_DRIVE,
      linkLabel: "The card's Drive folder",
      source: "ClickUp card, Drive Link",
    });
    expect(row(rail(ctx), "content")?.hint).toBeUndefined();
  });

  test("the card's Drive Folder field comes before its Drive Link, as elsewhere in the cockpit", () => {
    const c = row(
      rail(
        withAnswers(
          { drive: "" },
          cardLinks({ drive: CARD_DRIVE, drive_folder: CARD_FOLDER }),
        ),
      ),
      "content",
    );
    expect(c).toMatchObject({
      href: CARD_FOLDER,
      source: "ClickUp card, Drive Folder",
    });
  });

  test("an answer that is not a Drive link: the card's folder, and a hint that says so", () => {
    for (const theirs of [
      "https://instagram.com/cedar.stone.example",
      "https://www.dropbox.com/fixture",
      "سأرسلها على الواتساب",
    ]) {
      const c = row(
        rail(withAnswers({ drive: theirs }, cardLinks({ drive: CARD_DRIVE }))),
        "content",
      );
      expect(c).toMatchObject({
        value: CARD_DRIVE,
        linkLabel: "The card's Drive folder",
        hint: "Their answer is not a Drive folder.",
      });
    }
  });

  test("no Drive link anywhere: not on record, never a made-up link", () => {
    const ctx = withAnswers({ drive: "" }, { links: {} });
    const c = rail(ctx)
      .flatMap(p => p.rows)
      .find(r => r.id === "content" || r.empties?.includes("Content"));
    expect(c?.value).toBeNull();
    expect(c?.missing).toBe("Not on record.");
    expect(c?.href).toBeUndefined();
  });

  test("hosts: with or without https://, www. dropped, Drive and Docs only", () => {
    expect(hostOf("www.Facebook.com/x")).toBe("facebook.com");
    expect(hostOf("https://m.facebook.com/x")).toBe("m.facebook.com");
    expect(hostOf("not a link")).toBeNull();
    expect(hostOf("")).toBeNull();
    expect(isDriveLink("drive.google.com/drive/folders/x")).toBe(true);
    expect(isDriveLink("https://drive.google.com.example/x")).toBe(false);
    expect(isDriveLink(null)).toBe(false);
  });
});

describe("check with the client: only the flags that hold", () => {
  test("a clean record has no part; one flag puts it after Still missing and before the client", () => {
    expect(part(rail(), "check")).toBeUndefined();
    expect(checkIds({})).toEqual([]);
    const parts = rail(
      withAnswers({ facebook: "https://instagram.com/cedar.stone.example" }),
    );
    expect(parts.map(p => p.id)).toEqual(["check", "client", "order", "sale"]);
    expect(part(parts, "check")).toMatchObject({
      title: "Check with the client",
      rows: [
        {
          id: "check-facebook-instagram",
          label: "Facebook page",
          value:
            "Their Facebook page answer is an Instagram link. Ask for the Facebook page's link.",
          source: "Onboarding form, 13 Oct",
        },
      ],
    });
    const missing = rail(
      withAnswers(
        { facebook: "https://instagram.com/cedar.stone.example" },
        { handover: {} },
      ),
    );
    expect(missing.map(p => p.id).slice(0, 2)).toEqual(["missing", "check"]);
  });

  test("no onboarding answers: nothing to check", () => {
    expect(clientChecks(null, "Cedar & Stone Interiors")).toEqual([]);
    expect(
      part(rail(fixtureContext({ row: fixtureRow({ forms: {} }) })), "check"),
    ).toBeUndefined();
  });

  test("Facebook: an Instagram link, or any other answer that is not on Facebook", () => {
    expect(checkIds({ facebook: "instagram.com/cedar" })).toEqual([
      "facebook-instagram",
    ]);
    expect(checkIds({ facebook: "https://linktr.ee/cedar" })).toEqual([
      "facebook-other",
    ]);
    expect(checkIds({ facebook: "Cedar and Stone" })).toEqual([
      "facebook-other",
    ]);
    for (const ok of [
      "https://www.facebook.com/cedar",
      "m.facebook.com/cedar",
      "https://web.facebook.com/cedar",
      "https://fb.com/cedar",
      "https://fb.me/cedar",
    ])
      expect(checkIds({ facebook: ok })).toEqual([]);
    // Blank is said as missing elsewhere, never as a check.
    expect(checkIds({ facebook: "" })).toEqual([]);
  });

  test("Instagram: any answer not on Instagram", () => {
    expect(checkIds({ instagram: "https://facebook.com/cedar" })).toEqual([
      "instagram",
    ]);
    expect(checkIds({ instagram: "@cedar.stone" })).toEqual(["instagram"]);
    expect(checkIds({ instagram: "instagram.com/cedar" })).toEqual([]);
    expect(checkIds({ instagram: "https://instagr.am/cedar" })).toEqual([]);
  });

  test("website: a social, Linktree or Google Maps link instead of a site", () => {
    for (const social of [
      "https://instagram.com/cedar",
      "https://www.facebook.com/cedar",
      "https://linktr.ee/cedar",
      "https://maps.app.goo.gl/fixture",
      "https://goo.gl/maps/fixture",
      "https://www.google.com/maps/place/fixture",
      "https://maps.google.com/?q=fixture",
    ])
      expect(checkIds({ website: social })).toEqual(["website"]);
    for (const site of [
      "https://cedar-stone.example",
      "cedar-stone.example",
      "https://www.google.com/search?q=cedar",
      "Coming soon",
    ])
      expect(checkIds({ website: site })).toEqual([]);
  });

  test("business name: normalised, neither containing the other", () => {
    expect(sameName("Cedar & Stone Interiors", "Cedar & Stone Interiors")).toBe(
      true,
    );
    expect(sameName("Cedar and Stone", "Cedar & Stone Interiors")).toBe(true);
    expect(sameName("CEDAR STONE", "Cedar & Stone Interiors W.L.L")).toBe(true);
    // A card that carries both scripts matches either.
    expect(sameName("سيدار ستون", "Cedar Stone | سيدار ستون")).toBe(true);
    expect(sameName("Cedar Stone", "Cedar Stone | سيدار ستون")).toBe(true);
    expect(sameName("مؤسسة الأرز", "مؤسسة الارز")).toBe(true);
    expect(sameName("Oak Line Studio", "Cedar & Stone Interiors")).toBe(false);
    expect(sameName("Cedar Stone", "سيدار ستون")).toBe(false);
    expect(checkIds({ businessName: "Oak Line Studio" })).toEqual(["name"]);
    expect(checkIds({ businessName: "Cedar & Stone" })).toEqual([]);
  });

  test("revenue: under 1,000 asks for the units; a 90-day goal above last year's whole revenue asks to check both", () => {
    expect(checkIds({ lastRevenue: "500", goal90: "100" })).toEqual(["units"]);
    // One flag is enough when last year's number is in other units.
    expect(checkIds({ lastRevenue: "500", goal90: "40000" })).toEqual([
      "units",
    ]);
    expect(checkIds({ lastRevenue: "50,000", goal90: "80000" })).toEqual([
      "goal",
    ]);
    expect(checkIds({ lastRevenue: "120000", goal90: "40000" })).toEqual([]);
    expect(checkIds({ lastRevenue: "120000", goal90: "120000" })).toEqual([]);
    // 0 is how Make writes nothing: never a check, and never compared.
    expect(checkIds({ lastRevenue: "0", goal90: "40000" })).toEqual([]);
    expect(checkIds({ lastRevenue: "", goal90: "40000" })).toEqual([]);
    // Words are not read as a number.
    expect(checkIds({ lastRevenue: "about 50k", goal90: "80000" })).toEqual([]);
  });

  test("booking software: none given is the flag; a named tool, WhatsApp or the phone is not", () => {
    for (const none of ["", "No", "no.", "-", "لا يوجد", "لايوجد", "NA", "x"])
      expect(checkIds({ booking: none })).toEqual(["booking"]);
    for (const some of ["Calendly", "WhatsApp", "By phone", "دفتر مواعيد"])
      expect(checkIds({ booking: some })).toEqual([]);
  });

  test("every flag is one of the fixed sentences, in the form's order, and never the client's words", () => {
    const answers: Answers = {
      businessName: "Oak Line Studio",
      facebook: "https://instagram.com/oakline.example",
      instagram: "@oakline",
      website: "https://linktr.ee/oakline",
      lastRevenue: "300",
      booking: "لا يوجد",
    };
    const parts = rail(withAnswers(answers));
    const rows = part(parts, "check")?.rows ?? [];
    expect(rows.map(r => r.id)).toEqual([
      "check-facebook-instagram",
      "check-instagram",
      "check-website",
      "check-name",
      "check-units",
      "check-booking",
    ]);
    const fixed = new Set(Object.values(CHECK_SAYS));
    for (const r of rows) {
      expect(fixed.has(r.value ?? "")).toBe(true);
      for (const typed of Object.values(answers))
        expect(r.value).not.toContain(typed);
    }
  });

  test("display only: the form still carries their answers as they typed them", () => {
    const answers: Answers = {
      facebook: "https://instagram.com/cedar.stone.example",
      website: "https://linktr.ee/cedar",
      booking: "No",
    };
    const ctx = withAnswers(answers);
    const clean = withAnswers({});
    const hidden = KICKOFF.hidden(ctx);
    expect(part(rail(ctx), "check")?.rows.length).toBe(3);
    expect(hidden.values.facebook).toBe(answers.facebook as string);
    expect(hidden.values.website).toBe(answers.website as string);
    expect(hidden.values.booking_platform).toBe("No");
    // Every other hidden value is the clean record's.
    const {
      facebook: _f,
      website: _w,
      booking_platform: _b,
      ...rest
    } = hidden.values;
    const {
      facebook: _f2,
      website: _w2,
      booking_platform: _b2,
      ...cleanRest
    } = KICKOFF.hidden(clean).values;
    expect(rest).toEqual(cleanRest);
  });

  test("drawn as a chip per question and its sentence, the source once, nothing to press", () => {
    const parts = rail(
      withAnswers({
        facebook: "https://instagram.com/cedar.stone.example",
        booking: "-",
      }),
    );
    const check = part(parts, "check") as RailPart;
    const html = renderToStaticMarkup(
      createElement(CheckPart, { part: check }),
    );
    expect(html).toContain('aria-label="Check with the client"');
    expect(html).toContain("Check with the client · 2");
    expect(html).toContain("Facebook page");
    expect(html).toContain("Booking software");
    expect(html).toContain(
      "No booking software given, so there is no system to connect. Ask how they take bookings today.",
    );
    expect(html.match(/Onboarding form, 13 Oct/g)?.length).toBe(1);
    expect(html).not.toMatch(/<button|<input|<a /);
  });
});

describe("from the sale (CEO item 6, sale-tie.md 2.10)", () => {
  const tied = {
    state: "tied" as const,
    signedAt: "2026-10-12T09:00:00Z",
    tiedBy: "phone" as const,
    closer: "Rania",
    goLive: "Within two weeks of the kickoff.",
    handoffProblems: "No",
    expectations: "Ten booked consultations in the first month.",
    salesCallLink: "https://fathom.video/share/example-call",
    voidedInB2B: false,
    otherSales: 0,
  };
  const emptyCard = (over: Record<string, unknown> = {}) =>
    fixtureRow({
      handover: {
        billing_notes: "-Cash collected: 500",
        daily_budget: 40,
        ...over,
      } as never,
    });
  const sale = (ctx: FormContext) => part(rail(ctx), "sale");

  test("a tied sale opens with its stub: the signed day and the method chip, then its answers where the card is empty", () => {
    const p = sale(fixtureContext({ row: emptyCard(), sale: tied }));
    expect(p?.fold).toBe(true);
    expect(p?.rows.map(r => r.id)).toEqual([
      "sale-stub",
      "go-live",
      "handoff-problems",
      "expectations",
      "closer",
      "closer-notes",
    ]);
    expect(p?.rows[0]).toMatchObject({
      label: "Sale",
      value: "Signed 12 Oct",
      chip: { label: "Tied by phone", tone: "accent" },
      href: "https://fathom.video/share/example-call",
      linkLabel: "Watch the sales call",
    });
    const r = (id: string) => p?.rows.find(x => x.id === id);
    expect(r("go-live")).toMatchObject({
      label: "Go-live expectation",
      value: "Within two weeks of the kickoff.",
      source: "New Client Form, 12 Oct",
    });
    // "No" is the closer's real answer to the question, written as typed.
    expect(r("handoff-problems")).toMatchObject({
      label: "Handoff problems",
      value: "No",
      source: "New Client Form, 12 Oct",
    });
    expect(r("expectations")).toMatchObject({
      label: "What they believe they're getting",
      value: "Ten booked consultations in the first month.",
    });
    // Display only: the card's Closer is never written from here.
    expect(r("closer")).toMatchObject({
      value: "Rania",
      source: "New Client Form, 12 Oct",
      hint: "From the New Client Form. The card's Closer is empty.",
    });
  });

  test("the card's own fields come first; each method has its chip; a person's tie is the neutral chip", () => {
    const p = sale(
      fixtureContext({
        row: fixtureRow({
          handover: {
            ...fixtureRow().handover,
            go_live: "Next month.",
          },
        }),
        sale: { ...tied, tiedBy: "person" },
      }),
    );
    const r = (id: string) => p?.rows.find(x => x.id === id);
    expect(r("go-live")).toMatchObject({
      value: "Next month.",
      source: "ClickUp card",
    });
    expect(r("handoff-problems")).toMatchObject({
      value: "Budget is tight for the first month.",
      source: "ClickUp card",
    });
    expect(r("closer")).toMatchObject({
      value: "Omar",
      source: "ClickUp card",
    });
    expect(r("closer")?.hint).toBeUndefined();
    expect(r("sale-stub")?.chip).toEqual({
      label: "Tied by a person",
      tone: "neutral",
    });
    for (const [by, words] of [
      ["email", "Tied by email"],
      ["phone_email", "Tied by phone and email"],
    ] as const)
      expect(
        sale(fixtureContext({ sale: { ...tied, tiedBy: by } }))?.rows[0].chip
          ?.label,
      ).toBe(words);
    // A voided sale and earlier sales on the card are said under the stub.
    expect(
      sale(
        fixtureContext({
          sale: { ...tied, voidedInB2B: true, otherSales: 1 },
        }),
      )?.rows[0].hint,
    ).toBe("Voided in B2B. 1 earlier sale on this card.");
  });

  test("no tied sale says so, never a blank or a zero, and is never folded into Not on record", () => {
    const p = sale(
      fixtureContext({ row: emptyCard(), sale: { state: "none" } }),
    );
    expect(p?.rows[0]).toMatchObject({
      id: "sale-stub",
      label: "Sale",
      value: null,
      missing:
        "Not tied to a New Client Form yet. The CEO can tie it under Sales not on a card.",
    });
    // The card's empty rows fold into one line after the stub.
    expect(p?.rows[1].empties).toEqual([
      "Go-live expectation",
      "Handoff problems",
      "Closer",
      "Closer's notes",
    ]);
  });

  test("before the sale tie (not read, or its function missing) the part keeps the card's rows; a failed read says so", () => {
    for (const ctx of [
      fixtureContext(),
      fixtureContext({ sale: { state: "missing" } }),
      // Sale ties off: nothing can be tied, so no stub sends anyone to tie it.
      fixtureContext({ sale: { state: "off" } }),
    ]) {
      const p = sale(ctx);
      expect(p?.rows.map(r => r.id)).not.toContain("sale-stub");
      expect(p?.rows.find(r => r.id === "handoff-problems")?.value).toBe(
        "Budget is tight for the first month.",
      );
      expect(p?.problem).toBeUndefined();
    }
    expect(sale(fixtureContext({ failed: { sale: "down" } }))?.problem).toBe(
      "The sale tied to this card could not be read just now.",
    );
  });
});

test("the rail draws the sale stub's chip beside its value, and a folded part's problem", () => {
  const parts = rail(
    fixtureContext({
      sale: {
        state: "tied",
        signedAt: "2026-10-12T09:00:00Z",
        tiedBy: "email",
        closer: null,
        goLive: null,
        handoffProblems: null,
        expectations: null,
        salesCallLink: null,
        voidedInB2B: false,
        otherSales: 0,
      },
    }),
  );
  const html = renderToStaticMarkup(
    createElement(RailView, {
      config: { title: "Kickoff" },
      parts,
      notes: [],
      failedSends: null,
      after: null,
      jumped: null,
      onJump: () => {},
      onRecheck: async () => {},
    }),
  );
  expect(html).toContain("Signed 12 Oct");
  expect(html).toContain("Tied by email");
  const failed = renderToStaticMarkup(
    createElement(RailView, {
      config: { title: "Kickoff" },
      parts: rail(fixtureContext({ failed: { sale: "down" } })),
      notes: [],
      failedSends: null,
      after: null,
      jumped: null,
      onJump: () => {},
      onRecheck: async () => {},
    }),
  );
  expect(failed).toContain(
    "The sale tied to this card could not be read just now.",
  );
});
