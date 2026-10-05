/**
 * Every client's onboarding links and forms, as the CSM needs them (Aziz,
 * 2026-10-05: "the kickoff form as well linked for any people in
 * onboarding ... as well as their call recording and all of that stuff.
 * Prior to the onboarding call, their onboarding form and everything").
 *
 * Nothing here is typed by a person. The ClickUp client card holds the links
 * (Make writes them as the client moves through onboarding) and Typeform
 * holds the forms, joined to the card by the hidden field
 * onboarding_client_id, which is the card's ClickUp id. This file turns the
 * two into one row per client for cockpit_client_onboarding; onboarding.ts
 * does the reading and the writing. No I/O here, so scripts/onboarding.test.ts
 * can pin it.
 */

// biome-ignore lint/suspicious/noExplicitAny: ClickUp and Typeform bodies are untyped
type Any = any;

/** Clients - Mahara. */
export const LIST_ID = "901816559981";

/** The card's fields this reads, by ClickUp field id (2026-10-05). */
export const F = {
  clientStatus: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
  csm: "68ff84db-6c66-4e70-8e72-15d70828fda6",
  signup: "03968cf6-dac1-43b6-8f02-cef999af2bbb",
  onboardingCall: "ee9bf855-e05b-4afc-addf-1063cb54d3f0",
  launch: "2e744484-f581-4c37-962a-023c4de23729",
  kickoffForm: "87d7d889-afea-42f8-9485-6f3ead5b857f",
  onboardingMap: "51f49cb1-9f76-48be-b639-c42ca552d20a",
  blueprintForm: "1b7a4a74-d0e7-4a7f-9218-59c80a738186",
  brandDna: "89bbb8b0-ce83-4ac6-a597-7999078bc022",
  offerSheet: "43ca3d4c-36c8-4058-8ad8-35d5aab27042",
  salesCall: "1f2e9ad1-98d8-410d-9994-ac6da91ff91d",
  fathom: "abaa31ee-28ff-46f6-83bf-6c6d357a26d5",
  lastMeeting: "a5ffe867-d5fb-40a8-a13a-9bd3d792ac94",
  contract: "10b41484-c70d-4295-aab9-06a30443a3a2",
  drive: "19e39b91-dd2f-4027-ba88-31bc6aae07c3",
  driveFolder: "ce6129a5-c8e5-41ba-ac50-8650c7556469",
  reportSheet: "e6da13ae-6498-44a1-b7dd-9c6198500aa9",
  historyDoc: "31e35023-9419-4037-80b5-f83f06999f55",
  marketResearch: "7489dbcc-fbbd-4eec-abfd-1306be7ff4b8",
  website: "5d57fdde-eb70-4610-a23b-88f718b4451d",
  ghlId: "8d076d00-d31c-40c5-8b56-c9b1713952b9",
  salesTranscript: "68f71f79-b782-481b-9cd6-f3d05ae4f159",
  closer: "63af118b-bb16-48ba-9ddb-d0185b32fb23",
  closerNotes: "890d4ab8-d9e8-4e95-bbc3-147047ba8728",
  handoffRisks: "e17a1c27-ec34-4f87-8796-3cf1f8fa80f9",
  goLive: "d4483463-840f-4730-ae7f-bfa77c5bb22a",
  billingNotes: "f9bdf6b8-44de-4821-b804-52ca55d8d724",
  clientProfile: "7755485f-74a8-496c-85d8-562588e77944",
  paymentPlan: "17d17129-43c4-441b-a55c-6eca83b9f776",
  contractStatus: "ac976d4a-409b-441c-8c13-4b0e73a0c12f",
  contractSigned: "91e9e408-5673-4d8c-96c5-b557f2803b86",
  dailyBudget: "539743c2-b6cd-4eeb-bf2f-abaf64769a5e",
  service: "fccfc09c-650e-4aed-b4cd-3f50beba05a3",
} as const;

/** The card fields a sync cannot do without; a missing one is said on the screen. */
export const NEEDED: { id: string; name: string }[] = [
  { id: F.clientStatus, name: "Client Status" },
  { id: F.kickoffForm, name: "Kickoff Form Link" },
  { id: F.salesCall, name: "Sales Meeting Link" },
  { id: F.onboardingMap, name: "Onboarding Map" },
];

/**
 * The Typeforms, keyed to the card by onboarding_client_id. The kickoff form
 * moved to tG7dnxBn on 2026-09-14; the older kickoffs are on BbJy6xg4.
 */
export const FORMS = {
  onboarding: "KFRCXPFx",
  kickoff: "tG7dnxBn",
  kickoffOld: "BbJy6xg4",
  blueprint: "oYZKtogO",
} as const;
export type FormKey = keyof typeof FORMS;

/** The kickoff form's "Call Recording Link" and "Payment Amount", the same refs on both versions. */
const KICKOFF_RECORDING = "b5578678-d0c2-475b-b66f-7ea54d55fe31";
const KICKOFF_PAYMENT = "75e97e7d-4c19-437a-b4b8-67570c29344f";

/** The client's own onboarding form: the link Make sends in the welcome, with their card id. */
export function onboardingFormLink(taskId: string): string {
  return `https://maharamedia.typeform.com/to/${FORMS.onboarding}#onboarding_client_id=${encodeURIComponent(taskId)}`;
}

/**
 * The kickoff form with only the card id, as Make first writes it. The card's
 * own link is better (Make adds the onboarding answers once they are in);
 * this is for a card that has none.
 */
export function kickoffFormLink(taskId: string): string {
  return `https://maharamedia.typeform.com/to/${FORMS.kickoff}#onboarding_client_id=${encodeURIComponent(taskId)}`;
}

/** Everything before a client is live, as the roster's bucket says (media buyer csmSync ONBOARDING). */
export const ONBOARDING_STAGES = new Set([
  "Needs Contacting",
  "Onboarding Booked",
  "Brand Blueprint Booked♠️",
  "LAUNCH BOOKED",
  "Ready For Launch🚀",
  "DELAY OUT OF OUR CONTROL",
]);

export function inOnboarding(
  status: string | null,
  launchOn: string | null,
): boolean {
  if (!status) return false;
  return ONBOARDING_STAGES.has(status) || (status === "GHOSTED" && !launchOn);
}

export type LinkKey =
  | "kickoff_form"
  | "onboarding_map"
  | "blueprint_form"
  | "brand_dna"
  | "offer_sheet"
  | "sales_call"
  | "fathom"
  | "last_meeting"
  | "contract"
  | "drive"
  | "drive_folder"
  | "report_sheet"
  | "history_doc"
  | "market_research"
  | "website"
  | "ghl"
  | "clickup";

const LINK_FIELDS: [LinkKey, string][] = [
  ["kickoff_form", F.kickoffForm],
  ["onboarding_map", F.onboardingMap],
  ["blueprint_form", F.blueprintForm],
  ["brand_dna", F.brandDna],
  ["offer_sheet", F.offerSheet],
  ["sales_call", F.salesCall],
  ["fathom", F.fathom],
  ["last_meeting", F.lastMeeting],
  ["contract", F.contract],
  ["drive", F.drive],
  ["drive_folder", F.driveFolder],
  ["report_sheet", F.reportSheet],
  ["history_doc", F.historyDoc],
  ["market_research", F.marketResearch],
  ["website", F.website],
];

export type Handover = {
  closer?: string;
  closer_notes?: string;
  handoff_risks?: string;
  go_live?: string;
  billing_notes?: string;
  client_profile?: string;
  payment_plan?: string;
  contract_status?: string;
  contract_signed?: string;
  daily_budget?: number;
  service?: string;
};

export type FormAnswer = { ref: string; title: string; value: string };
export type FormEntry = {
  form_id: string;
  response_id: string;
  submitted_at: string;
  answers: FormAnswer[];
  /** Kickoff only: the onboarding call recording and the cash taken on it. */
  recording?: string | null;
  payment?: string | null;
};
export type Forms = {
  onboarding?: FormEntry;
  kickoff?: FormEntry;
  blueprint?: FormEntry;
};

export type OnboardingRow = {
  clickup_task_id: string;
  client_name: string;
  clickup_status: string | null;
  client_status: string | null;
  in_onboarding: boolean;
  csm: string | null;
  signup_on: string | null;
  onboarding_call_on: string | null;
  launch_on: string | null;
  links: Partial<Record<LinkKey, string>>;
  handover: Handover;
  sales_transcript: string | null;
  forms?: Forms;
  card_updated_at: string | null;
  seen_at: string;
  synced_at: string;
};

/** Field id to its dropdown options (orderindex and id to name). */
export type Options = Map<
  string,
  { id: string; index: number; name: string }[]
>;

export function optionsOf(fieldsBody: Any): Options {
  const out: Options = new Map();
  for (const f of (fieldsBody?.fields ?? []) as Any[])
    out.set(
      String(f.id),
      ((f.type_config?.options ?? []) as Any[]).map(o => ({
        id: String(o.id),
        index: Number(o.orderindex),
        name: String(o.name ?? o.label ?? ""),
      })),
    );
  return out;
}

/** The field ids the list has, to say which needed one went missing. */
export function missingFields(fieldsBody: Any): string[] {
  const have = new Set(
    ((fieldsBody?.fields ?? []) as Any[]).map(f => String(f.id)),
  );
  return NEEDED.filter(n => !have.has(n.id)).map(n => n.name);
}

function dropdown(
  options: Options,
  fieldId: string,
  value: unknown,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  for (const o of options.get(fieldId) ?? [])
    if (o.index === Number(value) || o.id === String(value)) return o.name;
  return null;
}

/** A ClickUp date (milliseconds) as the day it is in Kuwait. */
export function kuwaitDay(ms: unknown): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n + 3 * 3600_000).toISOString().slice(0, 10);
}

const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s);

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** One card as a row. Only the fields above are read; nothing else on the card is kept. */
export function cardRow(t: Any, options: Options, now: string): OnboardingRow {
  const cf = new Map<string, Any>(
    ((t.custom_fields ?? []) as Any[]).map(f => [String(f.id), f]),
  );
  const val = (id: string) => cf.get(id)?.value;
  const status = dropdown(options, F.clientStatus, val(F.clientStatus));
  const launchOn = kuwaitDay(val(F.launch));
  const links: Partial<Record<LinkKey, string>> = {};
  for (const [key, id] of LINK_FIELDS) {
    const s = text(val(id));
    if (s && isLink(s)) links[key] = s;
  }
  const ghl = text(val(F.ghlId));
  if (/^[A-Za-z0-9]{10,40}$/.test(ghl))
    links.ghl = `https://app.maharamedia.com/v2/location/${ghl}/dashboard`;
  if (t.url && isLink(String(t.url))) links.clickup = String(t.url);

  const handover: Handover = {};
  const put = (key: keyof Handover, v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === "") return;
    (handover as Any)[key] = v;
  };
  put("closer", text(val(F.closer)));
  put("closer_notes", text(val(F.closerNotes)));
  put("handoff_risks", text(val(F.handoffRisks)));
  put("go_live", text(val(F.goLive)));
  put("billing_notes", text(val(F.billingNotes)));
  put("client_profile", text(val(F.clientProfile)));
  put("payment_plan", dropdown(options, F.paymentPlan, val(F.paymentPlan)));
  put(
    "contract_status",
    dropdown(options, F.contractStatus, val(F.contractStatus)),
  );
  put(
    "contract_signed",
    dropdown(options, F.contractSigned, val(F.contractSigned)),
  );
  const budget = Number(val(F.dailyBudget));
  if (val(F.dailyBudget) !== undefined && Number.isFinite(budget) && budget > 0)
    handover.daily_budget = budget;
  put("service", dropdown(options, F.service, val(F.service)));

  const csm = ((val(F.csm) ?? []) as Any[])
    .map(u => String(u?.username || u?.email || "").trim())
    .filter(Boolean)
    .join(", ");
  const transcript = text(val(F.salesTranscript));

  return {
    clickup_task_id: String(t.id),
    client_name: String(t.name ?? "").trim(),
    clickup_status: t.status?.status ? String(t.status.status) : null,
    client_status: status,
    in_onboarding: inOnboarding(status, launchOn),
    csm: csm || null,
    signup_on: kuwaitDay(val(F.signup)),
    onboarding_call_on: kuwaitDay(val(F.onboardingCall)),
    launch_on: launchOn,
    links,
    handover,
    sales_transcript: transcript || null,
    card_updated_at: Number(t.date_updated)
      ? new Date(Number(t.date_updated)).toISOString()
      : null,
    seen_at: now,
    synced_at: now,
  };
}

// --- Typeform ------------------------------------------------------------------

type Question = { ref: string; title: string };

/** The form's questions in order, groups opened up, statements left out. */
export function questionsOf(definition: Any): Question[] {
  const out: Question[] = [];
  const walk = (fields: Any[]) => {
    for (const f of fields ?? []) {
      const inner = f?.properties?.fields;
      if (Array.isArray(inner) && inner.length) {
        walk(inner);
        continue;
      }
      if (f?.type === "statement" || !f?.ref) continue;
      out.push({ ref: String(f.ref), title: String(f.title ?? "") });
    }
  };
  walk(definition?.fields ?? []);
  return out;
}

/**
 * A question's title as the CSM reads it: the English half of a bilingual
 * "English | العربية" title, recalled values filled in, Typeform's markdown
 * and its "This question is required." leftovers taken out.
 */
export function questionTitle(
  raw: string,
  hidden: Record<string, string> = {},
): string {
  let t = String(raw ?? "").replace(
    /\{\{hidden:([A-Za-z0-9_]+)\}\}/g,
    (_, k: string) => hidden[k] || "…",
  );
  t = t.replace(/This question is required\.?/gi, " ");
  t = t.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
  const parts = t
    .split("|")
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const english = parts.find(p => /[A-Za-z]/.test(p) && !/[؀-ۿ]/.test(p));
    t = english ?? parts[0];
  }
  t = t.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157).trimEnd()}…` : t;
}

/** One answer as text, whatever kind of question it was. */
export function answerValue(a: Any): string {
  switch (a?.type) {
    case "text":
      return text(a.text);
    case "email":
      return text(a.email);
    case "phone_number":
      return text(a.phone_number);
    case "number":
      return a.number === null || a.number === undefined
        ? ""
        : String(a.number);
    case "boolean":
      return a.boolean ? "Yes" : "No";
    case "choice":
      return text(a.choice?.label ?? a.choice?.other);
    case "choices":
      return [
        ...((a.choices?.labels ?? []) as string[]),
        ...(a.choices?.other ? [String(a.choices.other)] : []),
      ]
        .map(s => String(s).trim())
        .filter(Boolean)
        .join(", ");
    case "url":
      return text(a.url);
    case "date":
      return text(a.date).slice(0, 10);
    case "file_url":
      return text(a.file_url);
    case "payment":
      return a.payment?.amount ? String(a.payment.amount) : "";
    default:
      return "";
  }
}

/** A response as an entry: its answers in the form's order, titled. */
export function formEntry(
  formId: string,
  definition: Any,
  response: Any,
): FormEntry {
  const byRef = new Map<string, Any>(
    ((response?.answers ?? []) as Any[]).map(a => [String(a?.field?.ref), a]),
  );
  const hidden: Record<string, string> = Object.fromEntries(
    Object.entries(response?.hidden ?? {}).map(([k, v]) => [
      k,
      String(v ?? ""),
    ]),
  );
  const answers: FormAnswer[] = [];
  for (const q of questionsOf(definition)) {
    const a = byRef.get(q.ref);
    if (!a) continue;
    const value = answerValue(a);
    if (!value) continue;
    answers.push({
      ref: q.ref,
      title: questionTitle(q.title, hidden),
      value: value.slice(0, 4000),
    });
  }
  const entry: FormEntry = {
    form_id: formId,
    response_id: String(response?.response_id ?? response?.token ?? ""),
    submitted_at: String(response?.submitted_at ?? ""),
    answers,
  };
  if (formId === FORMS.kickoff || formId === FORMS.kickoffOld) {
    const rec = answerValue(byRef.get(KICKOFF_RECORDING));
    entry.recording = rec && isLink(rec) ? rec : null;
    entry.payment = answerValue(byRef.get(KICKOFF_PAYMENT)) || null;
  }
  return entry;
}

/** The newest submitted response per card id, from one form's responses. */
export function newestByCard(responses: Any[]): Map<string, Any> {
  const out = new Map<string, Any>();
  for (const r of responses ?? []) {
    const id = String(r?.hidden?.onboarding_client_id ?? "").trim();
    if (!id || !r?.submitted_at) continue;
    const had = out.get(id);
    if (!had || String(r.submitted_at) > String(had.submitted_at))
      out.set(id, r);
  }
  return out;
}

export type FormData = {
  definitions: Partial<Record<FormKey, Any>>;
  responses: Partial<Record<FormKey, Any[]>>;
};

/** The three forms for one card: onboarding, the newest kickoff of either version, blueprint. */
export function formsFor(taskId: string, data: FormData): Forms {
  const newest = (key: FormKey) =>
    newestByCard(data.responses[key] ?? []).get(taskId);
  const out: Forms = {};
  const onboarding = newest("onboarding");
  if (onboarding)
    out.onboarding = formEntry(
      FORMS.onboarding,
      data.definitions.onboarding,
      onboarding,
    );
  const k = newest("kickoff");
  const old = newest("kickoffOld");
  const kickoff =
    k && (!old || String(k.submitted_at) >= String(old.submitted_at))
      ? { key: "kickoff" as const, r: k }
      : old
        ? { key: "kickoffOld" as const, r: old }
        : null;
  if (kickoff)
    out.kickoff = formEntry(
      FORMS[kickoff.key],
      data.definitions[kickoff.key],
      kickoff.r,
    );
  const blueprint = newest("blueprint");
  if (blueprint)
    out.blueprint = formEntry(
      FORMS.blueprint,
      data.definitions.blueprint,
      blueprint,
    );
  return out;
}

/** A sync, as the screen reads it from cockpit_client_onboarding_runs. */
export type Run = {
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  problem: string | null;
  trigger: string;
};

/** What the screen gets: the rows, the newest finished sync and the newest good one. */
export type KitsPage = {
  rows: OnboardingRow[];
  last: Run | null;
  lastOk: Run | null;
  now: string;
  /** Set by a refresh: what that read could not do. */
  problem?: string | null;
};

/** Where a client in onboarding is: before the onboarding call, on it, or past it. */
export type Step = "before" | "call" | "after";

export function stepOf(row: Pick<OnboardingRow, "forms">): Step {
  const f = row.forms ?? {};
  if (f.kickoff) return "after";
  if (f.onboarding) return "call";
  return "before";
}
