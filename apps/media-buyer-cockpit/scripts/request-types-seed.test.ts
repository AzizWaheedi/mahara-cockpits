/**
 * The request types seed (docs/requests/CONTRACT.md 2.3, section 9 "db"):
 * supabase/migrations/20261026s_request_types_seed.sql is the output of
 * scripts/gen-request-types-seed.ts over docs/requests/request-types.json,
 * byte for byte, and the JSON holds the decisions the contract makes. That
 * the database's own guard accepts every type is proved by
 * requests-supabase.test.ts, which applies the file.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildSeed,
  readSeedJson,
  SEED_NOTE,
  seedProblems,
  TEMPLATES,
} from "../../../scripts/gen-request-types-seed";
import { migration } from "./lib/cockpitTestDb";

const SEED = readSeedJson();
const type = (key: string) => {
  const t = SEED.types.find(x => x.key === key);
  if (!t) throw new Error(`No type ${key}`);
  return t;
};
const LISTS: Record<string, string> = {
  "901816723190": "tech",
  "901816723196": "ads",
  "901816723206": "call_center",
  "901816723211": "client_success",
  "901818016338": "creative",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_BUYER_TYPES = [1, 10, 13, 14, 23, 24, 26, 28];

describe("the generated migration", () => {
  test("is the generator's output over the JSON, byte for byte", () => {
    expect(migration("20261026s_request_types_seed.sql")).toBe(buildSeed(SEED));
    const raw = readFileSync(
      new URL(
        "../../../supabase/migrations/20261026s_request_types_seed.sql",
        import.meta.url,
      ),
    );
    expect(raw.equals(Buffer.from(buildSeed(SEED), "utf8"))).toBe(true);
  });

  test("inserts each thing once, never over an editor's change, inside one transaction", () => {
    const sql = buildSeed(SEED);
    expect(sql.startsWith("-- Requests: the seed")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(
      sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\nCOMMIT;"),
    ).toBe(true);
    expect(
      (sql.match(/INSERT INTO public\.cockpit_request_types /g) ?? []).length,
    ).toBe(31);
    expect(
      (
        sql.match(
          /WHERE NOT EXISTS \(SELECT 1 FROM public\.cockpit_request_types x WHERE x\.key = /g,
        ) ?? []
      ).length,
    ).toBe(31);
    expect((sql.match(/ON CONFLICT \(key\) DO NOTHING;/g) ?? []).length).toBe(
      31,
    );
    expect(sql).toContain("ON CONFLICT (clickup_field_id) DO NOTHING;");
    expect(sql).toContain("ON CONFLICT (id) DO NOTHING;");
    expect(sql).toContain("ON CONFLICT (key, version) DO NOTHING;");
    expect(sql).toContain(`'${SEED_NOTE}'`);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/);
    expect(
      (sql.match(/'2026-10-26 00:00:00\+00'::timestamptz/g) ?? []).length,
    ).toBe(24 * 2 + 34);
  });

  test("refuses a template ClickUp does not have, or one whose name differs", () => {
    const copy = structuredClone(SEED);
    copy.types[0].targets[0].template_name = "Connecting a lead form";
    copy.types[1].targets[0].template_id = "t-zzzzzzzz";
    expect(seedProblems(copy)).toEqual([
      'connect_lead_form/main: template t-86ex09tmh is "Connecting a new lead form" in ClickUp, not "Connecting a lead form".',
      "create_ad_account/meta: template t-zzzzzzzz is not in ClickUp.",
    ]);
    expect(() => buildSeed(copy)).toThrow("The seed JSON has problems");
    expect(seedProblems(SEED)).toEqual([]);
  });
});

describe("the JSON", () => {
  test("31 types, 38 parts, 24 catalog fields and the 34 templates listed in the contract", () => {
    expect(SEED.types.length).toBe(31);
    expect(SEED.types.reduce((n, t) => n + t.targets.length, 0)).toBe(38);
    expect(SEED.field_catalog.length).toBe(24);
    expect(TEMPLATES.length).toBe(34);
    expect(SEED.types.map(t => t.type_index).sort((a, b) => a - b)).toEqual([
      ...Array(31).keys(),
    ]);
    const contract = readFileSync(
      new URL("../../../docs/requests/CONTRACT.md", import.meta.url),
      "utf8",
    );
    const line = contract
      .split("\n")
      .find(l => l.startsWith("| Template objects"));
    if (!line) throw new Error("The contract's template line is missing");
    const listed = [
      ...line.matchAll(/`(t-[a-z0-9]+)` (.*?)(?=, `t-|\. Every template)/g),
    ].map(m => [m[1], m[2]]);
    expect(listed).toEqual(TEMPLATES.map(([id, name]) => [id, name]));
  });

  test("every type has the shape the type guard checks", () => {
    const catalog = new Map(
      SEED.field_catalog.map(f => [f.clickup_field_id, f]),
    );
    for (const t of SEED.types) {
      expect(t.key).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
      expect(t.label.length).toBeGreaterThanOrEqual(3);
      expect(t.label.length).toBeLessThanOrEqual(80);
      expect(t.request_type_option_id).toMatch(UUID);
      expect(t.clickup_option_name.length).toBeGreaterThan(0);
      expect(["urgent", "high", "normal", "low"]).toContain(t.priority);
      expect(t.due_days).toBeGreaterThanOrEqual(0);
      expect(t.due_days).toBeLessThanOrEqual(60);
      if (t.sop_url !== null) expect(t.sop_url).toMatch(/^https:\/\//);
      expect(t.targets.length).toBeGreaterThanOrEqual(1);
      expect(t.targets.length).toBeLessThanOrEqual(3);
      expect(t.team).toBe(t.targets[0].team);
      expect(new Set(t.targets.map(g => g.part)).size).toBe(t.targets.length);
      for (const g of t.targets) {
        expect(Object.keys(g).sort()).toEqual([
          "list_id",
          "name_suffix",
          "owner_clickup_id",
          "owner_rule",
          "part",
          "team",
          "template_id",
          "template_name",
          "when",
        ]);
        expect(g.part).toMatch(/^[a-z_]{2,20}$/);
        expect(LISTS[g.list_id]).toBe(g.team);
        if (g.template_id !== null)
          expect(g.template_id).toMatch(/^t-[a-z0-9]{6,20}$/);
        expect([
          "systems_manager",
          "csm_of_card",
          "creative_strategist",
          "media_buyer_of_record",
          "person",
        ]).toContain(g.owner_rule);
        if (g.owner_rule === "person")
          expect(typeof g.owner_clickup_id).toBe("number");
        if (g.when) {
          const f = t.fields.find(x => x.key === g.when?.field_key);
          expect(f?.kind).toBe("select");
          const options = f?.clickup_field_id
            ? catalog.get(f.clickup_field_id)?.options
            : f?.options;
          for (const o of g.when.options)
            expect(options?.some(x => x.id === o)).toBe(true);
        }
      }
      const keys = t.fields.map(f => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(t.fields.length).toBeLessThanOrEqual(20);
      expect(t.fields.filter(f => f.kind === "deadline").length).toBe(1);
      expect(t.fields.filter(f => f.kind === "priority").length).toBe(1);
      expect(
        t.fields.filter(f => f.kind === "client").length,
      ).toBeLessThanOrEqual(1);
      expect(
        t.fields.filter(f => f.kind === "details").length,
      ).toBeLessThanOrEqual(1);
      for (const f of t.fields) {
        expect(Object.keys(f).sort()).toEqual([
          "clickup_field_id",
          "help",
          "key",
          "kind",
          "label",
          "options",
          "required",
        ]);
        expect(f.key).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
        if (["client", "deadline", "priority"].includes(f.kind))
          expect(f.key).toBe(f.kind);
        if (f.clickup_field_id)
          expect(catalog.get(f.clickup_field_id)?.kind).toBe(f.kind as never);
        if (f.help !== null) expect(f.help.length).toBeLessThanOrEqual(140);
      }
      if (t.sop_steps === null) expect(t.sop_steps_state).toBe("none");
      else {
        expect(["source", "draft", "saved"]).toContain(t.sop_steps_state);
        expect(t.sop_steps.length).toBeGreaterThanOrEqual(1);
        expect(t.sop_steps.length).toBeLessThanOrEqual(40);
        for (const s of t.sop_steps) expect(s.length).toBeLessThanOrEqual(300);
      }
    }
  });

  test("the seed's decisions (contract 2.3)", () => {
    expect(type("client_pause").label).toBe("Client pause");
    expect(
      type("create_ad_account").targets.map(g => [
        g.part,
        g.template_id,
        g.when?.field_key,
        g.when?.options,
      ]),
    ).toEqual([
      [
        "meta",
        "t-86ex6f3q7",
        "ads_platform",
        ["88d55b4b-f296-4a0b-abc6-3b228889444a"],
      ],
      [
        "tiktok",
        "t-86ex6ee7a",
        "ads_platform",
        ["c115bdfe-661f-4855-a86b-69a54b2e616a"],
      ],
      [
        "snapchat",
        "t-86ex6ehwe",
        "ads_platform",
        ["97b22a7b-c18b-4be9-bd03-ff271bacfd77"],
      ],
    ]);
    expect(
      type("whatsapp_reactivation").targets.map(g => [
        g.part,
        g.list_id,
        g.template_id,
      ]),
    ).toEqual([
      ["message", "901818016338", "t-86exj3g1a"],
      ["send", "901816723190", "t-86exj3h8f"],
    ]);
    for (const key of ["client_offboarding", "client_pause", "client_relaunch"])
      expect(type(key).targets.map(g => [g.part, g.name_suffix])).toEqual([
        ["tech", " (Tech)"],
        ["media", " (Media)"],
      ]);
    const lsr = type("low_schedule_rate");
    const issue = SEED.field_catalog.find(
      f =>
        f.clickup_field_id ===
        lsr.fields.find(f => f.key === "schedule_rate_issue")?.clickup_field_id,
    );
    const id = (name: string) => issue?.options?.find(o => o.name === name)?.id;
    expect(
      lsr.targets.map(g => [g.part, g.when?.options.slice().sort()]),
    ).toEqual([
      ["call_center", [id("Call Center Issue"), id("Both")].sort()],
      ["ads", [id("Ads issue"), id("Both")].sort()],
    ]);
    expect(type("card_missing").targets[0].template_id).toBeNull();
    expect([
      type("card_missing").sop_steps?.length,
      type("card_missing").sop_steps_state,
    ]).toEqual([5, "draft"]);
    expect(type("whatsapp_connection").targets[0].template_id).toBe(
      "t-86ex62m1b",
    );
    expect([
      type("whatsapp_connection").sop_steps?.length,
      type("whatsapp_connection").sop_steps_state,
    ]).toEqual([6, "source"]);
    expect(type("funnel_intent").targets[0].template_id).toBe("t-86exj3gk4");
    expect([
      type("social_media").targets[0].template_id,
      type("social_media").sop_steps?.length,
      type("social_media").sop_steps_state,
    ]).toEqual([null, 10, "draft"]);
    for (const t of SEED.types.filter(x =>
      MEDIA_BUYER_TYPES.includes(x.type_index),
    ))
      for (const g of t.targets.filter(
        x => x.owner_rule === "media_buyer_of_record",
      ))
        expect(g.owner_clickup_id).toBeNull();
    expect(
      SEED.types
        .filter(t =>
          t.targets.some(g => g.owner_rule === "media_buyer_of_record"),
        )
        .map(t => t.type_index)
        .sort((a, b) => a - b),
    ).toEqual(MEDIA_BUYER_TYPES);
    for (const key of ["general_tech", "general_marketing", "general_csm"]) {
      const t = type(key);
      expect(t.fields.find(f => f.kind === "client")?.required).toBe(false);
      expect(t.fields.find(f => f.kind === "details")).toMatchObject({
        clickup_field_id: null,
        required: true,
      });
    }
    expect(
      SEED.types
        .filter(t => t.priority === "high")
        .map(t => t.key)
        .sort(),
    ).toEqual(["card_missing", "missing_leads", "whatsapp_connection"]);
    expect(
      SEED.types
        .filter(t => t.priority !== "high")
        .every(t => t.priority === "normal"),
    ).toBe(true);
    const due: Record<number, string[]> = {};
    for (const t of SEED.types) {
      due[t.due_days] = [...(due[t.due_days] ?? []), t.key];
    }
    expect(due[1].sort()).toEqual([
      "card_missing",
      "employee_offboarding",
      "missing_leads",
      "whatsapp_connection",
    ]);
    expect(due[3].sort()).toEqual(
      [
        "create_ad_account",
        "employee_onboarding",
        "funnel_intent",
        "low_schedule_rate",
        "low_show_rate",
        "privacy_policy",
        "company_name",
      ].sort(),
    );
    expect(due[5].sort()).toEqual([
      "dfy_to_dwy",
      "dwy_to_dfy",
      "whatsapp_reactivation",
    ]);
    expect(due[7]).toEqual(["new_script"]);
    expect(due[10].sort()).toEqual(["landing_page", "social_media"]);
    expect(Object.keys(due).sort()).toEqual(["1", "10", "2", "3", "5", "7"]);
    expect(
      SEED.types
        .filter(t => t.set_request_type)
        .map(t => t.key)
        .sort(),
    ).toEqual(
      [
        "employee_offboarding",
        "privacy_policy",
        "client_offboarding",
        "dfy_to_dwy",
        "dwy_to_dfy",
        "company_name",
        "company_address",
        "csm_request",
        "business_licence",
        "ads_request",
        "edit_campaign",
      ].sort(),
    );
    for (const t of SEED.types) {
      if (t.sop_steps === null) continue;
      const hasTemplate = t.targets.some(g => g.template_id !== null);
      expect(t.sop_steps_state).toBe(hasTemplate ? "source" : "draft");
    }
    expect(SEED.types.every(t => t.enabled)).toBe(true);
  });

  test("the catalog's selects carry their ClickUp option ids; nothing else lists options", () => {
    for (const f of SEED.field_catalog) {
      expect(f.clickup_field_id).toMatch(UUID);
      expect(["text", "longtext", "url", "number", "select"]).toContain(f.kind);
      if (f.kind === "select") {
        expect(f.options?.length).toBeGreaterThan(0);
        for (const o of f.options ?? []) expect(o.id).toMatch(UUID);
      } else expect(f.options).toBeNull();
    }
    expect(
      SEED.field_catalog.some(f => f.clickup_field_id.startsWith("5000c43f")),
    ).toBe(true);
    expect(
      SEED.field_catalog.some(
        f => f.clickup_field_id === "09abf737-302f-422a-9d17-8fb9619903d1",
      ),
    ).toBe(false);
    expect(
      SEED.field_catalog.some(
        f => f.clickup_field_id === "d3ac52c5-b71c-4782-9fea-1f9371cbae47",
      ),
    ).toBe(false);
    expect(
      SEED.field_catalog.some(
        f => f.clickup_field_id === "e9fd8024-8abe-4094-ac08-e6c0e736ad7e",
      ),
    ).toBe(false);
  });
});
