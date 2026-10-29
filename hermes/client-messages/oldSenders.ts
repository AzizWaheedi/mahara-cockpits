/**
 * The old recap senders (docs/forms/STAGE2B-CONTRACT.md 4.3, 3b): the 1-1
 * Typeform's webhook to Make, Make's grader (scenario 9209179) and Make 07,
 * the recap sender (scenario 9523861). While any of them is on, or cannot be
 * read, the cockpit holds every recap: two senders would put two recaps in a
 * client's group. Read only when approved recaps exist (and by the doctor),
 * cached 10 minutes in ~/.client-messages/old-senders.json. Reads only:
 * every call is a GET through the ledger fetch.
 */
import { readFileSync, writeFileSync } from "node:fs";

export const CHECKIN_FORM = "fRokTITH";
export const SCENARIOS = ["9209179", "9523861"] as const;
export const CACHE_MS = 10 * 60_000;

export type Switch = "on" | "off" | "unread";
export type OldSenders = {
  at: string;
  typeform: Switch;
  scenarios: Record<string, Switch>;
  /** True while anything is on or unread: the recaps wait. */
  held: boolean;
  /** The plain sentence for the hold, or null. */
  sentence: string | null;
};

export type OldSendersDeps = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => Date;
  cachePath: string | null;
};

const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A bare Make zone, as the VPS's api-keys.env holds it ("eu2"). */
export const BARE_ZONE = /^[a-z]{2,4}\d{1,2}$/i;

/**
 * Make's zone as an https origin on make.com. MAKE_ZONE may be a bare zone
 * ("eu2", the VPS's shape, read 2026-10-29), a host ("eu2.make.com") or a full
 * origin; anything that is not a make.com host is null (unread, which holds).
 */
export function makeOrigin(zone: string | undefined): string | null {
  const z = String(zone ?? "").trim();
  if (!z) return null;
  if (BARE_ZONE.test(z)) return `https://${z.toLowerCase()}.make.com`;
  try {
    const u = new URL(/^https?:\/\//.test(z) ? z : `https://${z}`);
    if (
      u.protocol !== "https:" ||
      !(u.host === "make.com" || u.host.endsWith(".make.com"))
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}

async function getJson(
  deps: OldSendersDeps,
  url: string,
  headers: Record<string, string>,
): Promise<any> {
  const res = await deps.fetch(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** The sentence that holds the recaps, naming what is on or unread. */
export function holdSentence(
  s: Pick<OldSenders, "typeform" | "scenarios">,
): string | null {
  const on = SCENARIOS.filter(id => s.scenarios[id] === "on");
  if (on.length)
    return `Make's recap sender is still on (scenario ${on.join(" and ")}). The cockpit sends 1-1 recaps only after the switch-over.`;
  if (s.typeform === "on")
    return "The 1-1 Typeform still sends to Make. The cockpit sends 1-1 recaps only after the switch-over.";
  const unread = [
    ...(s.typeform === "unread" ? ["the 1-1 Typeform's webhooks"] : []),
    ...SCENARIOS.filter(id => s.scenarios[id] === "unread").map(
      id => `Make scenario ${id}`,
    ),
  ];
  if (unread.length)
    return `The cockpit could not read ${unread.join(" or ")}, so it holds the recaps. It reads them again within 10 minutes.`;
  return null;
}

/** Fresh reads of the three senders; a read that fails is unread, which holds like on. */
export async function readOldSenders(
  deps: OldSendersDeps,
): Promise<OldSenders> {
  let typeform: Switch = "unread";
  try {
    if (!deps.env.TYPEFORM_TOKEN) throw new Error("no token");
    const data = await getJson(
      deps,
      `https://api.typeform.com/forms/${CHECKIN_FORM}/webhooks`,
      {
        Authorization: `Bearer ${deps.env.TYPEFORM_TOKEN}`,
      },
    );
    const items: unknown[] = Array.isArray(data?.items) ? data.items : [];
    typeform = items.some(w => {
      if (!isObj(w) || w.enabled !== true || typeof w.url !== "string")
        return false;
      try {
        const host = new URL(w.url).host.toLowerCase();
        return host === "make.com" || host.endsWith(".make.com");
      } catch {
        return false;
      }
    })
      ? "on"
      : "off";
  } catch {
    typeform = "unread";
  }
  const scenarios: Record<string, Switch> = {};
  const origin = makeOrigin(deps.env.MAKE_ZONE);
  for (const id of SCENARIOS) {
    try {
      if (!origin || !deps.env.MAKE_API_KEY) throw new Error("no key");
      const data = await getJson(deps, `${origin}/api/v2/scenarios/${id}`, {
        Authorization: `Token ${deps.env.MAKE_API_KEY}`,
      });
      const active = data?.scenario?.isActive;
      scenarios[id] =
        active === true ? "on" : active === false ? "off" : "unread";
    } catch {
      scenarios[id] = "unread";
    }
  }
  const out = { at: deps.now().toISOString(), typeform, scenarios };
  const sentence = holdSentence(out);
  return { ...out, held: sentence !== null, sentence };
}

function readCache(path: string | null, now: Date): OldSenders | null {
  if (!path) return null;
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    if (!isObj(v) || typeof v.at !== "string" || !isObj(v.scenarios))
      return null;
    const age = now.getTime() - Date.parse(v.at);
    if (!Number.isFinite(age) || age < 0 || age >= CACHE_MS) return null;
    return v as OldSenders;
  } catch {
    return null;
  }
}

/** The senders, from a cache younger than 10 minutes, else read now and cached. */
export async function oldSenders(
  deps: OldSendersDeps,
  opts: { fresh?: boolean } = {},
): Promise<OldSenders & { cached: boolean }> {
  const cached = opts.fresh ? null : readCache(deps.cachePath, deps.now());
  if (cached) return { ...cached, cached: true };
  const fresh = await readOldSenders(deps);
  if (deps.cachePath) {
    try {
      writeFileSync(deps.cachePath, JSON.stringify(fresh), { mode: 0o600 });
    } catch {
      // An unwritable cache only means the next run reads again.
    }
  }
  return { ...fresh, cached: false };
}
