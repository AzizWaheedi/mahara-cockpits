import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payloads
type Any = any;
declare const process: { env: Record<string, string | undefined> };

/**
 * Do's & Don'ts belong to the client, not to one campaign. The field lives on
 * the client card (Clients - Mahara) and every cockpit reads it from there:
 * the media buyer above the client's campaigns, the creative director on the
 * client page, client success on the client profile. It used to be filled on
 * Ads Management campaign cards; those notes were moved to the client cards on
 * 2026-09-14 (Aziz).
 *
 * One field, one id: ClickUp shows the same field on both lists, so deleting
 * it would delete it from the client cards too.
 */
export const DOS_DONTS_FIELD = "0f06a523-64f9-4f20-90a1-f76cb6f85318";

export async function clickupCall(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Any> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new Error("CLICKUP_API_TOKEN is not set");
  const res = await fetch(`https://api.clickup.com/api/v2/${path}`, {
    method,
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `ClickUp ${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function valueOn(taskId: string): Promise<string> {
  const t = await clickupCall("GET", `task/${taskId}`);
  const cf = (t.custom_fields ?? []).find((f: Any) => f.id === DOS_DONTS_FIELD);
  return typeof cf?.value === "string" ? cf.value : "";
}

/** The field's current text on each card. */
export const read = internalAction({
  args: { taskIds: v.array(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { taskIds }) => {
    const out: Record<string, string> = {};
    for (const id of taskIds) out[id] = await valueOn(id);
    return out;
  },
});

/**
 * Move a campaign card's note onto its client card. The text is added to what
 * the client card already says, read back, and only then cleared off the
 * campaign card. Running it twice changes nothing.
 */
export const moveToClient = internalAction({
  args: { cardId: v.string(), clientTaskId: v.string(), text: v.string() },
  returns: v.any(),
  handler: async (_ctx, { cardId, clientTaskId, text }) => {
    const add = text.trim();
    const before = await valueOn(clientTaskId);
    if (!before.includes(add))
      await clickupCall(
        "POST",
        `task/${clientTaskId}/field/${DOS_DONTS_FIELD}`,
        { value: [before.trim(), add].filter(Boolean).join("\n\n") },
      );
    const after = await valueOn(clientTaskId);
    if (!after.includes(add))
      throw new Error(
        `Client card ${clientTaskId} did not keep the text. Campaign card ${cardId} left untouched.`,
      );
    await clickupCall("DELETE", `task/${cardId}/field/${DOS_DONTS_FIELD}`);
    return {
      clientTaskId,
      clientValue: after,
      cardCleared: (await valueOn(cardId)) === "",
    };
  },
});

/**
 * Replace a client card's text, but only if it still says what the caller last
 * read, so an edit someone made in ClickUp in the meantime is never lost.
 */
export const setOnClient = internalAction({
  args: { clientTaskId: v.string(), expected: v.string(), value: v.string() },
  returns: v.any(),
  handler: async (_ctx, { clientTaskId, expected, value }) => {
    const now = await valueOn(clientTaskId);
    if (now.trim() !== expected.trim())
      return { ok: false, reason: "changed in ClickUp since it was read", now };
    await clickupCall("POST", `task/${clientTaskId}/field/${DOS_DONTS_FIELD}`, {
      value: value.trim(),
    });
    const after = await valueOn(clientTaskId);
    return { ok: after.trim() === value.trim(), after };
  },
});

/** Where the field is defined: list, folder, space or workspace level. */
export const fieldHome = internalAction({
  args: { listId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { listId }) => {
    const has = (r: Any) =>
      (r?.fields ?? []).some((f: Any) => f.id === DOS_DONTS_FIELD);
    const list = await clickupCall("GET", `list/${listId}`);
    const out: Record<string, unknown> = {
      list: list?.name,
      folder: list?.folder?.name,
      space: list?.space?.name,
    };
    if (list?.folder?.id && !list.folder.hidden)
      out.definedOnFolder = has(
        await clickupCall("GET", `folder/${list.folder.id}/field`),
      );
    if (list?.space?.id)
      out.definedOnSpace = has(
        await clickupCall("GET", `space/${list.space.id}/field`),
      );
    const teams = await clickupCall("GET", "team");
    for (const t of teams?.teams ?? [])
      out[`definedOnWorkspace ${t.name}`] = has(
        await clickupCall("GET", `team/${t.id}/field`),
      );
    return out;
  },
});

// --- Clean format ---------------------------------------------------------------

/** Starts like a prohibition, so it is a DON'T wherever it was typed. */
const NEGATIVE = /^(don'?t|do not|never|avoid|no|not|stop|without)\b/i;
const TICK_DO = /^(✅|✓|✔️?|☑️?)\s*/u;
const TICK_DONT = /^(❌|✕|✖️?|⛔|🚫)\s*/u;
/** Comments this module posts start with this, so the comment watch skips them. */
export const NOTES_MARK = "📌 Notes moved out of Do's & Don'ts";

/**
 * The one format every cockpit and Hermes read: a DO and a DON'T heading, one
 * "- " line per rule. Whatever someone types on the card folds into it:
 * bullets, numbers, ticks and crosses, "DO:" prefixes, lines with no heading.
 * A prohibition goes under DON'T wherever it was typed. A NOTES line that is
 * not a prohibition is not a rule (Aziz, 2026-09-14): it comes back in `notes`
 * so it can go to a comment on the task instead.
 */
export function cleanDosDonts(raw: string): { text: string; notes: string[] } {
  const out = {
    do: [] as string[],
    dont: [] as string[],
    notes: [] as string[],
  };
  let current: "do" | "dont" | "notes" | undefined;
  const add = (
    section: "do" | "dont" | "notes" | undefined,
    raw: string,
    tick?: "do" | "dont",
  ) => {
    let item = raw
      .replace(/\s+/g, " ")
      .replace(/\.\s+\(/g, " (")
      .trim();
    if (!item) return;
    if (/^[a-z][a-z\s]/.test(item))
      item = item[0].toUpperCase() + item.slice(1);
    item = item.replace(/^dont\b/i, "Don't");
    const target: "do" | "dont" | "notes" = NEGATIVE.test(item)
      ? "dont"
      : (tick ?? section ?? "do");
    const key = item.toLowerCase();
    if (!out[target].some(x => x.toLowerCase() === key)) out[target].push(item);
  };
  for (const rawLine of String(raw ?? "")
    .replace(/\r/g, "")
    .split("\n")) {
    let line = rawLine
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/^[#>\s]+/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
    const bulleted = /^(?:[-•*–—]|\d+[.)])\s+/.test(line);
    line = line
      .replace(/^(?:[-•*–—]|\d+[.)])\s+/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
    let tick: "do" | "dont" | undefined;
    if (TICK_DO.test(line)) tick = "do";
    else if (TICK_DONT.test(line)) tick = "dont";
    line = line.replace(TICK_DO, "").replace(TICK_DONT, "").trim();
    if (!line || /^do'?s\s*(&|and)\s*don'?ts:?$/i.test(line)) continue;
    const head = bulleted
      ? null
      : /^(do'?s|do|don'?ts|don'?t|notes?)\s*(?::\s*(.*))?$/i.exec(line);
    if (head) {
      const h = head[1].toLowerCase();
      current = h.startsWith("don")
        ? "dont"
        : h.startsWith("note")
          ? "notes"
          : "do";
      if (head[2]?.trim()) add(current, head[2]);
      continue;
    }
    add(current, line, tick);
  }
  const block = (title: string, items: string[]) =>
    items.length ? `${title}\n${items.map(i => `- ${i}`).join("\n")}` : "";
  return {
    text: [block("DO", out.do), block("DON'T", out.dont)]
      .filter(Boolean)
      .join("\n\n"),
    notes: out.notes,
  };
}

export async function commentsOn(taskId: string): Promise<Any[]> {
  const r = await clickupCall("GET", `task/${taskId}/comment`);
  return r?.comments ?? [];
}

/**
 * Put one card into the clean format. Notes go to a task comment first (never
 * twice), then the field is rewritten only if nobody edited it meanwhile.
 */
async function tidy(taskId: string): Promise<Record<string, unknown>> {
  const before = await valueOn(taskId);
  const { text, notes } = cleanDosDonts(before);
  if (text === before.trim() && !notes.length)
    return { taskId, changed: false };
  if (notes.length) {
    const body = `${NOTES_MARK}:\n${notes.map(n => `- ${n}`).join("\n")}`;
    const posted = (await commentsOn(taskId)).some(c =>
      notes.every(n => String(c.comment_text ?? "").includes(n)),
    );
    if (!posted)
      await clickupCall("POST", `task/${taskId}/comment`, {
        comment_text: body,
        notify_all: false,
      });
  }
  if ((await valueOn(taskId)).trim() !== before.trim())
    return { taskId, changed: false, reason: "edited in ClickUp meanwhile" };
  if (text)
    await clickupCall("POST", `task/${taskId}/field/${DOS_DONTS_FIELD}`, {
      value: text,
    });
  else await clickupCall("DELETE", `task/${taskId}/field/${DOS_DONTS_FIELD}`);
  return { taskId, changed: true, notesMoved: notes.length, empty: !text };
}

export const tidyClient = internalAction({
  args: { taskId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { taskId }) => await tidy(taskId),
});

/** Every client card with the field filled, put into the clean format. */
export const tidyAll = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const results: Array<Record<string, unknown>> = [];
    for (let page = 0; page < 10; page++) {
      const r = await clickupCall(
        "GET",
        `list/901816559981/task?include_closed=true&page=${page}`,
      );
      const tasks: Any[] = r?.tasks ?? [];
      for (const t of tasks) {
        const cf = (t.custom_fields ?? []).find(
          (f: Any) => f.id === DOS_DONTS_FIELD,
        );
        const val = typeof cf?.value === "string" ? cf.value : "";
        if (!val.trim()) continue;
        const c = cleanDosDonts(val);
        if (c.text === val.trim() && !c.notes.length) continue;
        results.push({ name: t.name, ...(await tidy(t.id)) });
      }
      if (tasks.length < 100) break;
    }
    return results;
  },
});
