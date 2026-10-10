/**
 * The current client extension, written onto the ClickUp cards. Ported from
 * apps/media-buyer-cockpit/convex/ceo/extensions.ts (applyToClickUp and
 * applyAuto). The rules are pure so extensions.test.ts can check them; the
 * reads and writes arrive as injected dependencies, each of which goes
 * through a health-ledger helper in tools.ts or a service-only RPC.
 *
 * - An extension is a response on the Client Extension Form (Typeform
 *   gqBcyK6g): the client as typed, and 1, 2 or 4 weeks. The clock starts at
 *   submission. The typed client is matched to a card by folded name.
 * - The button sends every value (force). The automatic pass sends only the
 *   values that differ from the last confirmed write, and it is a dry run
 *   unless CEO_EXTENSIONS_APPLY is 'true'.
 */

type Row = Record<string, unknown>;

export const EXT_FORM = 'gqBcyK6g';
const EXT_CLIENT_REF = '5145ff0c-009b-4f51-b3a9-4651efc908be';
const EXT_DURATION_REF = '278c2f80-88bd-428e-b330-8c6b3175d63f';
export const EXT_PAGE = 200;
export const EXT_PATH = `forms/${EXT_FORM}/responses?page_size=${EXT_PAGE}`;
export const CLIENTS_LIST = '901816559981';
export const EXTENSION_FIELD_NAME = 'Current extension (weeks)';
export const EXTENSION_FIELD_ENV = 'CLICKUP_EXTENSION_FIELD';
export const FIELD_ASK = `Create a Number field '${EXTENSION_FIELD_NAME}' on the Clients - Mahara list (${CLIENTS_LIST}); the cockpit finds it by name at the next sync`;
export const AUTO_ACTOR = 'the cockpit, after the extension form sync';

const WEEKS_BY_LABEL: Record<string, number> = { '1 WEEK': 1, '2 WEEKS': 2, '4 WEEKS': 4 };
const DAY_MS = 86_400_000;
const KUWAIT_OFFSET_MS = 3 * 3_600_000;
const INTERNAL_TEXT = /\binternal test\b|playing account/i;
const GONE = new Set(['Stopped', 'CANCELLED ONBOARDING']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const kuwaitDay = (at: number = Date.now()): string =>
  new Date(at + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
export const isInternalText = (s: unknown): boolean => INTERNAL_TEXT.test(String(s ?? ''));
export const fold = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const isGone = (stage: unknown): boolean => GONE.has(String(stage ?? ''));

export type ExtensionGrant = { id: string; submittedAt: number; day: string; client: string; weeks: number; until: string };
export type Card = { taskId: string; name: string; stage?: string | null };
export type FieldWrite = { taskId: string; client: string; weeks: number; until: string; grantedDay: string };
export type ApplyResult = {
  written: number;
  cleared: number;
  skipped: number;
  errors: string[];
  note: string;
  /** False when a read failed, a field is missing or a write failed. */
  ok: boolean;
  dryRun?: boolean;
  /** Cards the pass would have written, in a dry run. */
  planned?: number;
};

const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseExtensionResponses(items: unknown[]): ExtensionGrant[] {
  const out: ExtensionGrant[] = [];
  for (const raw of items) {
    if (!isRow(raw)) continue;
    const answers = Array.isArray(raw.answers) ? raw.answers.filter(isRow) : [];
    const refOf = (a: Row) => (isRow(a.field) ? a.field.ref : undefined);
    const client = String(answers.find(a => refOf(a) === EXT_CLIENT_REF)?.text ?? '').trim();
    // The duration is a dropdown that the responses API delivers as text.
    const duration = answers.find(a => refOf(a) === EXT_DURATION_REF);
    const choice = duration && isRow(duration.choice) ? duration.choice.label : undefined;
    const label = String(choice ?? duration?.text ?? '').trim().toUpperCase();
    const weeks = WEEKS_BY_LABEL[label];
    const submittedAt = Date.parse(String(raw.submitted_at ?? ''));
    if (!client || !weeks || !Number.isFinite(submittedAt)) continue;
    out.push({
      id: String(raw.response_id ?? raw.token ?? `${submittedAt}:${fold(client)}`),
      submittedAt,
      day: kuwaitDay(submittedAt),
      client,
      weeks,
      until: kuwaitDay(submittedAt + weeks * 7 * DAY_MS),
    });
  }
  return out.sort((a, b) => a.submittedAt - b.submittedAt);
}

/** Folded names, either containing the other; an exact fold wins, then the longest card name. */
export function matchCard<C extends Card>(client: string, cards: C[]): C | null {
  const typed = fold(client);
  if (typed.length < 4) return null;
  let best: { card: C; key: string } | null = null;
  for (const card of cards) {
    const key = fold(card.name);
    if (!key || !(typed.includes(key) || key.includes(typed))) continue;
    if (!best) { best = { card, key }; continue; }
    const exact = key === typed;
    const bestExact = best.key === typed;
    if (exact !== bestExact) { if (exact) best = { card, key }; continue; }
    if (key.length > best.key.length) best = { card, key };
  }
  return best?.card ?? null;
}

/**
 * What the field should say on every card the form has named: the live
 * grant's weeks, or 0 once it has ended. Gone cards are skipped.
 */
export function planWrites(grants: ExtensionGrant[], cards: Card[], today: string): { writes: FieldWrite[]; skipped: number } {
  const latest = new Map<string, { card: Card; grant: ExtensionGrant }>();
  for (const g of grants) {
    const card = matchCard(g.client, cards);
    if (!card || isInternalText(g.client) || isInternalText(card.name)) continue;
    const cur = latest.get(card.taskId);
    if (!cur || g.until > cur.grant.until || (g.until === cur.grant.until && g.submittedAt > cur.grant.submittedAt))
      latest.set(card.taskId, { card, grant: g });
  }
  const writes: FieldWrite[] = [];
  let skipped = 0;
  for (const { card, grant } of latest.values()) {
    if (isGone(card.stage)) { skipped += 1; continue; }
    writes.push({ taskId: card.taskId, client: card.name, weeks: grant.until >= today ? grant.weeks : 0, until: grant.until, grantedDay: grant.day });
  }
  writes.sort((a, b) => a.client.localeCompare(b.client));
  return { writes, skipped };
}

const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`.trim();

/** The audit sentence for one confirmed write. */
export function writeSentence(w: FieldWrite): string {
  return w.weeks > 0
    ? `Set ${w.client}'s current extension to ${w.weeks} ${w.weeks === 1 ? 'week' : 'weeks'} on ClickUp: granted ${shortDay(w.grantedDay)} on the Client Extension Form, cover to ${shortDay(w.until)}.`
    : `Cleared ${w.client}'s current extension on ClickUp (set to 0): the last one, granted ${shortDay(w.grantedDay)}, ended ${shortDay(w.until)}.`;
}

export const errText = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+:?\s*/g, '').trim().slice(0, 160);

/** The field ID from the override, else the field of that name on the Clients list. Null when it does not exist. */
export function fieldIdFrom(override: string | undefined, listFields: unknown): string | null {
  const id = override?.trim();
  if (id) return id;
  const fields = isRow(listFields) && Array.isArray(listFields.fields) ? listFields.fields : [];
  const want = EXTENSION_FIELD_NAME.toLowerCase();
  const hit = fields.find(f => isRow(f) && String(f.name ?? '').trim().toLowerCase() === want);
  return isRow(hit) && hit.id ? String(hit.id) : null;
}

export interface ExtensionDeps {
  /** The field ID, or null when the field does not exist. Throws when ClickUp cannot be read. */
  fieldId(): Promise<string | null>;
  /** The form's responses. Throws when Typeform cannot be read. */
  readForm(): Promise<unknown[]>;
  /** Every client card with its stage. Throws when the billing snapshot is missing or stale. */
  cards(): Promise<Card[]>;
  /** What the field said after the last confirmed write, per card, for this field. */
  lastWritten(fieldId: string): Promise<Record<string, number>>;
  /** The ClickUp write. */
  write(taskId: string, fieldId: string, weeks: number): Promise<void>;
  /** The audit row and the memory of the write, after ClickUp confirmed it. */
  record(write: FieldWrite, fieldId: string, what: string): Promise<void>;
  today(): string;
}

/** Write the field on every card the form has named. */
export async function applyExtensions(deps: ExtensionDeps, mode: { force: boolean; apply: boolean }): Promise<ApplyResult> {
  const none = { written: 0, cleared: 0, skipped: 0, errors: [] as string[] };
  let fieldId: string | null;
  try {
    fieldId = await deps.fieldId();
  } catch (e) {
    return { ...none, ok: false, note: `The Clients list could not be read on ClickUp (${errText(e)}), so nothing was written.` };
  }
  if (!fieldId) return { ...none, ok: false, note: FIELD_ASK };
  let grants: ExtensionGrant[];
  try {
    grants = parseExtensionResponses(await deps.readForm());
  } catch (e) {
    return { ...none, ok: false, note: `The Client Extension Form could not be read (${errText(e)}), so nothing was written.` };
  }
  let cards: Card[];
  try {
    cards = await deps.cards();
  } catch (e) {
    return { ...none, ok: false, note: `The client cards could not be read (${errText(e)}), so nothing was written.` };
  }
  if (cards.length === 0)
    return { ...none, ok: false, note: 'The client cards have not been read by the CSM sync yet, so there is nothing to match the form against.' };
  const { writes, skipped } = planWrites(grants, cards, deps.today());
  let due = writes;
  if (!mode.force) {
    let last: Record<string, number>;
    try {
      last = await deps.lastWritten(fieldId);
    } catch (e) {
      return { ...none, skipped, ok: false, note: `The last confirmed writes could not be read (${errText(e)}), so nothing was written.` };
    }
    due = writes.filter(w => last[w.taskId] !== w.weeks);
  }
  if (!mode.apply)
    return {
      ...none,
      skipped,
      ok: true,
      dryRun: true,
      planned: due.length,
      note: due.length
        ? `Dry run: ${due.length} ${due.length === 1 ? 'card' : 'cards'} would change on ClickUp. Set CEO_EXTENSIONS_APPLY to true to write them.`
        : 'Dry run: every card already says what the form says.',
    };
  const errors: string[] = [];
  const done: FieldWrite[] = [];
  for (const w of due) {
    try {
      await deps.write(w.taskId, fieldId, w.weeks);
    } catch (e) {
      errors.push(`${w.client}: ${errText(e)}`);
      continue;
    }
    try {
      await deps.record(w, fieldId, writeSentence(w));
      done.push(w);
    } catch (e) {
      // ClickUp has the value but the audit row is missing: stop before more unrecorded writes.
      errors.push(`${w.client}: written to ClickUp, but the audit row was not saved (${errText(e)}). The remaining cards were not written.`);
      break;
    }
  }
  const written = done.filter(w => w.weeks > 0).length;
  const cleared = done.length - written;
  const note = done.length
    ? `Written to the '${EXTENSION_FIELD_NAME}' field on each card the form has named: the live extension's weeks, or 0 once it has ended.`
    : writes.length
      ? due.length
        ? 'Nothing was written.'
        : 'Every card already says what the form says; nothing to write.'
      : 'No response on the Client Extension Form matches a client card, so there was nothing to write.';
  return { written, cleared, skipped, errors, note, ok: errors.length === 0 };
}
