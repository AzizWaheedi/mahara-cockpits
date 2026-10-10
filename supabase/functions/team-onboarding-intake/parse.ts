// One Typeform submission of the new-hire onboarding form (Cef2QGBh) as the
// row cockpit_team_onboarding_record stores. Pure: no Deno, no network, so
// bun can test it.
//
// The field refs are the form's own (mahara-context
// tools/team-onboarding-form/build.py). A ref the form drops simply stops
// appearing; a new one shows up in `answers` under "More" until it is named
// here.

type Json = Record<string, unknown>;

export type Answer = {
  ref: string;
  section: string;
  title: string;
  value: string | string[] | number | boolean | null;
};

export type Missed = { ref: string; topic: string; answered: string | null; correct: string | null };

export type Submission = {
  responseToken: string;
  formId: string;
  submittedAt: string;
  email: string | null;
  fullName: string | null;
  preferredName: string | null;
  roleLabel: string | null;
  score: number | null;
  scoreMax: number | null;
  missed: Missed[];
  goals: { money12m?: string; moneyFor?: string; life?: string; career3y?: string; help?: string };
  setup: { done: string[]; missing: string[]; blocked: string | null };
  workspace: {
    device: string | null;
    speedMbps: number | null;
    backup: boolean | null;
    cameraAndMic: boolean | null;
    quietSpace: boolean | null;
  };
  answers: Answer[];
  raw: Json;
};

/** What each standards-check question is about, for "Missed" on the page. */
export const QUIZ_TOPICS: Record<string, string> = {
  q_hours: "Core hours",
  q_reply: "Reply time",
  q_status: "Slack status",
  q_late: "Late notice",
  q_strike: "Strikes",
  q_pto: "Time off",
  q_internet: "Internet",
  q_eod: "EOD form",
  q_clickup: "ClickUp",
  q_problem: "Problems with solutions",
  q_value: "Partner results",
  q_camera: "Cameras",
};

const SECTIONS: [string, string[]][] = [
  ["About them", ["full_name", "preferred_name", "role", "manager", "start_date", "work_email", "phone", "location", "emergency_name", "emergency_phone", "birthday"]],
  ["Who we are", ["mission_own_words", "vision_role"]],
  ["Values", ["value_natural", "value_natural_story", "value_stretch", "value_stretch_plan", "grow_or_go"]],
  ["Standards", ["ack_standards"]],
  ["Scorecard", ["scorecard_walked", "scorecard_hardest"]],
  ["Setup", ["tools_done", "tools_blocked"]],
  ["Workspace", ["device", "speed_down", "backup_net", "cam_mic", "quiet_space"]],
  ["How they work", ["feedback_style", "strengths", "level_up", "first_30", "work_best", "fun_fact"]],
  ["Goals", ["goal_money_12m", "goal_money_for", "goal_life", "goal_career_3y", "goal_help"]],
  ["Commitment", ["commit_ack", "signature", "sign_date"]],
];
const SECTION_OF = new Map(SECTIONS.flatMap(([s, refs]) => refs.map(r => [r, s] as const)));

const GOALS: Record<string, keyof Submission["goals"]> = {
  goal_money_12m: "money12m",
  goal_money_for: "moneyFor",
  goal_life: "life",
  goal_career_3y: "career3y",
  goal_help: "help",
};

const NONE_CHOICE = "t_none";

const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, max = 4000): string | null => {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t ? t.slice(0, max) : null;
};

type Field = { id: string; ref: string; type: string; title: string; choices: { id: string; ref: string | null; label: string }[] };

/** Every answerable field in form order, groups opened up. */
function fieldsOf(definition: Json): Field[] {
  const out: Field[] = [];
  const walk = (list: unknown[]) => {
    for (const raw of list) {
      const f = obj(raw);
      const props = obj(f.properties);
      const inner = arr(props.fields).length ? arr(props.fields) : arr(f.fields);
      if (String(f.type) === "group" || inner.length) {
        walk(inner);
        continue;
      }
      out.push({
        id: String(f.id ?? ""),
        ref: String(f.ref ?? ""),
        type: String(f.type ?? ""),
        title: String(f.title ?? "").replace(/\*/g, "").slice(0, 400),
        choices: arr(f.choices ?? props.choices).map(c => {
          const o = obj(c);
          return { id: String(o.id ?? ""), ref: o.ref ? String(o.ref) : null, label: String(o.label ?? "") };
        }),
      });
    }
  };
  walk(arr(definition.fields));
  return out;
}

/** The value of one answer, whatever its type. */
function valueOf(a: Json): Answer["value"] {
  switch (String(a.type)) {
    case "text":
      return str(a.text);
    case "email":
      return str(a.email, 320);
    case "phone_number":
      return str(a.phone_number, 40);
    case "url":
      return str(a.url, 2000);
    case "date":
      return str(a.date, 40);
    case "number":
      return typeof a.number === "number" && Number.isFinite(a.number) ? a.number : null;
    case "boolean":
      return typeof a.boolean === "boolean" ? a.boolean : null;
    case "choice": {
      const c = obj(a.choice);
      return str(c.label, 400) ?? str(c.other, 400);
    }
    case "choices": {
      const c = obj(a.choices);
      const labels = arr(c.labels).map(l => str(l, 400)).filter((l): l is string => !!l);
      const other = str(c.other, 400);
      return other ? [...labels, other] : labels;
    }
    default:
      return null;
  }
}

/** The ref of the chosen option, when Typeform sends it, else found by label. */
function chosenRef(a: Json, field: Field | undefined): string | null {
  const c = obj(a.choice);
  if (c.ref) return String(c.ref);
  const label = str(c.label, 400);
  return field?.choices.find(x => x.label === label)?.ref ?? null;
}

export function parseSubmission(payload: unknown): Submission {
  const p = obj(payload);
  const r = obj(p.form_response);
  const formId = str(r.form_id, 64) ?? str(obj(r.definition).id, 64);
  const token = str(r.token, 200);
  const submittedAt = str(r.submitted_at, 64);
  if (!formId || !token || !submittedAt || Number.isNaN(Date.parse(submittedAt)))
    throw new Error("Not a Typeform form_response with a form, a token and a submission time");

  const fields = fieldsOf(obj(r.definition));
  const byId = new Map(fields.map(f => [f.id, f]));
  const byRef = new Map(fields.map(f => [f.ref, f]));
  const given = new Map<string, Json>();
  for (const raw of arr(r.answers)) {
    const a = obj(raw);
    const f = obj(a.field);
    const ref = String(f.ref ?? byId.get(String(f.id ?? ""))?.ref ?? "");
    if (ref) given.set(ref, a);
  }
  const value = (ref: string) => {
    const a = given.get(ref);
    return a ? valueOf(a) : null;
  };
  const text = (ref: string) => {
    const v = value(ref);
    return typeof v === "string" ? v : null;
  };
  const bool = (ref: string) => {
    const v = value(ref);
    return typeof v === "boolean" ? v : null;
  };

  // Every answer, in form order, then anything the form has that this file
  // does not know yet.
  const answers: Answer[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (!given.has(f.ref) || f.ref.startsWith("q_")) continue;
    seen.add(f.ref);
    answers.push({ ref: f.ref, section: SECTION_OF.get(f.ref) ?? "More", title: f.title, value: value(f.ref) });
  }
  for (const [ref, a] of given) {
    if (seen.has(ref) || ref.startsWith("q_")) continue;
    answers.push({ ref, section: SECTION_OF.get(ref) ?? "More", title: byRef.get(ref)?.title ?? ref, value: valueOf(a) });
  }

  // The standards check: Typeform keeps the score; the misses are worked out
  // from the chosen option's ref (the right one ends in _c).
  const quiz = fields.filter(f => /^q_[a-z0-9_]+$/.test(f.ref) && !f.ref.endsWith("_why") && f.choices.length);
  const missed: Missed[] = [];
  for (const f of quiz) {
    const a = given.get(f.ref);
    if (!a) continue;
    const ref = chosenRef(a, f);
    if (!ref || ref === `${f.ref}_c`) continue;
    missed.push({
      ref: f.ref,
      topic: QUIZ_TOPICS[f.ref] ?? f.title,
      answered: typeof valueOf(a) === "string" ? (valueOf(a) as string) : null,
      correct: f.choices.find(c => c.ref === `${f.ref}_c`)?.label ?? null,
    });
  }
  const scoreVar = arr(r.variables).map(obj).find(v => v.key === "score");
  const calculated = obj(r.calculated).score;
  const score =
    typeof scoreVar?.number === "number" ? scoreVar.number : typeof calculated === "number" ? calculated : null;

  const goals: Submission["goals"] = {};
  for (const [ref, key] of Object.entries(GOALS)) {
    const v = text(ref);
    if (v) goals[key] = v;
  }

  const toolsField = byRef.get("tools_done");
  const doneAnswer = given.get("tools_done");
  const doneRefs = new Set(arr(obj(doneAnswer?.choices).refs).map(String));
  const doneLabels = new Set(arr(obj(doneAnswer?.choices).labels).map(String));
  const isDone = (c: Field["choices"][number]) => (c.ref ? doneRefs.has(c.ref) : false) || doneLabels.has(c.label);
  const tools = (toolsField?.choices ?? []).filter(c => c.ref !== NONE_CHOICE && c.label !== "None of these yet");
  const speed = value("speed_down");

  return {
    responseToken: token,
    formId,
    submittedAt,
    email: text("work_email")?.toLowerCase() ?? null,
    fullName: text("full_name"),
    preferredName: text("preferred_name"),
    roleLabel: text("role"),
    score,
    scoreMax: quiz.length || null,
    missed,
    goals,
    setup: {
      done: doneAnswer ? tools.filter(isDone).map(c => c.label) : [],
      missing: doneAnswer ? tools.filter(c => !isDone(c)).map(c => c.label) : tools.map(c => c.label),
      blocked: text("tools_blocked"),
    },
    workspace: {
      device: text("device"),
      speedMbps: typeof speed === "number" ? speed : null,
      backup: bool("backup_net"),
      cameraAndMic: bool("cam_mic"),
      quietSpace: bool("quiet_space"),
    },
    answers,
    raw: p,
  };
}
