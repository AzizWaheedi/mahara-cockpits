/**
 * The Brand Blueprint's words for ClickUp, Slack and the WhatsApp group, and
 * the card mappings the three presses write (docs/brand-blueprint/SPEC.md
 * 3.2 to 3.6). Pure and import-free: the cockpit-creative-api Edge Function
 * bundles this file (supabase/functions/cockpit-creative-api/blueprint.ts),
 * so the brief the notes window previews is the brief ClickUp gets.
 *
 * Copy rules: plain lines, sentence case, no exclamation marks, no em dashes,
 * no promise of results. The budget appears here, for the media buyer, and
 * never on a slide.
 */

export const LAUNCH_LIST = "901816723196"; // Marketing/ADs
export const LAUNCH_TEMPLATE = "t-86ex8xaf1";
export const CLIENTS_LIST = "901816559981";
export const MEDIA_GENERAL = "C0AE8G5MT7Y"; // #media-general
export const CSM_FIELD = "68ff84db-6c66-4e70-8e72-15d70828fda6";
export const MAP_BASE = "https://mahara-onboarding-map.vercel.app/";

/**
 * The client card's fields the presses write. Only the first eight
 * characters of each ID are in the repo, so the executor finds the field on
 * the card by this prefix AND this name, and refuses when either changed.
 */
export const CARD_FIELDS = {
  templatedAds: { prefix: "e7d158a8", name: "Templated Ads Status" },
  canSelfRecord: { prefix: "39839c9d", name: "Can Self-Record?" },
  adApproval: { prefix: "dd2253f9", name: "Ad Approval Needed?" },
  offerCreation: { prefix: "404ba9d5", name: "Offer Creation" },
  onboardingMap: { prefix: "51f49cb1", name: "Onboarding Map" },
} as const;
export type CardFieldKey = keyof typeof CARD_FIELDS;

/** Never written by any press: a plan that names one is refused. */
export const NEVER_WRITTEN = [
  { prefix: "2e744484", name: "Launch Date" },
  { prefix: "669ae046", name: "Next Payment Date" },
  { prefix: "539743c2", name: "Daily Budget" },
] as const;

/**
 * Make 14 module [7]'s phase 5 message (whapi-cloud text), copied verbatim
 * from a read-only export of the scenario's blueprint on 2026-10-22 (SPEC
 * 3.6, ship step 2). `{map}` stands for the card's Onboarding Map link,
 * which Make read from the card ({{9.custom_fields.`Onboarding Map`}}).
 * Make's message then always carried the content-folder block with the
 * Client Data sheet's folder ({{6.`7`}}); here CONTENT_FOLDER_BLOCK is added
 * only when the card has a Drive folder, so no empty link is sent. Null
 * would mean the CSM is told to send the usual message with the map link.
 */
export const PHASE5_WHATSAPP: string | null =
  "أكملنا المرحلة الرابعة: بناء الهوية والعرض.\nالمرحلة التالية: مكالمة الإطلاق.\n\nاطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:\n{map}";

/** The content-folder block live since 2026-09-17, added when the card has a Drive folder. */
export const CONTENT_FOLDER_BLOCK =
  "*إذا ما رفعتوا المحتوى للحين:*\nارفعوا كل الصور والفيديوهات في مجلد المحتوى الموحد عشان توصل مباشرة لفريق الإبداع والمونتاج:\n{folder}";

export type Answers = Record<string, unknown>;
export type Step = {
  taskId: string;
  parentId: string;
  name?: string | null;
} | null;
export type Offer = { name?: string; what?: string; firstStep?: string };

/** What a press queues (SQL cockpit_blueprint_payload). */
export interface BlueprintPayload {
  v: 1;
  part: 1 | 2 | 3;
  press: number;
  card: { id: string; name: string };
  answers: Answers;
  from?: Record<string, string>;
  at?: Record<string, string>;
  previous: Answers | null;
  launchTaskId: string | null;
  sentAt: string;
  sentBy: string | null;
  links?: Partial<
    Record<
      "drive" | "driveFolder" | "brandDna" | "offerSheet" | "research",
      string | null
    >
  > | null;
  kickoff?: Partial<
    Record<
      | "budgetSaid"
      | "platforms"
      | "adAccount"
      | "pageName"
      | "cardFunded"
      | "consultTypes"
      | "templatedStatus"
      | "facebookAccess",
      string | null
    >
  > | null;
  cardBudget?: number | null;
  settings?: {
    assignee: { id: string; label: string | null } | null;
    pack: string | null;
  } | null;
  step4?: Step;
  service?: string | null;
  offer?: Offer | null;
  step2?: Step;
  launchCall?: { startsAt: string } | null;
  closeRoute?: "card_only" | "slack" | "make" | string;
  mapUrl?: string;
  csmFirstName?: string | null;
  dna_status?: string | null;
  dna_missing?: string | null;
  step3?: Step;
  offerSheet?: string | null;
}

// ------------------------------------------------------------------ labels

/** The five main services, as the deck's slides name them (content.ts SERVICES). */
export const SERVICE_LABEL: Record<string, string> = {
  "design-build": "Design and build",
  interior: "Interior design",
  architecture: "Architectural design",
  fitout: "Fit-out and renovation",
  construction: "Construction",
};

const CHOICE: Record<string, Record<string, string>> = {
  service: SERVICE_LABEL,
  capacity: { yes: "Yes", tight: "Tight", no: "No" },
  starter: { yes: "Yes", no: "No" },
  pack_approval: {
    on_call: "Approved on the Blueprint call",
    before: "Approved before the call",
    wants_changes: "Wants changes",
  },
  destination: { lead_form: "Lead form", landing_page: "Landing page" },
  identity: { their_page: "Their Page", our_page: "Our Page" },
  approval: {
    every: "Every video",
    first_batch: "The first batch, then we run",
    run_then_show: "We run, then show them",
  },
  dna_status: {
    complete: "Complete",
    small_gaps: "Small gaps",
    big_gaps: "Big gaps",
  },
  camera: {
    yes_studio: "Yes, with a cameraman or studio",
    yes_phone: "Yes, on their phone",
    no: "No",
    unsure: "Not sure yet",
  },
  content_rating: {
    strong: "Strong",
    usable: "Usable",
    weak: "Weak",
    none: "None",
  },
  scripts_status: {
    in_progress: "In progress",
    with_editors: "With the editors",
  },
};

/** Every key's English label, as the media team reads it. */
export const LABEL: Record<string, string> = {
  service: "Service",
  capacity: "Capacity",
  capacity_note: "Capacity note",
  starter: "Starter ads",
  pack_url: "Pack",
  pack_approval: "Pack approval",
  pack_changes: "Changes they want",
  daily_budget: "Daily budget",
  destination: "Sends people to",
  identity: "Publishing",
  red_lines: "Red lines",
  best_client: "The clients they want more of",
  not_for: "Who they don't want",
  method: "How a project runs",
  city_cant: "What most firms in their city can't do",
  pricing: "Pricing",
  minimum: "Smallest project",
  anchor: "Ads point to",
  terms: "Deposit and payment terms",
  margin: "Margin",
  competitors: "Competitors",
  why_us: "Why people pick them",
  approval: "Custom ads approval",
  dna_status: "Brand DNA",
  dna_missing: "Brand DNA still missing",
  rules: "Rules",
  camera: "On camera",
  content_rating: "Their content",
  shot_list: "Shot list",
  shot_list_due: "Shot list due",
  events: "Events to script for",
  readback_yes: "Said yes to the read-back",
  csm_signals: "For the CSM",
  anything_else: "Anything else",
  offer: "Offer",
  scripts_status: "Custom scripts",
  scripts_date: "Scripts date",
};

// ------------------------------------------------------------------ card mappings

/** Templated Ads Status from 1.3 and 1.5 (SPEC 3.3 step 5). */
export function templatedStatus(
  a: Answers,
): "Approved" | "Wants To See Them First" | "Declined" | null {
  if (a.starter === "no") return "Declined";
  if (a.starter !== "yes") return null;
  if (a.pack_approval === "wants_changes") return "Wants To See Them First";
  if (a.pack_approval === "on_call" || a.pack_approval === "before")
    return "Approved";
  return null;
}

/** Ad Approval Needed? from 2.12: the three-way answer stays in the record. */
export function adApprovalNeeded(approval: unknown): "Yes" | "No" | null {
  if (approval === "every" || approval === "first_batch") return "Yes";
  if (approval === "run_then_show") return "No";
  return null;
}

/** Can Self-Record? from 2.15, the card's own four options. */
export const CAN_SELF_RECORD: Record<string, string> = {
  yes_studio: "Yes - studio/cameraman",
  yes_phone: "Yes - phone only",
  no: "No",
  unsure: "Unsure",
};
export const canSelfRecord = (camera: unknown): string | null =>
  typeof camera === "string" ? (CAN_SELF_RECORD[camera] ?? null) : null;

export const launchName = (card: string) =>
  `${card.trim()} - New Client Campaign Launch 🚀`;
export const launchTag = (card: string) => card.trim().toLowerCase();
export const cardUrl = (id: string) => `https://app.clickup.com/t/${id}`;
export const mapUrl = (cardId: string) => `${MAP_BASE}?phase=5&cid=${cardId}`;

// ------------------------------------------------------------------ dates (Kuwait, UTC+3, no daylight time)

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const KUWAIT = 3 * 3600 * 1000;
const kw = (at: string | number | Date) =>
  new Date(new Date(at).getTime() + KUWAIT);
const pad = (n: number) => String(n).padStart(2, "0");

/** "Sat 24 Oct", in Kuwait. */
export function kuwaitDay(at: string | number | Date): string {
  const d = kw(at);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "22 Oct 10:11", in Kuwait. */
export function kuwaitStamp(at: string | number | Date): string {
  const d = kw(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * The launch task's due date: the second working day after the press's
 * Kuwait date, Saturday to Thursday (Friday off), 09:00 Kuwait. Pressed on a
 * Wednesday, it is due on Saturday.
 */
export function launchDue(now: Date): { day: string; ms: number } {
  const d = kw(now);
  let day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let working = 0;
  while (working < 2) {
    day += 86400000;
    if (new Date(day).getUTCDay() !== 5) working += 1;
  }
  const iso = new Date(day).toISOString().slice(0, 10);
  return { day: iso, ms: Date.parse(`${iso}T09:00:00+03:00`) };
}

// ------------------------------------------------------------------ values in words

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
function grouped(n: number): string {
  const [whole, frac] = String(n).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}
/** The first number in what was said, Arabic-Indic digits read too. */
export function firstNumber(said: unknown): number | null {
  if (typeof said !== "string") return null;
  const latin = said
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
  const m = latin.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
export function offerLine(o: unknown): string | null {
  if (!o || typeof o !== "object") return null;
  const { name, what, firstStep } = o as Offer;
  const head = [str(name), str(what)].filter(Boolean).join(": ");
  const parts = [
    head ? `${head}.` : null,
    str(firstStep) ? `First step: ${str(firstStep)}.` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** One answer in words, for a comment line. */
export function say(key: string, v: unknown): string {
  if (v === undefined || v === null) return "none";
  if (CHOICE[key] && typeof v === "string") return CHOICE[key][v] ?? v;
  if (key === "daily_budget" && typeof v === "object")
    return `${grouped(Number((v as { usd: number }).usd))} USD a day`;
  if ((key === "minimum" || key === "anchor") && typeof v === "object") {
    const m = v as { amount: number; currency: string };
    return `${grouped(Number(m.amount))} ${m.currency}`;
  }
  if (key === "shot_list" || key === "readback_yes")
    return v === true ? "Yes" : "No";
  if (key === "shot_list_due" || key === "scripts_date")
    return typeof v === "string"
      ? kuwaitDay(key === "scripts_date" ? `${v}T09:00:00+03:00` : v)
      : String(v);
  if (key === "competitors" && Array.isArray(v))
    return (
      v
        .map(c => {
          const x = c as { name: string; lose?: boolean; note?: string };
          const note = typeof x.note === "string" && x.note.trim();
          return `${x.name}${x.lose ? " (they lose to them)" : ""}${note ? `: ${note}` : ""}`;
        })
        // A note may hold a comma, so names with notes are set apart by ";".
        .join(
          v.some(c => typeof (c as { note?: unknown }).note === "string")
            ? "; "
            : ", ",
        )
    );
  if (key === "rules" && typeof v === "object") {
    const r = v as {
      always?: string[];
      never?: string[];
      neverShow?: string[];
    };
    return [
      list(r.always).length ? `always ${list(r.always).join("; ")}` : null,
      list(r.never).length ? `never ${list(r.never).join("; ")}` : null,
      list(r.neverShow).length
        ? `never show ${list(r.neverShow).join("; ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (key === "offer") return offerLine(v) ?? "none";
  if (Array.isArray(v)) return list(v).join("; ");
  return String(v);
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map(k => [k, canon((v as Record<string, unknown>)[k])]),
    );
  return v ?? null;
}

/** The keys whose values differ between two sends, in the given order. */
export function changedKeys(
  keys: readonly string[],
  before: Answers | null,
  after: Answers,
): string[] {
  return keys.filter(k => !same(before?.[k], after[k]));
}

/** One line per changed key: "Daily budget: 50 → 40 USD a day", "Red lines: added '…'". */
export function changeLines(
  keys: readonly string[],
  before: Answers | null,
  after: Answers,
): string[] {
  const out: string[] = [];
  for (const k of changedKeys(keys, before, after)) {
    const was = before?.[k];
    const now = after[k];
    const label = LABEL[k] ?? k;
    if (k === "red_lines" && (Array.isArray(was) || Array.isArray(now))) {
      const added = list(now).filter(x => !list(was).includes(x));
      const removed = list(was).filter(x => !list(now).includes(x));
      out.push(
        `${label}: ${[
          added.length ? `added "${added.join('", "')}"` : null,
          removed.length ? `removed "${removed.join('", "')}"` : null,
        ]
          .filter(Boolean)
          .join("; ")}`,
      );
    } else if (k === "daily_budget" && was && now) {
      out.push(
        `${label}: ${grouped(Number((was as { usd: number }).usd))} → ${say(k, now)}`,
      );
    } else if (now === undefined || now === null) {
      out.push(`${label}: removed (was ${say(k, was)})`);
    } else if (was === undefined || was === null) {
      out.push(`${label}: ${say(k, now)}`);
    } else {
      out.push(`${label}: ${say(k, was)} → ${say(k, now)}`);
    }
  }
  return out;
}

const PART1_KEYS = [
  "service",
  "starter",
  "pack_url",
  "pack_approval",
  "pack_changes",
  "daily_budget",
  "destination",
  "identity",
  "red_lines",
  "capacity",
  "capacity_note",
] as const;
const CLOSE_KEYS = [
  "approval",
  "camera",
  "content_rating",
  "shot_list",
  "shot_list_due",
  "minimum",
  "anchor",
  "margin",
  "events",
  "best_client",
  "not_for",
  "method",
  "city_cant",
  "pricing",
  "terms",
  "competitors",
  "why_us",
  "dna_status",
  "dna_missing",
  "rules",
] as const;
const CSM_KEYS = ["csm_signals", "anything_else"] as const;
const signed = (p: BlueprintPayload) =>
  `Sent from the Brand Blueprint by ${p.sentBy ?? "the creative director"}.`;

function linksLine(p: BlueprintPayload): string | null {
  const l = p.links ?? {};
  const parts = [
    l.drive || l.driveFolder ? `Drive ${l.driveFolder ?? l.drive}` : null,
    l.brandDna ? `Brand DNA ${l.brandDna}` : null,
    l.offerSheet ? `Offer Cheat Sheet ${l.offerSheet}` : null,
    l.research ? `Market research ${l.research}` : null,
  ].filter(Boolean);
  return parts.length ? `Links: ${parts.join(" · ")}` : null;
}

// ------------------------------------------------------------------ part 1: Send to media

/** The launch task's first comment: the brief (SPEC 3.3). */
export function launchBrief(
  p: BlueprintPayload,
  opts: { assigned: boolean; notes?: string[] },
): string {
  const a = p.answers;
  const k = p.kickoff ?? {};
  const lines: (string | null)[] = [];
  if (!opts.assigned)
    lines.push("Unassigned: set the launch media buyer in Settings.");
  lines.push("Brand Blueprint, starter ads");
  lines.push(`Client: ${p.card.name}, ${cardUrl(p.card.id)}`);
  lines.push(`Service: ${say("service", a.service)}`);
  if (a.starter === "yes") {
    const approval =
      a.pack_approval === "on_call"
        ? `Approved on the Blueprint call, ${kuwaitStamp(p.at?.pack_approval ?? p.sentAt)} (Kuwait).`
        : a.pack_approval === "before"
          ? "Approved before the call (the kickoff)."
          : `They want changes first: ${str(a.pack_changes) ?? "see the call notes"}.`;
    lines.push(
      `Starter ads: Yes. Pack: ${str(a.pack_url) ?? "not chosen"}. ${approval}`,
    );
    lines.push(
      "Offer: the starter pack's own. Their custom offer is locked within 1 to 2 days.",
    );
  } else {
    lines.push("No starter ads: build the account and wait for custom ads.");
  }
  const usd = (a.daily_budget as { usd?: number } | undefined)?.usd;
  const said = str(k.budgetSaid);
  const kickNumber = firstNumber(said);
  const note =
    said && kickNumber !== usd
      ? ` (the kickoff said "${said}"; corrected on the call)`
      : "";
  lines.push(
    `Daily budget: ${usd !== undefined ? `${grouped(Number(usd))} USD a day` : "not confirmed"}${note}`,
  );
  lines.push(`Sends people to: ${say("destination", a.destination)}`);
  const page = str(k.pageName);
  const publishing = [
    a.identity === "their_page"
      ? `Their Page${page ? ` "${page}"` : ""}`
      : a.identity === "our_page"
        ? "Our Page"
        : "not confirmed",
    str(k.adAccount) ? `Ad account "${str(k.adAccount)}"` : null,
    str(k.cardFunded) ? `Card with funds: ${str(k.cardFunded)}` : null,
  ].filter(Boolean);
  lines.push(`Publishing: ${publishing.join(" · ")}`);
  if (str(k.platforms)) lines.push(`Platforms: ${str(k.platforms)}`);
  if (str(k.consultTypes))
    lines.push(`Consultation types: ${str(k.consultTypes)}`);
  const red = list(a.red_lines);
  if (red.length) {
    lines.push("Red lines:");
    for (const r of red) lines.push(`- ${r}`);
  }
  lines.push(
    `Capacity: ${say("capacity", a.capacity)}${a.capacity !== "yes" && str(a.capacity_note) ? `. ${str(a.capacity_note)}` : ""}`,
  );
  lines.push(linksLine(p));
  for (const n of opts.notes ?? []) lines.push(n);
  lines.push(signed(p));
  return lines.filter((x): x is string => Boolean(x)).join("\n");
}

/** A later Send to media: only what changed since the last send. */
export function launchUpdate(p: BlueprintPayload): string {
  const changes = changeLines(PART1_KEYS, p.previous, p.answers);
  return [
    "Updated from the Blueprint",
    `Client: ${p.card.name}, ${cardUrl(p.card.id)}`,
    ...(changes.length
      ? changes
      : ["Nothing in the starter ads part changed."]),
    signed(p),
  ].join("\n");
}

/** The card comment for the CSM when capacity is Tight or No. */
export function capacityComment(p: BlueprintPayload): string | null {
  const a = p.answers;
  if (a.capacity !== "tight" && a.capacity !== "no") return null;
  return [
    `Capacity: ${say("capacity", a.capacity)}. ${str(a.capacity_note) ?? ""}`.trim(),
    `From the Brand Blueprint call with ${p.card.name}.`,
    signed(p),
  ].join("\n");
}

// ------------------------------------------------------------------ part 2: Close the call

/** The launch task's comment at the close. */
export function closeLaunchComment(p: BlueprintPayload): string {
  const a = p.answers;
  if (p.previous) {
    const changes = changeLines(CLOSE_KEYS, p.previous, a);
    return [
      "Updated from the Blueprint",
      `Client: ${p.card.name}`,
      ...(changes.length ? changes : ["Nothing media reads changed."]),
      signed(p),
    ].join("\n");
  }
  const lines: (string | null)[] = [
    "Brand Blueprint call closed",
    `Client: ${p.card.name}`,
    `Custom ads approval: ${say("approval", a.approval)}`,
    `On camera: ${say("camera", a.camera)}`,
    a.content_rating
      ? `Their content: ${say("content_rating", a.content_rating)}`
      : null,
    a.shot_list === true
      ? `Shot list: given, due ${typeof a.shot_list_due === "string" ? kuwaitDay(a.shot_list_due) : "in 72 hours"}`
      : "Shot list: not given yet",
    `Smallest project: ${say("minimum", a.minimum)} · Ads point to: ${say("anchor", a.anchor)}`,
    offerLine(p.offer) ? `Offer (draft): ${offerLine(p.offer)}` : null,
    str(a.events) ? `Events to script for: ${str(a.events)}` : null,
    signed(p),
  ];
  return lines.filter((x): x is string => Boolean(x)).join("\n");
}

/** The phase 5 WhatsApp for the group, or null while Make 14's text is not copied in. */
export function phase5Message(
  p: Pick<BlueprintPayload, "card" | "links" | "mapUrl">,
  text: string | null = PHASE5_WHATSAPP,
): string | null {
  if (!text) return null;
  const map = p.mapUrl ?? mapUrl(p.card.id);
  const folder = p.links?.driveFolder ?? p.links?.drive ?? null;
  const body = text.split("{map}").join(map);
  return folder
    ? `${body}\n\n${CONTENT_FOLDER_BLOCK.split("{folder}").join(folder)}`
    : body;
}

/** The client card's comment for the CSM at the close (SPEC 3.4 step 6). */
export function closeCsmComment(
  p: BlueprintPayload,
  opts: {
    whatsapp: boolean;
    launchFound: boolean;
    makeFallback: boolean;
    phase5?: string | null;
  },
): string {
  const a = p.answers;
  const call = p.launchCall?.startsAt
    ? `Launch call booked for ${kuwaitDay(p.launchCall.startsAt)} ${kuwaitStamp(p.launchCall.startsAt).split(" ").pop()} (Kuwait).`
    : "Launch call not booked yet.";
  if (p.previous) {
    const changes = changeLines(CSM_KEYS, p.previous, a);
    return [
      `Updated from the Blueprint for ${p.card.name}.`,
      ...changes,
      call,
      signed(p),
    ].join("\n");
  }
  const lines: (string | null)[] = [
    `Brand Blueprint call closed for ${p.card.name}.`,
    str(a.csm_signals) ? `For you: ${str(a.csm_signals)}` : null,
    str(a.anything_else) ? `Anything else: ${str(a.anything_else)}` : null,
    call,
    opts.launchFound
      ? null
      : "No open launch task was found, so media's close comment was not posted.",
    opts.makeFallback
      ? "Make close is chosen but not switched on in the server: the CSM pastes the WhatsApp."
      : null,
  ];
  if (opts.whatsapp) {
    const msg = opts.phase5 === undefined ? phase5Message(p) : opts.phase5;
    if (msg) lines.push("Paste this in the client's WhatsApp group:", msg);
    else
      lines.push(
        `The phase 5 WhatsApp text is not in the cockpit yet. Send the usual phase 5 message with this map link: ${p.mapUrl ?? mapUrl(p.card.id)}`,
      );
  }
  lines.push(signed(p));
  return lines.filter((x): x is string => Boolean(x)).join("\n");
}

/** #media-general, once the bot is there and close_route is 'slack'. */
export function slackCloseText(
  p: BlueprintPayload,
  launchTaskId: string | null,
): string {
  return `Brand Blueprint completed: ${p.card.name}. Scripts and custom creative can start.${launchTaskId ? ` ${cardUrl(launchTaskId)}` : ""}`;
}

/**
 * The Make 14 close body without its key: the key is added by the provider
 * when it sends, so it never sits in a plan, a rehearsal or a receipt. Sent,
 * it has exactly seven keys.
 */
export function makeClose(
  p: BlueprintPayload,
  slackText: string,
): Record<string, string | null> {
  return {
    source: "mahara-cockpit",
    event: "blueprint.call_closed",
    task_id: p.card.id,
    card_name: p.card.name,
    can_self_record: canSelfRecord(p.answers.camera),
    slack_text: slackText,
  };
}

// ------------------------------------------------------------------ part 3: Lock the offer

export function offerLaunchComment(p: BlueprintPayload): string {
  const a = p.answers;
  const scripts = a.scripts_status
    ? ` Custom scripts: ${say("scripts_status", a.scripts_status)}${typeof a.scripts_date === "string" ? `, by ${say("scripts_date", a.scripts_date)}` : ""}.`
    : "";
  const sheet = p.offerSheet ?? p.links?.offerSheet;
  return `${p.previous ? "Offer updated" : "Offer locked"}: ${offerLine(a.offer) ?? "not written"}${sheet ? ` Offer sheet: ${sheet}.` : ""} Custom ads in production.${scripts}\n${signed(p)}`;
}

export function dnaMissingComment(p: BlueprintPayload): string {
  return `Brand DNA still missing: ${str(p.dna_missing) ?? str(p.answers.dna_missing) ?? "see the call notes"}\n${signed(p)}`;
}
