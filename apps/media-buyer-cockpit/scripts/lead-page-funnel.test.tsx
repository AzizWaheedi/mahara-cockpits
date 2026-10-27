/**
 * A lead page in Open funnel (src/lib/leadPageFunnel.ts and
 * src/components/funnel/LeadPageJourney.tsx), Muhammed 2026-10-27: the lead
 * page reads as the instant form does, with one Edit form button.
 * - the ad link finds the client's page by host, whatever its path or tags;
 * - the campaign line names the page as an instant form is named;
 * - each step carries the ad visitors who reached it, and "Most stop here" marks
 *   the screen most of them left from (never the CRM saving the lead);
 * - visits not read yet show no number, never 0;
 * - the instant form's rail still reads as before.
 * Rendered on the server: nothing here reaches the network.
 */
import { expect, test } from "bun:test";

for (const e of [process.env, (import.meta as any).env].filter(Boolean))
  Object.assign(e, {
    VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
    VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
  });

const { renderToStaticMarkup } = await import("react-dom/server");
const { leakScreen, pageForUrl, pageJourney, pageLine, visitDays } =
  await import("../src/lib/leadPageFunnel");
const { LeadPageJourney } = await import(
  "../src/components/funnel/LeadPageJourney"
);
const { JourneyRail } = await import("../src/components/funnel/JourneyRail");
const { LeadPageSection } = await import(
  "../src/components/pageform/LeadPageSection"
);

type Page = import("../src/lib/pageFormClient").PageFormPage;
type Step = import("../src/lib/pageFormClient").FunnelStep;

const SITE = "https://merge.example.com";
const question = (key: string, label: string) => ({
  key,
  name: key,
  label,
  style: "list" as const,
  options: [{ value: "أ" }, { value: "ب" }],
});
const PAGE: Page = {
  slug: "mergestudio",
  title: "Merge Studio form page",
  siteUrl: SITE,
  publicUrl: `${SITE}/live.json`,
  photos: [],
  bindings: { type: "project_type", when: "start_when" },
  liveVersion: 2,
  current: {
    version: "v2",
    questions: [
      question("type", "ايش نوع مشروعك"),
      question("when", "متى ناوي تبدا"),
      question("budget", "كم ميزانيتك"),
    ],
  },
  retired: [],
  versions: [
    {
      version: 2,
      label: "v2",
      summary: "Added the budget question",
      source: "cockpit",
      by: "buyer@maharamedia.com",
      at: "2026-10-26T10:00:00Z",
      wentLive: "2026-10-26T10:01:00Z",
      live: true,
    },
    {
      version: 1,
      label: "v1",
      summary: "The questions the page was built with",
      source: "build",
      by: null,
      at: "2026-10-22T10:00:00Z",
      wentLive: "2026-10-22T10:00:00Z",
      live: false,
    },
  ],
};
// 12 opened, 5 started, then down to the thank-you page.
const STEPS: Step[] = [
  { screen: "intro", label: "Opened the page", visits: 12 },
  { screen: "q:type", label: "ايش نوع مشروعك", visits: 5 },
  { screen: "q:when", label: "متى ناوي تبدا", visits: 4 },
  { screen: "q:budget", label: "كم ميزانيتك", visits: 4 },
  { screen: "contact", label: "Reached the contact step", visits: 3 },
  { screen: "send", label: "Pressed send", visits: 2 },
  { screen: "thanks", label: "Saw the thank-you page", visits: 0 },
];
const LISTED = [
  {
    slug: "mergestudio",
    client: "mergestudio.kw",
    title: "Merge Studio form page",
    siteUrl: SITE,
  },
];

test("an ad link finds the client's page by its host", () => {
  expect(pageForUrl(LISTED, "https://merge.example.com/")?.slug).toBe(
    "mergestudio",
  );
  expect(
    pageForUrl(LISTED, "https://www.merge.example.com/offer?utm_medium=paid")
      ?.slug,
  ).toBe("mergestudio");
  expect(pageForUrl(LISTED, "https://other.example.com/")).toBeUndefined();
  expect(pageForUrl(LISTED, "not a link")).toBeUndefined();
  expect(pageForUrl(undefined, "https://merge.example.com/")).toBeUndefined();
});

test("the page's visit window is the one nearest the sheet's dates", () => {
  const range = (start: string, end: string) => ({
    start,
    end,
    key: "x",
    label: "x",
  });
  expect(visitDays(range("2026-10-24", "2026-10-26"))).toBe(7);
  expect(visitDays(range("2026-10-01", "2026-10-26"))).toBe(30);
  expect(visitDays(range("2026-08-01", "2026-10-26"))).toBe(90);
});

test("the campaign line names the page as an instant form is named", () => {
  expect(pageLine(PAGE, 3)).toBe(
    "Lead page “Merge Studio form page” · 3 questions · 3 ads",
  );
  expect(
    pageLine({ ...PAGE, current: { version: "v1", questions: [] } }, 1),
  ).toBe("Lead page “Merge Studio form page” · 0 questions · 1 ad");
  expect(pageLine({ ...PAGE, current: null }, 2)).toBe(
    "Lead page “Merge Studio form page” · 2 ads",
  );
});

test("each step carries its visits, and the leak is the screen most visitors left", () => {
  const steps = pageJourney(PAGE, STEPS);
  expect(steps.map(s => [s.id, s.visits, s.leak])).toEqual([
    ["intro", 12, true],
    ["questions", null, false],
    ["contact", 3, false],
    ["thanks", 0, false],
  ]);
  expect(steps[1].questions?.map(q => [q.label, q.screen, q.visits])).toEqual([
    ["ايش نوع مشروعك", 1, 5],
    ["متى ناوي تبدا", 2, 4],
    ["كم ميزانيتك", 3, 4],
  ]);
  // Phone screens: the first screen, each question, then the contact step.
  expect(steps.map(s => s.screen)).toEqual([0, 1, 4, null]);
  expect(steps[1].detail).toBe(
    "3 questions, one per screen. 2 answers fill their own CRM field. The rest go to the Answers field.",
  );
  expect(steps[2].detail).toContain("2 visitors pressed send.");
});

test("the CRM saving the lead is never the leak, and a stop at the contact step is", () => {
  const atContact: Step[] = STEPS.map(s =>
    s.screen === "intro"
      ? { ...s, visits: 6 }
      : s.screen === "send"
        ? { ...s, visits: 0 }
        : s,
  );
  // 6 to 5 at the start, 3 to 0 at send, then 0 to 0: the contact step.
  expect(leakScreen(atContact)).toBe("contact");
  expect(pageJourney(PAGE, atContact)[2].leak).toBe(true);
  // Only the send to thank-you step loses visits: no leak at all.
  expect(
    leakScreen([
      { screen: "intro", label: "", visits: 2 },
      { screen: "send", label: "", visits: 2 },
      { screen: "thanks", label: "", visits: 0 },
    ]),
  ).toBeNull();
});

test("visits not read yet show no number, never 0", () => {
  const steps = pageJourney(PAGE);
  expect(steps.every(s => s.visits === null && !s.leak)).toBe(true);
  expect(steps[1].questions?.every(q => q.visits === null)).toBe(true);
  expect(steps[2].detail).not.toContain("pressed send");
});

const lead = (data?: Step[]) => ({
  url: `${SITE}/`,
  page: PAGE,
  checked: true,
  error: null,
  loading: false,
  reload: () => {},
  days: 7,
  visits: {
    data: data && {
      slug: "mergestudio",
      version: "v2",
      liveVersion: "v2",
      days: 7,
      source: "ads" as const,
      counts: { all: 20, ads: 12 },
      since: "2026-10-20T00:00:00Z",
      steps: data,
      versions: [],
      lastAt: "2026-10-27T09:00:00Z",
      hosts: ["merge.example.com"],
    },
    error: null,
    loading: false,
    reload: () => {},
  },
});

test("the lead page reads as the instant form: steps, Edit form, versions and the page in the phone", () => {
  const html = renderToStaticMarkup(
    <LeadPageJourney page={PAGE} lead={lead(STEPS)} />,
  );
  for (const words of [
    "What a lead goes through",
    "Edit form",
    "First screen",
    "Questions",
    "Contact step",
    "Thank-you page",
    "ايش نوع مشروعك",
    "Most stop here",
    "reached",
    "Versions of the page",
    "Switch back",
    "Reached counts visitors from ads in the last 7 days, on v2",
    "v2 is live.",
  ])
    expect(html).toContain(words);
  expect(html).toContain(`src="${SITE}/?preview=1"`);
  expect(html.match(/Most stop here/g)).toHaveLength(1);
});

test("before the visits arrive, the steps carry no number", () => {
  const html = renderToStaticMarkup(
    <LeadPageJourney page={PAGE} lead={lead()} />,
  );
  expect(html).toContain("Reading the page&#x27;s visits…");
  expect(html).not.toContain("reached");
  expect(html).not.toContain("Most stop here");
});

test("the client page's Lead page uses the same button name and keeps its versions", () => {
  const html = renderToStaticMarkup(
    <LeadPageSection
      read={{ data: [PAGE], error: null, loading: false, reload: () => {} }}
    />,
  );
  expect(html).toContain("Edit form");
  expect(html).not.toContain("Edit questions");
  expect(html).toContain("Versions (2)");
  expect(html).toContain("Switch back");
  expect(html).toContain("Added the budget question");
});

test("the instant form's rail still reads as before", () => {
  const html = renderToStaticMarkup(
    <JourneyRail
      spec={{
        name: "Villa form",
        intro: { title: "Free design call", style: "LIST_STYLE", content: [] },
        questions: [{ key: "full_name", type: "FULL_NAME" }],
        higherIntent: false,
        smsVerify: true,
        privacy: { url: "https://villa.example/privacy" },
        thankYou: { title: "Thanks", buttonType: "NONE" },
      }}
      screen="intro"
      onScreen={() => {}}
    />,
  );
  for (const words of [
    "Greeting",
    "Opens on “Free design call” before any question.",
    "Review step",
    "Off. One tap sends whatever Meta filled in.",
    "SMS code",
    "Thank you",
  ])
    expect(html).toContain(words);
  expect(html).toContain('aria-current="step"');
  expect(html).not.toContain("reached");
});
