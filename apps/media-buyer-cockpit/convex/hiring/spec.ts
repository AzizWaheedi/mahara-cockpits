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
      "Three minutes on camera: the account you are proudest of, what the cost per lead was when you took it and what it was when you left it, and the one change that moved it.",
    testProject:
      "A 30 day export from one GCC construction client, Meta plus one of Snap or TikTok, names removed. One page back: what to kill, what to scale, what to restructure, the cost per lead you expect it to land at, and why. Two days to answer.",
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
      "Two minutes over your own work: play the best three seconds you have ever cut, then say why it holds and what you would try next.",
    testProject:
      "Raw footage from one shoot with the client's name removed. Cut one 30 second vertical ad and one 15 second hook variant, to the brief attached. Two days. Send the project file as well as the export.",
    dailyResponsibilities:
      "Cut ads and reels for GCC construction and design firms, hold the house style, and turn a shoot into enough variants for a real test.",
  },
];

/**
 * Names that have changed, so `setup.ts` renames what is there instead of
 * building a second one beside it and stranding the cards in the first.
 *
 * Aziz, 2026-09-22: the sales funnel splits in two, "I make them a setter,
 * and then they turn into a closer" or "I just bring them straight to
 * becoming a closer". The old single pipeline becomes the closer's, because
 * the form behind it asks a closer's questions, and the setter's pipeline is
 * new. A candidate moves between the two with `reassign`.
 */
export const RENAMES: {
  kind: "pipeline" | "value" | "field";
  from: string;
  to: string;
}[] = [
  // The sales funnel split in two (Aziz, 2026-09-22): "I make them a setter,
  // and then they turn into a closer" or "I just bring them straight to
  // becoming a closer. It just depends on how skilled they are." The old
  // single pipeline becomes the closer's, because the form behind it asks a
  // closer's questions, and the setter's is new. `reassign` moves a candidate
  // between the two.
  { kind: "pipeline", from: "Hiring, sales rep B2B", to: "Sales closer (B2B)" },
  { kind: "pipeline", from: "Hiring, B2B closer", to: "Sales closer (B2B)" },
  { kind: "pipeline", from: "Hiring, B2B setter", to: "Sales setter (B2B)" },
  // The sub-account holds nothing but hiring, so a pipeline is just the role.
  { kind: "pipeline", from: "Hiring, media buyer", to: "Media buyer" },
  {
    kind: "pipeline",
    from: "Hiring, client success manager",
    to: "Client success manager",
  },
  {
    kind: "pipeline",
    from: "Hiring, call centre agent",
    to: "Call centre agent",
  },
  { kind: "pipeline", from: "Hiring, video editor", to: "Video editor" },
  {
    kind: "value",
    from: "Sales rep, B2B setter and closer - Test project",
    to: "Sales closer (B2B) - Test project",
  },
  {
    kind: "value",
    from: "Sales rep, B2B setter and closer - Loom request",
    to: "Sales closer (B2B) - Loom request",
  },
  {
    kind: "value",
    from: "Sales rep, B2B setter and closer - Compensation",
    to: "Sales closer (B2B) - Compensation",
  },
  {
    kind: "value",
    from: "Sales rep, B2B setter and closer - Daily responsibilities",
    to: "Sales closer (B2B) - Daily responsibilities",
  },
  {
    kind: "value",
    from: "Sales rep, B2B setter and closer - Position breakdown video",
    to: "Sales closer (B2B) - Position breakdown video",
  },
  {
    kind: "value",
    from: "Sales rep, B2B setter and closer - Job post",
    to: "Sales closer (B2B) - Job post",
  },
  {
    kind: "value",
    from: "Sales closer, B2B - Test project",
    to: "Sales closer (B2B) - Test project",
  },
  {
    kind: "value",
    from: "Sales closer, B2B - Loom request",
    to: "Sales closer (B2B) - Loom request",
  },
  {
    kind: "value",
    from: "Sales closer, B2B - Compensation",
    to: "Sales closer (B2B) - Compensation",
  },
  {
    kind: "value",
    from: "Sales closer, B2B - Daily responsibilities",
    to: "Sales closer (B2B) - Daily responsibilities",
  },
  {
    kind: "value",
    from: "Sales closer, B2B - Position breakdown video",
    to: "Sales closer (B2B) - Position breakdown video",
  },
  {
    kind: "value",
    from: "Sales closer, B2B - Job post",
    to: "Sales closer (B2B) - Job post",
  },
  {
    kind: "value",
    from: "Sales setter, B2B - Test project",
    to: "Sales setter (B2B) - Test project",
  },
  {
    kind: "value",
    from: "Sales setter, B2B - Loom request",
    to: "Sales setter (B2B) - Loom request",
  },
  {
    kind: "value",
    from: "Sales setter, B2B - Compensation",
    to: "Sales setter (B2B) - Compensation",
  },
  {
    kind: "value",
    from: "Sales setter, B2B - Daily responsibilities",
    to: "Sales setter (B2B) - Daily responsibilities",
  },
  {
    kind: "value",
    from: "Sales setter, B2B - Position breakdown video",
    to: "Sales setter (B2B) - Position breakdown video",
  },
  {
    kind: "value",
    from: "Sales setter, B2B - Job post",
    to: "Sales setter (B2B) - Job post",
  },
  // Scores numbered so the field list reads in interview order.
  { kind: "field", from: "Score, application", to: "Score 1, application" },
  { kind: "field", from: "Score, Loom", to: "Score 2, Loom" },
  {
    kind: "field",
    from: "Score, group interview",
    to: "Score 3, group interview",
  },
  { kind: "field", from: "Score, one-to-one", to: "Score 4, one to one" },
  { kind: "field", from: "Score, test project", to: "Score 5, test project" },
  { kind: "field", from: "Score, total", to: "Score 6, total" },
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
    name: "Score 1, application",
    type: "NUMERICAL",
    note: "Out of 10, graded against the role's scorecard.",
  },
  {
    key: "scoreLoom",
    name: "Score 2, Loom",
    type: "NUMERICAL",
    note: "Out of 10.",
  },
  {
    key: "scoreGroup",
    name: "Score 3, group interview",
    type: "NUMERICAL",
    note: "Out of 10, against the group interview framework.",
  },
  {
    key: "scoreOneToOne",
    name: "Score 4, one to one",
    type: "NUMERICAL",
    note: "Out of 10.",
  },
  {
    key: "scoreTestProject",
    name: "Score 5, test project",
    type: "NUMERICAL",
    note: "Out of 10.",
  },
  {
    key: "scoreTotal",
    name: "Score 6, total",
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
    note: "The page this role's job ad points at. This role only, never the careers index.",
  },
  {
    name: `${role.label} - Apply link`,
    seed: role.applyUrl,
    note: "The application form for this role, for a message or an ad that skips the page.",
  },
];

/**
 * The two calendars a candidate books on, and the custom value each one
 * fills in once it exists.
 *
 * Hours are Mahara's working clock, Saturday to Thursday, 10:00 to 18:00
 * Kuwait. GoHighLevel wants one openHours entry per day, not one entry
 * listing several days, and it refuses `locationId` on an update.
 */
export type CalendarSpec = {
  key: string;
  name: string;
  /** Fills this custom value with the booking link once built. */
  fills: string;
  /** round_robin for one person at a time, class_booking for a group session. */
  type: "round_robin" | "class_booking";
  minutes: number;
  /** How many people may take the same slot. */
  perSlot: number;
  description: string;
};

/** Sunday is 0. Saturday to Thursday is Mahara's week. */
export const WORKING_DAYS = [6, 0, 1, 2, 3, 4];
export const WORKING_FROM = 10;
export const WORKING_TO = 18;

export const CALENDARS: CalendarSpec[] = [
  {
    key: "group",
    name: "Group interview",
    fills: "Hiring - Group interview booking link",
    type: "class_booking",
    minutes: 60,
    // A group interview is one session with many candidates on it. The
    // framework books an hour and runs 45 minutes.
    perSlot: 20,
    description:
      "Book your group interview. It is held on Zoom with the other people still in for this role. Be on a computer somewhere quiet, join on time, and keep your answers to sixty seconds each.",
  },
  {
    key: "one-to-one",
    name: "One to one interview",
    fills: "Hiring - One-to-one booking link",
    type: "round_robin",
    minutes: 30,
    perSlot: 1,
    description:
      "Book your one to one. It is held on Zoom. Be on a computer somewhere quiet and join five minutes early. If you were sent a test project, send it back before the call if you can.",
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
