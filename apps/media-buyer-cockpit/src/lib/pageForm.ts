/**
 * The questions on a client's own form page (olivar-landing "step-form"
 * pages, Merge Studio first), as the cockpit edits them. Shared by the editor
 * in the browser and by cockpit-media-api, which runs the same checks again
 * before anything is published, so a draft that passes here is what goes live.
 *
 * Publishing writes { version, questions } to the page's public file; the
 * page reads it while its first screen is open. Only the questions are
 * editable: the first screen, the contact step and the design stay in the repo.
 *
 * Each launch question carries a `param`: the query key of its own GHL field,
 * set up by tools/ghl_form_setup.py. A question added here has none, so its
 * answer reaches GHL only in the Answers field ("name: answer | ..."). The
 * server copies params from the page's bindings, never from the browser.
 */

export type PageOption = {
  /** The answer as the visitor reads it, and as GHL stores it. */
  value: string;
  /** A short line under the answer (photo cards only). */
  desc?: string;
  icon?: string;
  /** A photo from the page's library (photo cards only). */
  image?: string;
  /** A note shown when this answer is picked; the visitor then taps Next. */
  note?: string;
};

export type PageQuestion = {
  /** Stable for life: answers, reports and GHL bindings match on it. */
  key: string;
  /** The short name written before the answer in GHL's Answers field. */
  name: string;
  label: string;
  hint?: string;
  style: "photo" | "list";
  /** The question's own photo: a band on a phone, the side panel on a desktop. */
  image?: string;
  options: PageOption[];
  /** Query key of the question's own GHL field. Launch questions only; set by the server. */
  param?: string;
};

export type PageFormSpec = { version?: string; questions: PageQuestion[] };

export const LIMITS = {
  questions: [1, 8],
  options: [2, 8],
  label: 120,
  hint: 160,
  name: 40,
  value: 60,
  desc: 90,
  note: 240,
} as const;

/**
 * Icon names the page can draw, with the same paths as the page's ICON map
 * (olivar-landing clients/mergestudio/src/page.html), so the picker shows
 * what the visitor will see.
 */
export const ICONS: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  building:
    '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M9 7.5h1.5M13.5 7.5H15M9 11h1.5M13.5 11H15M9 14.5h1.5M13.5 14.5H15M10.5 20.5v-3h3v3"/>',
  hammer:
    '<path d="m13 9-8.5 8.5a1.6 1.6 0 0 0 2.3 2.3L15.3 11"/><path d="M12.5 5.5 15 3l6 6-2.5 2.5z"/><path d="m12.5 5.5 6 6"/>',
  crane:
    '<path d="M6 21V4h1.5L19 7"/><path d="M6 7h13"/><path d="M17 7v4"/><path d="M15.5 11h3v2.5h-3z"/><path d="M3.5 21h6"/><path d="M6 10.5 9 7M6 14l3-3"/>',
  dots: '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/>',
  sofa: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3 12.5a1.8 1.8 0 0 1 3.5-.5v3h11v-3a1.8 1.8 0 0 1 3.5.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M6 18v1.5M18 18v1.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15.5h5"/>',
  chat: '<path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z"/><path d="M8.5 10.8h.01M12 10.8h.01M15.5 10.8h.01" stroke-width="2.4"/>',
  cube: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  blocks:
    '<rect x="3.5" y="13" width="7" height="6" rx=".8"/><rect x="13.5" y="13" width="7" height="6" rx=".8"/><rect x="8.5" y="5" width="7" height="6" rx=".8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2.5 2.5M14 9l2 2"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>',
  bolt: '<path d="M13 3 5 13.5h6l-1 7.5 8-10.5h-6z"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  "plan-s":
    '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v5M4 12h4"/>',
  "plan-m":
    '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h8"/>',
  "plan-l":
    '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M10 4v9M4 13h16M15 13v7"/>',
  "plan-xl":
    '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M9 5v14M15 5v6M3.5 12H9M15 11h5.5M9 15h11.5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  helmet:
    '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M3 16h18v2.5H3z"/><path d="M10 8.3V5.5h4v2.8"/>',
  ruler:
    '<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7 13 1.5 1.5M10 10l1.5 1.5M13 7l1.5 1.5"/>',
  image:
    '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8.5 8"/>',
  bookmark: '<path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/>',
};

/** Picker order: the icons an answer is likely to need first. */
export const ICON_NAMES = Object.keys(ICONS);

const KEY = /^[a-z][a-z0-9_]{1,39}$/;
// Control characters and the bidi overrides that could scramble a label.
const badChar = (c: number) =>
  (c <= 0x1f && c !== 0x09 && c !== 0x0a && c !== 0x0d) ||
  (c >= 0x202a && c <= 0x202e) ||
  (c >= 0x2066 && c <= 0x2069);
const hasBadText = (t: string) =>
  [...t].some(ch => badChar(ch.codePointAt(0) ?? 0));

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A fresh key for a question added in the editor; never one already used on this page. */
export function newQuestionKey(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const key = `q_${Date.now().toString(36)}${n > 1 ? `_${n}` : ""}`;
    if (!used.has(key)) return key;
  }
}

/**
 * Everything wrong with a draft, in words the media buyer can act on. Empty
 * means it can be published. `photos` is the page's photo library; `retired`
 * holds keys of questions removed in an earlier version, which are never reused.
 */
export function problems(
  spec: PageFormSpec,
  opts: { photos: string[]; retired?: string[] } = { photos: [] },
): string[] {
  const out: string[] = [];
  const photos = new Set(opts.photos);
  const retired = new Set(opts.retired ?? []);
  const qs = Array.isArray(spec?.questions) ? spec.questions : [];
  if (qs.length < LIMITS.questions[0]) out.push("Add at least one question.");
  if (qs.length > LIMITS.questions[1])
    out.push(
      `Keep it to ${LIMITS.questions[1]} questions or fewer. Every extra screen loses visitors.`,
    );
  const keys = new Set<string>();
  const names = new Set<string>();
  qs.forEach((q, i) => {
    const at = `Question ${i + 1}`;
    if (!q || typeof q !== "object") {
      out.push(`${at} is empty.`);
      return;
    }
    if (!KEY.test(q.key ?? "")) out.push(`${at} has no valid key.`);
    else if (keys.has(q.key)) out.push(`${at} repeats another question's key.`);
    else if (retired.has(q.key))
      out.push(`${at} reuses the key of a removed question.`);
    keys.add(q.key);
    const label = trimmed(q.label);
    if (label.length < 3) out.push(`${at} needs the question itself.`);
    if (label.length > LIMITS.label)
      out.push(`${at}: keep the question under ${LIMITS.label} characters.`);
    const name = trimmed(q.name);
    if (!name) out.push(`${at} needs a short name for the CRM.`);
    else if (name.length > LIMITS.name)
      out.push(`${at}: keep the CRM name under ${LIMITS.name} characters.`);
    else if (names.has(name))
      out.push(`${at} uses the same CRM name as another question.`);
    names.add(name);
    if (trimmed(q.hint).length > LIMITS.hint)
      out.push(`${at}: keep the hint under ${LIMITS.hint} characters.`);
    if (q.style !== "photo" && q.style !== "list")
      out.push(`${at}: choose photo cards or a list.`);
    if (q.image && !photos.has(q.image))
      out.push(`${at}: its photo is not in this page's photo library.`);
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length < LIMITS.options[0])
      out.push(`${at} needs at least two answers.`);
    if (options.length > LIMITS.options[1])
      out.push(`${at}: keep it to ${LIMITS.options[1]} answers or fewer.`);
    const values = new Set<string>();
    options.forEach((o, k) => {
      const where = `${at}, answer ${k + 1}`;
      const value = trimmed(o?.value);
      if (!value) out.push(`${where} is empty.`);
      else if (value.length > LIMITS.value)
        out.push(`${where}: keep it under ${LIMITS.value} characters.`);
      else if (values.has(value)) out.push(`${where} repeats another answer.`);
      values.add(value);
      if (trimmed(o?.desc).length > LIMITS.desc)
        out.push(
          `${where}: keep the line under it under ${LIMITS.desc} characters.`,
        );
      if (trimmed(o?.note).length > LIMITS.note)
        out.push(`${where}: keep the note under ${LIMITS.note} characters.`);
      if (o?.icon && !ICONS[o.icon])
        out.push(`${where}: pick an icon from the list.`);
      if (q.style === "photo" && !o?.image)
        out.push(`${where} needs a photo (or show this question as a list).`);
      if (o?.image && !photos.has(o.image))
        out.push(`${where}: its photo is not in this page's photo library.`);
    });
    const texts = [
      q.label,
      q.name,
      q.hint,
      ...options.flatMap(o => [o?.value, o?.desc, o?.note]),
    ];
    if (texts.some(t => typeof t === "string" && hasBadText(t)))
      out.push(`${at} contains hidden control characters. Retype it.`);
  });
  return out;
}

/**
 * The spec exactly as it is published: trimmed, unknown fields dropped, photo
 * fields only where the style uses them, and each `param` taken from the
 * page's bindings (key -> param) rather than from whatever the browser sent.
 */
export function clean(
  spec: PageFormSpec,
  bindings: Record<string, string>,
): PageFormSpec {
  return {
    questions: spec.questions.map(q => {
      const photo = q.style === "photo";
      const out: PageQuestion = {
        key: q.key,
        name: trimmed(q.name),
        label: trimmed(q.label),
        style: photo ? "photo" : "list",
        options: q.options.map(o => {
          const opt: PageOption = { value: trimmed(o.value) };
          if (photo && trimmed(o.desc)) opt.desc = trimmed(o.desc);
          if (o.icon && ICONS[o.icon]) opt.icon = o.icon;
          if (photo && o.image) opt.image = o.image;
          if (trimmed(o.note)) opt.note = trimmed(o.note);
          return opt;
        }),
      };
      if (trimmed(q.hint)) out.hint = trimmed(q.hint);
      if (q.image) out.image = q.image;
      if (bindings[q.key]) out.param = bindings[q.key];
      return out;
    }),
  };
}

/** What changed between two versions, as a short sentence for the history and the audit log. */
export function describeChange(
  before: PageFormSpec | null,
  after: PageFormSpec,
): string {
  if (!before) return `Published ${after.questions.length} questions`;
  const was = new Map(before.questions.map(q => [q.key, q]));
  const now = new Map(after.questions.map(q => [q.key, q]));
  const added = after.questions.filter(q => !was.has(q.key));
  const removed = before.questions.filter(q => !now.has(q.key));
  const edited = after.questions.filter(
    q => was.has(q.key) && JSON.stringify(was.get(q.key)) !== JSON.stringify(q),
  );
  const order =
    JSON.stringify(
      before.questions.filter(q => now.has(q.key)).map(q => q.key),
    ) !==
    JSON.stringify(after.questions.filter(q => was.has(q.key)).map(q => q.key));
  const parts = [
    ...added.map(q => `added "${q.name}"`),
    ...removed.map(q => `removed "${q.name}"`),
    ...edited.map(q => `edited "${q.name}"`),
    ...(order ? ["reordered the questions"] : []),
  ];
  if (!parts.length) return "No change to the questions";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The Answers field as the page writes it, for the editor's example line. */
export function answersLine(
  spec: PageFormSpec,
  answers: Record<string, string>,
): string {
  return spec.questions
    .filter(q => answers[q.key])
    .map(q => `${q.name || q.label}: ${answers[q.key]}`)
    .join(" | ");
}
