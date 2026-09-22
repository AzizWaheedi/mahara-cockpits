import { v } from "convex/values";
import { internalAction } from "../_generated/server";

declare const process: { env: Record<string, string | undefined> };

/**
 * Read-only reconnaissance of the GoHighLevel sub-accounts that will hold the
 * hiring pipeline (Aziz, 2026-09-22). Nothing here writes, and no token is
 * ever returned: the agency token comes from the deployment and a location
 * token is passed in by hand from the CLI.
 *
 * GoHighLevel's public API is scoped per location, and a Private Integration
 * Token carries no hint of which location it belongs to, so the only honest
 * way to pair a token with a sub-account is to list the agency's locations and
 * try each one.
 */

// biome-ignore lint/suspicious/noExplicitAny: GoHighLevel payloads are untyped
type Any = any;

const BASE = "https://services.leadconnectorhq.com";

async function ghl(
  token: string,
  path: string,
  version = "2021-07-28",
): Promise<{ status: number; body: Any }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

/** Every sub-account the agency token can see: id and name only. */
export const locations = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const token = process.env.GHL_AGENCY_TOKEN ?? "";
    if (!token) return { error: "GHL_AGENCY_TOKEN is not set" };
    const out: { id: string; name: string }[] = [];
    for (let skip = 0; skip < 600; skip += 100) {
      const r = await ghl(token, `/locations/search?limit=100&skip=${skip}`);
      if (r.status !== 200)
        return { error: `locations/search ${r.status}`, body: r.body, out };
      const rows: Any[] = r.body?.locations ?? [];
      out.push(
        ...rows.map(l => ({ id: String(l.id), name: String(l.name ?? "") })),
      );
      if (rows.length < 100) break;
    }
    return { count: out.length, locations: out };
  },
});

/** Which of these locations does this token open? One is the answer. */
export const whichLocation = internalAction({
  args: { token: v.string(), ids: v.array(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { token, ids }) => {
    const hits: { id: string; pipelines: number }[] = [];
    for (const id of ids) {
      const r = await ghl(token, `/opportunities/pipelines?locationId=${id}`);
      if (r.status === 200)
        hits.push({ id, pipelines: (r.body?.pipelines ?? []).length });
    }
    return { tried: ids.length, hits };
  },
});

/**
 * Everything a hiring build needs to know about one sub-account: its
 * pipelines and their stages, its contact custom fields, its custom values,
 * its workflows and its calendars. Names and ids only; no contact data.
 */
export const survey = internalAction({
  args: { token: v.string(), locationId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { token, locationId }) => {
    const out: Any = { locationId };
    const pipelines = await ghl(
      token,
      `/opportunities/pipelines?locationId=${locationId}`,
    );
    out.pipelines =
      pipelines.status === 200
        ? (pipelines.body?.pipelines ?? []).map((p: Any) => ({
            id: String(p.id),
            name: String(p.name ?? ""),
            stages: (p.stages ?? []).map((s: Any) => String(s.name ?? "")),
          }))
        : { status: pipelines.status, body: pipelines.body };

    const fields = await ghl(
      token,
      `/locations/${locationId}/customFields?model=contact`,
    );
    out.customFields =
      fields.status === 200
        ? (fields.body?.customFields ?? []).map((f: Any) => ({
            id: String(f.id),
            name: String(f.name ?? ""),
            key: String(f.fieldKey ?? ""),
            type: String(f.dataType ?? ""),
          }))
        : { status: fields.status, body: fields.body };

    const values = await ghl(token, `/locations/${locationId}/customValues`);
    out.customValues =
      values.status === 200
        ? (values.body?.customValues ?? []).map((c: Any) => ({
            id: String(c.id),
            name: String(c.name ?? ""),
            key: String(c.fieldKey ?? ""),
          }))
        : { status: values.status, body: values.body };

    const flows = await ghl(token, `/workflows/?locationId=${locationId}`);
    out.workflows =
      flows.status === 200
        ? (flows.body?.workflows ?? []).map((w: Any) => ({
            id: String(w.id),
            name: String(w.name ?? ""),
            status: String(w.status ?? ""),
          }))
        : { status: flows.status, body: flows.body };

    const cals = await ghl(
      token,
      `/calendars/?locationId=${locationId}`,
      "2021-04-15",
    );
    out.calendars =
      cals.status === 200
        ? (cals.body?.calendars ?? []).map((c: Any) => ({
            id: String(c.id),
            name: String(c.name ?? ""),
          }))
        : { status: cals.status, body: cals.body };

    const tags = await ghl(token, `/locations/${locationId}/tags`);
    out.tags =
      tags.status === 200
        ? (tags.body?.tags ?? []).map((t: Any) => String(t.name ?? ""))
        : { status: tags.status, body: tags.body };
    return out;
  },
});

/**
 * One arbitrary call, for working out what the API will allow before a
 * builder is written. CLI only (internalAction), read or write, and the
 * answer is trimmed so a probe never dumps candidate data into a terminal.
 */
export const call = internalAction({
  args: {
    token: v.string(),
    method: v.optional(v.string()),
    path: v.string(),
    body: v.optional(v.any()),
    version: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (_ctx, { token, method, path, body, version }) => {
    const res = await fetch(`${BASE}${path}`, {
      method: method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: version ?? "2021-07-28",
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: text.slice(0, 600) };
    }
  },
});
