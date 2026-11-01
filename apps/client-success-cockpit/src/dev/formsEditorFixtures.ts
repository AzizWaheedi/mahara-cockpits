/**
 * The forms editor's fixtures (docs/forms/WAVE34-CONTRACT.md 3.1, 5.5 to 5.8,
 * 5.13): the four client form schemas with the contract's own English and
 * Arabic lines (drafted under aziz-kuwaiti-voice for the contract), the
 * editor's reads, and an in-memory stand-in for the RPCs that refuses the
 * way the database does for the cases the screen tests reach. Nothing here
 * calls a server. Only relative, type-only imports: the media buyer app's
 * PGlite test seeds these schemas when 20261102a is not on the branch yet.
 */
import type { FormsEditorIO } from "../lib/formsEditor";
import type {
  ClientFormSchema,
  EditorFormRow,
  EditorOne,
  EditorRead,
  RoutingPatch,
} from "../lib/formsEditorCore";

const t = (en: string, ar: string) => ({ en, ar });

const SCALE_10_1 = {
  lowLabel: t("1 = Poor", "١ = ضعيف"),
  highLabel: t("10 = Excellent", "١٠ = ممتاز"),
};

/** NPS (5.7). */
export const NPS_SCHEMA: ClientFormSchema = {
  v: 1,
  key: "nps",
  title: t("How are we doing?", "شلون شغلنا معاكم؟"),
  intro: t(
    "One minute. Your account manager reads every answer.",
    "دقيقة وحدة بس. مدير حسابك يقرا كل رد.",
  ),
  minutes: 1,
  audience: "any",
  signer: "none",
  context: [],
  fields: [
    {
      key: "recommend",
      type: "scale",
      label: t(
        "How likely are you to recommend Mahara to a friend or another business owner?",
        "شكثر ممكن تنصح فينا ربعك أو صاحب شركة ثاني؟",
      ),
      hint: null,
      required: true,
      min: 0,
      max: 10,
      lowLabel: t("0 = Not at all likely", "٠ = أبد"),
      highLabel: t("10 = Extremely likely", "١٠ = أكيد"),
      showIf: null,
    },
    {
      key: "results",
      type: "scale",
      label: t(
        "How happy are you with the results so far?",
        "شكثر راضي عن النتائج لين الحين؟",
      ),
      hint: null,
      required: false,
      min: 0,
      max: 10,
      lowLabel: t("0 = Not happy", "٠ = مو راضي"),
      highLabel: t("10 = Very happy", "١٠ = راضي وايد"),
      showIf: null,
    },
    {
      key: "communication",
      type: "scale",
      label: t(
        "How is communication with your Mahara team?",
        "شلون التواصل مع فريق مهارة؟",
      ),
      hint: null,
      required: false,
      min: 1,
      max: 10,
      ...SCALE_10_1,
      showIf: null,
    },
    {
      key: "startStop",
      type: "longtext",
      label: t(
        "What should we start or stop doing?",
        "شنو تبينا نبدي فيه أو نوقفه؟",
      ),
      hint: null,
      required: false,
      maxLength: 2000,
      showIf: null,
    },
  ],
  reads: { low_score: ["recommend"], nps_notice: ["recommend", "results"] },
  submit: t("Send", "أرسل"),
  done: t(
    "Thanks. Your account manager reads every answer.",
    "مشكور. مدير حسابك يقرا كل رد.",
  ),
  invite: {
    whatsapp: t(
      "Hi {client} team, a quick question from Mahara: how likely are you to recommend us? It takes a minute: {form_link}",
      "هلا فريق {client}، عندنا سؤال سريع من مهارة: شكثر ممكن تنصحون فينا؟ ما ياخذ إلا دقيقة: {form_link}",
    ),
    push: t(
      "A one-minute question from your Mahara team. Tap to answer.",
      "سؤال من فريق مهارة ياخذ دقيقة. اضغط وجاوب.",
    ),
  },
};

/** The onboarding survey, CSAT (5.8). */
export const CSAT_SCHEMA: ClientFormSchema = {
  v: 1,
  key: "csat",
  title: t("How was getting started?", "شلون كانت البداية معانا؟"),
  intro: t(
    "Your campaign is live. Tell us how the first steps felt.",
    "حملتك اشتغلت. قول لنا شلون كانت أول الخطوات.",
  ),
  minutes: 1,
  audience: "any",
  signer: "none",
  context: [],
  fields: [
    {
      key: "onboarding",
      type: "scale",
      label: t(
        "How would you rate getting started with Mahara?",
        "من ١ لين ١٠، شكثر تعطي البداية معانا؟",
      ),
      hint: null,
      required: true,
      min: 1,
      max: 10,
      ...SCALE_10_1,
      showIf: null,
    },
    {
      key: "liked",
      type: "longtext",
      label: t("What did you like?", "شنو عجبك؟"),
      hint: null,
      required: false,
      maxLength: 2000,
      showIf: null,
    },
    {
      key: "disliked",
      type: "longtext",
      label: t("What could we have done better?", "شنو كان ممكن نسويه أحسن؟"),
      hint: null,
      required: false,
      maxLength: 2000,
      showIf: null,
    },
  ],
  reads: { low_score: ["onboarding"], csat_notice: ["onboarding"] },
  submit: t("Send", "أرسل"),
  done: t(
    "Thank you. This helps the next client too.",
    "مشكور. هذا يساعدنا مع العميل الياي بعد.",
  ),
  invite: {
    whatsapp: t(
      "Hi {client} team, now that your campaign is live, how was getting started with us? Tell us in a minute: {form_link}",
      "هلا فريق {client}، الحين حملتكم اشتغلت. شلون كانت البداية معانا؟ قولوا لنا بدقيقة: {form_link}",
    ),
    push: t(
      "How was getting started? Tell your Mahara team in a minute.",
      "شلون كانت البداية؟ قول لفريق مهارة بدقيقة.",
    ),
  },
};

/** Pause consent (5.5). */
export const PAUSE_CONSENT_SCHEMA: ClientFormSchema = {
  v: 1,
  key: "pause_consent",
  title: t("Confirm your pause", "أكّد الإيقاف المؤقت"),
  intro: t(
    "Your account manager set up this pause after your call. Check the dates, then confirm.",
    "مدير حسابك جهّز هالإيقاف بعد المكالمة. شيّك على التواريخ وبعدها أكّد.",
  ),
  minutes: 2,
  audience: "admin",
  signer: "typed",
  context: [
    { key: "start", type: "date", label: t("Pause starts", "يبدأ الإيقاف") },
    {
      key: "restart",
      type: "date",
      label: t("Campaign restarts", "ترجع الحملة"),
    },
  ],
  fields: [
    {
      key: "datesWrong",
      type: "tick",
      label: t("These dates are wrong", "التواريخ هذي غلط"),
      hint: null,
      required: false,
      showIf: null,
    },
    {
      key: "datesNote",
      type: "longtext",
      label: t("What should they be?", "شنو التواريخ الصح؟"),
      hint: null,
      required: true,
      maxLength: 2000,
      showIf: { key: "datesWrong", equals: true },
    },
    {
      key: "reason",
      type: "choice",
      label: t("Why are you pausing?", "ليش تبي توقف الحملة؟"),
      hint: null,
      required: true,
      options: [
        { value: "travel", label: t("Travel", "سفر") },
        { value: "closed", label: t("Temporary closure", "سكّرنا مؤقتاً") },
        {
          value: "capacity",
          label: t("We are at capacity", "عندنا شغل فوق طاقتنا"),
        },
        { value: "season", label: t("Ramadan or a season", "رمضان أو موسم") },
        { value: "other", label: t("Something else", "شي ثاني") },
      ],
      showIf: null,
    },
    {
      key: "details",
      type: "longtext",
      label: t("Tell us a little more", "قول لنا أكثر شوي"),
      hint: null,
      required: true,
      maxLength: 2000,
      showIf: null,
    },
    {
      key: "consentTerm",
      type: "tick",
      label: t(
        "I understand the 90-day term keeps running during the pause.",
        "أدري إن مدة العقد ٩٠ يوم تظل تمشي خلال الإيقاف.",
      ),
      hint: null,
      required: true,
      showIf: { key: "datesWrong", equals: false },
    },
    {
      key: "consentOver14",
      type: "tick",
      label: t(
        "I understand that a pause longer than 14 days ends our agreement.",
        "أدري إن الإيقاف إذا زاد عن ١٤ يوم ينتهي فيه الاتفاق بيننا.",
      ),
      hint: null,
      required: true,
      showIf: { key: "datesWrong", equals: false },
      boldIf: { context: "over14", equals: true },
    },
    {
      key: "anythingElse",
      type: "longtext",
      label: t(
        "Anything else for your Mahara team?",
        "تبي تقول شي ثاني لفريق مهارة؟",
      ),
      hint: null,
      required: false,
      maxLength: 2000,
      showIf: null,
    },
  ],
  reads: { consent_gate: ["datesWrong", "consentTerm", "consentOver14"] },
  submit: t("Confirm the pause", "أكّد الإيقاف"),
  done: t(
    "Confirmed. Your account manager takes it from here.",
    "تم التأكيد. مدير حسابك بيكمل الباقي.",
  ),
  invite: {
    whatsapp: t(
      "Hi {client} team, here is the pause we agreed on the call. Check the dates and confirm here: {form_link}",
      "هلا فريق {client}، هذا الإيقاف المؤقت اللي اتفقنا عليه بالمكالمة. شيّكوا على التواريخ وأكّدوا من هني: {form_link}",
    ),
    push: t(
      "Your account manager sent the pause to confirm. Tap to open it.",
      "مدير حسابك أرسل لك الإيقاف عشان تأكده. اضغط وافتحه.",
    ),
  },
};

const SCALE_ENDS_0 = {
  lowLabel: t("0 = Not at all", "٠ = أبد"),
  highLabel: t("10 = Definitely", "١٠ = أكيد"),
};

/** The exit survey, version 2 (5.6). */
export const EXIT_SURVEY_SCHEMA: ClientFormSchema = {
  v: 1,
  key: "exit_survey",
  title: t("Before you go", "قبل لا تمشي"),
  intro: t(
    "We are sorry to see you go. Your answers reach your account manager and our CEO, and help us do better.",
    "يعز علينا تمشي. ردودك توصل لمدير حسابك وللمدير التنفيذي، وتساعدنا نتحسن.",
  ),
  minutes: 2,
  audience: "admin",
  signer: "typed",
  context: [],
  fields: [
    {
      key: "reasons",
      type: "multi",
      label: t("Why are you leaving?", "ليش قررت توقف؟"),
      hint: null,
      required: true,
      options: [
        { value: "results", label: t("The results", "النتائج") },
        {
          value: "company_changes",
          label: t("Changes in our company", "تغييرات بشركتنا"),
        },
        { value: "cheaper", label: t("A cheaper provider", "لقينا أحد أرخص") },
        {
          value: "in_house",
          label: t("Moving it in-house", "بنسويه داخل الشركة"),
        },
        { value: "other", label: t("Something else", "شي ثاني") },
      ],
      showIf: null,
    },
    {
      key: "ads",
      type: "scale",
      label: t("The ads we ran for you", "الإعلانات اللي سويناها لك"),
      hint: null,
      required: true,
      min: 1,
      max: 10,
      ...SCALE_10_1,
      showIf: null,
    },
    {
      key: "people",
      type: "scale",
      label: t(
        "The people who reached you through the ads",
        "الناس اللي تواصلوا معاك من الإعلانات",
      ),
      hint: null,
      required: true,
      min: 1,
      max: 10,
      ...SCALE_10_1,
      showIf: null,
    },
    {
      key: "comms",
      type: "scale",
      label: t("Communication with our team", "التواصل مع فريقنا"),
      hint: null,
      required: true,
      min: 1,
      max: 10,
      ...SCALE_10_1,
      showIf: null,
    },
    {
      key: "recommend",
      type: "scale",
      label: t(
        "How likely are you to recommend Mahara to another business owner?",
        "شكثر ممكن تنصح فينا صاحب شركة ثاني؟",
      ),
      hint: null,
      required: true,
      min: 0,
      max: 10,
      ...SCALE_ENDS_0,
      showIf: null,
    },
    {
      key: "keptUs",
      type: "longtext",
      label: t(
        "What would have kept you with us?",
        "شنو كان ممكن يخليك تكمل معانا؟",
      ),
      hint: null,
      required: false,
      maxLength: 2000,
      showIf: null,
    },
    {
      key: "comments",
      type: "longtext",
      label: t("Anything else you want us to know?", "في شي ثاني تبينا نعرفه؟"),
      hint: null,
      required: false,
      maxLength: 2000,
      showIf: null,
    },
  ],
  reads: {
    card_comment: [
      "reasons",
      "ads",
      "people",
      "comms",
      "recommend",
      "keptUs",
      "comments",
    ],
  },
  submit: t("Send", "أرسل"),
  done: t(
    "Thank you. Your account manager will be in touch.",
    "مشكور. مدير حسابك بيتواصل معاك.",
  ),
  invite: {
    whatsapp: t(
      "Hi {client} team, thank you for the time we worked together. Two minutes of honest feedback would help us a lot: {form_link}",
      "هلا فريق {client}، شكراً على الفترة اللي اشتغلنا فيها سوا. دقيقتين من رأيكم الصريح تفرق معانا وايد: {form_link}",
    ),
    push: t(
      "Your account manager sent a short survey. Tap to open it.",
      "مدير حسابك أرسل لك استبيان قصير. اضغط وافتحه.",
    ),
  },
};

export const CLIENT_SCHEMAS: Record<string, ClientFormSchema> = {
  nps: NPS_SCHEMA,
  csat: CSAT_SCHEMA,
  pause_consent: PAUSE_CONSENT_SCHEMA,
  exit_survey: EXIT_SURVEY_SCHEMA,
};

/** A deep copy, so a test's edit never reaches the shared fixture. */
export const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// --- The editor's reads --------------------------------------------------------

const AT = "2026-11-02T07:30:00Z";

function row(key: string, over: Partial<EditorFormRow> = {}): EditorFormRow {
  const s = CLIENT_SCHEMAS[key];
  return {
    key,
    title: s?.title.en ?? key,
    titleAr: s?.title.ar ?? null,
    group: "client",
    editable: true,
    why: null,
    provider: "native",
    audience: "client",
    version: 1,
    registryVersion: 1,
    publishedAt: AT,
    publishedBy: "a migration",
    questions: s?.fields.length ?? null,
    live: false,
    draft: null,
    ...over,
  };
}

const STAFF_WHY =
  "Set in the cockpit's code; the SQL checks these fields word for word.";
const TYPEFORM_WHY = "Lives in Typeform; Make owns its effects until Stage 4.";

export function editorReadFixture(): EditorRead {
  return {
    forms: [
      row("exit_survey", {
        provider: "typeform",
        version: 2,
        registryVersion: 1,
      }),
      row("nps", { live: true }),
      row("csat"),
      row("pause_consent", {
        draft: {
          baseVersion: 1,
          savedAt: AT,
          savedBy: "an admin",
          stale: false,
        },
      }),
      row("portal_feedback", {
        title: "Portal feedback",
        titleAr: null,
        editable: false,
        why: "The portal's Share feedback writes these; edit it in the portal.",
        version: 1,
        questions: 5,
        live: null,
      }),
      ...(
        [
          ["extension", "Give more time"],
          ["pause", "Pause this client"],
          ["resume", "Resume this client"],
          ["churn_confirm", "Client is leaving"],
          ["mrr", "Set MRR"],
          ["checkin", "1-1 call notes"],
          ["blueprint", "Brand Blueprint"],
        ] as const
      ).map(([key, title]) =>
        row(key, {
          title,
          titleAr: null,
          group: "staff",
          editable: false,
          why: STAFF_WHY,
          audience: "team",
          questions: null,
          live: null,
        }),
      ),
      ...(
        [
          ["kickoff", "Kickoff", "team"],
          ["onboarding", "Client onboarding", "client"],
          ["new_client", "New Client Form", "team"],
          ["pause_request", "Pause request", "client"],
        ] as const
      ).map(([key, title, audience]) =>
        row(key, {
          title,
          titleAr: null,
          group: "typeform",
          editable: false,
          why: TYPEFORM_WHY,
          provider: "typeform",
          audience,
          questions: 0,
          live: null,
        }),
      ),
    ],
    routing: {
      schedules: {
        nps: {
          on: true,
          rule: { firstDay: 60, everyDays: 90, remindAfterDays: 7 },
          updatedAt: AT,
          updatedBy: "a migration",
        },
        csat: {
          on: true,
          rule: {
            afterLaunchDays: 0,
            whatsappAfterDays: 3,
            snoozeDays: 3,
            reissues: 3,
            retryAfterDays: 7,
            maxAgeDays: 60,
          },
          updatedAt: AT,
          updatedBy: "a migration",
        },
      },
      lowScore: { max: 6 },
      scheduleOn: false,
      note: "The automatic schedule is off for every client; these rules apply once it is turned on.",
    },
    portalBase: "https://portal.maharamedia.com",
    workspaces: [
      { locationId: "locZeta01", name: "Zeta Kitchens", status: "Active" },
      { locationId: "locAlpha01", name: "Alpha Interiors", status: "Active" },
      { locationId: "locBeta01", name: "Beta Build", status: "Paused" },
    ],
  };
}

/** One form's read, from the list fixture plus its schema. */
export function editorOneFixture(
  key: string,
  over: Partial<EditorOne> = {},
): EditorOne {
  const list = editorReadFixture();
  const form = list.forms.find(f => f.key === key);
  if (!form) throw new Error(`No fixture form ${key}`);
  const schema = CLIENT_SCHEMAS[key];
  const version = form.version ?? 1;
  return {
    form,
    published:
      form.editable && schema
        ? {
            version,
            schema: copy(schema),
            publishedAt: AT,
            publishedBy: "a migration",
            note: null,
          }
        : null,
    draft: null,
    history: form.editable
      ? Array.from({ length: version }, (_, i) => version - i).map(v => ({
          version: v,
          publishedAt: AT,
          publishedBy: "a migration",
          note: v === 1 ? null : "Waves 3-4 client survey",
          client: key !== "exit_survey" || v > 1,
          current: v === version,
        }))
      : [],
    reads: schema
      ? Object.entries(schema.reads).map(([effect, fields]) => ({
          effect,
          label:
            {
              low_score: "the low-score call on Today",
              nps_notice: "the NPS answer notice",
              csat_notice: "the onboarding survey notice",
              consent_gate: "the pause confirm check",
              card_comment: "the ClickUp card comment",
            }[effect] ?? effect,
          fields,
        }))
      : [],
    record: form.editable
      ? null
      : {
          fields: key === "extension" ? ["weeks", "reason", "callId"] : [],
          lives:
            form.group === "staff"
              ? "apps/client-success-cockpit/src/forms/staff/formDefs.ts"
              : "typeform",
          typeformId: form.group === "typeform" ? "tG7dnxBn" : null,
        },
    ...over,
  };
}

// --- An in-memory stand-in for the RPCs ------------------------------------------

export type FakeCall = { op: string; args: unknown[] };

/**
 * The editor's RPCs in memory: drafts, publish (stale base, no changes, a
 * field guard on the reads), restore and routing. `refuse` makes the next
 * call of an op throw the given sentence, as the server would.
 */
export function fakeFormsEditorIO(
  start: EditorRead = editorReadFixture(),
): FormsEditorIO & {
  calls: FakeCall[];
  refuse: (op: string, message: string, where?: string) => void;
  state: { read: EditorRead; ones: Map<string, EditorOne> };
} {
  const read = copy(start);
  const ones = new Map<string, EditorOne>();
  const calls: FakeCall[] = [];
  const refusals = new Map<string, { message: string; where?: string }>();
  const one = (key: string) => {
    let o = ones.get(key);
    if (!o) {
      o = editorOneFixture(key);
      ones.set(key, o);
    }
    return o;
  };
  const fail = (op: string) => {
    const r = refusals.get(op);
    if (!r) return;
    refusals.delete(op);
    throw Object.assign(new Error(r.message), {
      code: "22023",
      hint: r.where ?? null,
    });
  };
  const syncRow = (key: string) => {
    const o = one(key);
    const i = read.forms.findIndex(f => f.key === key);
    if (i >= 0) read.forms[i] = { ...o.form };
  };
  return {
    calls,
    state: { read, ones },
    refuse: (op, message, where) => refusals.set(op, { message, where }),
    async read() {
      calls.push({ op: "read", args: [] });
      fail("read");
      return copy(read);
    },
    async readOne(key) {
      calls.push({ op: "readOne", args: [key] });
      fail("readOne");
      return copy(one(key));
    },
    async saveDraft(key, schema, base) {
      calls.push({ op: "saveDraft", args: [key, schema, base] });
      fail("saveDraft");
      const o = one(key);
      if (base !== o.form.version)
        throw Object.assign(
          new Error(
            `Someone published version ${o.form.version} since you opened this. Reload it.`,
          ),
          { code: "22023" },
        );
      if (schema === null) {
        o.draft = null;
        o.form = { ...o.form, draft: null };
      } else {
        const same =
          JSON.stringify(schema) === JSON.stringify(o.published?.schema);
        o.draft = {
          schema: copy(schema),
          baseVersion: base,
          savedAt: "2026-11-02T08:00:00Z",
          savedBy: "an admin",
          stale: false,
          problem: same ? "No changes yet." : null,
          where: null,
        };
        o.form = {
          ...o.form,
          draft: {
            baseVersion: base,
            savedAt: "2026-11-02T08:00:00Z",
            savedBy: "an admin",
            stale: false,
          },
        };
      }
      syncRow(key);
      return copy(o);
    },
    async publish(key, note, base) {
      calls.push({ op: "publish", args: [key, note, base] });
      fail("publish");
      const o = one(key);
      if (base !== o.form.version)
        throw Object.assign(
          new Error(
            `Someone published version ${o.form.version} since you opened this. Reload it.`,
          ),
          { code: "22023" },
        );
      if (!o.draft)
        throw Object.assign(new Error("No changes yet."), { code: "22023" });
      const next = (o.form.version ?? 0) + 1;
      o.history = [
        {
          version: next,
          publishedAt: "2026-11-02T08:05:00Z",
          publishedBy: "an admin",
          note,
          client: true,
          current: true,
        },
        ...o.history.map(h => ({ ...h, current: false })),
      ];
      o.published = {
        version: next,
        schema: copy(o.draft.schema),
        publishedAt: "2026-11-02T08:05:00Z",
        publishedBy: "an admin",
        note,
      };
      o.draft = null;
      o.form = {
        ...o.form,
        version: next,
        draft: null,
        registryVersion:
          o.form.provider === "native" ? next : o.form.registryVersion,
      };
      syncRow(key);
      return {
        version: next,
        registryUpdated: o.form.provider === "native",
        read: copy(o),
      };
    },
    async restore(key, version, note) {
      calls.push({ op: "restore", args: [key, version, note] });
      fail("restore");
      const o = one(key);
      const next = (o.form.version ?? 0) + 1;
      o.history = [
        {
          version: next,
          publishedAt: "2026-11-02T08:10:00Z",
          publishedBy: "an admin",
          note: `Restored version ${version}${note ? `: ${note}` : ""}`,
          client: true,
          current: true,
        },
        ...o.history.map(h => ({ ...h, current: false })),
      ];
      o.form = { ...o.form, version: next };
      if (o.published) o.published = { ...o.published, version: next };
      syncRow(key);
      return {
        version: next,
        registryUpdated: o.form.provider === "native",
        read: copy(o),
      };
    },
    async setRouting(patch: RoutingPatch) {
      calls.push({ op: "setRouting", args: [patch] });
      fail("setRouting");
      const s = read.routing.schedules ?? {};
      if (patch.nps && s.nps)
        s.nps = {
          ...s.nps,
          on: patch.nps.on ?? s.nps.on,
          rule: { ...s.nps.rule, ...patch.nps.rule },
        };
      if (patch.csat && s.csat)
        s.csat = {
          ...s.csat,
          on: patch.csat.on ?? s.csat.on,
          rule: { ...s.csat.rule, ...patch.csat.rule },
        };
      if (patch.lowScore) read.routing.lowScore = { max: patch.lowScore.max };
      return copy(read.routing);
    },
  };
}
