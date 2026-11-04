import {
  type DueRead,
  type ItemsRead,
  readDue,
  readItemRow,
  readItems,
} from "@/lib/kickoffItems";
import type { KickoffItemsApi, RaiseAnswer } from "@/lib/kickoffItemsClient";
import { RequestError } from "@/lib/requestsClient";

/**
 * Kickoff items in the server's own shapes (WAVE56-CONTRACT.md 4.20), for
 * the tests and the harness: invented clients on the test card, never a real
 * one. The fake api keeps one card's rows and answers each press the way the
 * five RPCs do, read back through the same parsers the screens use.
 */

export const ITEMS_TASK = "86eywg1cq";
export const ITEMS_CLIENT = "Cedar Interiors";

type Raw = Record<string, unknown>;

/** An open funded-card item as cockpit_kickoff_items_read gives it. */
export function rawItem(over: Raw = {}): Raw {
  return {
    item: "funded_card",
    short: "Funded card",
    line: "The card with funds is not linked to the ad account.",
    value: "No",
    typeKey: "card_missing",
    typeLabel: "Card missing for ads",
    typeEnabled: true,
    oneTap: true,
    details: null,
    priority: "high",
    state: "open",
    offered: true,
    stillOpen: true,
    blocked: null,
    actions: { raise: true, decline: true, link: true },
    route: {
      teamLabel: "Client Success",
      ownerLabel: "the CSM",
      ownerNote: null,
      dueDefault: "2026-11-04",
      dueWords: "Wed 4 Nov",
      priority: "high",
      writer: { canSend: true, held: false, note: null },
    },
    decision: null,
    request: null,
    existing: null,
    ...over,
  };
}

/** The Mahara OS item, open, a normal-priority tech request with a details question. */
export function rawMaharaOs(over: Raw = {}): Raw {
  return rawItem({
    item: "mahara_os",
    short: "Mahara OS access",
    line: "Mahara OS access: Tech Issue.",
    value: "Tech Issue",
    typeKey: "general_tech",
    typeLabel: "General tech request",
    priority: "normal",
    details:
      "Raised from the kickoff on Tue 3 Nov: Mahara OS access is Tech Issue. Get the client logged in to Mahara OS, then tell their CSM.",
    route: {
      teamLabel: "Operations / Tech",
      ownerLabel: "the systems manager",
      ownerNote: null,
      dueDefault: "2026-11-05",
      dueWords: "Thu 5 Nov",
      priority: "normal",
      writer: { canSend: true, held: false, note: null },
    },
    ...over,
  });
}

/** An item as it reads once raised: delivered to ClickUp. */
export function raised(row: Raw, over: Raw = {}): Raw {
  return {
    ...row,
    state: "raised",
    offered: false,
    actions: { raise: false, decline: false, link: false },
    route: null,
    decision: {
      answer: "raised",
      how: "one_tap",
      typeKey: row.typeKey,
      byLabel: "the CSM",
      at: "2026-11-03T07:42:00Z",
      note: null,
      mine: true,
      kickoffRef: "resp-k1",
    },
    request: {
      id: "5c0f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e20",
      state: "delivered",
      done: false,
      typeKey: row.typeKey,
      typeLabel: row.typeLabel,
      dueOn: (row.route as Raw | null)?.dueDefault ?? "2026-11-04",
      priority: row.priority,
      held: false,
      heldNote: null,
      url: "https://app.clickup.com/t/86fxkick1",
      partState: "delivered",
      mayOpen: true,
    },
    ...over,
  };
}

/** An item as it reads once declined. */
export function declined(row: Raw, over: Raw = {}): Raw {
  return {
    ...row,
    state: "declined",
    offered: false,
    actions: { raise: true, decline: false, link: true },
    decision: {
      answer: "declined",
      how: null,
      typeKey: null,
      byLabel: "the CSM",
      at: "2026-11-03T07:45:00Z",
      note: null,
      mine: true,
      kickoffRef: "resp-k1",
    },
    ...over,
  };
}

export function rawRead(items: Raw[], over: Raw = {}): Raw {
  return {
    asOf: "2026-11-03T08:00:00Z",
    taskId: ITEMS_TASK,
    kickoff: {
      at: "2026-11-03T07:30:00Z",
      day: "Tue 3 Nov",
      formId: "native",
      ref: "resp-k1",
      source: "native",
      answered: true,
      inOnboarding: true,
    },
    inWindow: true,
    reason: null,
    note: null,
    items,
    ...over,
  };
}

export type ItemsCall = { name: string; args: unknown[] };

/**
 * A stand-in for the five RPCs over one or more cards' rows. `missing`
 * answers every call as PostgREST does when the functions are not applied.
 * `raiseAnswer` and `failRaise` let a test bend one press.
 */
export function fakeItemsApi(
  cards: Record<string, Raw>,
  opts: {
    missing?: boolean;
    due?: Raw;
    raiseAnswer?: (taskId: string, item: string) => Raw | null;
    failRaise?: string | null;
  } = {},
): { api: KickoffItemsApi; calls: ItemsCall[]; cards: Record<string, Raw> } {
  const calls: ItemsCall[] = [];
  const missing = () => {
    throw new RequestError(
      "Requests cannot be read: the database does not have them yet. Tell the systems manager.",
      "PGRST202",
    );
  };
  const rowsOf = (taskId: string) =>
    ((cards[taskId]?.items as Raw[] | undefined) ?? []) as Raw[];
  const replace = (taskId: string, row: Raw) => {
    const card = cards[taskId] ?? rawRead([]);
    card.items = rowsOf(taskId).map(r => (r.item === row.item ? row : r));
    cards[taskId] = card;
    return row;
  };
  const find = (taskId: string, item: string) =>
    rowsOf(taskId).find(r => r.item === item) ?? rawItem({ item });
  const api: KickoffItemsApi = {
    read: async (taskId): Promise<ItemsRead> => {
      calls.push({ name: "read", args: [taskId] });
      if (opts.missing) missing();
      return readItems(cards[taskId] ?? rawRead([]), taskId);
    },
    raise: async (taskId, item, requestId): Promise<RaiseAnswer> => {
      calls.push({ name: "raise", args: [taskId, item, requestId] });
      if (opts.missing) missing();
      if (opts.failRaise) throw new RequestError(opts.failRaise, "55000");
      const bent = opts.raiseAnswer?.(taskId, item);
      const row = replace(taskId, bent ?? raised(find(taskId, item)));
      return {
        raised: row.state === "raised",
        reused: false,
        alreadyOpen: row.state === "already_open",
        item: readItemRow(row),
        submit: { id: "5c0f6a0e", state: "queued", held: false, note: null },
      };
    },
    link: async (taskId, item, requestId) => {
      calls.push({ name: "link", args: [taskId, item, requestId] });
      if (opts.missing) missing();
      const base = find(taskId, item);
      const row = replace(
        taskId,
        raised(base, {
          decision: {
            ...((raised(base).decision as Raw) ?? {}),
            how: "linked",
          },
        }),
      );
      return { linked: true, item: readItemRow(row) };
    },
    decline: async (taskId, item, note) => {
      calls.push({ name: "decline", args: [taskId, item, note ?? null] });
      if (opts.missing) missing();
      const row = replace(taskId, declined(find(taskId, item)));
      return { declined: true, item: readItemRow(row) };
    },
    due: async (): Promise<DueRead> => {
      calls.push({ name: "due", args: [] });
      if (opts.missing) missing();
      return readDue(opts.due ?? { asOf: null, rows: [], more: false });
    },
  };
  return { api, calls, cards };
}
