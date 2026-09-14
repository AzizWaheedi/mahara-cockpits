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

async function clickupCall(
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

async function valueOn(taskId: string): Promise<string> {
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
