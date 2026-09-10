import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Mahara's client-facing GHL sub-account. Every client call the CSM owns (welcome,
 * onboarding, brand blueprint, launch, check-in, exit) is booked on a calendar here, so
 * this is the only honest answer to "what do I have today" and "when is our next call".
 *
 * The Space tool gateway cannot reach GHL and the sandbox is blocked by Cloudflare, but a
 * plain fetch from a Convex action works, so all GHL reads live here.
 */
const LOCATION = "wwG426bwruWWv9W3fazQ";
const BASE = "https://services.leadconnectorhq.com";

async function ghl(token: string, path: string, version = "2021-04-15") {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: version,
      Accept: "application/json",
    },
  });
  if (!res.ok)
    throw new Error(`GHL ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

export const calendars = internalAction({
  args: { token: v.string() },
  returns: v.array(v.object({ id: v.string(), name: v.string() })),
  handler: async (_ctx, args) => {
    const d = await ghl(args.token, `/calendars/?locationId=${LOCATION}`);
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    return ((d?.calendars ?? []) as any[]).map(c => ({
      id: String(c.id),
      name: String(c.name ?? ""),
    }));
  },
});

/** Appointments across every calendar in a window, flattened and trimmed to what we show. */
export const events = internalAction({
  args: { token: v.string(), fromMs: v.number(), toMs: v.number() },
  // biome-ignore lint/suspicious/noExplicitAny: trimmed rows
  returns: v.array(v.any()),
  handler: async (_ctx, args) => {
    const cals = await ghl(args.token, `/calendars/?locationId=${LOCATION}`);
    // biome-ignore lint/suspicious/noExplicitAny: GHL payload
    const list = (cals?.calendars ?? []) as any[];
    // biome-ignore lint/suspicious/noExplicitAny: trimmed rows
    const out: any[] = [];
    for (const cal of list) {
      let d: { events?: unknown[] };
      try {
        d = await ghl(
          args.token,
          `/calendars/events?locationId=${LOCATION}&calendarId=${cal.id}` +
            `&startTime=${args.fromMs}&endTime=${args.toMs}`,
        );
      } catch {
        // One broken calendar must not cost us the whole day's schedule.
        continue;
      }
      // biome-ignore lint/suspicious/noExplicitAny: GHL payload
      for (const e of (d?.events ?? []) as any[]) {
        out.push({
          id: String(e.id),
          calendar: String(cal.name ?? ""),
          calendarId: String(cal.id),
          title: String(e.title ?? ""),
          startTime: e.startTime ?? null,
          endTime: e.endTime ?? null,
          status: String(e.appointmentStatus ?? e.status ?? ""),
          contactId: e.contactId ?? null,
          assignedUserId: e.assignedUserId ?? null,
          address: e.address ?? null,
        });
      }
    }
    return out;
  },
});

/** Contact names for the appointments we found, so a row reads as a client not an id. */
export const contacts = internalAction({
  args: { token: v.string(), ids: v.array(v.string()) },
  // biome-ignore lint/suspicious/noExplicitAny: trimmed rows
  returns: v.array(v.any()),
  handler: async (_ctx, args) => {
    // biome-ignore lint/suspicious/noExplicitAny: trimmed rows
    const out: any[] = [];
    for (const id of args.ids) {
      try {
        // Contacts only answer on the newer API version, calendars only on the older one.
        const d = await ghl(args.token, `/contacts/${id}`, "2021-07-28");
        const c = d?.contact ?? {};
        out.push({
          id,
          name: String(
            c.contactName ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`,
          ).trim(),
          email: c.email ?? null,
          phone: c.phone ?? null,
          companyName: c.companyName ?? null,
        });
      } catch {}
    }
    return out;
  },
});
