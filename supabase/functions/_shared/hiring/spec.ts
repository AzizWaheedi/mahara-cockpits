/**
 * Ported 2026-10-09 from apps/media-buyer-cockpit/convex/hiring/spec.ts and
 * forms.ts, which ran on Convex until it stopped on 2026-10-07. The roles,
 * stages and field names below must stay word for word with that file and
 * with hermes/ceo-refresh/native/hiring/spec.js: the GoHighLevel board is
 * matched to them by name.
 *
 * What Mahara's hiring back end is made of: the roles, the pipeline stages,
 * the fields a candidate carries and the values that make a role's messages
 * changeable without touching code.
 *
 * Pure data. The Convex `setup.ts` built it in GoHighLevel; the Supabase
 * hiring jobs and the CEO refresh read it.
 *
 * Aziz, 2026-09-22: the five roles with a live funnel, and the stages of the
 * interview process in his own words.
 */

/** The five roles Mahara hires on repeat. */
export const ROLE_KEYS = [
  "media-buyer",
  "csm",
  "sales-closer",
  "sales-setter",
  "call-centre",
  "video-editor",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * The stages, in Aziz's order. `key` is what the cockpit stores, `name` is
 * what the GoHighLevel board shows, and `odds` is the win probability
 * GoHighLevel uses to draw the funnel and shade the board, which is the only
 * styling its API exposes: stage colours are not settable there.
 *
 * Disqualified, Bench, Fired and Churn are resting places rather than steps,
 * so the funnel maths in the cockpit counts only the advancing stages and
 * reads the rest as exits.
 */
export const STAGES = [
  { key: "application", name: "Application", advancing: true, odds: 5 },
  { key: "disqualified", name: "Disqualified", advancing: false, odds: 0 },
  { key: "loom", name: "Loom request", advancing: true, odds: 15 },
  { key: "group", name: "Group interview", advancing: true, odds: 30 },
  {
    key: "one-to-one",
    name: "One to one interview",
    advancing: true,
    odds: 55,
  },
  { key: "offer", name: "Job offer", advancing: true, odds: 85 },
  { key: "bench", name: "Bench", advancing: false, odds: 10 },
  { key: "hired", name: "Hired", advancing: true, odds: 100 },
  { key: "fired", name: "Fired", advancing: false, odds: 0 },
  { key: "churn", name: "Churn", advancing: false, odds: 0 },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export const STAGE_KEYS = STAGES.map(s => s.key) as StageKey[];
export const ADVANCING_STAGES = STAGES.filter(s => s.advancing).map(
  s => s.key,
) as StageKey[];
/** A candidate who reached this stage is out, one way or another. */
export const EXIT_STAGES: StageKey[] = ["disqualified", "fired", "churn"];

export const stageName = (key: StageKey): string =>
  STAGES.find(s => s.key === key)?.name ?? key;

export const stageKeyByName = (name: string): StageKey | null => {
  const want = name.trim().toLowerCase();
  return (
    (STAGES.find(s => s.name.toLowerCase() === want)?.key as StageKey) ?? null
  );
};

/**
 * A role may call a stage something else on its own board.
 *
 * Aziz, 2026-09-22: "for non-client-facing roles, for example video editor
 * and, I guess, media buyer, a Loom request makes sense, but I think we should
 * have case studies." A media buyer's third stage is their campaigns, not a
 * talking head, so that is what the board calls it. The key never changes, so
 * the funnel, the scores and the engine are untouched by the label.
 */
export const STAGE_LABELS: Partial<
  Record<RoleKey, Partial<Record<StageKey, string>>>
> = {
  "media-buyer": { loom: "Case studies" },
  "video-editor": { loom: "Case studies" },
};

/** Names a stage used to have, so a rename finds the old one instead of building a second. */
export const STAGE_AKA: Partial<Record<StageKey, string[]>> = {
  "one-to-one": ["One-to-one interview"],
  loom: ["Loom request", "Case studies"],
};

export const stageNameFor = (role: string, key: StageKey): string =>
  STAGE_LABELS[role as RoleKey]?.[key] ?? stageName(key);

/** Every name this stage may already be under on this role's board. */
export const stageAliases = (role: string, key: StageKey): string[] => {
  const seen = new Set<string>();
  for (const n of [
    stageNameFor(role, key),
    stageName(key),
    ...(STAGE_AKA[key] ?? []),
  ])
    seen.add(n.trim().toLowerCase());
  return [...seen];
};

/** Which stage this board's column is, whatever this role calls it. */
export const stageKeyOnBoard = (
  role: string,
  name: string,
): StageKey | null => {
  const want = name.trim().toLowerCase();
  for (const s of STAGES)
    if (stageAliases(role, s.key as StageKey).includes(want))
      return s.key as StageKey;
  return null;
};

export type Role = {
  key: RoleKey;
  /** On the board and in the cockpit. */
  label: string;
  /** The pipeline this role's candidates sit in. */
  pipeline: string;
  /** The page the job ad points at, for this role only. */
  careersUrl: string;
  /**
   * The form that page opens, for this role only. Aziz, 2026-09-22: "make
   * sure you go to the specific funnel for that hire when you're putting the
   * job posting." A message or an ad never links to the careers index.
   */
  applyUrl: string;
  /** What the role is paid, as the careers page states it. */
  compensation: string;
  /** Where the mentor's directory says to post this role. */
  postOn: string;
  /** How long until they are fully ramped, from the directory. */
  rampTime: string;
  /** The numbers this person is judged on once hired. */
  scorecard: string[];
  /** What a candidate is asked to record at the Loom stage. */
  loomPrompt: string;
  /**
   * The task sent before the one-to-one. Seeded from the hiring directory's
   * shape and Mahara's own work; Aziz edits these in GoHighLevel custom
   * values, never here, which is the point of holding them there.
   */
  testProject: string;
  /** What the person does day to day, used in the job offer and the ad. */
  dailyResponsibilities: string;
};

export const ROLES: Role[] = [
  {
    key: "media-buyer",
    label: "Media buyer",
    pipeline: "Media buyer",
    careersUrl: "https://maharamedia.com/careers/media-buyer/",
    applyUrl: "https://maharamedia.typeform.com/to/zo1Zm6u6",
    compensation:
      "Up to $3,000+ a month. Base plus a cost per lead bonus once a full roster is managed.",
    postOn: "OnlineJobs and Facebook ads. The Philippines or Egypt.",
    rampTime: "2 to 4 weeks to a full roster with little hand holding.",
    scorecard: [
      "Cost per lead against the $15 gate",
      "Cost per booking against the $60 gate",
      "Campaigns managed",
      "Share of clients on track",
    ],
    loomPrompt:
      "Send two case studies from campaigns you actually ran, not a showreel. For each: the client and the market, what the cost per lead was when you took it and what it was when you left it, the one change that moved it, and a screenshot of the account to back it up. Then answer this in writing: a lead-gen campaign has been running eight days, cost per lead is $9 against a $15 gate, but the client says the leads are junk and will not answer the phone. What do you look at first, what do you change, and what do you refuse to change yet?",
    testProject:
      "A 30 day export from one GCC construction client, Meta plus one of Snap or TikTok, names removed. One page back: what to kill, what to scale, what to restructure, the cost per lead you expect it to land at, and why. Two days to answer. This is unpaid and it is one page, not a deck.",
    dailyResponsibilities:
      "Run paid campaigns on Meta, Snapchat and TikTok for GCC construction and design firms, hold cost per lead and cost per booking inside the gates, and brief creative on what to make next.",
  },
  {
    key: "csm",
    label: "Client success manager",
    pipeline: "Client success manager",
    careersUrl: "https://maharamedia.com/careers/client-success-manager/",
    applyUrl: "https://maharamedia.typeform.com/to/oW8CWRhi",
    compensation:
      "Up to $6,000 a month. Base plus commission on retention, upsells and referrals.",
    postOn:
      "Indeed, LinkedIn, Skool communities and recruiters. Hire in the client's country.",
    rampTime:
      "2 to 3 weeks before taking clients, 1.5 to 4 months to a full roster.",
    scorecard: [
      "Retention and churn on the roster",
      "Clients on track",
      "Extensions and upsells",
      "Response time to a client",
    ],
    loomPrompt:
      "Three minutes on camera: a client you saved, what they were angry about, exactly what you said on that call, and where the account ended up.",
    testProject:
      "A real account with the names removed: a GCC design firm three months in, lead volume on target, closes below it. Send back the written client update you would send and the agenda for the save call, in the language you would send it in.",
    dailyResponsibilities:
      "Own a roster of GCC clients end to end, run the check in calls, keep every account on track against its gates, and turn a good result into an extension.",
  },
  {
    key: "sales-closer",
    label: "Sales closer (B2B)",
    pipeline: "Sales closer (B2B)",
    careersUrl: "https://maharamedia.com/careers/sales-rep/",
    applyUrl: "https://maharamedia.typeform.com/to/rqv3Fkts",
    compensation:
      "Base plus uncapped commission on cash collected. Bilingual Arabic and English, based in the GCC.",
    postOn:
      "Skool and Facebook communities, recruiters, your own network. Onshore where the clients are.",
    rampTime: "On calls within 1 to 2 weeks.",
    scorecard: [
      "Close rate on demos shown",
      "Cash collected",
      "Demo show rate",
      "Average deal size",
    ],
    loomPrompt:
      "Three minutes on camera: the last deal you closed over $5,000, what the objection was, and the words you used to get past it.",
    testProject:
      "A recorded or written discovery call with a GCC construction client. Send back a written review naming the three moments the deal was won or lost and what you would have said instead. Then a live roleplay of the close on the call, with me as that owner.",
    dailyResponsibilities:
      "Run the demo, handle the objection, and close construction and design firms across the GCC.",
  },
  {
    key: "sales-setter",
    label: "Sales setter (B2B)",
    pipeline: "Sales setter (B2B)",
    careersUrl: "https://maharamedia.com/careers/sales-rep/",
    applyUrl: "https://maharamedia.typeform.com/to/rqv3Fkts",
    compensation:
      "Base or draw, whichever is higher, plus commission on cash collected from your sets. Bilingual Arabic and English.",
    postOn:
      "Skool and Facebook communities, recruiters, your own network. Onshore where the clients are, or offshore at a much lower band.",
    rampTime: "On calls within 3 to 4 days. The easiest seat to ramp.",
    scorecard: [
      "Speed to lead inside working hours",
      "Sets booked per day",
      "Set to show rate",
      "Cash collected from their sets",
    ],
    loomPrompt:
      "Two minutes on camera: call me as if I filled a form two days ago and do not remember doing it. Get me to agree to a meeting.",
    testProject:
      "Five inbound B2B leads from GCC construction and design firms with their form answers and timestamps, names removed. Send back your opening sixty seconds, your qualifying questions in writing, and which two you would call first and why.",
    dailyResponsibilities:
      "Call every lead inside the working clock, qualify on budget and decision maker, and book the demo so it shows.",
  },
  {
    key: "call-centre",
    label: "Call centre agent",
    pipeline: "Call centre agent",
    careersUrl: "https://maharamedia.com/careers/call-center-agent/",
    applyUrl: "https://maharamedia.typeform.com/to/jYTRw2Sx",
    compensation:
      "Base plus commission per appointment booked. Khaliji Arabic fluency required.",
    postOn:
      "Facebook ads and local groups, in a market whose accent matches the one being called.",
    rampTime: "Inside a week, given a script, an SOP and one roleplay.",
    scorecard: [
      "Contact rate",
      "Booked from contacted",
      "Show rate against the 60% line",
      "Appointments booked per day",
    ],
    loomPrompt:
      "Two minutes, in Khaliji Arabic: introduce yourself, then book me into a meeting as if I had filled a form two days ago and did not remember doing it.",
    testProject:
      "A fifteen minute live block after the one to one: a speed test, then a roleplay calling an Arabic speaking villa owner who filled a form two days ago and does not remember. Held in the language the phones are actually worked in.",
    dailyResponsibilities:
      "Call the leads our ads bring in, qualify them in Khaliji Arabic, and book them into the client's calendar so they show up.",
  },
  {
    key: "video-editor",
    label: "Video editor",
    pipeline: "Video editor",
    // There is no /careers/video-editor/ page, so the ad points at the form
    // itself rather than at the index, which lists every other role too.
    careersUrl: "https://maharamedia.typeform.com/to/tigKbFlO",
    applyUrl: "https://maharamedia.typeform.com/to/tigKbFlO",
    compensation: "Competitive, on a portfolio.",
    postOn:
      "OnlineJobs, Facebook editor communities and the swipe file's own creators.",
    rampTime: "Not set. First paid cut inside two weeks is the working bar.",
    scorecard: [
      "Cuts delivered on time",
      "Revisions per cut",
      "Hook rate on the ads they cut",
      "Cuts that became a winner",
    ],
    loomPrompt:
      "Send three case studies, not a showreel. For each: a link to the finished cut, who it was for, what it was meant to do, and one line on the choice you made that the client would not have thought of. If any of them ran as a paid ad, say what the hook rate or the cost per result was.",
    testProject:
      "Raw footage from one shoot with the client's name removed. Cut one 30 second vertical ad and one 15 second hook variant, to the brief attached. Two days. Send the project file as well as the export. This is unpaid, it is short on purpose, and the footage is never used by Mahara.",
    dailyResponsibilities:
      "Cut ads and reels for GCC construction and design firms, hold the house style, and turn a shoot into enough variants for a real test.",
  },
];

/** Roles a candidate can be moved between, because they answered one form. */
export const TRACKS: Record<string, RoleKey[]> = {
  "sales-closer": ["sales-setter"],
  "sales-setter": ["sales-closer"],
};

export const roleByKey = (key: string): Role | null =>
  ROLES.find(r => r.key === key) ?? null;

export const roleByPipeline = (name: string): Role | null => {
  const want = name.trim().toLowerCase();
  return ROLES.find(r => r.pipeline.toLowerCase() === want) ?? null;
};

/**
 * The GoHighLevel custom fields a candidate carries, by the stable key the
 * cockpit reads and the name the account shows. Ids are matched by name and
 * cached in cockpit_hiring_meta under "ghl-ids".
 */
export const FIELDS: { key: string; name: string }[] = [
  { key: "role", name: "Role applied for" },
  { key: "source", name: "Application source" },
  { key: "yearsExperience", name: "Years of experience" },
  { key: "arabic", name: "Arabic fluency" },
  { key: "portfolio", name: "CV or portfolio" },
  { key: "loomUrl", name: "Loom URL" },
  { key: "testProjectUrl", name: "Test project submission" },
  { key: "scoreApplication", name: "Score 1, application" },
  { key: "scoreLoom", name: "Score 2, Loom" },
  { key: "scoreGroup", name: "Score 3, group interview" },
  { key: "scoreOneToOne", name: "Score 4, one to one" },
  { key: "scoreTestProject", name: "Score 5, test project" },
  { key: "scoreTotal", name: "Score 6, total" },
  { key: "notes", name: "Interview notes" },
  { key: "disqualifyReason", name: "Disqualify reason" },
  { key: "benchReason", name: "Bench reason" },
  { key: "offerSentOn", name: "Offer sent on" },
  { key: "startDate", name: "Start date" },
  { key: "agreedComp", name: "Agreed compensation" },
];

/**
 * The Typeform behind each role's careers page, checked 2026-09-22. The
 * setter track has no form: everyone answers the closer's form.
 */
export const FORMS: Record<string, { id: string; title: string }> = {
  "media-buyer": { id: "zo1Zm6u6", title: "Media Buyer Application" },
  csm: { id: "oW8CWRhi", title: "Client Success Manager Application" },
  "sales-closer": {
    id: "rqv3Fkts",
    title: "High-Ticket Closer Job Application",
  },
  "call-centre": { id: "jYTRw2Sx", title: "Call Centre Agent Application" },
  "video-editor": { id: "tigKbFlO", title: "Video Editor Application" },
};
