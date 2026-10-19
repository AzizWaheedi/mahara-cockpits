import { describe, expect, test } from "bun:test";
import { runRefresh } from "./worker.ts";

/**
 * The Ads tab's live on and off (the CEO, 2026-10-19) through the real worker
 * and the real provider driver, with every request answered here. A failed
 * read of Meta's campaign, ad set and ad lists has to leave the section
 * publishing on the snapshot rule with its note. The adapter catches the
 * error, but the driver also leaves a receipt for it, and the worker fails a
 * section on any failed receipt under its key (worker.ts), as the publish
 * function refuses one (20261007e_cockpit_provider_rpc_restore.sql). So these
 * reads are receipted as "b2bAds:optional" (providerTools.ts withOptionalReads).
 * Every id here is made up.
 */

type Receipt = { provider: string; method: string; resource: string; phase: string; http_status: number | null; error?: string; section?: string };
type Publication = {
  sections: { key: string; payload: Record<string, any>; sources: { name: string; ok: boolean }[] }[];
  failures: { key: string; error: string }[];
  receipts: Receipt[];
};

const ACT = "act_746108264865897";
const ENV = {
  SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  SUPABASE_ACCESS_TOKEN: "test",
  SUPABASE_SERVICE_ROLE_KEY: "test",
  META_SYSTEM_TOKEN: "test",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const LISTS: Record<string, unknown[]> = {
  campaigns: [{ id: "900000000000101", name: "MaharaMedia | Lead Gen | 19-10-26", status: "ACTIVE", configured_status: "ACTIVE", effective_status: "ACTIVE" }],
  adsets: [{ id: "900000000000201", name: "Kuwait founders", status: "ACTIVE", configured_status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "900000000000101" }],
  ads: [{ id: "900000000000301", name: "Founder story", status: "ACTIVE", configured_status: "ACTIVE", effective_status: "ACTIVE", adset_id: "900000000000201", campaign_id: "900000000000101" }],
};

/**
 * Runs b2bAds through runRefresh with --apply semantics against fakes: the
 * B2B SQL answers no rows, the account and insights answer empty, and
 * `answer` decides each status list (`n` counts that list's requests).
 */
async function refresh(answer: (edge: string, n: number) => Response | Promise<Response>, account?: (n: number) => Response) {
  let publication: Publication | null = null;
  const counts: Record<string, number> = {};
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.supabase.com") return json([]);
    if (url.hostname === "graph.facebook.com") {
      const path = url.pathname.replace("/v21.0/", "");
      const edge = new RegExp(`^${ACT}/(campaigns|adsets|ads)$`).exec(path)?.[1];
      if (edge) {
        counts[edge] = (counts[edge] ?? 0) + 1;
        return answer(edge, counts[edge]);
      }
      if (path.endsWith("/insights")) return json({ data: [], paging: {} });
      counts.account = (counts.account ?? 0) + 1;
      return account ? account(counts.account) : json({ account_status: 1, currency: "USD", timezone_name: "Asia/Kuwait" });
    }
    const rpc = url.pathname.split("/").pop();
    if (rpc === "cockpit_ceo_refresh_claim")
      return json({ run_id: "11111111-1111-4111-8111-111111111111", lease_token: "22222222-2222-4222-8222-222222222222", status: "claimed", revision: 1 });
    if (rpc === "cockpit_ceo_refresh_publish") {
      publication = JSON.parse(String(init?.body)).p_publication;
      return json({ status: "published", revision: 2 });
    }
    return json({});
  }) as typeof fetch;
  const report = await runRefresh({ apply: true, only: ["b2bAds"], fetcher, env: ENV });
  return { report, publication: publication as Publication | null, counts };
}

/** The publish function's evidence rule for one section (20261007e, cockpit_ceo_refresh_publish). */
const publishable = (p: Publication, key: string) =>
  p.receipts.some(r => r.section === key && r.phase === "response" && r.http_status !== null && r.http_status >= 200 && r.http_status <= 299) &&
  !p.receipts.some(r => r.section === key && r.phase === "failure");

const listReceipts = (p: Publication) => p.receipts.filter(r => /\/(campaigns|adsets|ads)$/.test(r.resource));
const section = (p: Publication | null) => {
  const found = p?.sections.find(s => s.key === "b2bAds");
  if (!found) throw new Error(`b2bAds was not published: ${JSON.stringify(p?.failures)}`);
  return found;
};

describe("Our ads through the worker: Meta's live on and off never fails the section", () => {
  test("when the three lists answer, on and off is Meta's, and their receipts are the optional reads'", async () => {
    const { report, publication } = await refresh(edge => json({ data: LISTS[edge], paging: {} }));
    expect(report.sections).toEqual([expect.objectContaining({ key: "b2bAds", status: "computed" })]);
    const s = section(publication);
    expect(s.payload.statusFrom).toBe("meta");
    expect(typeof s.payload.statusReadAt).toBe("number");
    // On in Meta with no snapshot: on the tab at $0, switchable.
    const ad = s.payload.campaigns[0].adsets[0].ads[0];
    expect(ad).toMatchObject({ id: "900000000000301", running: true, switchOn: true, delivered: false });
    expect(listReceipts(publication!).map(r => [r.resource.split("/").pop(), r.phase, r.http_status, r.section])).toEqual([
      ["campaigns", "response", 200, "b2bAds:optional"],
      ["adsets", "response", 200, "b2bAds:optional"],
      ["ads", "response", 200, "b2bAds:optional"],
    ]);
    expect(publishable(publication!, "b2bAds")).toBe(true);
    expect(publication!.failures).toEqual([]);
  });

  test("a Meta rate limit (HTTP 400, code 17) on a list: the snapshot rule and its note, published", async () => {
    const { report, publication } = await refresh(edge =>
      edge === "campaigns" ? json({ error: { code: 17, message: "User request limit reached" } }, 400) : json({ data: LISTS[edge], paging: {} }),
    );
    expect(report.status).toBe("published");
    expect(report.sections).toEqual([expect.objectContaining({ key: "b2bAds", status: "computed" })]);
    const s = section(publication);
    expect(s.payload.statusFrom).toBe("snapshots");
    expect(s.payload.statusReadAt).toBeNull();
    const warn = s.payload.notes.find((n: { level: string; text: string }) => n.level === "warn" && n.text.startsWith("Meta's own on and off could not be read"));
    expect(warn?.text).toContain(`meta returned HTTP 400 for graph.facebook.com/v21.0/${ACT}/campaigns`);
    expect(warn?.text).toContain("so the switches show delivery, not Meta's setting");
    expect(s.sources.every(x => x.ok === true)).toBe(true);
    // The failure still reaches the health ledger, as a failure, never as the section's own.
    expect(listReceipts(publication!).map(r => [r.phase, r.http_status, r.section])).toEqual([
      ["response", 400, "b2bAds:optional"],
      ["failure", 400, "b2bAds:optional"],
    ]);
    expect(publication!.receipts.some(r => r.section === "b2bAds" && r.phase === "failure")).toBe(false);
    expect(publishable(publication!, "b2bAds")).toBe(true);
    expect(publication!.failures).toEqual([]);
  });

  test("one HTTP 500 retried to 200 is Meta's answer, and the retried 500 fails nothing", async () => {
    const { report, publication, counts } = await refresh((edge, n) =>
      edge === "ads" && n === 1 ? json({ error: { code: 1 } }, 500) : json({ data: LISTS[edge], paging: {} }),
    );
    expect(counts.ads).toBe(2);
    expect(report.sections).toEqual([expect.objectContaining({ key: "b2bAds", status: "computed" })]);
    expect(section(publication).payload.statusFrom).toBe("meta");
    expect(listReceipts(publication!).filter(r => r.resource.endsWith("/ads")).map(r => [r.phase, r.http_status, r.section])).toEqual([
      ["response", 500, "b2bAds:optional"],
      ["response", 200, "b2bAds:optional"],
    ]);
    expect(publishable(publication!, "b2bAds")).toBe(true);
  });

  test("a network failure on every try: the snapshot rule, with a failure receipt and no status", async () => {
    const { report, publication, counts } = await refresh(edge => {
      if (edge === "adsets") throw new TypeError("fetch failed");
      return json({ data: LISTS[edge], paging: {} });
    });
    expect(counts.adsets).toBe(3);
    expect(report.sections).toEqual([expect.objectContaining({ key: "b2bAds", status: "computed" })]);
    expect(section(publication).payload.statusFrom).toBe("snapshots");
    expect(listReceipts(publication!).filter(r => r.phase === "failure")).toEqual([
      expect.objectContaining({ resource: `graph.facebook.com/v21.0/${ACT}/adsets`, http_status: null, section: "b2bAds:optional" }),
    ]);
    expect(publishable(publication!, "b2bAds")).toBe(true);
  }, 15_000);

  test("the section's own reads keep the strict rule: a retried 500 on the account read still fails it", async () => {
    const { report, publication } = await refresh(
      edge => json({ data: LISTS[edge], paging: {} }),
      n => (n === 1 ? json({ error: { code: 1 } }, 500) : json({ account_status: 1, currency: "USD", timezone_name: "Asia/Kuwait" })),
    );
    expect(report.sections).toEqual([expect.objectContaining({ key: "b2bAds", status: "failed" })]);
    expect(report.sections[0].error).toContain(`meta provider did not confirm graph.facebook.com/v21.0/${ACT}`);
    expect(publication?.sections ?? []).toEqual([]);
  });
});
