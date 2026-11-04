/**
 * The current client extension, as the CEO endpoints see it after waves 1
 * and 2 (docs/forms/WAVE12-CONTRACT.md 4.11.3).
 *
 * - A grant is an `extension` billing event: "Give more time" on the client
 *   page or Extend on the billing sheet, one write. The one record is the view
 *   cockpit_extensions_v (billing events only; the Client Extension Form's two
 *   responses of 14 Sep were tests, never grants). The typed-name match to a
 *   card is gone: every grant carries its card id.
 * - The ClickUp field 'Current extension (weeks)' (8cb9d308) has one writer,
 *   the billing queue (clickup-writeback, kind `billing`), which writes it with
 *   the grant and clears it the day after the grant ends. The old pass that
 *   wrote it from the form ("Write current extensions to ClickUp" and the
 *   hourly mahara-ceo-extensions-auto) is retired: applyExtensions now writes
 *   nothing and says so, whoever calls it. Its signature and ExtensionDeps stay
 *   so endpoints.ts and ceo-extensions-sync keep compiling until they drop the
 *   call; the cron is unscheduled at C1 (section 9, D-C1.5).
 */

type Row = Record<string, unknown>;

export const EXT_FORM = 'gqBcyK6g';
export const EXT_PAGE = 200;
/** Kept for endpoints.ts's wiring; nothing in this module reads the form any more. */
export const EXT_PATH = `forms/${EXT_FORM}/responses?page_size=${EXT_PAGE}`;
export const CLIENTS_LIST = '901816559981';
export const EXTENSION_FIELD_NAME = 'Current extension (weeks)';
export const EXTENSION_FIELD_ENV = 'CLICKUP_EXTENSION_FIELD';
export const FIELD_ASK = `Create a Number field '${EXTENSION_FIELD_NAME}' on the Clients - Mahara list (${CLIENTS_LIST}); the cockpit finds it by name at the next sync`;
export const AUTO_ACTOR = 'the cockpit, after the extension form sync';
/** What the retired write says, word for word (WAVE12-CONTRACT 4.11.3). */
export const RETIRED = 'Retired: the billing sheet writes the extension field.';

const KUWAIT_OFFSET_MS = 3 * 3_600_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const kuwaitDay = (at: number = Date.now()): string =>
  new Date(at + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
export const fold = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** One grant of cockpit_extensions_v, as the screens and the CEO refresh read it. */
export type ExtensionGrant = {
  grantId: number;
  taskId: string;
  client: string;
  grantedOn: string;
  weeks: number;
  from: string | null;
  until: string;
  state: 'live' | 'ended' | 'replaced';
  /** The seat that gave it, in words ('the CSM', 'finance', 'the CEO', 'the billing agent': cockpit_extensions_v reads the words the acts store, or the source's words when a grant has none); a code ('csm', 'ceo') only on an event cockpit_billing_detail built. */
  seatRole: string | null;
};
export type Card = { taskId: string; name: string; stage?: string | null };
export type FieldWrite = { taskId: string; client: string; weeks: number; until: string; grantedDay: string };
export type ApplyResult = {
  written: number;
  cleared: number;
  skipped: number;
  errors: string[];
  note: string;
  /** False when a read failed. */
  ok: boolean;
  dryRun?: boolean;
  planned?: number;
  /** Always true now: the pass writes nothing (4.11.3). */
  retired?: boolean;
  /** Grants running today in cockpit_extensions_v, when the caller could read the view; null when not read. */
  live?: number | null;
};

const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const STATES = new Set(['live', 'ended', 'replaced']);

/**
 * cockpit_extensions_v rows to grants. A row without its card, its end day, a
 * week count of 1, 2 or 4 or a known state is refused, so a broken view never
 * reads as "no extension".
 */
export function grantsFromView(rows: unknown[]): ExtensionGrant[] {
  return rows.map((raw): ExtensionGrant => {
    if (!isRow(raw)) throw Error('an extension grant row is not an object');
    const taskId = String(raw.clickup_task_id ?? '').trim();
    const until = String(raw.until ?? '').slice(0, 10);
    const grantedOn = String(raw.granted_on ?? '').slice(0, 10);
    const weeks = Number(raw.weeks);
    const state = String(raw.state ?? '');
    const grantId = Number(raw.grant_id);
    if (!taskId || !ISO_DAY.test(until) || !ISO_DAY.test(grantedOn) || ![1, 2, 4].includes(weeks) || !STATES.has(state) || !Number.isFinite(grantId))
      throw Error('an extension grant lacks its card, its days, its weeks or its state');
    const from = String(raw.from_date ?? '').slice(0, 10);
    return {
      grantId,
      taskId,
      client: String(raw.client_name ?? '').trim() || taskId,
      grantedOn,
      weeks,
      from: ISO_DAY.test(from) ? from : null,
      until,
      state: state as ExtensionGrant['state'],
      seatRole: typeof raw.seat_role === 'string' && raw.seat_role ? raw.seat_role : null,
    };
  }).sort((a, b) => a.grantedOn.localeCompare(b.grantedOn) || a.grantId - b.grantId);
}

const shortDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''}`.trim();

/** The sentence for one grant: "Liwan Limited: 2 weeks, given 19 Oct, runs to 2 Nov." */
export function grantSentence(g: ExtensionGrant, today: string): string {
  const weeks = `${g.weeks} ${g.weeks === 1 ? 'week' : 'weeks'}`;
  const end = g.state === 'replaced' ? 'replaced by a longer one' : g.until >= today ? `runs to ${shortDay(g.until)}` : `ended ${shortDay(g.until)}`;
  return `${g.client}: ${weeks}, given ${shortDay(g.grantedOn)}, ${end}.`;
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

/**
 * The old pass's reads and writes. The retired pass calls none of the form,
 * field or write members; `liveGrants`, when the wiring gives it, is read to
 * say how many grants the billing sheet is keeping on the cards.
 */
export interface ExtensionDeps {
  fieldId(): Promise<string | null>;
  readForm(): Promise<unknown[]>;
  cards(): Promise<Card[]>;
  lastWritten(fieldId: string): Promise<Record<string, number>>;
  write(taskId: string, fieldId: string, weeks: number): Promise<void>;
  record(write: FieldWrite, fieldId: string, what: string): Promise<void>;
  today(): string;
  /** cockpit_extensions_v rows (select *), through the service key. */
  liveGrants?(): Promise<unknown[]>;
}

/**
 * Retired (WAVE12-CONTRACT 4.11.3): nothing is written to ClickUp, whatever
 * the mode. The billing queue is the one writer of the field. The result says
 * so, with the live grant count when the view could be read.
 */
export async function applyExtensions(deps: ExtensionDeps, _mode: { force: boolean; apply: boolean }): Promise<ApplyResult> {
  const none = { written: 0, cleared: 0, skipped: 0, errors: [] as string[], retired: true };
  if (!deps.liveGrants) return { ...none, ok: true, live: null, note: RETIRED };
  let grants: ExtensionGrant[];
  try {
    grants = grantsFromView(await deps.liveGrants());
  } catch (e) {
    return { ...none, ok: false, live: null, note: `${RETIRED} The grants could not be read from cockpit_extensions_v (${errText(e)}).` };
  }
  const live = grants.filter(g => g.state === 'live' && g.until >= deps.today());
  return {
    ...none,
    ok: true,
    live: live.length,
    note: live.length
      ? `${RETIRED} ${live.length} ${live.length === 1 ? 'grant runs' : 'grants run'} today: ${live.map(g => grantSentence(g, deps.today())).join(' ')}`
      : `${RETIRED} No grant runs today.`,
  };
}
