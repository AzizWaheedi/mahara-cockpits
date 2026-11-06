// bun test supabase/functions/sales-mirror/intake.test.ts
//
// New leads within a minute, and the ROAS tag that lands after the first
// read (2026-11-05). Pure parts only: no network, no database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DIRECT_FIELDS, ghlContactRow, latePatches, newContactRows, runMode, type StoredLead } from "./lib.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const AT = "2026-11-05T12:00:00.000Z";

const contact = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  firstName: "Lead",
  lastName: id,
  phone: "+96550001234",
  country: "KW",
  tags: [] as string[],
  dnd: false,
  dateAdded: "2026-11-05T11:59:00.000Z",
  dateUpdated: "2026-11-05T11:59:30.000Z",
  customFields: [{ id: "IvdTSSuctezX9DTHo42K", value: "$500k - $1M" }],
  ...over,
});
const fresh = (id: string, over: Record<string, unknown> = {}) => ghlContactRow(contact(id, over), AT) as Record<string, unknown>;

describe("the newest contacts of one HighLevel search", () => {
  test("only those added in the last day become lead rows", () => {
    const rows = newContactRows(
      [contact("new"), contact("old", { dateAdded: "2026-11-03T11:00:00.000Z" }), contact("none", { dateAdded: null }), { dateAdded: "2026-11-05T11:00:00.000Z" }],
      NOW,
      AT,
    );
    expect(rows.map(r => r.contact_id)).toEqual(["new"]);
    expect(rows[0]).toMatchObject({ lead_class: null, is_lead: null, pipeline_id: null, mirrored_at: AT });
  });
  test("an answer with no contacts list is no rows, never a failure", () => {
    expect(newContactRows(undefined, NOW, AT)).toEqual([]);
    expect(newContactRows({ contacts: [] }, NOW, AT)).toEqual([]);
  });
  test("every field kept in step is a column the HighLevel row fills", () => {
    const r = fresh("x");
    for (const k of DIRECT_FIELDS) expect(k in r).toBe(true);
    expect(DIRECT_FIELDS).toContain("tags");
    expect(DIRECT_FIELDS).toContain("lead_class");
    expect(DIRECT_FIELDS).toContain("revenue");
  });
});

describe("the ROAS tag that lands after the first read", () => {
  // Our own row, stored a minute ago before the tag: B2B has not copied it.
  const ours = (id: string, over: Record<string, unknown> = {}): StoredLead => {
    const { mirrored_at: _m, lead_updated_at: _u, ...r } = fresh(id);
    return { ...(r as StoredLead), is_lead: null, ...over };
  };
  // B2B's row: is_lead set, its own class from the tags B2B read.
  const b2b = (id: string, cls: string | null, tags: string[] = []): StoredLead => ({ contact_id: id, is_lead: true, lead_class: cls, tags });

  test("our row takes the tag, its class and anything else HighLevel changed, guarded on B2B not having copied it", () => {
    const out = latePatches(
      [fresh("a", { tags: ["roas-qualified", "fb-lead"], customFields: [{ id: "IvdTSSuctezX9DTHo42K", value: "$1M+" }] })],
      [ours("a")],
      AT,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ contact_id: "a", guard: "is_lead=is.null", why: "direct" });
    expect(out[0]?.body).toMatchObject({ lead_class: "qualified", tags: ["roas-qualified", "fb-lead"], revenue: "$1M+", mirrored_at: AT });
    // Never the columns only B2B knows.
    expect(out[0]?.body).not.toHaveProperty("is_lead");
    expect(out[0]?.body).not.toHaveProperty("pipeline_id");
    expect(out[0]?.body).not.toHaveProperty("lead_created_at");
  });

  test("our row with nothing new is left alone (tags in another order are the same tags)", () => {
    const stored = ours("b", { tags: ["Roas-Unqualified", "x"], lead_class: "unqualified" });
    expect(latePatches([fresh("b", { tags: ["x", "roas-unqualified"] })], [stored], AT)).toEqual([]);
  });

  test("B2B's row with no class takes HighLevel's tags and class only, guarded on the class still empty", () => {
    const out = latePatches([fresh("c", { tags: ["roas-unqualified"] })], [b2b("c", null, ["fb-lead"])], AT);
    expect(out).toEqual([
      { contact_id: "c", guard: "lead_class=is.null", body: { tags: ["roas-unqualified"], lead_class: "unqualified" }, why: "class" },
    ]);
  });

  test("B2B's row re-tagged in HighLevel (not ready, then qualified) is guarded on the class it had", () => {
    const out = latePatches([fresh("d", { tags: ["roas-qualified", "roas-unprepared"] })], [b2b("d", "unprepared", ["roas-unprepared"])], AT);
    expect(out[0]).toMatchObject({ guard: "lead_class=eq.unprepared", body: { lead_class: "qualified" } });
  });

  test("a class is never emptied here: a tag HighLevel took away waits for B2B's own copy", () => {
    expect(latePatches([fresh("e", { tags: [] })], [b2b("e", "qualified", ["roas-qualified"])], AT)).toEqual([]);
  });

  test("B2B's row already right, or a contact not stored yet (the insert takes it): nothing", () => {
    expect(latePatches([fresh("f", { tags: ["roas-qualified"] })], [b2b("f", "qualified", ["roas-qualified"])], AT)).toEqual([]);
    expect(latePatches([fresh("g", { tags: ["roas-qualified"] })], [], AT)).toEqual([]);
  });
});

describe("the minute job", () => {
  test("only the body {mode: new_contacts} runs the light step; anything else is the whole copy", () => {
    expect(runMode({ mode: "new_contacts" })).toBe("new_contacts");
    expect(runMode({})).toBe("full");
    expect(runMode(null)).toBe("full");
    expect(runMode({ mode: "everything" })).toBe("full");
    expect(runMode("new_contacts")).toBe("full");
  });

  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  test("its own lock, its worker status row, and no mirror run row a minute", () => {
    expect(src).toContain('const CONTACTS_LOCK = "sales-mirror-contacts";');
    expect(src).toContain('const lock = mode === "new_contacts" ? CONTACTS_LOCK : LOCK;');
    const body = src.slice(src.indexOf("async function runContacts()"), src.indexOf("async function run()"));
    expect(body).toContain('{ worker: "sales-mirror", job: "new_contacts", ok, detail: detail.slice(0, 500)');
    expect(body).not.toContain("cockpit_sales_mirror_runs");
    expect(body).toContain("await mirrorNewContacts(at, now)");
  });
  test("the three-minute run still copies new contacts, so intake never stops when the minute job is not scheduled", () => {
    const run = src.slice(src.indexOf("async function run()"));
    expect(run).toContain('await step("new_contacts", () => mirrorNewContacts(at, now));');
  });
  test("each late patch is guarded, so a newer row is never written over", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source's own template text, read as text
    expect(src).toContain("cockpit_sales_leads?contact_id=eq.${encodeURIComponent(p.contact_id)}&${p.guard}");
    expect(src).toContain('prefer: "resolution=ignore-duplicates,return=minimal"');
  });

  test("the cron: every minute, the mode in the body, the vault's cron secret, rescheduled cleanly", () => {
    const sql = readFileSync(new URL("../../migrations/20261105s_setter_speed_intake_cron.sql", import.meta.url), "utf8");
    expect(sql).toContain("select cron.unschedule(j.jobid) from cron.job as j where j.jobname = 'mahara-sales-new-contacts';");
    expect(sql).toContain("'mahara-sales-new-contacts',\n  '* * * * *',");
    expect(sql).toContain("url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-mirror'");
    expect(sql).toContain(`body := '{"mode":"new_contacts"}'::jsonb`);
    expect(sql).toContain("where name = 'cockpit_sync_secret'");
  });
});
