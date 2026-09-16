// Local logic test for Save as winner. In-memory fake database only; nothing
// talks to any Convex deployment. Run from the media buyer app directory:
//   bun test <this file>
import { describe, expect, test } from "bun:test";

const APP = `${import.meta.dir}/../..`;
const { getFunctionName } = await import(
  Bun.resolveSync("convex/server", `${APP}/convex`)
);
const { ConvexError } = await import(
  Bun.resolveSync("convex/values", `${APP}/convex`)
);
const market = await import(`${APP}/convex/market.ts`);
const ws = await import(`${APP}/convex/winnerSaves.ts`);
const assist = await import(`${APP}/convex/assist.ts`);
const schema = (await import(`${APP}/convex/schema.ts`)).default;

// ---------- validator check on the JSON form ----------
function check(json: any, value: any, path: string): string[] {
  const t = json.type;
  const bad = (m: string) => [
    `${path}: ${m} (got ${JSON.stringify(value)?.slice(0, 80)})`,
  ];
  switch (t) {
    case "any":
      return value === undefined ? bad("undefined") : [];
    case "null":
      return value === null ? [] : bad("not null");
    case "number":
      return typeof value === "number" ? [] : bad("not number");
    case "string":
      return typeof value === "string" ? [] : bad("not string");
    case "boolean":
      return typeof value === "boolean" ? [] : bad("not boolean");
    case "literal":
      return value === json.value ? [] : bad(`not literal ${json.value}`);
    case "id":
      return typeof value === "string" ? [] : bad("not id");
    case "array":
      if (!Array.isArray(value)) return bad("not array");
      return value.flatMap((x, i) => check(json.value, x, `${path}[${i}]`));
    case "union": {
      for (const m of json.value)
        if (check(m, value, path).length === 0) return [];
      return bad("no union member matched");
    }
    case "record": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return bad("not record");
      return Object.entries(value).flatMap(([k, x]) =>
        check(json.values.fieldType, x, `${path}.${k}`),
      );
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return bad("not object");
      const out: string[] = [];
      for (const [k, f] of Object.entries<any>(json.value)) {
        if (value[k] === undefined) {
          if (!f.optional) out.push(`${path}.${k}: missing`);
          continue;
        }
        out.push(...check(f.fieldType, value[k], `${path}.${k}`));
      }
      for (const k of Object.keys(value)) {
        if (k.startsWith("_")) continue;
        if (!(k in json.value)) out.push(`${path}.${k}: not in validator`);
      }
      return out;
    }
    default:
      return [`${path}: unknown validator type ${t}`];
  }
}

function checkReturn(fn: any, value: any, name: string) {
  const json = JSON.parse(fn.exportReturns());
  if (json === null) return;
  const errs = check(json, value, name);
  expect(errs).toEqual([]);
}

// ---------- fake database ----------
let idSeq = 0;
let clock = 1_000_000;
class FakeDb {
  tables = new Map<string, any[]>();
  writes = 0;
  rows(t: string) {
    if (!this.tables.has(t)) this.tables.set(t, []);
    return this.tables.get(t)!;
  }
  seed(t: string, doc: any) {
    const row = { ...doc, _id: `${t}:${++idSeq}`, _creationTime: ++clock };
    this.rows(t).push(row);
    return row;
  }
  validate(t: string, doc: any) {
    const table = (schema as any).tables[t];
    if (!table) throw new Error(`no table ${t}`);
    const errs = check(table.validator.json, doc, t);
    if (errs.length) throw new Error(`schema: ${errs.join("; ")}`);
  }
  async insert(t: string, doc: any) {
    this.validate(t, doc);
    this.writes++;
    return this.seed(t, doc)._id;
  }
  async get(id: string) {
    const t = String(id).split(":")[0];
    return this.rows(t).find(r => r._id === id) ?? null;
  }
  async patch(id: string, fields: any) {
    const t = String(id).split(":")[0];
    const row = this.rows(t).find(r => r._id === id);
    if (!row) throw new Error("no row");
    const next = { ...row };
    for (const [k, x] of Object.entries(fields)) {
      if (x === undefined) delete next[k];
      else next[k] = x;
    }
    const { _id, _creationTime, ...rest } = next;
    this.validate(t, rest);
    for (const k of Object.keys(row)) delete row[k];
    Object.assign(row, next);
    this.writes++;
  }
  async replace(id: string, doc: any) {
    const t = String(id).split(":")[0];
    this.validate(t, doc);
    const row = this.rows(t).find(r => r._id === id);
    for (const k of Object.keys(row)) if (!k.startsWith("_")) delete row[k];
    Object.assign(row, doc);
    this.writes++;
  }
  async delete(id: string) {
    const t = String(id).split(":")[0];
    const list = this.rows(t);
    list.splice(
      list.findIndex(r => r._id === id),
      1,
    );
  }
  query(t: string) {
    const conds: ((r: any) => boolean)[] = [];
    let desc = false;
    const q: any = {
      eq(f: string, x: any) {
        conds.push(r => r[f] === x);
        return q;
      },
      gte(f: string, x: any) {
        conds.push(r => r[f] >= x);
        return q;
      },
      lte(f: string, x: any) {
        conds.push(r => r[f] <= x);
        return q;
      },
      gt(f: string, x: any) {
        conds.push(r => r[f] > x);
        return q;
      },
      lt(f: string, x: any) {
        conds.push(r => r[f] < x);
        return q;
      },
    };
    const results = () => {
      const list = this.rows(t).filter(r => conds.every(c => c(r)));
      return desc ? [...list].reverse() : [...list];
    };
    const b: any = {
      withIndex(_name: string, fn?: (q: any) => any) {
        if (fn) fn(q);
        return b;
      },
      order(o: string) {
        desc = o === "desc";
        return b;
      },
      filter() {
        throw new Error("filter not supported in fake");
      },
      async collect() {
        return results();
      },
      async first() {
        return results()[0] ?? null;
      },
      async take(n: number) {
        return results().slice(0, n);
      },
      async unique() {
        const r = results();
        if (r.length > 1) throw new Error("not unique");
        return r[0] ?? null;
      },
    };
    return b;
  }
}

function makeCtx(db: FakeDb, userId?: string) {
  const scheduled: any[] = [];
  return {
    db,
    scheduled,
    auth: {
      getUserIdentity: async () =>
        userId ? { subject: `${userId}|session`, tokenIdentifier: "x" } : null,
    },
    scheduler: {
      runAfter: async (ms: number, ref: any, args: any) => {
        scheduled.push({ ms, ref, args });
      },
    },
    storage: {},
  };
}

const refName = (ref: any) => getFunctionName(ref);

const CAMPAIGN = "Arc | Leads | KW";
const OTHER = "Other | Leads | KW";

function seedWorld() {
  idSeq = 0;
  const db = new FakeDb();
  const nada = db.seed("users", { email: "nada@maharamedia.com" });
  const csm = db.seed("users", { email: "abdu@maharamedia.com" });
  const restricted = db.seed("users", { email: "rita@maharamedia.com" });
  db.seed("members", {
    email: "nada@maharamedia.com",
    name: "Nada",
    roles: ["media_buyer"],
    clients: [],
    addedAt: 1,
  });
  db.seed("members", {
    email: "rita@maharamedia.com",
    name: "Rita",
    roles: ["media_buyer"],
    clients: ["Other Client"],
    addedAt: 1,
  });
  const base = {
    accountName: "Arc acct",
    onBoard: true,
    spend7d: 1,
    leads7d: 1,
    impressions7d: 1,
    linkClicks7d: 1,
    dayRate: 1,
    verdict: "ok",
    reason: "ok",
    syncedAt: 1,
  };
  db.seed("campaigns", {
    ...base,
    campaignName: CAMPAIGN,
    clientName: "Arcwani",
    clientTag: "arcwani",
    serviceType: "architecture",
    advertisingCities: ["Kuwait City"],
    metaAccountId: "act_111",
    rank: 1,
  });
  db.seed("campaigns", {
    ...base,
    campaignName: OTHER,
    clientName: "Other Client",
    rank: 2,
  });
  // Tree: ad set + three ads, two sharing a name.
  db.seed("metaTree", {
    campaignName: CAMPAIGN,
    kind: "adset",
    metaId: "90001",
    name: "Broad KW",
    status: "ACTIVE",
    syncedAt: 1,
  });
  const ad = (metaId: string, name: string, extra: any = {}) =>
    db.seed("metaTree", {
      campaignName: CAMPAIGN,
      kind: "ad",
      metaId,
      name,
      status: "ACTIVE",
      adsetId: "90001",
      accountId: "111",
      syncedAt: 1,
      ...extra,
    });
  ad("100001", "Video A", {
    creativeId: "c1",
    stillKey: "c:c1",
    stillUrl: "https://x.convex.cloud/api/storage/a",
    stillTinyUrl: "https://x.convex.cloud/api/storage/at",
  });
  ad("100002", "Twin");
  ad("100003", "Twin", { effectiveStatus: "PAUSED" });
  ad("100004", "No id rows");
  // Daily grain.
  const day = (
    date: string,
    adName: string,
    metaAdId: string | undefined,
    n: any,
  ) =>
    db.seed("dailyStats", {
      date,
      campaignName: CAMPAIGN,
      adSetName: "Broad KW",
      adName,
      ...(metaAdId ? { metaAdId } : {}),
      impressions: 0,
      linkClicks: 0,
      ...n,
    });
  day("2026-09-10", "Video A", "100001", {
    spend: 60.123,
    leads: 3,
    impressions: 800,
    linkClicks: 30,
    frequency: 1.2,
  });
  day("2026-09-11", "Video A", "100001", {
    spend: 40,
    leads: 2,
    impressions: 400,
    linkClicks: 25,
    frequency: 1.5,
  });
  day("2026-09-12", "Video A", "100001", {
    spend: 999,
    leads: 1,
    impressions: 1,
    linkClicks: 1,
  }); // out of range below
  day("2026-09-10", "Twin", "100002", { spend: 20, leads: 0 });
  day("2026-09-10", "Twin", "100003", { spend: 30, leads: 2 });
  day("2026-09-10", "No id rows", undefined, { spend: 12, leads: 4 });
  db.seed("bookingEvents", {
    campaignName: CAMPAIGN,
    date: "2026-09-10",
    status: "showed",
    adId: "100001",
    syncedAt: 1,
  });
  db.seed("bookingEvents", {
    campaignName: CAMPAIGN,
    date: "2026-09-11",
    status: "confirmed",
    adId: "100001",
    syncedAt: 1,
  });
  db.seed("bookingEvents", {
    campaignName: CAMPAIGN,
    date: "2026-09-11",
    status: "confirmed",
    syncedAt: 1,
  });
  // A collected play for the ad set.
  db.seed("marketPlays", {
    client: "Arcwani",
    accountId: "111",
    city: "Kuwait City",
    country: "Kuwait",
    serviceLine: "Architecture and engineering",
    adsetId: "90001",
    adsetName: "Broad KW",
    playType: "broad",
    interests: [],
    spend: 500,
    leads: 40,
    copyTraits: ["question hook"],
    language: "ar",
    creatives: [
      {
        adId: "100001",
        adName: "Video A",
        format: "video",
        headline: "Play headline",
        body: "Play body",
        cta: "Learn more",
        creativeId: "c1",
        stillKey: "c:c1",
        spend: 300,
        leads: 25,
        cpl: 12,
      },
      {
        adId: "100003",
        adName: "Twin",
        format: "image",
        spend: 50,
        leads: 1,
        cpl: 50,
      },
    ],
    windowDays: 90,
    syncedAt: 1,
  });
  return { db, nada: nada._id, csm: csm._id, restricted: restricted._id };
}

async function expectRefusal(p: Promise<any>, text: RegExp) {
  let err: any;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ConvexError);
  expect(String(err.data)).toMatch(text);
}

const saveArgs = (over: any = {}) => ({
  campaignName: CAMPAIGN,
  adId: "100001",
  adName: "Video A",
  start: "2026-09-10",
  end: "2026-09-11",
  rangeLabel: "Last 2 days",
  note: "  The first line names the price.  ",
  ...over,
});

describe("save", () => {
  test("inserts a manual row with the server's numbers and logs it", async () => {
    const { db, nada } = seedWorld();
    const ctx = makeCtx(db, nada);
    const res = await ws.save._handler(ctx, saveArgs());
    checkReturn(ws.save, res, "save");
    expect(res).toEqual({ ok: true, adId: "100001", created: true });
    const rows = db.rows("winnersArchive");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.origin).toBe("manual");
    expect(r.spend).toBe(100.12);
    expect(r.leads).toBe(5);
    expect(r.cpl).toBe(20.02);
    expect(r.savedBy).toBe("nada@maharamedia.com");
    expect(r.savedByName).toBe("Nada");
    expect(r.savedNote).toBe("The first line names the price.");
    expect(r.savedRange).toEqual({
      start: "2026-09-10",
      end: "2026-09-11",
      label: "Last 2 days",
    });
    // 1,200 impressions: rates are allowed; 55 link clicks: opt-in allowed.
    expect(r.savedStats).toMatchObject({
      spend: 100.12,
      leads: 5,
      cpl: 20.02,
      impressions: 1200,
      linkClicks: 55,
      linkCtr: 4.58,
      cpm: 83.44,
      optInRate: 9.09,
      frequency: 1.5,
      bookings: 2,
      showed: 1,
      costPerBooking: 50.06,
      bookingsAttributed: true,
    });
    expect(r).toMatchObject({
      client: "Arcwani",
      serviceLine: "Architecture and engineering",
      city: "Kuwait City",
      country: "Kuwait",
      format: "video",
      headline: "Play headline",
      campaignName: CAMPAIGN,
      creativeId: "c1",
      accountId: "111",
      stillKey: "c:c1",
      stillUrl: "https://x.convex.cloud/api/storage/a",
      stillLive: true,
      wonFrom: "2026-09-10",
      wonTo: "2026-09-11",
      adsetName: "Broad KW",
    });
    expect(r.previewSrc).toBeUndefined();
    const chat = db.rows("campaignChat");
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({
      campaignId: CAMPAIGN,
      author: "her",
      authorName: "Nada",
      kind: "action",
      status: "done",
      ok: true,
      pending: false,
      client: "arcwani",
    });
    expect(chat[0].text).toBe(
      "Saved Video A to What works (Last 2 days: $100.12 spent, 5 leads, $20.02 a lead). Why: The first line names the price.",
    );
    expect(db.rows("usage")[0]).toMatchObject({
      event: "winner.save",
      detail: "100001",
      role: "media_buyer",
      email: "nada@maharamedia.com",
    });
    expect(db.rows("manualChanges")).toHaveLength(0);
    // Copy and picture are present, so no enrich.
    expect(ctx.scheduled).toHaveLength(0);
  });

  test("a double click makes one row and one log line", async () => {
    const { db, nada } = seedWorld();
    const ctx = makeCtx(db, nada);
    await ws.save._handler(ctx, saveArgs());
    const again = await ws.save._handler(ctx, saveArgs());
    expect(again.created).toBe(false);
    expect(db.rows("winnersArchive")).toHaveLength(1);
    expect(db.rows("campaignChat")).toHaveLength(1);
  });

  test("marks an existing collector row without touching its numbers or origin", async () => {
    const { db, nada } = seedWorld();
    db.seed("winnersArchive", {
      adId: "100001",
      adName: "Video A (old name)",
      client: "Arcwani",
      format: "video",
      spend: 300,
      leads: 25,
      cpl: 12,
      firstArchivedAt: 1,
      lastSeenAt: 1,
      headline: "Kept headline",
      previewSrc: "https://www.facebook.com/ads/api/preview_iframe.php?x",
    });
    const ctx = makeCtx(db, nada);
    const res = await ws.save._handler(ctx, saveArgs({ note: "" }));
    expect(res.created).toBe(false);
    const rows = db.rows("winnersArchive");
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      spend: 300,
      leads: 25,
      cpl: 12,
      headline: "Kept headline",
      adName: "Video A (old name)",
    });
    expect(r.origin).toBeUndefined();
    expect(r.savedNote).toBeUndefined();
    expect(r.savedStats.spend).toBe(100.12);
    // Filled because missing.
    expect(r).toMatchObject({
      campaignName: CAMPAIGN,
      creativeId: "c1",
      accountId: "111",
      stillKey: "c:c1",
      body: "Play body",
      cta: "Learn more",
      adsetName: "Broad KW",
    });
    expect(db.rows("campaignChat")[0].text).not.toContain("Why:");
    expect(market.isSaved(r)).toBe(true);
    expect(market.isAuto(r)).toBe(true);
  });

  test("refuses bad input, other campaigns, zero leads, wrong role and wrong client", async () => {
    const { db, nada, csm, restricted } = seedWorld();
    const ctx = makeCtx(db, nada);
    await expectRefusal(
      ws.save._handler(ctx, saveArgs({ adId: "abc" })),
      /not a Meta ad id/,
    );
    await expectRefusal(
      ws.save._handler(
        ctx,
        saveArgs({ start: "2026-09-12", end: "2026-09-10" }),
      ),
      /ends before it starts/,
    );
    await expectRefusal(
      ws.save._handler(ctx, saveArgs({ start: "x" })),
      /Pick a date range/,
    );
    await expectRefusal(
      ws.save._handler(ctx, saveArgs({ campaignName: OTHER })),
      /not in this campaign/,
    );
    await expectRefusal(
      ws.save._handler(ctx, saveArgs({ adId: "100002", adName: "Twin" })),
      /had no leads between 2026-09-10 and 2026-09-11/,
    );
    await expectRefusal(
      ws.save._handler(makeCtx(db, csm), saveArgs()),
      /not yours/,
    );
    await expectRefusal(
      ws.save._handler(makeCtx(db, restricted), saveArgs()),
      /not on your list/,
    );
    expect(db.rows("winnersArchive")).toHaveLength(0);
    expect(db.rows("campaignChat")).toHaveLength(0);
  });

  test("an ad the tree knows by name but whose rows carry no id still saves, and gets enriched", async () => {
    const { db, nada } = seedWorld();
    const ctx = makeCtx(db, nada);
    const res = await ws.save._handler(
      ctx,
      saveArgs({ adId: "100004", adName: "No id rows", note: undefined }),
    );
    expect(res.created).toBe(true);
    const r = db.rows("winnersArchive")[0];
    expect(r).toMatchObject({
      spend: 12,
      leads: 4,
      cpl: 3,
      format: "unknown",
      client: "Arcwani",
    });
    expect(r.stillKey).toBe("a:100004");
    expect(ctx.scheduled).toHaveLength(1);
    expect(refName(ctx.scheduled[0].ref)).toBe("winnerSaves:enrich");
    expect(ctx.scheduled[0].args).toEqual({ adId: "100004" });
  });

  test("with no campaign card or play, labels fall back", async () => {
    const { db, nada } = seedWorld();
    // An ad in the grain only (not in the tree), in the other campaign.
    db.seed("dailyStats", {
      date: "2026-09-10",
      campaignName: OTHER,
      adName: "Solo",
      metaAdId: "200001",
      spend: 150,
      leads: 10,
      impressions: 5000,
      linkClicks: 10,
    });
    const ctx = makeCtx(db, nada);
    await ws.save._handler(
      ctx,
      saveArgs({ campaignName: OTHER, adId: "200001", adName: "Solo" }),
    );
    const r = db.rows("winnersArchive")[0];
    expect(r).toMatchObject({
      client: "Other Client",
      city: "Unknown",
      format: "unknown",
      cpl: 15,
    });
    expect(r.stillLive).toBeUndefined();
    expect(r.savedStats.optInRate).toBeUndefined();
    expect(r.savedStats.linkCtr).toBe(0.2);
    expect(r.savedStats.bookingsAttributed).toBe(false);
  });
});

describe("unsave, savedIn and saving again", () => {
  test("withdraws the save, keeps the row, and a new save wins again", async () => {
    const { db, nada } = seedWorld();
    const ctx = makeCtx(db, nada);
    await ws.save._handler(ctx, saveArgs());
    let s = await ws.savedIn._handler(ctx, {
      adIds: ["100001", "100002", "bad"],
    });
    checkReturn(ws.savedIn, s, "savedIn");
    expect(Object.keys(s)).toEqual(["100001"]);
    expect(s["100001"]).toMatchObject({
      saved: true,
      savedByName: "Nada",
      auto: false,
    });

    const u = await ws.unsave._handler(ctx, { adId: "100001" });
    checkReturn(ws.unsave, u, "unsave");
    expect(u).toEqual({ ok: true, changed: true });
    const r = db.rows("winnersArchive")[0];
    expect(r.unsavedBy).toBe("nada@maharamedia.com");
    expect(market.isSaved(r)).toBe(false);
    expect(db.rows("campaignChat").at(-1).text).toBe(
      "Removed Video A from the team's saved winners.",
    );
    expect(db.rows("usage").at(-1).event).toBe("winner.unsave");
    // Manual and withdrawn: gone from the buttons and from What works.
    s = await ws.savedIn._handler(ctx, { adIds: ["100001"] });
    expect(s).toEqual({});
    const list = await market.winners._handler(ctx, {});
    expect(list).toHaveLength(0);
    // Unsave again: nothing changes.
    expect(await ws.unsave._handler(ctx, { adId: "100001" })).toEqual({
      ok: true,
      changed: false,
    });
    expect(await ws.unsave._handler(ctx, { adId: "999999" })).toEqual({
      ok: true,
      changed: false,
    });

    clock++;
    const realNow = Date.now;
    Date.now = () => realNow() + 5_000;
    try {
      await ws.save._handler(ctx, saveArgs({ note: "Second look" }));
    } finally {
      Date.now = realNow;
    }
    const again = db.rows("winnersArchive");
    expect(again).toHaveLength(1);
    expect(market.isSaved(again[0])).toBe(true);
    expect(again[0].savedNote).toBe("Second look");
  });

  test("a restricted member cannot remove a save on another client", async () => {
    const { db, nada, restricted } = seedWorld();
    await ws.save._handler(makeCtx(db, nada), saveArgs());
    await expectRefusal(
      ws.unsave._handler(makeCtx(db, restricted), { adId: "100001" }),
      /not on your list/,
    );
    expect(market.isSaved(db.rows("winnersArchive")[0])).toBe(true);
  });
});

describe("preview", () => {
  test("lists the ads behind a shared name and folds only the picked one", async () => {
    const { db, nada } = seedWorld();
    const ctx = makeCtx(db, nada);
    const base = {
      campaignName: CAMPAIGN,
      adName: "Twin",
      adIds: ["100002", "100003"],
      start: "2026-09-10",
      end: "2026-09-11",
    };
    const p0 = await ws.preview._handler(ctx, base);
    checkReturn(ws.preview, p0, "preview");
    expect(p0.candidates.map((c: any) => [c.adId, c.live])).toEqual([
      ["100002", true],
      ["100003", false],
    ]);
    expect(p0.adId).toBeUndefined();
    expect(p0.stats).toBeUndefined();
    const p1 = await ws.preview._handler(ctx, { ...base, adId: "100003" });
    checkReturn(ws.preview, p1, "preview");
    expect(p1.stats).toMatchObject({ spend: 30, leads: 2, cpl: 15 });
    expect(p1.problem).toBeUndefined();
    const p2 = await ws.preview._handler(ctx, { ...base, adId: "100002" });
    expect(p2.problem).toMatch(/no leads/);
  });

  test("finds the ad by name when the row has no ids, and says when it cannot", async () => {
    const { db, nada } = seedWorld();
    const ctx = makeCtx(db, nada);
    const p = await ws.preview._handler(ctx, {
      campaignName: CAMPAIGN,
      adName: "No id rows",
      start: "2026-09-10",
      end: "2026-09-11",
    });
    checkReturn(ws.preview, p, "preview");
    expect(p.adId).toBe("100004");
    expect(p.stats).toMatchObject({ spend: 12, leads: 4 });
    const none = await ws.preview._handler(ctx, {
      campaignName: CAMPAIGN,
      adName: "Ghost",
      start: "2026-09-10",
      end: "2026-09-11",
    });
    checkReturn(ws.preview, none, "preview");
    expect(none.problem).toMatch(/do not have this ad's Meta id/);
    const single = await ws.preview._handler(ctx, {
      campaignName: CAMPAIGN,
      adName: "Video A",
      adIds: ["100001"],
      start: "2026-09-10",
      end: "2026-09-11",
    });
    expect(single.candidates[0]).toMatchObject({
      stillTinyUrl: "https://x.convex.cloud/api/storage/at",
      accountId: "111",
    });
    expect(single.stats.leads).toBe(5);
  });

  test("returns a refusal instead of throwing", async () => {
    const { db, restricted, csm } = seedWorld();
    const p = await ws.preview._handler(makeCtx(db, restricted), {
      campaignName: CAMPAIGN,
      adName: "Video A",
      adIds: ["100001"],
      start: "2026-09-10",
      end: "2026-09-11",
    });
    checkReturn(ws.preview, p, "preview");
    expect(p.refusal).toMatch(/not on your list/);
    const q = await ws.preview._handler(makeCtx(db, csm), {
      campaignName: CAMPAIGN,
      adName: "Video A",
      start: "2026-09-10",
      end: "2026-09-11",
    });
    expect(q.refusal).toMatch(/not yours/);
    const bad = await ws.preview._handler(makeCtx(db, restricted), {
      campaignName: OTHER,
      adName: "x",
      start: "bad",
      end: "2026-09-11",
    });
    expect(bad.refusal).toMatch(/Pick a date range/);
  });
});

describe("fill", () => {
  test("fills only what is missing", async () => {
    const { db } = seedWorld();
    db.seed("winnersArchive", {
      adId: "100004",
      adName: "x",
      client: "c",
      format: "unknown",
      headline: "Mine",
      spend: 1,
      leads: 1,
      cpl: 1,
      firstArchivedAt: 1,
      lastSeenAt: 1,
      origin: "manual",
      savedAt: 5,
    });
    const ctx = makeCtx(db);
    const out = await ws.fill._handler(ctx, {
      adId: "100004",
      details: {
        format: "image",
        headline: "Meta's",
        body: "Body",
        cta: "Sign up",
        creativeId: "c9",
        accountId: "111",
      },
    });
    checkReturn(ws.fill, out, "fill");
    expect(out).toEqual({
      needsStill: true,
      creativeId: "c9",
      accountId: "111",
    });
    const r = db.rows("winnersArchive")[0];
    expect(r).toMatchObject({
      format: "image",
      headline: "Mine",
      body: "Body",
      cta: "Sign up",
      stillKey: "c:c9",
    });
    await ws.fill._handler(ctx, {
      adId: "100004",
      still: { key: "c:c9", url: "https://s/1", tinyUrl: "https://s/2" },
    });
    expect(db.rows("winnersArchive")[0]).toMatchObject({
      stillUrl: "https://s/1",
      stillTinyUrl: "https://s/2",
    });
    await ws.fill._handler(ctx, {
      adId: "100004",
      still: { url: "https://s/other" },
    });
    expect(db.rows("winnersArchive")[0].stillUrl).toBe("https://s/1");
    expect(await ws.fill._handler(ctx, { adId: "555555" })).toBeNull();
  });
});

describe("archiveWinners", () => {
  function archiveWorld() {
    const w = seedWorld();
    const { db } = w;
    // A manual save that the rule now also picks (ad 100001: $12 at $300 spent).
    db.seed("winnersArchive", {
      adId: "100001",
      adName: "Saved label",
      client: "Saved client label",
      city: "Saved city",
      format: "unknown",
      headline: "Saved headline",
      spend: 100.12,
      leads: 5,
      cpl: 20.02,
      firstArchivedAt: 1,
      lastSeenAt: Date.now(),
      origin: "manual",
      savedBy: "nada@maharamedia.com",
      savedByName: "Nada",
      savedAt: 10,
      savedNote: "why",
      savedRange: { start: "2026-09-10", end: "2026-09-11" },
      savedStats: { spend: 100.12, leads: 5 },
      stillUrl: "https://kept/still",
      stillKey: "a:100001",
    });
    // An old auto row with a dead preview link, in a campaign Meta answered for, not in the tree any more.
    db.seed("winnersArchive", {
      adId: "100009",
      adName: "Gone ad",
      client: "Arcwani",
      format: "image",
      spend: 200,
      leads: 20,
      cpl: 10,
      firstArchivedAt: 1,
      lastSeenAt: 1,
      campaignName: CAMPAIGN,
      stillLive: true,
      previewSrc: "https://old",
      creativeId: "c9",
    });
    // An auto row whose campaign Meta did not answer for: keeps its state.
    db.seed("winnersArchive", {
      adId: "300001",
      adName: "Unread account",
      client: "Z",
      format: "image",
      spend: 200,
      leads: 20,
      cpl: 10,
      firstArchivedAt: 1,
      lastSeenAt: 1,
      campaignName: "Unread | KW",
      stillLive: true,
      creativeId: "c3",
    });
    // A withdrawn manual save never picked by the rule: hidden, no picture work.
    db.seed("winnersArchive", {
      adId: "300002",
      adName: "Withdrawn",
      client: "Z",
      format: "image",
      spend: 20,
      leads: 1,
      cpl: 20,
      firstArchivedAt: 1,
      lastSeenAt: 1,
      origin: "manual",
      savedAt: 5,
      unsavedAt: 6,
    });
    // A still already saved for c9, and one marked gone for c3.
    db.seed("adStills", {
      key: "c:c9",
      status: "saved",
      url: "https://s/c9",
      tinyUrl: "https://s/c9t",
      attempts: 0,
      lastTriedAt: 1,
      savedAt: 2,
    });
    db.seed("adStills", {
      key: "c:c3",
      status: "gone",
      attempts: 1,
      lastTriedAt: 1,
    });
    // A play for a new winner in another ad set, with no tree node at all.
    db.seed("marketPlays", {
      client: "New Co",
      accountId: "act_222",
      adsetId: "90002",
      adsetName: "Set 2",
      playType: "interests",
      interests: ["Homes"],
      spend: 400,
      leads: 40,
      creatives: [
        {
          adId: "400001",
          adName: "Fresh winner",
          format: "image",
          creativeId: "c4",
          thumbUrl: "https://scontent.fbcdn.net/x.jpg?oe=00000001",
          previewSrc: "https://old-preview",
          spend: 400,
          leads: 40,
          cpl: 10,
        },
      ],
      windowDays: 90,
      syncedAt: 1,
    });
    return w;
  }

  test("never touches a save, fills and refreshes the rest, and retires carefully", async () => {
    const { db } = archiveWorld();
    const ctx = makeCtx(db);
    const res = await market.archiveWinners._handler(ctx, {});
    checkReturn(market.archiveWinners, res, "archiveWinners");
    const rows = db.rows("winnersArchive");
    const by = (id: string) => rows.filter(r => r.adId === id);
    expect(by("100001")).toHaveLength(1);
    const saved = by("100001")[0];
    expect(saved).toMatchObject({
      origin: "manual",
      savedBy: "nada@maharamedia.com",
      savedNote: "why",
      savedStats: { spend: 100.12, leads: 5 },
      adName: "Saved label",
      client: "Saved client label",
      city: "Saved city",
      headline: "Saved headline",
      body: "Play body",
      format: "video",
      spend: 300,
      leads: 25,
      cpl: 12,
      stillLive: true,
      campaignName: CAMPAIGN,
      creativeId: "c1",
      accountId: "111",
      stillKey: "a:100001", // a saved picture keeps its key
      stillUrl: "https://kept/still",
    });
    expect(typeof saved.autoFirstAt).toBe("number");
    expect(market.isAuto(saved) && market.isSaved(saved)).toBe(true);

    const gone = by("100009")[0];
    expect(gone.stillLive).toBe(false);
    expect(typeof gone.retiredOn).toBe("string");
    expect(gone.previewSrc).toBeUndefined();
    expect(gone).toMatchObject({
      stillKey: "c:c9",
      stillUrl: "https://s/c9",
      stillTinyUrl: "https://s/c9t",
    });

    const unread = by("300001")[0];
    expect(unread.stillLive).toBe(true);
    expect(unread.retiredOn).toBeUndefined();
    expect(unread.stillUrl).toBeUndefined();

    const withdrawn = by("300002")[0];
    expect(withdrawn.stillKey).toBeUndefined();

    const fresh = by("400001")[0];
    expect(fresh).toMatchObject({
      origin: "auto",
      accountId: "222",
      creativeId: "c4",
      stillKey: "c:c4",
      client: "New Co",
    });
    expect(fresh.previewSrc).toBeUndefined();
    expect(fresh.stillLive).toBeUndefined(); // no campaign known: not judged
    expect(res).toMatchObject({ added: 1, archived: 5 });

    // Pictures: only the new winner needs a capture (c9 linked, c3 gone,
    // the withdrawn save is hidden, the saved one has a picture).
    expect(ctx.scheduled).toHaveLength(1);
    expect(refName(ctx.scheduled[0].ref)).toBe("previews:captureStills");
    expect(ctx.scheduled[0].args.items).toEqual([
      { adId: "400001", creativeId: "c4", accountId: "222", keep: true },
    ]);
    expect(res.stillsQueued).toBe(1);

    // A second run writes nothing new except the capture request.
    const before = db.writes;
    const ctx2 = makeCtx(db);
    const res2 = await market.archiveWinners._handler(ctx2, {});
    expect(res2.added).toBe(0);
    expect(res2.updated).toBe(0);
    expect(db.writes).toBe(before);
    expect(by("100001")[0].autoFirstAt).toBe(saved.autoFirstAt);
  });

  test("a manual row whose ad has more spend in the save than the play keeps its numbers", async () => {
    const { db } = seedWorld();
    db.seed("winnersArchive", {
      adId: "100001",
      adName: "A",
      client: "c",
      format: "video",
      spend: 900,
      leads: 90,
      cpl: 10,
      firstArchivedAt: 1,
      lastSeenAt: 1,
      origin: "manual",
      savedAt: 3,
    });
    await market.archiveWinners._handler(makeCtx(db), {});
    expect(db.rows("winnersArchive")[0]).toMatchObject({
      spend: 900,
      leads: 90,
      cpl: 10,
    });
  });

  test("duplicates are left alone and not multiplied", async () => {
    const { db } = seedWorld();
    const row = {
      adId: "100001",
      adName: "A",
      client: "c",
      format: "video",
      spend: 1,
      leads: 1,
      cpl: 1,
      firstArchivedAt: 1,
      lastSeenAt: 1,
    };
    db.seed("winnersArchive", row);
    db.seed("winnersArchive", { ...row, adName: "B" });
    await market.archiveWinners._handler(makeCtx(db), {});
    const rows = db.rows("winnersArchive").filter(r => r.adId === "100001");
    expect(rows).toHaveLength(2);
    expect(rows[0].spend).toBe(300); // the oldest is the primary
    expect(rows[1].spend).toBe(1);
  });
});

describe("winners and the assist context", () => {
  function listWorld() {
    const w = seedWorld();
    const { db } = w;
    const base = {
      client: "C",
      format: "image",
      firstArchivedAt: 1,
      lastSeenAt: 1,
      serviceLine: "Interior design",
    };
    db.seed("winnersArchive", {
      ...base,
      adId: "1",
      adName: "auto cheap",
      spend: 100,
      leads: 50,
      cpl: 2,
      previewSrc: "https://dead",
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "2",
      adName: "auto mid",
      spend: 100,
      leads: 20,
      cpl: 5,
      origin: "auto",
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "3",
      adName: "saved old",
      spend: 100,
      leads: 2,
      cpl: 50,
      origin: "manual",
      savedAt: 100,
      savedBy: "nada@maharamedia.com",
      savedByName: "Nada",
      savedNote: "old note",
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "4",
      adName: "saved new",
      spend: 100,
      leads: 4,
      cpl: 25,
      origin: "manual",
      savedAt: 200,
      savedBy: "rita@maharamedia.com",
      savedByName: "Rita",
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "5",
      adName: "withdrawn",
      spend: 100,
      leads: 50,
      cpl: 1,
      origin: "manual",
      savedAt: 100,
      unsavedAt: 150,
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "6",
      adName: "withdrawn but auto",
      spend: 100,
      leads: 10,
      cpl: 10,
      origin: "manual",
      autoFirstAt: 5,
      savedAt: 100,
      unsavedAt: 150,
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "2",
      adName: "auto mid dup saved",
      spend: 100,
      leads: 20,
      cpl: 5,
      savedAt: 300,
      savedBy: "nada@maharamedia.com",
      savedByName: "Nada",
    });
    db.seed("winnersArchive", {
      ...base,
      adId: "7",
      adName: "other service",
      serviceLine: "Kitchens",
      spend: 100,
      leads: 20,
      cpl: 3,
    });
    return w;
  }

  test("saved first and never cut, then by cost per lead, with filters", async () => {
    const { db, nada } = listWorld();
    const ctx = makeCtx(db, nada);
    const all = await market.winners._handler(ctx, {
      serviceLine: "Interior design",
      limit: 4,
    });
    expect(all.map((r: any) => r.adName)).toEqual([
      "auto mid dup saved",
      "saved new",
      "saved old",
      "auto cheap",
    ]);
    expect(all.every((r: any) => !("previewSrc" in r))).toBe(true);
    expect(all[0]).toMatchObject({
      isSaved: true,
      isAuto: true,
      origin: "auto",
      savedByName: "Nada",
    });
    expect(all[1]).toMatchObject({
      isSaved: true,
      isAuto: false,
      origin: "manual",
    });
    const tiny = await market.winners._handler(ctx, {
      serviceLine: "Interior design",
      limit: 1,
    });
    expect(tiny.map((r: any) => r.adId)).toEqual(["2", "4", "3"]);
    const saved = await market.winners._handler(ctx, { origin: "saved" });
    expect(saved.map((r: any) => r.adId)).toEqual(["2", "4", "3"]);
    const auto = await market.winners._handler(ctx, { origin: "auto" });
    expect(auto.map((r: any) => r.adId)).toEqual(["1", "7", "2", "6"]);
    const rita = await market.winners._handler(ctx, {
      savedBy: "RITA@maharamedia.com ",
    });
    expect(rita.map((r: any) => r.adId)).toEqual(["4"]);
    const all2 = await market.winners._handler(ctx, {});
    expect(all2.map((r: any) => r.adId).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "6",
      "7",
    ]);
    const withdrawnAuto = all2.find((r: any) => r.adId === "6");
    expect(withdrawnAuto).toMatchObject({ isSaved: false, isAuto: true });
    const stats = await market.archiveStats._handler(ctx, {});
    expect(stats).toMatchObject({ saved: 3, savedOnly: 3 });
  });

  test("guards a missing cost per lead", async () => {
    const { db, nada } = seedWorld();
    // A legacy row written without a cost per lead.
    db.seed("winnersArchive", {
      adId: "1",
      adName: "x",
      client: "C",
      format: "image",
      firstArchivedAt: 1,
      lastSeenAt: 1,
      spend: 1,
      leads: 0,
    });
    db.seed("winnersArchive", {
      adId: "2",
      adName: "y",
      client: "C",
      format: "image",
      firstArchivedAt: 1,
      lastSeenAt: 1,
      spend: 1,
      leads: 1,
      cpl: 1,
    });
    const rows = await market.winners._handler(makeCtx(db, nada), {});
    expect(rows.map((r: any) => r.cpl)).toEqual([1, null]);
  });

  test("assist context puts the team's saves first", async () => {
    const { db } = listWorld();
    const out = await assist.context._handler(makeCtx(db), {});
    const ids = out.winners.map((w: any) => w.whyItWorks ?? w.cpl);
    expect(out.winners).toHaveLength(6);
    expect(out.winners[0]).toMatchObject({ savedBy: "Nada" });
    expect(out.winners[2]).toMatchObject({
      savedBy: "Nada",
      whyItWorks: "old note",
    });
    expect(out.winners.slice(3).map((w: any) => w.cpl)).toEqual([2, 3, 10]);
    expect(ids).toBeDefined();
  });
});
