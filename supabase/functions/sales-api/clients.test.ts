import { describe, expect, test } from "bun:test";
import {
  CLIENT_DRAFT_CLOSED,
  CLIENT_REFUSAL,
  clientDraftClosed,
  clientFacts,
  clientRefusal,
  DEAL_COLS,
  isClient,
  readClient,
  SIGNED_DRAFT_CLOSED,
  SIGNED_REFUSAL,
} from "./clients.ts";

type Row = Record<string, unknown>;

describe("isClient", () => {
  test("the client tag, as HighLevel keeps it", () => {
    expect(isClient({ tags: ["roas-qualified", "client"] })).toBe(true);
  });
  test("any case or stray spaces", () => {
    expect(isClient({ tags: [" Client "] })).toBe(true);
  });
  test("a tag that only contains the word is not the tag", () => {
    expect(isClient({ tags: ["client-referral", "ex client", "clients"] })).toBe(false);
  });
  test("no tags, no lead, tags not a list", () => {
    expect(isClient({ tags: null })).toBe(false);
    expect(isClient({})).toBe(false);
    expect(isClient(null)).toBe(false);
    expect(isClient(undefined)).toBe(false);
    expect(isClient({ tags: "client" })).toBe(false);
  });
});

const deal = (over: Row = {}): Row => ({
  contact_id: "c-1",
  submitted_at: "2026-10-09T18:46:19Z",
  closer: "Ahmed Abushaiba",
  setter: "تحرير عبادي",
  contracted_revenue: 6000,
  voided: false,
  ...over,
});

describe("clientFacts: a client is the tag or a live deal", () => {
  test("neither: not a client, nothing known", () => {
    expect(clientFacts({ contact_id: "c-1", tags: ["roas-qualified"] }, [])).toEqual({
      client: false,
      why: null,
      signed_at: null,
      closer: null,
      setter: null,
      value: null,
    });
  });

  test("the tag only: a client, with no signed date or value (missing, never zero)", () => {
    const f = clientFacts({ contact_id: "c-1", tags: ["client"] }, []);
    expect(f).toEqual({ client: true, why: "tag", signed_at: null, closer: null, setter: null, value: null });
  });

  test("a deal only: a client by the deal, with its date, value, closer and setter", () => {
    const f = clientFacts({ contact_id: "c-1", tags: [] }, [deal()]);
    expect(f).toEqual({
      client: true,
      why: "deal",
      signed_at: "2026-10-09T18:46:19.000Z",
      closer: "Ahmed Abushaiba",
      setter: "تحرير عبادي",
      value: 6000,
    });
  });

  test("both: the tag is why (HighLevel's word), the deal still gives the date", () => {
    const f = clientFacts({ contact_id: "c-1", tags: ["Client"] }, [deal()]);
    expect(f.why).toBe("tag");
    expect(f.signed_at).toBe("2026-10-09T18:46:19.000Z");
  });

  test("a voided deal never makes a client", () => {
    expect(clientFacts({ contact_id: "c-1", tags: [] }, [deal({ voided: true })]).client).toBe(false);
  });

  test("the newest live deal speaks; a voided newer one is passed over", () => {
    const f = clientFacts({ contact_id: "c-1" }, [
      deal({ submitted_at: "2026-09-01T10:00:00Z", closer: "Maria", contracted_revenue: 3000 }),
      deal({ submitted_at: "2026-10-05T10:00:00Z", closer: "Aziz Waheedi", contracted_revenue: 9000 }),
      deal({ submitted_at: "2026-10-10T10:00:00Z", closer: "Voided Rep", voided: true }),
    ]);
    expect([f.closer, f.value, f.signed_at]).toEqual(["Aziz Waheedi", 9000, "2026-10-05T10:00:00.000Z"]);
  });

  test("a deal that names another contact is not this lead's", () => {
    expect(clientFacts({ contact_id: "c-1" }, [deal({ contact_id: "c-2" })]).client).toBe(false);
  });

  test("no lead row (a contact the copy lacks): its deals still make it a client", () => {
    expect(clientFacts(null, [deal()]).why).toBe("deal");
  });

  test("a value the form left out, or not a number, is unknown, not zero", () => {
    expect(clientFacts({ contact_id: "c-1" }, [deal({ contracted_revenue: null })]).value).toBeNull();
    expect(clientFacts({ contact_id: "c-1" }, [deal({ contracted_revenue: "" })]).value).toBeNull();
    expect(clientFacts({ contact_id: "c-1" }, [deal({ contracted_revenue: "n/a" })]).value).toBeNull();
    expect(clientFacts({ contact_id: "c-1" }, [deal({ contracted_revenue: "4500" })]).value).toBe(4500);
  });

  test("an unreadable date leaves signed_at unknown but the client stands", () => {
    const f = clientFacts({ contact_id: "c-1" }, [deal({ submitted_at: null })]);
    expect([f.client, f.signed_at]).toEqual([true, null]);
  });

  test("blank names are unknown", () => {
    const f = clientFacts({ contact_id: "c-1" }, [deal({ closer: "  ", setter: null })]);
    expect([f.closer, f.setter]).toEqual([null, null]);
  });
});

describe("readClient", () => {
  function fakeSvc(tables: Record<string, Row[]>, fail?: string) {
    const paths: string[] = [];
    const svc = async (path: string): Promise<Row[]> => {
      paths.push(path);
      if (fail && path.startsWith(fail)) throw new Error("database 503: unavailable");
      const [table, query] = path.split("?");
      const id = decodeURIComponent(/contact_id=eq\.([^&]+)/.exec(query ?? "")?.[1] ?? "");
      return (tables[table as string] ?? []).filter(r => r.contact_id === id && (table !== "cockpit_sales_deals" || r.voided === false));
    };
    return { svc, paths };
  }

  test("reads the lead's tags and its live deals, by contact id", async () => {
    const { svc, paths } = fakeSvc({
      cockpit_sales_leads: [{ contact_id: "c 1", tags: [] }],
      cockpit_sales_deals: [deal({ contact_id: "c 1" }), deal({ contact_id: "c 1", voided: true })],
    });
    const f = await readClient(svc, "c 1");
    expect(f.why).toBe("deal");
    expect(paths).toContain("cockpit_sales_leads?contact_id=eq.c%201&select=contact_id,tags");
    expect(paths.find(p => p.startsWith("cockpit_sales_deals"))).toBe(
      `cockpit_sales_deals?contact_id=eq.c%201&voided=eq.false&select=${DEAL_COLS}&order=submitted_at.desc&limit=20`,
    );
  });

  test("a lead row the caller holds is not read again", async () => {
    const { svc, paths } = fakeSvc({ cockpit_sales_deals: [] });
    const f = await readClient(svc, "c-1", { contact_id: "c-1", tags: ["client"] });
    expect(f.why).toBe("tag");
    expect(paths.some(p => p.startsWith("cockpit_sales_leads"))).toBe(false);
  });

  test("the caller's lead may be missing (null): the deals still count", async () => {
    const { svc } = fakeSvc({ cockpit_sales_deals: [deal()] });
    expect((await readClient(svc, "c-1", null)).client).toBe(true);
  });

  test("a failed read throws: a gate never takes it for 'not a client'", async () => {
    const { svc } = fakeSvc({ cockpit_sales_leads: [{ contact_id: "c-1", tags: [] }] }, "cockpit_sales_deals");
    await expect(readClient(svc, "c-1")).rejects.toThrow("database 503");
  });
});

describe("the words for why", () => {
  test("the tag keeps the words the team knows; a deal says the form", () => {
    expect(clientRefusal({ why: "tag" })).toBe(CLIENT_REFUSAL);
    expect(clientRefusal({ why: "deal" })).toBe(SIGNED_REFUSAL);
    expect(clientDraftClosed({ why: "tag" })).toBe(CLIENT_DRAFT_CLOSED);
    expect(clientDraftClosed({ why: "deal" })).toBe(SIGNED_DRAFT_CLOSED);
    expect(SIGNED_REFUSAL).toContain("New Client Form");
  });
  test("no dashes in the words", () => {
    for (const s of [CLIENT_REFUSAL, SIGNED_REFUSAL, CLIENT_DRAFT_CLOSED, SIGNED_DRAFT_CLOSED]) expect(s).not.toMatch(/[–—]/);
  });
});
