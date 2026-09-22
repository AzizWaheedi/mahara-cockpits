/**
 * What Mahara's hiring back end is made of: the roles, the pipeline stages,
 * the fields a candidate carries and the values that make a role's messages
 * changeable without touching code.
 *
 * Pure data. `setup.ts` builds it in GoHighLevel, the cockpit reads it, and
 * the tests check it against what is actually there, so this file is the one
 * description of the funnel and the only place to change it.
 *
 * Aziz, 2026-09-22: the five roles with a live funnel, and the stages of the
 * interview process in his own words.
 */

/** The five roles Mahara hires on repeat. */
export const ROLE_KEYS = [
  "media-buyer",
  "csm",
  "sales-rep",
  "call-centre",
  "video-editor",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * The stages, in Aziz's order. `key` is what the cockpit stores, `name` is
 * what the GoHighLevel board shows.
 *
 * Disqualified, Bench, Fired and Churn are resting places rather than steps,
 * so the funnel maths in the cockpit counts only the advancing stages and
 * reads the rest as exits.
 */
export const STAGES = [
  { key: "application", name: "Application", advancing: true },
  { key: "disqualified", name: "Disqualified", advancing: false },
  { key: "loom", name: "Loom request", advancing: true },
  { key: "group", name: "Group interview", advancing: true },
  { key: "one-to-one", name: "One-to-one interview", advancing: true },
  { key: "offer", name: "Job offer", advancing: true },
  { key: "bench", name: "Bench", advancing: false },
  { key: "hired", name: "Hired", advancing: true },
  { key: "fired", name: "Fired", advancing: false },
  { key: "churn", name: "Churn", advancing: false },
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

/** Which scores a stage asks for, so the cockpit shows the right boxes. */
export const STAGE_SCORES: Partial<Record<StageKey, string[]>> = {
  application: ["application"],
  loom: ["loom"],
  group: ["group"],
  "one-to-one": ["oneToOne", "testProject"],
};

export type Role = {
  key: RoleKey;
  /** On the board and in the cockpit. */
  label: string;
  /** The pipeline this role's candidates sit in. */
  pipeline: string;
  /** The page a candidate applies from. */
  careersUrl: string;
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
    pipeline: "Hiring, media buyer",
    careersUrl: "https://maharamedia.com/careers/media-buyer/",
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
      "Three minutes on camera: the account you are proudest of, what the cost per lead was when you took it and what it was when you left it, and the one change that moved it.",
    testProject:
      "A 30 day export from one GCC construction client, Meta plus one of Snap or TikTok, names removed. One page back: what to kill, what to scale, what to restructure, the cost per lead you expect it to land at, and why. Two days to answer.",
    dailyResponsibilities:
      "Run paid campaigns on Meta, Snapchat and TikTok for GCC construction and design firms, hold cost per lead and cost per booking inside the gates, and brief creative on what to make next.",
  },
  {
    key: "csm",
    label: "Client success manager",
    pipeline: "Hiring, client success manager",
    careersUrl: "https://maharamedia.com/careers/client-success-manager/",
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
    key: "sales-rep",
    label: "Sales rep, B2B setter and closer",
    pipeline: "Hiring, sales rep B2B",
    careersUrl: "https://maharamedia.com/careers/sales-rep/",
    compensation:
      "Base plus uncapped commission. Bilingual Arabic and English, based in the GCC.",
    postOn:
      "Skool and Facebook communities, recruiters, your own network. Onshore where the clients are.",
    rampTime: "On calls within 1 to 2 weeks.",
    scorecard: [
      "Speed to lead inside working hours",
      "Intro and demo show rate",
      "Close rate on demos shown",
      "Cash collected",
    ],
    loomPrompt:
      "Three minutes on camera: the last deal you closed over $5,000, what the objection was, and the words you used to get past it.",
    testProject:
      "Five inbound B2B leads from GCC construction and design firms with their form answers and timestamps, names removed. Send back your opening sixty seconds, your qualifying questions in writing, and which two you would call first and why.",
    dailyResponsibilities:
      "Call every lead inside the working clock, qualify on budget and decision maker, run the demo, and close construction and design firms across the GCC.",
  },
  {
    key: "call-centre",
    label: "Call centre agent",
    pipeline: "Hiring, call centre agent",
    careersUrl: "https://maharamedia.com/careers/call-center-agent/",
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
    pipeline: "Hiring, video editor",
    careersUrl: "https://maharamedia.com/careers",
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
      "Two minutes over your own work: play the best three seconds you have ever cut, then say why it holds and what you would try next.",
    testProject:
      "Raw footage from one shoot with the client's name removed. Cut one 30 second vertical ad and one 15 second hook variant, to the brief attached. Two days. Send the project file as well as the export.",
    dailyResponsibilities:
      "Cut ads and reels for GCC construction and design firms, hold the house style, and turn a shoot into enough variants for a real test.",
  },
];

export const roleByKey = (key: string): Role | null =>
  ROLES.find(r => r.key === key) ?? null;

export const roleByPipeline = (name: string): Role | null => {
  const want = name.trim().toLowerCase();
  return ROLES.find(r => r.pipeline.toLowerCase() === want) ?? null;
};

/**
 * The fields a candidate carries in GoHighLevel. `key` is the stable name the
 * cockpit reads; GoHighLevel derives its own field key from the name, so the
 * two are matched by name at setup and the ids are cached in Supabase.
 */
export type FieldSpec = {
  key: string;
  name: string;
  type:
    | "TEXT"
    | "LARGE_TEXT"
    | "NUMERICAL"
    | "DATE"
    | "SINGLE_OPTIONS"
    | "CHECKBOX";
  options?: string[];
  /** Why it exists, shown in the cockpit's own sources map. */
  note: string;
};

/**
 * GoHighLevel already carries a contact's country as a standard field, and
 * refuses a custom one by that name (2026-09-22), so the cockpit reads
 * `contact.country` and there is no "Country" row below.
 */
export const FIELDS: FieldSpec[] = [
  {
    key: "role",
    name: "Role applied for",
    type: "SINGLE_OPTIONS",
    options: ROLES.map(r => r.label),
    note: "Which funnel the candidate belongs to; set from the application form.",
  },
  {
    key: "source",
    name: "Application source",
    type: "TEXT",
    note: "Where they came from, so a channel can be judged on hires and not on applications.",
  },
  {
    key: "yearsExperience",
    name: "Years of experience",
    type: "NUMERICAL",
    note: "Self reported on the form.",
  },
  {
    key: "arabic",
    name: "Arabic fluency",
    type: "TEXT",
    note: "Khaliji, Levantine, Egyptian, none. Decides the call centre and sales funnels.",
  },
  {
    key: "portfolio",
    name: "CV or portfolio",
    type: "LARGE_TEXT",
    note: "The link they gave.",
  },
  {
    key: "loomUrl",
    name: "Loom URL",
    type: "TEXT",
    note: "What they sent at the Loom request stage.",
  },
  {
    key: "testProjectUrl",
    name: "Test project submission",
    type: "LARGE_TEXT",
    note: "What they sent back for the role's test project.",
  },
  {
    key: "scoreApplication",
    name: "Score, application",
    type: "NUMERICAL",
    note: "Out of 10, graded against the role's scorecard.",
  },
  {
    key: "scoreLoom",
    name: "Score, Loom",
    type: "NUMERICAL",
    note: "Out of 10.",
  },
  {
    key: "scoreGroup",
    name: "Score, group interview",
    type: "NUMERICAL",
    note: "Out of 10, against the group interview framework.",
  },
  {
    key: "scoreOneToOne",
    name: "Score, one-to-one",
    type: "NUMERICAL",
    note: "Out of 10.",
  },
  {
    key: "scoreTestProject",
    name: "Score, test project",
    type: "NUMERICAL",
    note: "Out of 10.",
  },
  {
    key: "scoreTotal",
    name: "Score, total",
    type: "NUMERICAL",
    note: "The mean of the scores given so far, computed by the cockpit, never typed.",
  },
  {
    key: "notes",
    name: "Interview notes",
    type: "LARGE_TEXT",
    note: "Everything written about the candidate, newest first, stamped by stage.",
  },
  {
    key: "disqualifyReason",
    name: "Disqualify reason",
    type: "TEXT",
    note: "Why they were let go, so the funnel can be read and the job post fixed.",
  },
  {
    key: "benchReason",
    name: "Bench reason",
    type: "TEXT",
    note: "Good but not now. The reason is the thing that brings them back.",
  },
  {
    key: "offerSentOn",
    name: "Offer sent on",
    type: "DATE",
    note: "Drives time to hire.",
  },
  {
    key: "startDate",
    name: "Start date",
    type: "DATE",
    note: "Agreed start, which is where the team record begins.",
  },
  {
    key: "agreedComp",
    name: "Agreed compensation",
    type: "TEXT",
    note: "What was signed, in their currency.",
  },
];

export const fieldByKey = (key: string): FieldSpec | null =>
  FIELDS.find(f => f.key === key) ?? null;

/**
 * Values that make a role's messages changeable without a deploy: the test
 * project, the Loom prompt, the pay line, the day to day. Aziz edits these in
 * GoHighLevel, Settings, Custom values; setup only seeds them once and never
 * overwrites an edit.
 */
export type ValueSpec = { name: string; seed: string; note: string };

export const roleValues = (role: Role): ValueSpec[] => [
  {
    name: `${role.label} - Test project`,
    seed: role.testProject,
    note: "Sent when a candidate reaches the one-to-one stage.",
  },
  {
    name: `${role.label} - Loom request`,
    seed: role.loomPrompt,
    note: "Sent when a candidate reaches the Loom request stage.",
  },
  {
    name: `${role.label} - Compensation`,
    seed: role.compensation,
    note: "Quoted in the job offer.",
  },
  {
    name: `${role.label} - Daily responsibilities`,
    seed: role.dailyResponsibilities,
    note: "Used in the job post and the offer.",
  },
  {
    name: `${role.label} - Position breakdown video`,
    seed: "",
    note: "A Loom from Aziz on what the role really is. Sent with the Loom request.",
  },
  {
    name: `${role.label} - Job post`,
    seed: role.careersUrl,
    note: "Where the role is advertised.",
  },
];

export const GLOBAL_VALUES: ValueSpec[] = [
  {
    name: "Hiring - Agency name",
    seed: "Mahara Media",
    note: "Used in every candidate message.",
  },
  {
    name: "Hiring - Owner name",
    seed: "Aziz",
    note: "Who the messages are signed by.",
  },
  {
    name: "Hiring - Careers page",
    seed: "https://maharamedia.com/careers",
    note: "The page every job post points at.",
  },
  {
    name: "Hiring - Group interview booking link",
    seed: "",
    note: "Sent when a candidate reaches the group interview stage.",
  },
  {
    name: "Hiring - One-to-one booking link",
    seed: "",
    note: "Sent with the test project.",
  },
  {
    name: "Hiring - Reply to email",
    seed: "aziz@maharamedia.com",
    note: "Where a candidate's reply lands.",
  },
  {
    name: "Hiring - WhatsApp number",
    seed: "",
    note: "The number candidate messages come from.",
  },
];

export const allValues = (): ValueSpec[] => [
  ...GLOBAL_VALUES,
  ...ROLES.flatMap(roleValues),
];
