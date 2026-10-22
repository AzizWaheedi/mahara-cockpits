/**
 * The kickoff's hidden fields (src/forms/prefill.ts, docs/csm-forms/
 * KICKOFF.md 2.1 and 2.2), on invented fixtures only: the ID is always the
 * record's, everything else comes from the newest completed onboarding
 * response, the card's Make-built link fills a gap or undoes the mirror's
 * cut and is otherwise a cross-check, and no value is ever cut.
 *
 * Run: bun test scripts/form-prefill.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  FULL_ANSWERS,
  fixtureContext,
  fixtureRow,
  NAME,
  onboardingEntry,
  TASK,
} from "../src/dev/formFixtures";
import { KICKOFF } from "../src/forms/formConfig";
import {
  buildHidden,
  canonicalHidden,
  formLink,
  hiddenSha256,
  KICKOFF_HIDDEN,
  LONG_LINK,
  MIRROR_CUT,
  parseFormLink,
  readCardLink,
  sameValue,
} from "../src/forms/prefill";

const hidden = (row = fixtureRow()) => KICKOFF.hidden(fixtureContext({ row }));
const cardLink = (values: Record<string, string>, formId = "tG7dnxBn") =>
  formLink(formId, values);

describe("the kickoff's hidden fields", () => {
  test("all 23 keys, built from the onboarding entry, in the form's names", () => {
    const p = hidden();
    expect(KICKOFF_HIDDEN.length).toBe(23);
    expect(Object.keys(p.values).sort()).toEqual(
      KICKOFF_HIDDEN.map(s => s.key).sort(),
    );
    expect(p.values.onboarding_client_id).toBe(TASK);
    expect(p.from.onboarding_client_id).toBe("record");
    expect(p.values.legal_name).toBe(FULL_ANSWERS.businessName);
    expect(p.values.phone).toBe("+965 5555 0101");
    expect(p.values.service_focus).toBe("تصميم داخلي للفلل");
    for (const s of KICKOFF_HIDDEN.filter(x => x.ref))
      expect(p.from[s.key]).toBe("onboarding form");
    expect(p.notes).toEqual([]);
    expect(p.onboarding?.response_id).toBe("onbresponse000001");
  });

  test("the phone is the client's Phone answer, never the front desk or the personal number", () => {
    const e = onboardingEntry({ ...FULL_ANSWERS });
    e.answers.push(
      {
        ref: "282dac48-5031-4acb-96b6-ea469e8a5a8b",
        title: "Front",
        value: "+965 1111 1111",
      },
      {
        ref: "09d2e62a-51d4-4665-a3a9-30f5279b71bc",
        title: "Personal",
        value: "+965 2222 2222",
      },
    );
    expect(hidden(fixtureRow({ forms: { onboarding: e } })).values.phone).toBe(
      "+965 5555 0101",
    );
  });

  test("legal_name falls back to the card name", () => {
    const { businessName: _gone, ...rest } = FULL_ANSWERS;
    const p = hidden(
      fixtureRow({ forms: { onboarding: onboardingEntry(rest) } }),
    );
    expect(p.values.legal_name).toBe(NAME);
    expect(p.from.legal_name).toBe("card name");
  });

  test("with no onboarding response, only the ID and the name go, and the panel says so", () => {
    const p = hidden(fixtureRow({ forms: {} }));
    expect(p.values).toEqual({ onboarding_client_id: TASK, legal_name: NAME });
    expect(p.onboarding).toBeNull();
    // Said once, in the panel's "Onboarding answers" row, not as a note.
    expect(p.noOnboarding).toBe(
      `${NAME} has not filled the onboarding form, so the kickoff opens with their name and card only.`,
    );
    expect(p.notes).toEqual([]);
    expect(p.copy?.label).toBe("Copy their onboarding link");
    expect(p.copy?.value).toContain(`#onboarding_client_id=${TASK}`);
    // A card link full of values is still not used without an onboarding response.
    const withLink = hidden(
      fixtureRow({
        forms: {},
        links: {
          kickoff_form: cardLink({
            onboarding_client_id: TASK,
            email: "x@example.invalid",
          }),
        },
      }),
    );
    expect(withLink.values.email).toBeUndefined();
  });

  test("an unfinished or foreign onboarding entry never fills a kickoff", () => {
    const unfinished = { ...onboardingEntry(), submitted_at: "" };
    expect(
      hidden(fixtureRow({ forms: { onboarding: unfinished } })).onboarding,
    ).toBeNull();
    const foreign = { ...onboardingEntry(), form_id: "BbJy6xg4" };
    expect(
      hidden(fixtureRow({ forms: { onboarding: foreign } })).values.email,
    ).toBeUndefined();
  });

  test('"0" is kept, and a multi-choice answer keeps the mirror\'s ", " join', () => {
    const p = hidden();
    expect(p.values.last_revenue).toBe("0");
    expect(p.values.consultation_types).toBe("In-office, Online");
  });

  test("Arabic, line breaks and a leading + survive the URLSearchParams round trip", () => {
    const p = hidden();
    const link = formLink("tG7dnxBn", p.values);
    expect(link).toContain("phone=%2B965");
    expect(link).not.toContain("phone=+965");
    const back = parseFormLink(link);
    expect(back?.formId).toBe("tG7dnxBn");
    expect(back?.hidden).toEqual(p.values);
    expect(back?.hidden.address).toContain("\n");
    expect(back?.hidden.service_focus).toBe("تصميم داخلي للفلل");
  });

  test("the ID is always the row's: a card link with another ID or another form is ignored and said", () => {
    const other = hidden(
      fixtureRow({
        forms: { onboarding: onboardingEntry({ businessName: "Cedar" }) },
        links: {
          kickoff_form: cardLink({
            onboarding_client_id: "86someoneelse",
            email: "wrong@example.invalid",
          }),
        },
      }),
    );
    expect(other.values.onboarding_client_id).toBe(TASK);
    expect(other.values.email).toBeUndefined();
    expect(other.notes).toContain(
      "The card's kickoff link carries another card's ID, so it is out of date and not used.",
    );
    const form = hidden(
      fixtureRow({
        links: {
          kickoff_form: cardLink({ onboarding_client_id: TASK }, "BbJy6xg4"),
        },
      }),
    );
    expect(form.notes).toContain(
      "The card's kickoff link is for another form, so it is not used.",
    );
    expect(
      readCardLink(
        {
          clickup_task_id: TASK,
          links: {
            kickoff_form:
              "https://evil.example/to/tG7dnxBn#onboarding_client_id=86fixture1",
          },
        },
        {
          linkKey: "kickoff_form",
          formId: "tG7dnxBn",
          idField: "onboarding_client_id",
          title: "Kickoff",
        },
      ).usable,
    ).toBe(false);
  });

  test("the card link fills a key the onboarding response left blank", () => {
    const { drive: _gone, ...rest } = FULL_ANSWERS;
    const p = hidden(
      fixtureRow({
        forms: { onboarding: onboardingEntry(rest) },
        links: {
          kickoff_form: cardLink({
            onboarding_client_id: TASK,
            content_drive: "https://drive.example/from-card",
          }),
        },
      }),
    );
    expect(p.values.content_drive).toBe("https://drive.example/from-card");
    expect(p.from.content_drive).toBe("card link");
  });

  test("the 4,000-character cut prefers the card link's longer value, and only one that starts with ours", () => {
    const long = `${"Challenge. ".repeat(500)}`.slice(0, 5000);
    const cut = long.slice(0, MIRROR_CUT);
    const row = fixtureRow({
      forms: {
        onboarding: onboardingEntry({ ...FULL_ANSWERS, challenges: cut }),
      },
      links: {
        kickoff_form: cardLink({
          onboarding_client_id: TASK,
          challenges: long,
        }),
      },
    });
    const p = hidden(row);
    expect(p.values.challenges).toBe(long);
    expect(p.from.challenges).toBe("card link");
    // A longer card value that does not start with the mirror's is not taken.
    const other = hidden(
      fixtureRow({
        forms: {
          onboarding: onboardingEntry({ ...FULL_ANSWERS, challenges: cut }),
        },
        links: {
          kickoff_form: cardLink({
            onboarding_client_id: TASK,
            challenges: `X${long}`,
          }),
        },
      }),
    );
    expect(other.values.challenges).toBe(cut);
    // Cut by the mirror with nothing to undo it: said, not hidden.
    expect(other.notes).toContain(
      'Their "Top challenges" answer is longer than the cockpit keeps, so the form carries its first 4,000 characters.',
    );
    expect(p.notes.some(n => n.includes("longer than the cockpit keeps"))).toBe(
      false,
    );
    // No value is cut, however long the link gets.
    expect(p.linkChars).toBeGreaterThan(5000);
  });

  test('the cross-check ignores Make\'s "," join and a blank for 0, and says a real difference', () => {
    const p = hidden();
    const makeStyle = {
      ...p.values,
      consultation_types: "In-office,Online",
      last_revenue: "",
    };
    delete (makeStyle as Record<string, string>).last_revenue;
    const same = hidden(
      fixtureRow({ links: { kickoff_form: cardLink(makeStyle) } }),
    );
    expect(same.notes.filter(n => n.includes("differs"))).toEqual([]);
    const two = hidden(
      fixtureRow({
        links: {
          kickoff_form: cardLink({
            ...makeStyle,
            email: "old@example.invalid",
            hours: "Old hours",
          }),
        },
      }),
    );
    expect(two.notes).toContain(
      "The card's kickoff link differs on 2 fields. The form uses their onboarding answers.",
    );
    expect(two.values.email).toBe(FULL_ANSWERS.email);
    expect(sameValue("a,b", "a, b")).toBe(true);
    expect(sameValue("", "0")).toBe(true);
    expect(sameValue("0", undefined)).toBe(true);
    expect(sameValue("1", "")).toBe(false);
  });

  test("the length note appears above 4,000 characters, never below", () => {
    expect(hidden().notes.some(n => n.includes("answers are long"))).toBe(
      false,
    );
    const p = hidden(
      fixtureRow({
        forms: {
          onboarding: onboardingEntry({
            ...FULL_ANSWERS,
            marketing: "m".repeat(LONG_LINK),
          }),
        },
      }),
    );
    expect(p.linkChars).toBeGreaterThan(LONG_LINK);
    expect(p.notes).toContain(
      "Their answers are long. If the form opens empty, use Open in Typeform.",
    );
  });

  test("the fingerprint is SHA-256 of the canonical object, whatever the key order", async () => {
    const a = await hiddenSha256({ b: "2", a: "1" });
    const b = await hiddenSha256({ a: "1", b: "2" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(canonicalHidden({ b: "2", a: "1" })).toBe('[["a","1"],["b","2"]]');
    expect(await hiddenSha256({ a: "1" })).not.toBe(a);
  });

  test("buildHidden serves another form's shape: its own ID field and link key", () => {
    const p = buildHidden(
      fixtureRow({
        links: {
          blueprint_form: formLink("oYZKtogO", {
            onboarding_client_id: TASK,
            website: "https://card.example",
          }),
        },
      }),
      {
        spec: [
          { key: "onboarding_client_id", ref: null, label: "Client ID" },
          { key: "website", ref: "not-on-the-form", label: "Website" },
        ],
        formId: "oYZKtogO",
        idField: "onboarding_client_id",
        linkKey: "blueprint_form",
        title: "Brand Blueprint",
      },
    );
    expect(p.values).toEqual({
      onboarding_client_id: TASK,
      website: "https://card.example",
    });
  });
});
