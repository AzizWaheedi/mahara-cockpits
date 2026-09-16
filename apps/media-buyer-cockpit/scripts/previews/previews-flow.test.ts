/**
 * Flow tests for the media buyer preview backend, run against the real
 * handlers in an in-memory fake (fakeConvex.ts). Meta, fbcdn and file
 * storage are faked; nothing leaves this machine.
 *
 * Run: bun test <this file>
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { FakeConvex, FakeWeb, image, json, metaError } from "./fakeConvex";

const APP = `${import.meta.dir}/../../convex`;
process.env.META_SYSTEM_TOKEN = "test-token-not-real";
process.env.CONVEX_SITE_URL = "https://fake-deployment.convex.site";
process.env.VIKTOR_SPACES_ACCESS_MODE = "public";
process.env.CREATIVE_BRIDGE_TOKEN = "creative-bridge-test";
process.env.CSM_BRIDGE_TOKEN = "csm-bridge-test";

const previews = await import(`${APP}/previews.ts`);
const health = await import(`${APP}/health.ts`);
const sync = await import(`${APP}/sync.ts`);
const fanout = await import(`${APP}/fanout.ts`);
const csmSync = await import(`${APP}/csmSync.ts`);
const cockpit = await import(`${APP}/cockpit.ts`);
const gate = await import(`${APP}/gate.ts`);
const http = (await import(`${APP}/http.ts`)).default;
const { internal } = await import(`${APP}/_generated/api.js`);

// biome-ignore lint/suspicious/noExplicitAny: test
type Any = any;

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 16, 12, 0, 0);
const hex = (ms: number) => Math.floor(ms / 1000).toString(16);
const cdnUrl = (name: string, expires = T0 + 3 * 24 * HOUR) =>
  `https://scontent.fkwi8-1.fna.fbcdn.net/v/t45/${name}.jpg?_nc_cat=1&oe=${hex(expires)}&oh=00_x`;
const IFRAME = (ad: string) =>
  `<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=${ad}&amp;t=AQ" width="320" height="560"></iframe>`;

const AD = "120211000000000001";
const AD2 = "120211000000000002";
const CR = "120212000000000001";
const ACCT = "555000111";
const CAMPAIGN = "KW | Acme | Leads";

let cx: FakeConvex;
let web: FakeWeb;
/** Meta's answers, by object path. */
let meta: Record<string, (q: URLSearchParams) => Response>;
/** Picture bodies by name. */
let pictures: Record<string, () => Response>;

function modules() {
  return { previews, health, sync, fanout, csmSync, cockpit, gate };
}

beforeEach(() => {
  setSystemTime(new Date(T0));
  cx = new FakeConvex(modules());
  web = new FakeWeb();
  meta = {};
  pictures = {};
  web.routes.push(url => {
    if (url.host !== "graph.facebook.com") return undefined;
    expect(url.searchParams.get("access_token")).toBe("test-token-not-real");
    const path = url.pathname.replace(/^\/v21\.0\//, "");
    const h = meta[path];
    if (!h)
      return metaError(
        100,
        `Unsupported get request. Object with ID '${path}' does not exist`,
        33,
      );
    return h(url.searchParams);
  });
  web.routes.push(url => {
    if (!url.host.endsWith("fbcdn.net")) return undefined;
    const name =
      url.pathname
        .split("/")
        .pop()
        ?.replace(/\.jpg$/, "") ?? "";
    const h = pictures[name];
    return h
      ? h()
      : new Response("gone", {
          status: 403,
          headers: { "content-type": "text/plain" },
        });
  });
  web.routes.push(url => {
    if (!url.href.startsWith(cx.storage.base)) return undefined;
    const id = `_storage~${url.pathname.split("/").pop()}`;
    const f = cx.storage.files.get(id);
    return f ? image(f.bytes, f.type) : new Response("", { status: 404 });
  });
  web.install();
});

afterEach(() => {
  web.uninstall();
  setSystemTime();
});

function seedCampaign(extra: Any = {}) {
  return cx.db.seed("campaigns", [
    {
      campaignName: CAMPAIGN,
      accountName: "Acme Ad Account",
      clientName: "Acme",
      onBoard: true,
      spend7d: 300,
      leads7d: 30,
      impressions7d: 10000,
      linkClicks7d: 300,
      dayRate: 40,
      verdict: "scale",
      reason: "ok",
      rank: 1,
      syncedAt: T0,
      metaAccountId: ACCT,
      metaCampaignId: "120210000000000001",
      ...extra,
    },
  ]);
}

function seedTreeAd(extra: Any = {}) {
  return cx.db.seed("metaTree", [
    {
      campaignName: CAMPAIGN,
      kind: "ad",
      metaId: AD,
      name: "Video 1",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      adsetId: "120213000000000001",
      accountId: ACCT,
      creativeId: CR,
      stillKey: `c:${CR}`,
      thumbUrl: cdnUrl("rowthumb"),
      syncedAt: T0,
      ...extra,
    },
  ]);
}

function seedMember(email: string, roles: string[], clients: string[] = []) {
  return cx.db.seed("members", [{ email, roles, clients, addedAt: T0 }]);
}

function seedUser(email: string) {
  return cx.db.seed("users", [{ email }])[0];
}

function metaHappy() {
  meta[`${AD}/previews`] = () => json({ data: [{ body: IFRAME(AD) }] });
  meta[CR] = q =>
    q.get("fields") === "thumbnail_url"
      ? json({
          id: CR,
          thumbnail_url: cdnUrl(`thumb${q.get("thumbnail_width")}`),
        })
      : json({ id: CR });
  pictures.thumb320 = () => image(24_000);
  pictures.thumb96 = () => image(3_000);
}

const freshFor = (adId = AD, format?: string) =>
  cx.run("action", internal.previews.freshFor, {
    adId,
    caller: "test",
    format,
  });

// ---------------------------------------------------------------- live preview

describe("live preview on demand", () => {
  test("first open: fetches the preview, saves the still, links the tree row", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    const r = await freshFor();
    expect(r.ok).toBe(true);
    expect(r.src).toBe(
      `https://business.facebook.com/ads/api/preview_iframe.php?d=${AD}&t=AQ`,
    );
    expect(r.width).toBe(320);
    expect(r.height).toBe(560);
    expect(r.expiresAt).toBe(T0 + 20 * HOUR);
    expect(r.accountId).toBe(ACCT);
    expect(r.stillKey).toBe(`c:${CR}`);
    expect(r.stillUrl).toStartWith(cx.storage.base);
    expect(r.stillTinyUrl).toStartWith(cx.storage.base);
    expect(r.stillUrl).not.toBe(r.stillTinyUrl);

    const [still] = cx.db.all("adStills");
    expect(still).toMatchObject({
      key: `c:${CR}`,
      status: "saved",
      source: "thumbnail",
      bytes: 24_000,
      tinyBytes: 3_000,
      contentType: "image/jpeg",
      attempts: 0,
    });
    expect(still.savedAt).toBeGreaterThanOrEqual(T0);
    const [node] = cx.db.all("metaTree");
    expect(node.stillUrl).toBe(r.stillUrl);
    expect(node.stillTinyUrl).toBe(r.stillTinyUrl);
    const [link] = cx.db.all("previewLinks");
    expect(link).toMatchObject({
      adId: AD,
      format: "MOBILE_FEED_STANDARD",
      fetchedAt: T0,
    });
    // One preview call, two creative calls; three Convex calls in all.
    expect(web.graphCalls()).toEqual([
      `GET graph.facebook.com/v21.0/${AD}/previews?ad_format=MOBILE_FEED_STANDARD`,
      `GET graph.facebook.com/v21.0/${CR}?fields=thumbnail_url&thumbnail_width=320&thumbnail_height=320`,
      `GET graph.facebook.com/v21.0/${CR}?fields=thumbnail_url&thumbnail_width=96&thumbnail_height=96`,
    ]);
    expect(cx.calls).toEqual([
      "previews:freshFor",
      "previews:previewContext",
      "previews:cacheWrite",
    ]);
  });

  test("second open within 20 hours: no Meta call, one read", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    const first = await freshFor();
    web.log = [];
    cx.calls = [];
    setSystemTime(new Date(T0 + 10 * HOUR));
    const again = await freshFor();
    expect(again).toEqual(first);
    expect(web.log).toEqual([]);
    expect(cx.calls).toEqual(["previews:freshFor", "previews:previewContext"]);
  });

  test("a link with under five minutes left is fetched again", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    await freshFor();
    setSystemTime(new Date(T0 + 20 * HOUR - 4 * 60_000));
    web.log = [];
    const r = await freshFor();
    expect(r.ok).toBe(true);
    expect(r.expiresAt).toBe(T0 + 40 * HOUR - 4 * 60_000);
    // The still is saved already: only the preview is fetched.
    expect(web.graphCalls()).toHaveLength(1);
    expect(cx.db.all("previewLinks")).toHaveLength(1);
  });

  test("deleted ad: gone, cached for a day, saved picture still returned", async () => {
    seedCampaign();
    seedTreeAd({ stillKey: `c:${CR}` });
    cx.db.seed("adStills", [
      {
        key: `c:${CR}`,
        status: "saved",
        storageId: "_storage~900",
        url: "https://fake-deployment.convex.cloud/api/storage/900",
        attempts: 0,
        lastTriedAt: T0 - HOUR,
        savedAt: T0 - HOUR,
      },
    ]);
    // no meta handlers: everything is "does not exist"
    const r = await freshFor();
    expect(r).toMatchObject({
      ok: false,
      reason: "gone",
      stillUrl: "https://fake-deployment.convex.cloud/api/storage/900",
      accountId: ACCT,
    });
    expect(r.message).toContain("Meta no longer has this ad");
    expect(r.src).toBeUndefined();
    // A saved still: no capture attempted.
    expect(web.graphCalls()).toHaveLength(1);
    const [link] = cx.db.all("previewLinks");
    expect(link.expiresAt).toBe(T0 + 24 * HOUR);
    expect(link.reason).toBe("gone");
    web.log = [];
    setSystemTime(new Date(T0 + 23 * HOUR));
    expect((await freshFor()).reason).toBe("gone");
    expect(web.log).toEqual([]);
    // The ledger is not told about a deleted ad.
    expect(cx.db.all("sourceHealth")).toEqual([]);
  });

  test("deleted ad with no still: the capture marks the creative gone, never retried", async () => {
    seedCampaign();
    seedTreeAd({ thumbUrl: cdnUrl("expiredthumb", T0 - HOUR) });
    const r = await freshFor();
    expect(r.reason).toBe("gone");
    expect(r.thumbUrl).toBeUndefined();
    const [still] = cx.db.all("adStills");
    expect(still).toMatchObject({
      key: `c:${CR}`,
      status: "gone",
      attempts: 0,
    });
    // Still gone a week later: no capture.
    setSystemTime(new Date(T0 + 8 * 24 * HOUR));
    web.log = [];
    await freshFor();
    expect(web.graphCalls()).toEqual([
      `GET graph.facebook.com/v21.0/${AD}/previews?ad_format=MOBILE_FEED_STANDARD`,
    ]);
  });

  test("rate limited: no capture, answer cached five minutes", async () => {
    seedCampaign();
    seedTreeAd();
    meta[`${AD}/previews`] = () => metaError(17, "User request limit reached");
    const r = await freshFor();
    expect(r.reason).toBe("rate_limited");
    expect(r.message).toContain("slow down");
    expect(web.graphCalls()).toHaveLength(1);
    expect(cx.db.all("adStills")).toEqual([]);
    expect(cx.db.all("previewLinks")[0].expiresAt).toBe(T0 + 5 * 60_000);
    // The row's own Meta picture is still offered while it is good.
    expect(r.thumbUrl).toBe(cdnUrl("rowthumb"));
    expect(r.thumbExpiresAt).toBe(
      Math.floor((T0 + 3 * 24 * HOUR) / 1000) * 1000,
    );
  });

  test("unshared account: no_meta_access, no capture", async () => {
    seedCampaign();
    seedTreeAd();
    meta[`${AD}/previews`] = () =>
      metaError(
        200,
        "Ad account owner has NOT grant ads_management or ads_read permission",
      );
    const r = await freshFor();
    expect(r.reason).toBe("no_meta_access");
    expect(cx.db.all("adStills")).toEqual([]);
    expect(cx.db.all("previewLinks")[0].expiresAt).toBe(T0 + 24 * HOUR);
  });

  test("feed format not supported: tries Instagram once, caches under the asked format", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    meta[`${AD}/previews`] = q =>
      q.get("ad_format") === "MOBILE_FEED_STANDARD"
        ? metaError(
            100,
            "Invalid parameter (The ad_format MOBILE_FEED_STANDARD is not supported for this ad)",
          )
        : json({ data: [{ body: IFRAME("ig") }] });
    const r = await freshFor();
    expect(r.ok).toBe(true);
    expect(r.src).toContain("d=ig");
    expect(cx.db.all("previewLinks")[0].format).toBe("MOBILE_FEED_STANDARD");
  });

  test("empty preview answer: error for ten minutes, still saved, fresh Meta still kept", async () => {
    seedCampaign();
    seedTreeAd({
      thumbUrl: undefined,
      creativeId: undefined,
      stillKey: `a:${AD}`,
    });
    meta[`${AD}/previews`] = () => json({ data: [] });
    meta[AD] = () =>
      json({ id: AD, account_id: `act_${ACCT}`, creative: { id: CR } });
    meta[CR] = q =>
      q.get("fields") === "thumbnail_url"
        ? json({ id: CR, thumbnail_url: cdnUrl("toolarge") })
        : json({ id: CR });
    pictures.toolarge = () => image(400_000);
    const r = await freshFor();
    expect(r.reason).toBe("error");
    expect(cx.db.all("previewLinks")[0].expiresAt).toBe(T0 + 10 * 60_000);
    // The download was too big: failed, attempt counted, the fresh link offered.
    const stills = cx.db.all("adStills");
    expect(stills).toHaveLength(1);
    expect(stills[0]).toMatchObject({
      key: `c:${CR}`,
      status: "failed",
      attempts: 1,
    });
    expect(stills[0].lastError).toContain("too big");
    expect(r.thumbUrl).toBe(cdnUrl("toolarge"));
    // The tree row learned its creative and key.
    expect(cx.db.all("metaTree")[0]).toMatchObject({
      creativeId: CR,
      stillKey: `c:${CR}`,
    });
    expect(cx.db.all("previewLinks")[0].thumbUrl).toBe(cdnUrl("toolarge"));
  });

  test("a dead token is recorded in the ledger", async () => {
    seedCampaign();
    seedTreeAd();
    meta[`${AD}/previews`] = () =>
      metaError(190, "Error validating access token: Session has expired");
    meta[CR] = () =>
      metaError(190, "Error validating access token: Session has expired");
    const r = await freshFor();
    expect(r.reason).toBe("error");
    const rows = cx.db.all("sourceHealth");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "meta", ok: false });
    expect(rows[0].streak).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).not.toContain("test-token-not-real");
  });

  test("bad ids never reach Meta", async () => {
    for (const bad of [
      "123",
      "12345/../act_1",
      "abc123456",
      `${AD}?fields=x`,
    ]) {
      const r = await freshFor(bad);
      expect(r).toMatchObject({ ok: false, reason: "error" });
    }
    expect(web.log).toEqual([]);
    expect(cx.calls.filter(c => c !== "previews:freshFor")).toEqual([]);
  });

  test("an unknown format falls back to the feed format", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    await freshFor(AD, "WHATEVER");
    expect(web.graphCalls()[0]).toContain("ad_format=MOBILE_FEED_STANDARD");
  });

  test("Meta hanging: the answer still comes back within the budget", async () => {
    seedCampaign();
    seedTreeAd();
    setSystemTime(); // real clock for timers
    meta[`${AD}/previews`] = () => new Promise<Response>(() => {}) as never;
    web.routes.unshift(url =>
      url.pathname.endsWith("/previews")
        ? (new Promise(() => {}) as never)
        : undefined,
    );
    const started = Date.now();
    const r = await freshFor();
    expect(r.reason).toBe("error");
    expect(Date.now() - started).toBeLessThan(17_000);
  }, 20_000);
});

// ---------------------------------------------------------------- access

describe("who may open a preview", () => {
  const allowed = (a: Any) => cx.run("query", internal.previews.allowed, a);

  test("roles and client scope", async () => {
    seedCampaign();
    seedTreeAd();
    seedMember("nada@maharamedia.com", ["media_buyer"], []);
    seedMember("scoped@maharamedia.com", ["media_buyer", "csm"], ["acme"]);
    seedMember(
      "other@maharamedia.com",
      ["media_buyer", "creative"],
      ["someone else"],
    );
    seedMember("csm@maharamedia.com", ["csm"], []);
    expect(
      await allowed({
        adId: AD,
        role: "media_buyer",
        email: "nada@maharamedia.com",
      }),
    ).toBe("");
    expect(
      await allowed({
        adId: AD,
        role: "media_buyer",
        email: "scoped@maharamedia.com",
      }),
    ).toBe("");
    expect(
      await allowed({ adId: AD, role: "csm", email: "scoped@maharamedia.com" }),
    ).toBe("");
    expect(
      await allowed({
        adId: AD,
        role: "media_buyer",
        email: "other@maharamedia.com",
      }),
    ).toContain("not on your list");
    expect(
      await allowed({
        adId: AD,
        role: "media_buyer",
        email: "csm@maharamedia.com",
      }),
    ).toContain("not yours");
    expect(
      await allowed({ adId: AD, role: "csm", email: "stranger@example.com" }),
    ).toContain("not yours");
    // Static admins pass without a member row.
    expect(
      await allowed({
        adId: AD,
        role: "creative",
        email: "aziz@maharamedia.com",
      }),
    ).toBe("");
    // An ad nobody knows: a restricted member is refused, an open one is not.
    expect(
      await allowed({
        adId: AD2,
        role: "media_buyer",
        email: "other@maharamedia.com",
      }),
    ).toContain("not on your list");
    expect(
      await allowed({
        adId: AD2,
        role: "media_buyer",
        email: "nada@maharamedia.com",
      }),
    ).toBe("");
    expect(await allowed({ adId: AD, role: "media_buyer" })).toContain(
      "not yours",
    );
  });

  test("winners are company-wide, like What works", async () => {
    seedMember("other@maharamedia.com", ["creative"], ["someone else"]);
    cx.db.seed("winnersArchive", [
      {
        adId: AD2,
        adName: "W",
        client: "Acme",
        format: "video",
        spend: 200,
        leads: 20,
        cpl: 10,
        firstArchivedAt: T0,
        lastSeenAt: T0,
      },
    ]);
    expect(
      await allowed({
        adId: AD2,
        role: "creative",
        email: "other@maharamedia.com",
      }),
    ).toBe("");
  });

  test("by user id (the media buyer's own action)", async () => {
    const uid = seedUser("nada@maharamedia.com");
    seedMember("nada@maharamedia.com", ["media_buyer"], []);
    expect(await allowed({ adId: AD, role: "media_buyer", userId: uid })).toBe(
      "",
    );
    const other = seedUser("nobody@example.com");
    expect(
      await allowed({ adId: AD, role: "media_buyer", userId: other }),
    ).toContain("not yours");
  });

  test("fresh (signed in): a refused person gets no Meta call", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    const uid = seedUser("csm@maharamedia.com");
    seedMember("csm@maharamedia.com", ["csm"], []);
    cx.identity = { subject: `${uid}|session1` };
    const r = await cx.run("action", "previews:fresh", { adId: AD });
    expect(r).toMatchObject({ ok: false, reason: "no_access" });
    expect(web.log).toEqual([]);

    const nada = seedUser("nada@maharamedia.com");
    seedMember("nada@maharamedia.com", ["media_buyer"], []);
    cx.identity = { subject: `${nada}|session2` };
    const ok = await cx.run("action", "previews:fresh", { adId: AD });
    expect(ok.ok).toBe(true);
  });

  test("fresh needs a signed-in user", async () => {
    cx.identity = null;
    await expect(
      cx.run("action", "previews:fresh", { adId: AD }),
    ).rejects.toThrow(/Not authenticated/);
  });
});

// ---------------------------------------------------------------- bridge door

describe("/bridge/preview", () => {
  const route = () => {
    const found = http.lookup("/bridge/preview", "POST");
    expect(found).not.toBeNull();
    return found[0];
  };
  const call = async (body: Any, token?: string) => {
    const res: Response = await route()._handler(
      cx.actionCtx(),
      new Request("https://x.convex.site/bridge/preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return {
      status: res.status,
      cache: res.headers.get("cache-control"),
      body: res.status === 401 ? await res.text() : await res.json(),
    };
  };

  test("refuses without the bridge token", async () => {
    expect(
      (await call({ adId: AD, email: "a@b.c", cockpit: "csm" })).status,
    ).toBe(401);
    expect(
      (await call({ adId: AD, email: "a@b.c", cockpit: "csm" }, "wrong"))
        .status,
    ).toBe(401);
    expect(
      (
        await call(
          { adId: AD, email: "a@b.c", cockpit: "csm" },
          "csm-bridge-tes",
        )
      ).status,
    ).toBe(401);
    expect(web.log).toEqual([]);
  });

  test("the cockpit must match its token", async () => {
    const r = await call(
      { adId: AD, email: "a@b.c", cockpit: "creative" },
      "csm-bridge-test",
    );
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
  });

  test("bad input", async () => {
    expect(
      (
        await call(
          { adId: "act_1", email: "a@b.c", cockpit: "csm" },
          "csm-bridge-test",
        )
      ).status,
    ).toBe(400);
    expect(
      (await call({ adId: AD, cockpit: "csm" }, "csm-bridge-test")).status,
    ).toBe(400);
    expect((await call("not json", "csm-bridge-test")).status).toBe(403);
    expect(web.log).toEqual([]);
  });

  test("an unknown person gets no_access and no Meta call", async () => {
    seedCampaign();
    seedTreeAd();
    const r = await call(
      { adId: AD, email: "Stranger@Example.com", cockpit: "creative" },
      "creative-bridge-test",
    );
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    expect(r.body).toMatchObject({ ok: false, reason: "no_access", adId: AD });
    expect(web.log).toEqual([]);
  });

  test("a CSM member gets the live preview and the saved still", async () => {
    seedCampaign();
    seedTreeAd();
    metaHappy();
    seedMember("abdu@maharamedia.com", ["csm"], []);
    const r = await call(
      { adId: AD, email: "abdu@maharamedia.com", cockpit: "csm" },
      "csm-bridge-test",
    );
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    expect(r.body.ok).toBe(true);
    expect(r.body.src).toContain("preview_iframe.php");
    expect(r.body.stillUrl).toStartWith(cx.storage.base);
    // Same cache for the creative cockpit a minute later.
    seedMember("mo@maharamedia.com", ["creative"], []);
    web.log = [];
    const r2 = await call(
      { adId: AD, email: "mo@maharamedia.com", cockpit: "creative" },
      "creative-bridge-test",
    );
    expect(r2.body.src).toBe(r.body.src);
    expect(web.log).toEqual([]);
  });
});

// ---------------------------------------------------------------- captures

describe("saving stills", () => {
  const capture = (items: Any[]) =>
    cx.run("action", internal.previews.captureStills, { items });

  test("dedupes by creative, claims, and a second run leaves settled keys alone", async () => {
    metaHappy();
    seedTreeAd();
    cx.db.seed("metaTree", [
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: AD2,
        name: "Video 1 copy",
        status: "ACTIVE",
        creativeId: CR,
        stillKey: `c:${CR}`,
        syncedAt: T0,
      },
    ]);
    const out = await capture([
      { adId: AD, creativeId: CR, campaignName: CAMPAIGN },
      { adId: AD2, creativeId: CR, campaignName: CAMPAIGN, keep: true },
      { adId: "bad" },
      {},
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: `c:${CR}`, status: "saved" });
    const stills = cx.db.all("adStills");
    expect(stills).toHaveLength(1);
    expect(stills[0].keep).toBe(true);
    expect(web.graphCalls()).toHaveLength(2);
    expect(cx.calls).toEqual([
      "previews:captureStills",
      "previews:claimStills",
      "previews:recordStills",
    ]);
    // The first ad's tree row got the picture (the item that won the merge).
    const byId = Object.fromEntries(
      cx.db.all("metaTree").map((r: Any) => [r.metaId, r]),
    );
    expect(byId[AD].stillUrl).toBe(out[0].url);

    web.log = [];
    const again = await capture([{ adId: AD, creativeId: CR }]);
    expect(again).toEqual([
      {
        key: `c:${CR}`,
        status: "saved",
        url: out[0].url,
        tinyUrl: out[0].tinyUrl,
      },
    ]);
    expect(web.log).toEqual([]);
  });

  test("an old winner with only an ad id: finds the creative, links the winner, drops the placeholder", async () => {
    metaHappy();
    meta[AD] = () =>
      json({ id: AD, account_id: `act_${ACCT}`, creative: { id: CR } });
    cx.db.seed("winnersArchive", [
      {
        adId: AD,
        adName: "W",
        client: "Acme",
        format: "video",
        spend: 200,
        leads: 20,
        cpl: 10,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        campaignName: CAMPAIGN,
      },
    ]);
    const out = await capture([{ adId: AD, keep: true }]);
    expect(out).toEqual([
      expect.objectContaining({ key: `c:${CR}`, status: "saved" }),
    ]);
    const stills = cx.db.all("adStills");
    expect(stills.map((s: Any) => s.key)).toEqual([`c:${CR}`]);
    expect(stills[0]).toMatchObject({
      keep: true,
      accountId: ACCT,
      creativeId: CR,
      adId: AD,
    });
    const [w] = cx.db.all("winnersArchive");
    expect(w).toMatchObject({
      creativeId: CR,
      accountId: ACCT,
      stillKey: `c:${CR}`,
      stillUrl: out[0].url,
    });
  });

  test("another ad already saved the creative: no download, just a link", async () => {
    meta[AD] = () =>
      json({ id: AD, account_id: `act_${ACCT}`, creative: { id: CR } });
    cx.db.seed("adStills", [
      {
        key: `c:${CR}`,
        status: "saved",
        storageId: "_storage~77",
        url: "https://s/77",
        tinyUrl: "https://s/78",
        attempts: 0,
        lastTriedAt: T0 - HOUR,
        savedAt: T0 - HOUR,
      },
    ]);
    cx.db.seed("winnersArchive", [
      {
        adId: AD,
        adName: "W",
        client: "Acme",
        format: "video",
        spend: 200,
        leads: 20,
        cpl: 10,
        firstArchivedAt: T0,
        lastSeenAt: T0,
      },
    ]);
    const out = await capture([{ adId: AD, keep: true }]);
    expect(out[0]).toEqual({
      key: `c:${CR}`,
      status: "saved",
      url: "https://s/77",
      tinyUrl: "https://s/78",
    });
    expect(web.log.filter(l => l.includes("fbcdn"))).toEqual([]);
    expect(web.graphCalls()).toHaveLength(1);
    expect(cx.db.all("adStills")).toHaveLength(1);
    expect(cx.db.all("winnersArchive")[0]).toMatchObject({
      stillKey: `c:${CR}`,
      stillUrl: "https://s/77",
      stillTinyUrl: "https://s/78",
    });
    expect(cx.storage.files.size).toBe(0);
  });

  test("a race: the second copy is thrown away", async () => {
    metaHappy();
    // Someone saved it while this run was downloading.
    const first = await cx.run("mutation", internal.previews.recordStills, {
      outcomes: [
        {
          key: `c:${CR}`,
          status: "saved",
          countAttempt: false,
          storageId: await cx.storage.store(
            new Blob(["x".repeat(300)], { type: "image/jpeg" }),
          ),
          url: "https://s/a",
        },
      ],
    });
    const newId = await cx.storage.store(
      new Blob(["y".repeat(300)], { type: "image/jpeg" }),
    );
    const tinyId = await cx.storage.store(
      new Blob(["z".repeat(300)], { type: "image/jpeg" }),
    );
    const second = await cx.run("mutation", internal.previews.recordStills, {
      outcomes: [
        {
          key: `c:${CR}`,
          status: "saved",
          countAttempt: false,
          storageId: newId,
          url: "https://s/b",
          tinyStorageId: tinyId,
          tinyUrl: "https://s/c",
        },
      ],
    });
    expect(first[0].url).toBe("https://s/a");
    expect(second[0]).toEqual({
      key: `c:${CR}`,
      status: "saved",
      url: "https://s/a",
    });
    expect(cx.storage.deleted).toEqual([newId, tinyId]);
    expect(cx.db.all("adStills")).toHaveLength(1);
  });

  test("a row picture in hand: saved without any Graph call", async () => {
    pictures.sbthumb = () => image(9_000, "image/png");
    cx.db.seed("ads", [
      {
        campaignName: CAMPAIGN,
        adName: "Old ad",
        spend: 10,
        leads: 1,
        metaAdId: AD2,
        stillKey: `a:${AD2}`,
        thumbnailUrl: cdnUrl("sbthumb"),
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
    ]);
    const out = await capture([
      { adId: AD2, campaignName: CAMPAIGN, sourceUrl: cdnUrl("sbthumb") },
    ]);
    expect(out[0]).toMatchObject({ key: `a:${AD2}`, status: "saved" });
    expect(web.graphCalls()).toEqual([]);
    expect(cx.db.all("adStills")[0]).toMatchObject({
      source: "row_url",
      contentType: "image/png",
      bytes: 9_000,
    });
    expect(cx.db.all("ads")[0].stillUrl).toBe(out[0].url);
  });

  test("an expired row picture is not used; the Graph path is", async () => {
    metaHappy();
    meta[AD2] = () => json({ id: AD2, account_id: ACCT, creative: { id: CR } });
    const out = await capture([
      { adId: AD2, sourceUrl: cdnUrl("sbthumb", T0 - 1000) },
    ]);
    expect(out[0].status).toBe("saved");
    expect(web.log.some(l => l.includes("sbthumb"))).toBe(false);
  });

  test("no thumbnail: falls back to the image, then the video cover", async () => {
    meta[CR] = q =>
      q.get("fields") === "thumbnail_url"
        ? json({ id: CR })
        : json({
            id: CR,
            image_url: cdnUrl("broken"),
            object_story_spec: { video_data: { image_url: cdnUrl("cover") } },
          });
    pictures.cover = () => image(30_000, "image/webp");
    const out = await capture([{ adId: AD, creativeId: CR }]);
    expect(out[0].status).toBe("saved");
    const [s] = cx.db.all("adStills");
    expect(s).toMatchObject({
      source: "video_picture",
      contentType: "image/webp",
    });
    expect(s.tinyUrl).toBeUndefined();
  });

  test("failures count to five, then wait a week; rate limits do not count", async () => {
    meta[CR] = q =>
      json({ id: CR, thumbnail_url: cdnUrl(`t${q.get("thumbnail_width")}`) });
    pictures.t320 = () =>
      new Response("<html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    for (let i = 1; i <= 5; i++) {
      setSystemTime(new Date(T0 + i * HOUR));
      await capture([{ adId: AD, creativeId: CR }]);
      expect(cx.db.all("adStills")[0]).toMatchObject({
        status: "failed",
        attempts: i,
      });
    }
    expect(cx.db.all("adStills")[0].lastError).toContain("not an image");
    web.log = [];
    setSystemTime(new Date(T0 + 6 * 24 * HOUR));
    await capture([{ adId: AD, creativeId: CR }]);
    expect(web.log).toEqual([]);
    setSystemTime(new Date(T0 + 5 * HOUR + 7 * 24 * HOUR));
    meta[CR] = () =>
      metaError(613, "Calls to this api have exceeded the rate limit");
    await capture([{ adId: AD, creativeId: CR }]);
    expect(cx.db.all("adStills")[0]).toMatchObject({
      status: "failed",
      attempts: 5,
    });
    expect(cx.db.all("adStills")[0].lastError).toContain("613");
  });

  test("a claim holds the key for 15 minutes against a second run", async () => {
    const claim = await cx.run("mutation", internal.previews.claimStills, {
      items: [{ key: `c:${CR}`, item: { creativeId: CR } }],
    });
    expect(claim[0].due).toBe(true);
    const again = await cx.run("mutation", internal.previews.claimStills, {
      items: [{ key: `c:${CR}`, item: { creativeId: CR, keep: true } }],
    });
    expect(again[0].due).toBe(false);
    expect(cx.db.all("adStills")[0]).toMatchObject({
      status: "failed",
      attempts: 0,
      keep: true,
    });
    setSystemTime(new Date(T0 + 16 * 60_000));
    const later = await cx.run("mutation", internal.previews.claimStills, {
      items: [{ key: `c:${CR}`, item: { creativeId: CR } }],
    });
    expect(later[0].due).toBe(true);
  });

  test("more than 30 items: 30 now, the rest queued once", async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({
      creativeId: `1202120000${String(i).padStart(4, "0")}`,
    }));
    for (const it of items)
      meta[it.creativeId] = () =>
        json({ id: it.creativeId, thumbnail_url: cdnUrl("same") });
    pictures.same = () => image(1_000);
    const out = await capture(items);
    expect(out).toHaveLength(30);
    expect(cx.scheduled).toHaveLength(1);
    expect(cx.scheduled[0].name).toBe("previews:captureStills");
    expect(cx.scheduled[0].args.items).toHaveLength(15);
    await cx.drain();
    expect(
      cx.db.all("adStills").filter((s: Any) => s.status === "saved"),
    ).toHaveLength(45);
    expect(cx.scheduled).toHaveLength(0);
  });

  test("ensureStill (Save as winner)", async () => {
    metaHappy();
    const r = await cx.run("action", internal.previews.ensureStill, {
      adId: AD,
      creativeId: CR,
      keep: true,
    });
    expect(r).toMatchObject({ key: `c:${CR}`, status: "saved" });
    expect(r.url).toStartWith(cx.storage.base);
    web.log = [];
    const again = await cx.run("action", internal.previews.ensureStill, {
      adId: AD,
      creativeId: CR,
    });
    expect(again).toEqual(r);
    expect(web.log).toEqual([]);
    expect(
      await cx.run("action", internal.previews.ensureStill, { adId: "nope" }),
    ).toEqual({ status: "failed" });
  });

  test("savedAt is strictly increasing, and stillsSince pages by it", async () => {
    const mk = async (n: number) => ({
      key: `c:${n}00000`,
      status: "saved",
      countAttempt: false,
      storageId: await cx.storage.store(new Blob(["x".repeat(300)])),
      url: `https://s/${n}`,
    });
    const out = await cx.run("mutation", internal.previews.recordStills, {
      outcomes: [await mk(1), await mk(2), await mk(3)],
    });
    expect(out).toHaveLength(3);
    const rows = cx.db.all("adStills").map((r: Any) => r.savedAt);
    expect(rows).toEqual([T0, T0 + 1, T0 + 2]);
    // Same clock again: still after the last one.
    await cx.run("mutation", internal.previews.recordStills, {
      outcomes: [await mk(4)],
    });
    expect(cx.db.all("adStills").map((r: Any) => r.savedAt)).toEqual([
      T0,
      T0 + 1,
      T0 + 2,
      T0 + 3,
    ]);
    cx.db.seed("adStills", [
      { key: "c:99999", status: "failed", attempts: 1, lastTriedAt: T0 },
    ]);
    const since = await cx.run("query", internal.previews.stillsSince, {
      since: T0,
      limit: 2,
    });
    expect(since.map((s: Any) => s.savedAt)).toEqual([T0 + 1, T0 + 2]);
    expect(since[0]).toEqual({
      key: "c:200000",
      url: "https://s/2",
      savedAt: T0 + 1,
    });
    const all = await cx.run("query", internal.previews.stillsSince, {
      since: 0,
      limit: 40,
    });
    expect(all).toHaveLength(4);
    expect(
      await cx.run("query", internal.previews.stillsSince, {
        since: T0 + 3,
        limit: 40,
      }),
    ).toEqual([]);
  });

  test("lookupStills (for the winners pass)", async () => {
    cx.db.seed("adStills", [
      {
        key: "c:1",
        status: "saved",
        url: "u1",
        attempts: 0,
        lastTriedAt: 0,
        savedAt: 1,
      },
      { key: "c:2", status: "gone", attempts: 0, lastTriedAt: 0 },
    ]);
    const m = await previews.lookupStills(cx.db as Any, [
      "c:1",
      "c:2",
      "c:3",
      "c:1",
      "",
    ]);
    expect([...m.entries()]).toEqual([
      ["c:1", { status: "saved", url: "u1", tinyUrl: undefined }],
      ["c:2", { status: "gone", url: undefined, tinyUrl: undefined }],
    ]);
  });
});

// ---------------------------------------------------------------- adDetails

describe("adDetails", () => {
  test("identity and copy", async () => {
    meta[AD] = () =>
      json({
        id: AD,
        name: "Video 1",
        status: "PAUSED",
        effective_status: "CAMPAIGN_PAUSED",
        adset_id: "7001",
        campaign_id: "7002",
        account_id: `act_${ACCT}`,
        creative: {
          id: CR,
          thumbnail_url: cdnUrl("t"),
          object_story_spec: {
            video_data: {
              video_id: "88",
              message: "Hello?",
              title: "Head",
              call_to_action: { type: "GET_QUOTE" },
            },
          },
        },
      });
    const r = await cx.run("action", internal.previews.adDetails, { adId: AD });
    expect(r).toEqual({
      ok: true,
      creativeId: CR,
      accountId: ACCT,
      adsetId: "7001",
      campaignId: "7002",
      name: "Video 1",
      status: "CAMPAIGN_PAUSED",
      format: "video",
      cta: "Get quote",
      headline: "Head",
      body: "Hello?",
      videoId: "88",
      thumbUrl: cdnUrl("t"),
    });
  });
  test("refusals map to reasons", async () => {
    expect(
      await cx.run("action", internal.previews.adDetails, { adId: AD }),
    ).toEqual({ ok: false, reason: "gone" });
    meta[AD] = () =>
      metaError(10, "Application does not have permission for this action");
    expect(
      await cx.run("action", internal.previews.adDetails, { adId: AD }),
    ).toEqual({ ok: false, reason: "no_meta_access" });
    expect(
      await cx.run("action", internal.previews.adDetails, { adId: "x" }),
    ).toEqual({ ok: false, reason: "error" });
  });
});

// ---------------------------------------------------------------- daily check

describe("daily preview check", () => {
  function seedWinners() {
    const w = (adId: string, extra: Any = {}) => ({
      adId,
      adName: `W${adId}`,
      client: "Acme",
      format: "video",
      spend: 200,
      leads: 20,
      cpl: 10,
      firstArchivedAt: T0,
      lastSeenAt: T0,
      ...extra,
    });
    cx.db.seed("winnersArchive", [
      w("100001", { stillUrl: "https://s/ok", stillKey: "c:1" }),
      w("100002", { creativeId: "2", campaignName: CAMPAIGN }), // never tried
      w("100003", { stillKey: "c:3" }), // failed, eligible
      w("100004", { stillKey: "c:4" }), // failed, waiting
      w("100005", { stillKey: "c:5" }), // gone
      w("100006", { origin: "manual", savedAt: T0 - 10, unsavedAt: T0 }), // unsaved manual: not shown
      w("100002", { stillUrl: "https://s/dup" }), // duplicate with a picture wins
    ]);
    cx.db.seed("adStills", [
      { key: "c:3", status: "failed", attempts: 2, lastTriedAt: T0 - HOUR },
      { key: "c:4", status: "failed", attempts: 5, lastTriedAt: T0 - HOUR },
      { key: "c:5", status: "gone", attempts: 0, lastTriedAt: T0 - HOUR },
    ]);
  }

  test("rotStats counts", async () => {
    seedWinners();
    cx.db.seed("winnersArchive", [
      {
        adId: "100007",
        adName: "x",
        client: "Acme",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
      },
    ]);
    seedTreeAd({ thumbUrl: cdnUrl("old", T0 - HOUR) });
    cx.db.seed("metaTree", [
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: AD2,
        name: "b",
        status: "ACTIVE",
        thumbUrl: cdnUrl("good"),
        syncedAt: T0,
      },
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: "3",
        name: "c",
        status: "PAUSED",
        syncedAt: T0,
      },
      {
        campaignName: CAMPAIGN,
        kind: "adset",
        metaId: "4",
        name: "d",
        status: "ACTIVE",
        syncedAt: T0,
      },
    ]);
    const s = await cx.run("query", internal.previews.rotStats, {});
    expect(s.winners).toEqual({
      shown: 6,
      missing: 4,
      neverTried: 1,
      failedEligible: 1,
      failedWaiting: 1,
      gone: 1,
      savedNotLinked: 0,
    });
    expect(s.live).toEqual({ ads: 2, withPicture: 1 });
    expect(s.heal.map((h: Any) => h.adId).sort()).toEqual(["100003", "100007"]);
    expect(s.heal.every((h: Any) => h.keep === true)).toBe(true);
  });

  test("rotCheck: loads samples, reports, heals, cleans, records", async () => {
    seedWinners();
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        await cx.storage.store(
          new Blob(["x".repeat(3000)], { type: "image/jpeg" }),
        ),
      );
    cx.db.seed(
      "adStills",
      ids.map((id, i) => ({
        key: `c:9${i}`,
        status: "saved",
        storageId: id,
        url: `${cx.storage.base}${id.split("~")[1]}`,
        tinyUrl: i === 4 ? `${cx.storage.base}404` : undefined,
        bytes: 3000,
        attempts: 0,
        lastTriedAt: T0,
        savedAt: T0 + i,
      })),
    );
    cx.db.seed("previewLinks", [
      {
        adId: AD,
        format: "MOBILE_FEED_STANDARD",
        fetchedAt: T0 - 30 * HOUR,
        expiresAt: T0 - 2 * HOUR,
      },
      {
        adId: AD2,
        format: "MOBILE_FEED_STANDARD",
        fetchedAt: T0 - 20 * HOUR - 1,
        expiresAt: T0 - 30 * 60_000,
      },
      {
        adId: "777777",
        format: "MOBILE_FEED_STANDARD",
        src: "x",
        fetchedAt: T0,
        expiresAt: T0 + HOUR,
      },
    ]);
    const r = await cx.run("action", internal.previews.rotCheck, {});
    expect(r.ok).toBe(false);
    const byName = Object.fromEntries(r.checks.map((c: Any) => [c.name, c]));
    expect(Object.keys(byName)).toEqual([
      "previews saved pictures load",
      "previews winners with a picture",
      "previews live ads with a picture",
      "previews storage",
    ]);
    // Samples: first, middle, last saved; the last one's tiny link is broken.
    expect(byName["previews saved pictures load"]).toMatchObject({ ok: false });
    expect(byName["previews saved pictures load"].error).toBe(
      "1 of 3 saved pictures did not load (HTTP 404)",
    );
    expect(byName["previews winners with a picture"].error).toBe(
      "2 of 5 winners have no saved picture (2 failed; 1 more was deleted in Meta before we saved them)",
    );
    expect(byName["previews live ads with a picture"]).toEqual({
      name: "previews live ads with a picture",
      ok: true,
    });
    expect(byName["previews storage"]).toEqual({
      name: "previews storage",
      ok: true,
    });
    for (const c of r.checks) expect(JSON.stringify(c)).not.toContain("—");
    // Old answers gone, the live one kept.
    expect(
      cx.db
        .all("previewLinks")
        .map((l: Any) => l.adId)
        .sort(),
    ).toEqual([AD2, "777777"].sort());
    // Heal queued with keep.
    expect(cx.scheduled.map(s => s.name)).toContain("previews:captureStills");
    const heal = cx.scheduled.find(s => s.name === "previews:captureStills");
    expect(heal?.args.items).toEqual([{ adId: "100003", keep: true }]);
    // Ledger row.
    const led = cx.db.all("sourceHealth");
    expect(led).toEqual([
      expect.objectContaining({ source: "previews", ok: false }),
    ]);
    expect(health.RUNBOOK.previews.label).toBe(
      "Ad previews and saved pictures",
    );
  });

  test("all good", async () => {
    const id = await cx.storage.store(
      new Blob(["x".repeat(3000)], { type: "image/jpeg" }),
    );
    cx.db.seed("adStills", [
      {
        key: "c:1",
        status: "saved",
        storageId: id,
        url: `${cx.storage.base}${id.split("~")[1]}`,
        bytes: 3000,
        attempts: 0,
        lastTriedAt: T0,
        savedAt: T0,
      },
    ]);
    cx.db.seed("winnersArchive", [
      {
        adId: "100001",
        adName: "a",
        client: "Acme",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        stillUrl: "x",
      },
    ]);
    const r = await cx.run("action", internal.previews.rotCheck, {});
    expect(r.ok).toBe(true);
    expect(r.checks.every((c: Any) => c.ok)).toBe(true);
    expect(cx.scheduled).toEqual([]);
    expect(cx.db.all("sourceHealth")[0]).toMatchObject({
      source: "previews",
      ok: true,
      streak: 0,
    });
  });

  test("storage over 500 MB fails", async () => {
    cx.db.seed("adStills", [
      {
        key: "c:1",
        status: "saved",
        url: "u",
        bytes: 400 * 1024 * 1024,
        tinyBytes: 101 * 1024 * 1024,
        attempts: 0,
        lastTriedAt: T0,
        savedAt: T0,
      },
    ]);
    pictures.none = () => image(10);
    web.routes.unshift(url =>
      url.href === "https://fake-deployment.convex.cloud/u"
        ? image(300)
        : undefined,
    );
    const r = await previews.runRotCheck(cx.actionCtx() as Any);
    const storage = r.checks.find((c: Any) => c.name === "previews storage");
    expect(storage).toMatchObject({
      ok: false,
      error: "Saved pictures use 501 MB, over the 500 MB warning line",
    });
  });
});

// ---------------------------------------------------------------- sync store

describe("sync.store", () => {
  const base = () => ({
    campaigns: [
      {
        campaignName: CAMPAIGN,
        accountName: "Acme",
        clientName: "Acme",
        onBoard: true,
        spend7d: 100,
        leads7d: 10,
        impressions7d: 1000,
        linkClicks7d: 10,
        dayRate: 10,
        verdict: "ok",
        reason: "ok",
        rank: 1,
        syncedAt: T0,
        metaCampaignId: "9",
      },
    ],
    ads: [
      {
        campaignName: CAMPAIGN,
        adName: "Video 1",
        spend: 50,
        leads: 5,
        metaAdId: AD,
        stillKey: `c:${CR}`,
        thumbnailUrl: cdnUrl("t1"),
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
      {
        campaignName: CAMPAIGN,
        adName: "Old ad",
        spend: 5,
        leads: 0,
        metaAdId: "990000001",
        thumbnailUrl: cdnUrl("sb"),
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
      {
        campaignName: CAMPAIGN,
        adName: "No id",
        spend: 5,
        leads: 0,
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
      {
        campaignName: "Off board",
        adName: "x",
        spend: 5,
        leads: 0,
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
    ],
    metaTree: [
      {
        campaignName: CAMPAIGN,
        kind: "adset",
        metaId: "8001",
        name: "Set",
        status: "ACTIVE",
        syncedAt: T0,
      },
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: AD,
        name: "Video 1",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        adsetId: "8001",
        accountId: ACCT,
        creativeId: CR,
        stillKey: `c:${CR}`,
        thumbUrl: cdnUrl("t1"),
        syncedAt: T0,
      },
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: AD2,
        name: "Paused one",
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        adsetId: "8001",
        accountId: ACCT,
        creativeId: "120212000000000002",
        stillKey: "c:120212000000000002",
        syncedAt: T0,
      },
    ],
    adChanges: [],
    checks: [],
    inbox: [],
  });
  const store = (args: Any) => cx.run("mutation", internal.sync.store, args);

  test("first run: asks for the missing stills, live ads first", async () => {
    const r = await store(base());
    expect(r).toMatchObject({ campaigns: 1, ads: 3, offBoard: 0 });
    expect(r.missingStills).toEqual([
      {
        adId: AD,
        creativeId: CR,
        accountId: ACCT,
        campaignName: CAMPAIGN,
        sourceUrl: cdnUrl("t1"),
      },
      {
        adId: AD2,
        creativeId: "120212000000000002",
        accountId: ACCT,
        campaignName: CAMPAIGN,
      },
      { adId: "990000001", campaignName: CAMPAIGN, sourceUrl: cdnUrl("sb") },
    ]);
    const ads = Object.fromEntries(
      cx.db.all("ads").map((a: Any) => [a.adName, a]),
    );
    expect(ads["Old ad"].stillKey).toBe("a:990000001");
    expect(ads["No id"].stillKey).toBeUndefined();
    const run = cx.db.all("syncRuns")[0];
    expect(run.health).toMatchObject({
      treeAds: 2,
      treeWithPicture: 1,
      ads: 3,
      adsWithCreative: 2,
      stillsWanted: 3,
    });
    expect(run.problems).toContain("Only 1 of 2 ads have a picture.");
    expect(JSON.stringify(cx.db.all("metaTree"))).not.toContain("previewSrc");
  });

  test("with saved stills: rows get the links, nothing is asked twice, unchanged rows are not rewritten", async () => {
    await store(base());
    cx.db.seed("adStills", [
      {
        key: `c:${CR}`,
        status: "saved",
        url: "https://s/full",
        tinyUrl: "https://s/tiny",
        attempts: 0,
        lastTriedAt: T0,
        savedAt: T0,
      },
      {
        key: "c:120212000000000002",
        status: "failed",
        attempts: 0,
        lastTriedAt: T0 - 60_000,
      },
      { key: "a:990000001", status: "gone", attempts: 0, lastTriedAt: T0 },
    ]);
    cx.db.writes = [];
    const r = await store(base());
    // The failed one is inside its 15-minute claim; the gone one is final.
    expect(r.missingStills).toEqual([]);
    const tree = Object.fromEntries(
      cx.db.all("metaTree").map((t: Any) => [t.metaId, t]),
    );
    expect(tree[AD]).toMatchObject({
      stillUrl: "https://s/full",
      stillTinyUrl: "https://s/tiny",
    });
    const ads = Object.fromEntries(
      cx.db.all("ads").map((a: Any) => [a.adName, a]),
    );
    expect(ads["Video 1"]).toMatchObject({
      stillUrl: "https://s/full",
      stillTinyUrl: "https://s/tiny",
    });
    // Only the ad row whose picture changed is rewritten in the tree.
    expect(cx.db.writes.filter(w => w.endsWith("metaTree"))).toEqual([
      "replace metaTree",
    ]);

    // Third run, nothing changed: no tree writes and no still lookups.
    cx.db.writes = [];
    cx.db.reads = [];
    setSystemTime(new Date(T0 + 20 * 60_000));
    const r3 = await store(base());
    expect(cx.db.writes.filter(w => w.endsWith("metaTree"))).toEqual([]);
    // c:...002 is due again (claim ran out), and is looked up again; the saved key is not.
    expect(r3.missingStills.map((m: Any) => m.adId)).toEqual([AD2]);
    expect(cx.db.reads.filter(x => x === "adStills.by_key")).toHaveLength(2);
  });

  test("a re-signed Meta picture link is not a change while the old one has a day left", async () => {
    await store(base());
    const resigned = (hours: number) => {
      const args = base();
      args.metaTree[1].thumbUrl = cdnUrl("t1", T0 + hours * HOUR);
      return args;
    };
    cx.db.writes = [];
    await store(resigned(80));
    expect(cx.db.writes.filter(w => w.endsWith("metaTree"))).toEqual([]);
    expect(
      cx.db.all("metaTree").find((t: Any) => t.metaId === AD).thumbUrl,
    ).toBe(cdnUrl("t1"));
    // Two days on, the stored link has under a day left: the new one is written.
    setSystemTime(new Date(T0 + 50 * HOUR));
    await store(resigned(120));
    expect(
      cx.db.all("metaTree").find((t: Any) => t.metaId === AD).thumbUrl,
    ).toBe(cdnUrl("t1", T0 + 120 * HOUR));
    // A different creative always takes its own link.
    const other = resigned(200);
    other.metaTree[1].creativeId = "120212000000000009";
    other.metaTree[1].stillKey = "c:120212000000000009";
    await store(other);
    expect(
      cx.db.all("metaTree").find((t: Any) => t.metaId === AD).thumbUrl,
    ).toBe(cdnUrl("t1", T0 + 200 * HOUR));
  });

  test("tree diff: removed rows deleted, new rows inserted, old preview links dropped", async () => {
    cx.db.seed("metaTree", [
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: AD,
        name: "Video 1",
        status: "ACTIVE",
        previewSrc: "https://old",
        previewAt: T0 - 30 * HOUR,
        syncedAt: T0 - HOUR,
      },
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: "5550001",
        name: "Gone",
        status: "ACTIVE",
        syncedAt: T0 - HOUR,
      },
    ]);
    await store(base());
    const tree = cx.db.all("metaTree");
    expect(tree.map((t: Any) => t.metaId).sort()).toEqual(
      ["8001", AD, AD2].sort(),
    );
    expect(tree.find((t: Any) => t.metaId === AD).previewSrc).toBeUndefined();
    expect(tree.find((t: Any) => t.metaId === AD).previewAt).toBeUndefined();
  });

  test("an ad that dropped out keeps its id and picture from the last run", async () => {
    cx.db.seed("ads", [
      {
        campaignName: CAMPAIGN,
        adName: "No id",
        spend: 1,
        leads: 0,
        metaAdId: "990000002",
        stillKey: "c:77",
        stillUrl: "https://s/77",
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
    ]);
    const r = await store(base());
    const ad = cx.db.all("ads").find((a: Any) => a.adName === "No id");
    expect(ad).toMatchObject({
      metaAdId: "990000002",
      stillKey: "c:77",
      stillUrl: "https://s/77",
    });
    expect(r.missingStills.some((m: Any) => m.adId === "990000002")).toBe(
      false,
    );
  });

  test("capped at 30, active first", async () => {
    const args = base();
    args.metaTree = [];
    for (let i = 0; i < 40; i++)
      args.metaTree.push({
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: String(700000 + i),
        name: `a${i}`,
        status: i % 2 ? "ACTIVE" : "PAUSED",
        creativeId: String(800000 + i),
        stillKey: `c:${800000 + i}`,
        syncedAt: T0,
      });
    const r = await store(args);
    expect(r.missingStills).toHaveLength(30);
    expect(
      r.missingStills.slice(0, 20).every((m: Any) => Number(m.adId) % 2 === 1),
    ).toBe(true);
  });

  test("zero campaigns keeps the old snapshot", async () => {
    await store(base());
    const r = await store({ ...base(), campaigns: [] });
    expect(r).toEqual({
      campaigns: 1,
      ads: 0,
      offBoard: -1,
      missingStills: [],
    });
    expect(cx.db.all("ads")).toHaveLength(3);
  });

  test("exportAdPerformance and previewCoverage carry pictures, not preview links", async () => {
    await store(base());
    cx.db.seed("adStills", [
      {
        key: "c:z",
        status: "saved",
        url: "u",
        attempts: 0,
        lastTriedAt: T0,
        savedAt: T0 + 5,
      },
    ]);
    const out = await cx.run("query", internal.sync.exportAdPerformance, {});
    expect(out.latestStillAt).toBe(T0 + 5);
    expect(JSON.stringify(out)).not.toContain("previewSrc");
    expect(out.ads[0]).toMatchObject({ metaAdId: AD, stillKey: `c:${CR}` });
    expect(out.tree.find((t: Any) => t.metaId === AD)).toMatchObject({
      accountId: ACCT,
      creativeId: CR,
      stillKey: `c:${CR}`,
    });
    const cov = await cx.run("query", internal.sync.previewCoverage, {});
    expect(cov).toEqual({
      perfAds: 3,
      perfWithPicture: 2,
      perfWithSavedStill: 0,
      treeAds: 2,
      treeWithPicture: 1,
      treeWithSavedStill: 0,
      treeWithUsableThumb: 1,
    });
  });
});

// ---------------------------------------------------------------- feeds

describe("bridge payloads", () => {
  test("winnerRows: saved and unsaved first and never cut, then cheapest, 500 in all", async () => {
    const rows = [];
    for (let i = 0; i < 520; i++)
      rows.push({
        adId: String(100000 + i),
        adName: `a${i}`,
        client: "c",
        format: "video",
        spend: 100,
        leads: 10,
        cpl: 1000 - i,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        previewSrc: "https://old",
      });
    rows.push({
      adId: "9000001",
      adName: "saved",
      client: "c",
      format: "video",
      spend: 100,
      leads: 1,
      cpl: 5000,
      firstArchivedAt: T0,
      lastSeenAt: T0,
      origin: "manual",
      savedBy: "nada@maharamedia.com",
      savedByName: "Nada",
      savedAt: T0,
      savedNote: "Price first",
      savedRange: { start: "2026-09-01", end: "2026-09-15" },
      savedStats: { spend: 100, leads: 1, cpl: 100 },
      stillUrl: "https://s/1",
      stillKey: "c:1",
      creativeId: "1",
      accountId: "2",
      campaignName: CAMPAIGN,
    });
    rows.push({
      adId: "9000002",
      adName: "unsaved",
      client: "c",
      format: "video",
      spend: 100,
      leads: 1,
      cpl: 6000,
      firstArchivedAt: T0,
      lastSeenAt: T0,
      origin: "manual",
      savedAt: T0 - 10,
      unsavedAt: T0,
      unsavedBy: "x@y.z",
    });
    cx.db.seed("winnersArchive", rows);
    const out = await cx.run("query", internal.fanout.winnerRows, {});
    expect(out).toHaveLength(500);
    expect(out[0]).toEqual({
      adId: "9000001",
      adName: "saved",
      client: "c",
      format: "video",
      spend: 100,
      leads: 1,
      cpl: 5000,
      origin: "manual",
      savedBy: "nada@maharamedia.com",
      savedByName: "Nada",
      savedAt: T0,
      savedNote: "Price first",
      savedRange: { start: "2026-09-01", end: "2026-09-15" },
      savedStats: { spend: 100, leads: 1, cpl: 100 },
      stillUrl: "https://s/1",
      stillKey: "c:1",
      creativeId: "1",
      accountId: "2",
    });
    expect(out[1].adId).toBe("9000002");
    expect(out[1].unsavedAt).toBe(T0);
    expect(out[2].cpl).toBe(481);
    expect(JSON.stringify(out)).not.toContain("previewSrc");
    expect(JSON.stringify(out)).not.toContain("campaignName");
  });

  test("rawPlays drops preview links from old rows", async () => {
    cx.db.seed("marketPlays", [
      {
        adsetId: "1",
        adsetName: "s",
        client: "c",
        accountId: "2",
        serviceLine: "x",
        playType: "broad",
        interests: [],
        spend: 1,
        leads: 1,
        windowDays: 90,
        syncedAt: T0,
        creatives: [
          {
            adId: "3",
            adName: "a",
            format: "video",
            previewSrc: "https://old",
            thumbUrl: "t",
            creativeId: "4",
            stillKey: "c:4",
            spend: 1,
            leads: 1,
          },
        ],
      },
    ]);
    const out = await cx.run("query", internal.fanout.rawPlays, {});
    expect(out[0].creatives[0]).toEqual({
      adId: "3",
      adName: "a",
      format: "video",
      thumbUrl: "t",
      creativeId: "4",
      stillKey: "c:4",
      spend: 1,
      leads: 1,
    });
    expect(out[0]._id).toBeUndefined();
  });

  test("metaTreeForCsm: stills and ids, usable Meta pictures only, and the newest still", async () => {
    seedTreeAd({
      thumbUrl: cdnUrl("old", T0 - HOUR),
      stillUrl: "https://s/1",
      previewSrc: "https://old",
    });
    cx.db.seed("metaTree", [
      {
        campaignName: CAMPAIGN,
        kind: "ad",
        metaId: AD2,
        name: "b",
        status: "ACTIVE",
        thumbUrl: cdnUrl("good"),
        syncedAt: T0,
      },
    ]);
    const out = await cx.run("query", internal.csmSync.metaTreeForCsm, {});
    expect(out.latestStillAt).toBe(0);
    const byId = Object.fromEntries(out.tree.map((t: Any) => [t.metaId, t]));
    expect(byId[AD]).toMatchObject({
      accountId: ACCT,
      stillKey: `c:${CR}`,
      stillUrl: "https://s/1",
    });
    expect(byId[AD].thumbUrl).toBeUndefined();
    expect(byId[AD2].thumbUrl).toBe(cdnUrl("good"));
    expect(JSON.stringify(out)).not.toContain("previewSrc");
  });
});

// ---------------------------------------------------------------- other readers

describe("other readers", () => {
  test("gate.check resolves a Meta id through the by_meta index", async () => {
    seedCampaign();
    seedTreeAd();
    const uid = seedUser("scoped@maharamedia.com");
    seedMember("scoped@maharamedia.com", ["media_buyer"], ["acme"]);
    expect(
      await cx.run("query", internal.gate.check, {
        userId: uid,
        role: "media_buyer",
        metaId: AD,
      }),
    ).toBe("");
    expect(
      await cx.run("query", internal.gate.check, {
        userId: uid,
        role: "media_buyer",
        metaId: AD2,
      }),
    ).toContain("not on your list");
    expect(cx.db.reads).toContain("metaTree.by_meta");
  });

  test("cockpit.winners returns stills and ids, never preview links", async () => {
    seedCampaign({ serviceType: "Kitchens" });
    cx.db.seed("ads", [
      {
        campaignName: CAMPAIGN,
        adName: "Video 1",
        spend: 100,
        leads: 10,
        cpl: 10,
        metaAdId: AD,
        previewSrc: "https://old",
        thumbnailUrl: "t",
        stillKey: "c:1",
        stillUrl: "https://s/1",
        stillTinyUrl: "https://s/2",
        verdict: "ok",
        reason: "ok",
        syncedAt: T0,
      },
    ]);
    const uid = seedUser("nada@maharamedia.com");
    seedMember("nada@maharamedia.com", ["media_buyer"], []);
    cx.identity = { subject: `${uid}|s` };
    const out = await cx.run("query", "cockpit:winners", {
      serviceType: "Kitchens",
    });
    expect(out.sameLine).toHaveLength(1);
    expect(out.sameLine[0]).toMatchObject({
      metaAdId: AD,
      accountId: ACCT,
      stillKey: "c:1",
      stillUrl: "https://s/1",
      stillTinyUrl: "https://s/2",
      thumbnailUrl: "t",
    });
    expect(JSON.stringify(out)).not.toContain("previewSrc");
  });
});

// ---------------------------------------------------------------- smoke check

describe("smoke check runs the preview check once a day", () => {
  async function runSmoke(at: number) {
    setSystemTime(new Date(at));
    process.env.CSM_BRIDGE_URL = "https://csm.fake";
    process.env.CREATIVE_BRIDGE_URL = "https://creative.fake";
    web.routes.unshift(url =>
      url.host === "csm.fake" || url.host === "creative.fake"
        ? json({
            ok: true,
            data: {
              app: url.host.split(".")[0],
              ok: true,
              checks: [{ name: "screen", ok: true }],
            },
          })
        : undefined,
    );
    const smoke = await import(`${APP}/smoke.ts`);
    const portal = await import(`${APP}/portal.ts`);
    const askAi = await import(`${APP}/askAi.ts`);
    const fixRequests = await import(`${APP}/fixRequests.ts`);
    const c = new FakeConvex({
      ...modules(),
      smoke,
      portal,
      askAi,
      fixRequests,
    });
    c.storage = cx.storage;
    c.db = cx.db;
    return { out: await c.run("action", internal.smoke.check, {}), c };
  }

  test("03:07 UTC: preview lines join the media buyer checks", async () => {
    cx.db.seed("winnersArchive", [
      {
        adId: "100009",
        adName: "a",
        client: "Acme",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
      },
    ]);
    const { out, c } = await runSmoke(Date.UTC(2026, 8, 16, 3, 7, 5));
    const mb = out.results.find((r: Any) => r.app === "media-buyer");
    expect(mb.checks.map((x: Any) => x.name)).toEqual([
      "cockpit.snapshot",
      "previews saved pictures load",
      "previews winners with a picture",
      "previews live ads with a picture",
      "previews storage",
    ]);
    expect(mb.ok).toBe(false);
    expect(out.failures).toEqual([
      {
        app: "media-buyer",
        name: "previews winners with a picture",
        error: "1 of 1 winners have no saved picture (1 not tried)",
      },
    ]);
    const rec = cx.db
      .all("cockpitHealth")
      .find((h: Any) => h.app === "media-buyer");
    expect(rec.ok).toBe(false);
    expect(rec.checks).toHaveLength(5);
    expect(
      cx.db.all("sourceHealth").find((h: Any) => h.source === "previews"),
    ).toMatchObject({ ok: false });
    expect(c.calls).toContain("previews:rotStats");
    expect(c.calls).toContain("previews:cleanup");
  });

  test("any other run: no preview lines, no extra calls", async () => {
    const { out, c } = await runSmoke(Date.UTC(2026, 8, 16, 3, 22, 5));
    const mb = out.results.find((r: Any) => r.app === "media-buyer");
    expect(mb.checks.map((x: Any) => x.name)).toEqual(["cockpit.snapshot"]);
    expect(mb.ok).toBe(true);
    expect(c.calls.some(x => x.startsWith("previews:"))).toBe(false);
  });
});

describe("winners line wording", () => {
  test("saved but not linked yet, and not tried", async () => {
    cx.db.seed("winnersArchive", [
      {
        adId: "100011",
        adName: "a",
        client: "c",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        stillKey: "c:11",
      },
      {
        adId: "100012",
        adName: "b",
        client: "c",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
      },
      {
        adId: "100013",
        adName: "c",
        client: "c",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        stillKey: "c:13",
      },
      {
        adId: "100014",
        adName: "d",
        client: "c",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        stillKey: "c:14",
      },
    ]);
    cx.db.seed("adStills", [
      {
        key: "c:11",
        status: "saved",
        url: "u",
        attempts: 0,
        lastTriedAt: T0,
        savedAt: T0,
      },
      { key: "c:13", status: "gone", attempts: 0, lastTriedAt: T0 },
      { key: "c:14", status: "gone", attempts: 0, lastTriedAt: T0 },
    ]);
    web.routes.unshift(url =>
      url.href === "https://fake-deployment.convex.cloud/u"
        ? image(300)
        : undefined,
    );
    const r = await previews.runRotCheck(cx.actionCtx() as Any);
    const w = r.checks.find(
      (c: Any) => c.name === "previews winners with a picture",
    );
    expect(w.error).toBe(
      "2 of 4 winners have no saved picture (1 not tried, 1 saved but not linked yet; 2 more were deleted in Meta before we saved them)",
    );
  });

  test("only deleted ones: reported in the log, the check passes", async () => {
    cx.db.seed("winnersArchive", [
      {
        adId: "100013",
        adName: "c",
        client: "c",
        format: "video",
        spend: 1,
        leads: 1,
        cpl: 1,
        firstArchivedAt: T0,
        lastSeenAt: T0,
        stillKey: "c:13",
      },
    ]);
    cx.db.seed("adStills", [
      { key: "c:13", status: "gone", attempts: 0, lastTriedAt: T0 },
    ]);
    const r = await previews.runRotCheck(cx.actionCtx() as Any);
    expect(
      r.checks.find((c: Any) => c.name === "previews winners with a picture"),
    ).toEqual({
      name: "previews winners with a picture",
      ok: true,
    });
  });
});
