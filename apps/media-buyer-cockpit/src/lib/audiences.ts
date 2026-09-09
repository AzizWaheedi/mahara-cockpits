/**
 * The audience plan, in plain English.
 *
 * This is Mahara's own audience library, not Meta's defaults: you cannot buy
 * wealth in the GCC — there is no income or homeowner targeting — so the money
 * comes from geo, price-anchored creative, and lookalikes seeded on real buyers.
 * Interest stacks decide who sees it; the funnel decides who qualifies.
 */

export type ServiceLine =
  | "villa_construction"
  | "renovation"
  | "interior_design"
  | "kitchens"
  | "materials"
  | "landscaping"
  | "hvac"
  | "real_estate"
  | "facility";

export const SERVICE_LINES: Array<{ value: ServiceLine; label: string }> = [
  { value: "villa_construction", label: "Villa construction / turnkey" },
  { value: "renovation", label: "Renovation / fit-out" },
  { value: "interior_design", label: "Interior design / decor" },
  { value: "kitchens", label: "Kitchens / joinery / furniture" },
  { value: "materials", label: "Marble / ceramic / materials" },
  { value: "landscaping", label: "Landscaping / pools" },
  { value: "hvac", label: "HVAC / smart home / MEP" },
  { value: "real_estate", label: "Real estate / off-plan" },
  { value: "facility", label: "Facility management" },
];

type Plan = {
  /** One line she can read without knowing what a "module" is. */
  who: string;
  interests: string[];
  narrow?: string[];
  ageFloor: number;
  ageCeiling: number;
};

export const PLANS: Record<ServiceLine, Plan> = {
  villa_construction: {
    who: "People who own or are building a property, narrowed to luxury signals.",
    interests: ["Home improvement", "Construction", "Architecture"],
    narrow: ["Luxury vehicles", "Luxury goods"],
    ageFloor: 30,
    ageCeiling: 60,
  },
  renovation: {
    who: "Property owners who follow design and renovation content.",
    interests: ["Home improvement", "Renovation", "Interior design"],
    ageFloor: 28,
    ageCeiling: 55,
  },
  interior_design: {
    who: "People with design taste, narrowed to luxury signals.",
    interests: ["Interior design", "Furniture", "Home decor"],
    narrow: ["Luxury goods"],
    ageFloor: 28,
    ageCeiling: 55,
  },
  kitchens: {
    who: "Property owners and people who just moved, who follow design.",
    interests: ["Kitchen", "Home improvement", "Furniture"],
    narrow: ["Interior design"],
    ageFloor: 28,
    ageCeiling: 55,
  },
  materials: {
    who: "Homeowners renovating — the material interests themselves don't exist on Meta, so these are the working proxies.",
    interests: ["Kitchen", "Home improvement", "Interior design"],
    ageFloor: 28,
    ageCeiling: 55,
  },
  landscaping: {
    who: "Property owners interested in gardens and pools.",
    interests: ["Gardening", "Landscaping", "Swimming pool"],
    narrow: ["Luxury goods"],
    ageFloor: 30,
    ageCeiling: 60,
  },
  hvac: {
    who: "Property owners interested in air conditioning and home automation.",
    interests: ["Air conditioning", "Home automation", "Home improvement"],
    ageFloor: 28,
    ageCeiling: 60,
  },
  real_estate: {
    who: "Property buyers and off-plan investors, including expats who travel.",
    interests: ["Real estate", "Property investment", "Frequent travellers"],
    narrow: ["Luxury goods"],
    ageFloor: 30,
    ageCeiling: 60,
  },
  facility: {
    who: "Decision makers at businesses — facilities and operations roles.",
    interests: ["Facility management", "Property management"],
    ageFloor: 30,
    ageCeiling: 60,
  },
};

/**
 * What I'd recommend — not a template.
 *
 * The number of ad sets is a budget question, not a preference. Meta needs roughly
 * 50 conversions a week per ad set to get out of learning; at $30 a day, splitting
 * three ways starves all three and none of them ever learns. So the recommendation
 * scales with the money, and she can override any of it.
 */
export function recommendAdSets(budget: number, line: ServiceLine) {
  const p = PLANS[line];
  const stack = {
    name: "Interest stack",
    what: p.who,
    detail: `${p.interests.join(", ")}${p.narrow ? ` — narrowed to ${p.narrow.join(", ")}` : ""}. Advantage+ off, or Meta ignores the stack and the test tells you nothing.`,
  };
  const broad = {
    name: "Broad",
    what: "No targeting — let Meta find them.",
    detail:
      "Advantage+ Audience on. Usually the strongest single ad set in the GCC.",
  };
  const lal = {
    name: "Lookalike",
    what: "People who look like this client's actual closed buyers.",
    detail: "1% lookalike off the buyer seed list. Advantage+ off.",
  };

  if (budget < 50) {
    return {
      sets: [broad],
      why: `At $${budget} a day, one ad set. Split this three ways and each gets $${Math.round(budget / 3)} — none of them ever gets enough conversions to leave learning, and you learn nothing from any of them.`,
    };
  }
  if (budget < 100) {
    return {
      sets: [broad, stack],
      why: `At $${budget} a day, two ad sets at about $${Math.round(budget / 2)} each. Enough to read a difference between them within a week.`,
    };
  }
  return {
    sets: [broad, stack, lal],
    why: `At $${budget} a day there is room for three at about $${Math.round(budget / 3)} each — add the lookalike only if this client has a real buyer list to seed it with.`,
  };
}

export function ageLine(line: ServiceLine): string {
  const p = PLANS[line];
  return `Age ${p.ageFloor}–${p.ageCeiling} — never 18–65, that just buys people who cannot afford it.`;
}

export const ALWAYS = [
  "People living in this location — never “recently in”, that buys tourists.",
  "Exclude everyone who already enquired in the last 180 days.",
  "Exclude the leads we already marked unqualified.",
];
