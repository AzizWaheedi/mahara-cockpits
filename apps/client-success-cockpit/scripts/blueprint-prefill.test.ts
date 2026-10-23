import { describe, expect, test } from "bun:test";
import {
  blueprintPrefill,
  type FormLike,
  type PrefillInput,
  parseBudget,
  part1Suggestions,
  servicesOf,
  summary,
} from "../src/present/blueprintPrefill";

/**
 * What the Brand Blueprint knows before the call (docs/brand-blueprint/
 * SPEC.md 1.5), on made-up answers only: the five services from the
 * kickoff's own words and the onboarding form's, two services, no kickoff,
 * the budget read as dollars, the card's fallbacks, the status mappings and
 * the summaries.
 */

const k = (ref: string, title: string, value: string) => ({
  ref,
  title,
  value,
});
const KICK = (answers: ReturnType<typeof k>[]): FormLike => ({
  submitted_at: "2026-10-16T08:10:00Z",
  answers,
});
const base = (over: Partial<PrefillInput> = {}): PrefillInput => ({
  forms: null,
  onboardingPrep: {},
  dosDonts: { do: [], dont: [] },
  card: null,
  packs: {},
  lang: "en",
  ...over,
});

describe("the service (1.1)", () => {
  test("the kickoff's five, word for word, by its ref", () => {
    for (const [words, key] of [
      ["Design and build", "design-build"],
      ["Interior design", "interior"],
      ["Architectural design", "architecture"],
      ["Fit out and renovation", "fitout"],
      ["Construction only", "construction"],
    ] as const) {
      const p = blueprintPrefill(
        base({
          forms: {
            kickoff: KICK([
              k("c0000001-0000-4000-8000-000000000007", "Q", words),
            ]),
          },
        }),
      );
      expect(p.values.service?.value).toBe(key);
      expect(p.values.service?.from).toBe("kickoff");
      expect(p.values.service?.kind).toBe("P");
    }
  });
  test("an answer filed under its title only is read too", () => {
    const p = blueprintPrefill(
      base({
        forms: {
          kickoff: KICK([
            k("x", "Which service are we advertising?", "Interior design"),
          ]),
        },
      }),
    );
    expect(p.values.service?.value).toBe("interior");
  });
  test("two services: no value, slide 4 asks which goes first", () => {
    expect(servicesOf("Design and build, Construction only")).toEqual([
      "design-build",
      "construction",
    ]);
    const p = blueprintPrefill(
      base({
        forms: {
          kickoff: KICK([
            k(
              "c0000001-0000-4000-8000-000000000007",
              "Q",
              "Design and build, Construction only",
            ),
          ]),
        },
      }),
    );
    expect(p.values.service).toBeUndefined();
    expect(p.twoServices).toEqual(["design-build", "construction"]);
    expect(p.notes.join(" ")).toContain("two services");
  });
  test("no kickoff: the onboarding deck's choice, then the form's #1 service (in Arabic too)", () => {
    const chosen = blueprintPrefill(
      base({
        onboardingPrep: {
          service_focus: "Fit-out and renovation",
          service_chosen_at: "2026-10-16T08:00:00Z",
        },
      }),
    );
    expect(chosen.values.service?.value).toBe("fitout");
    expect(chosen.values.service?.from).toBe("deck.service");
    const form = blueprintPrefill(
      base({
        forms: {
          onboarding: {
            submitted_at: "2026-10-13T10:00:00Z",
            answers: [k("6271b610-1", "#1 service", "تصميم داخلي للفلل")],
          },
        },
      }),
    );
    expect(form.values.service?.value).toBe("interior");
    expect(form.kickoff).toBe(false);
    expect(form.notes).toContain(
      "No kickoff on record: ask the service and the budget.",
    );
  });
});

describe("the daily figure (1.6)", () => {
  test("the first number is dollars; a range or another currency gives none", () => {
    expect(parseBudget("$40 a day")).toEqual({ usd: 40, said: "$40 a day" });
    expect(parseBudget("40 دولار")).toEqual({ usd: 40, said: "40 دولار" });
    expect(parseBudget("٤٠")).toEqual({ usd: 40, said: "٤٠" });
    expect(parseBudget("40 to 50")?.usd).toBeNull();
    expect(parseBudget("40-50 a day")?.usd).toBeNull();
    expect(parseBudget("KWD 15")?.usd).toBeNull();
    expect(parseBudget("15 دينار")?.usd).toBeNull();
    expect(parseBudget("")).toBeNull();
  });
  test("the kickoff first, then the card's, with the kickoff's words kept for the notes", () => {
    const kick = blueprintPrefill(
      base({
        forms: { kickoff: KICK([k("cf53482c-1", "Q", "$40 a day")]) },
        cardBudget: 55,
      }),
    );
    expect(kick.values.daily_budget?.value).toEqual({
      usd: 40,
      said: "$40 a day",
    });
    const card = blueprintPrefill(
      base({
        forms: { kickoff: KICK([k("cf53482c-1", "Q", "KWD 15 a day")]) },
        cardBudget: 55,
      }),
    );
    expect(card.values.daily_budget?.value).toEqual({
      usd: 55,
      said: "KWD 15 a day",
    });
    expect(card.values.daily_budget?.from).toBe("card.budget");
    expect(card.notes).toContain(
      "The kickoff said KWD 15 a day: confirm it in dollars.",
    );
  });
});

describe("the statuses", () => {
  const status = (v: string) =>
    blueprintPrefill(
      base({ forms: { kickoff: KICK([k("eb7ed18c-1", "Q", v)]) } }),
    );
  test("Templated Ads Status: approved, declined, wants to see them first, else starter first", () => {
    const ok = status("Approved");
    expect(ok.values.starter?.value).toBe("yes");
    expect(ok.values.pack_approval?.value).toBe("before");
    expect(status("Declined").values.starter?.value).toBe("no");
    const see = status("Wants To See Them First");
    expect(see.values.starter).toMatchObject({ value: "yes", kind: "D" });
    expect(see.values.approval?.value).toBe("first_batch");
    expect(see.values.pack_approval).toBeUndefined();
    expect(blueprintPrefill(base()).values.starter).toMatchObject({
      value: "yes",
      kind: "D",
      from: "default",
    });
  });
  test("Facebook Access Status: ours, theirs, else asked", () => {
    const id = (v: string) =>
      blueprintPrefill(
        base({ forms: { kickoff: KICK([k("6fcbd33c-1", "Q", v)]) } }),
      ).values.identity?.value;
    expect(id("Using Ours")).toBe("our_page");
    expect(id("Access Confirmed")).toBe("their_page");
    expect(id("Their Page Our Ad Acc")).toBe("their_page");
    expect(id("Pending")).toBeUndefined();
  });
  test("Can Self-Record? from the card", () => {
    const cam = (v: string) =>
      blueprintPrefill(base({ card: { canSelfRecord: v } })).values.camera
        ?.value;
    expect(cam("Yes - studio/cameraman")).toBe("yes_studio");
    expect(cam("Yes - phone only")).toBe("yes_phone");
    expect(cam("No")).toBe("no");
    expect(cam("Unsure")).toBe("unsure");
  });
});

describe("red lines, rules and summaries", () => {
  test("the onboarding deck's red lines (Arabic on an Arabic deck), else the card's DON'Ts", () => {
    const deck = blueprintPrefill(
      base({
        onboardingPrep: {
          red_lines: ["No prices"],
          red_lines_ar: ["بدون أسعار"],
        },
        dosDonts: { do: ["Real projects"], dont: ["No stock photos"] },
        lang: "ar",
      }),
    );
    expect(deck.values.red_lines?.value).toEqual(["بدون أسعار"]);
    const card = blueprintPrefill(
      base({ dosDonts: { do: ["Real projects"], dont: ["No stock photos"] } }),
    );
    expect(card.values.red_lines?.value).toEqual(["No stock photos"]);
    expect(card.values.rules?.value).toEqual({
      always: ["Real projects"],
      never: ["No stock photos"],
    });
  });
  test("a summary is cut on a whole word near 160 characters; Arabic stays as typed", () => {
    const long = "Families who have just finished the shell of their villa "
      .repeat(5)
      .trim();
    const s = summary(long);
    expect(s.length).toBeLessThanOrEqual(161);
    expect(s.endsWith("…")).toBe(true);
    expect(long.startsWith(s.slice(0, -1))).toBe(true);
    expect(summary("عملاء يبون فيلا كاملة")).toBe("عملاء يبون فيلا كاملة");
    const p = blueprintPrefill(
      base({
        forms: {
          onboarding: {
            submitted_at: "2026-10-13T10:00:00Z",
            answers: [k("6c819933-1", "Q", long)],
          },
        },
      }),
    );
    expect(p.values.best_client).toMatchObject({
      kind: "S",
      full: long,
      date: "2026-10-13",
    });
  });
  test("prep's Confirm part 1 offers only part 1's suggestions not yet answered", () => {
    const p = blueprintPrefill(
      base({
        forms: {
          kickoff: KICK([
            k("c0000001-0000-4000-8000-000000000007", "Q", "Interior design"),
            k("cf53482c-1", "Q", "$40"),
          ]),
        },
        packs: {
          interior: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
        },
      }),
    );
    expect(part1Suggestions(p, {}).map(s => s.key)).toEqual([
      "service",
      "starter",
      "pack_url",
      "daily_budget",
      "destination",
    ]);
    expect(
      part1Suggestions(p, { service: "fitout" }).map(s => s.key),
    ).not.toContain("service");
  });
});
