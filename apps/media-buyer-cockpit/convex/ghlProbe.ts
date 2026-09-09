import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Throwaway probe: does the location Private Integration Token work from Convex, and
 * which endpoints does it open? Kept small so it can be deleted once the calendar feed
 * is built properly.
 */
export const probe = internalAction({
  args: { token: v.string(), path: v.string(), version: v.optional(v.string()) },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const res = await fetch(`https://services.leadconnectorhq.com${args.path}`, {
      headers: {
        Authorization: `Bearer ${args.token}`,
        Version: args.version ?? "2021-07-28",
        Accept: "application/json",
      },
    });
    const body = await res.text();
    return `${res.status} ${body.slice(0, 900)}`;
  },
});

/** Which of the candidate locations does this token actually open? */
export const findLocation = internalAction({
  args: { token: v.string(), ids: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (_ctx, args) => {
    const hits: string[] = [];
    for (const id of args.ids) {
      const res = await fetch(
        `https://services.leadconnectorhq.com/calendars/?locationId=${id}`,
        {
          headers: {
            Authorization: `Bearer ${args.token}`,
            Version: "2021-04-15",
            Accept: "application/json",
          },
        },
      );
      if (res.status === 200) hits.push(`${id} ${(await res.text()).slice(0, 400)}`);
    }
    return hits;
  },
});
