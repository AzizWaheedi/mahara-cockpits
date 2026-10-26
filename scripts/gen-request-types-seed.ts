#!/usr/bin/env bun
/**
 * Prints supabase/migrations/20261026s_request_types_seed.sql from
 * docs/requests/request-types.json (docs/requests/CONTRACT.md section 2.3).
 *
 *   bun scripts/gen-request-types-seed.ts > supabase/migrations/20261026s_request_types_seed.sql
 *
 * The migration is this script's output, byte for byte;
 * apps/media-buyer-cockpit/scripts/request-types-seed.test.ts regenerates it
 * and compares. Edit the JSON (the orchestrator owns it) and rerun, never the
 * SQL by hand.
 *
 * Every insert is ON CONFLICT DO NOTHING, and a type row is only offered
 * when its key is not there yet, so a re-apply never overwrites an editor's
 * change (the type guard runs before a conflict is found, so it is not even
 * asked to check a row that will not be written).
 *
 * The 34 ClickUp template objects are not in the JSON: they are the listing
 * of GET team/90182518398/taskTemplate read on 2026-10-26 (CONTRACT section
 * 10), kept below. The script refuses a type whose template id is not among
 * them or whose template name differs from ClickUp's (PLAN 3.3: objects are
 * matched by name).
 */
import { readFileSync } from "node:fs";

export const SEED_DAY = "2026-10-26";
export const SEED_NOTE =
  "Seeded 2026-10-26 from docs/requests/request-types.json";
const JSON_PATH = new URL(
  "../docs/requests/request-types.json",
  import.meta.url,
);

/** GET team/90182518398/taskTemplate, 2026-10-26: id and name only. */
export const TEMPLATES: ReadonlyArray<readonly [string, string]> = [
  ["t-86ex8x9xw", "Tech Onboarding"],
  ["t-86ex8xaf1", "Media Onboarding 2.0"],
  ["t-86eyu1w3d", "Creative Onboarding"],
  ["t-86ex6fpu3", "Ad Spend Invoice Request 🧾"],
  ["t-86ex1965m", "Add Custom Values to Client's sub account"],
  ["t-86exj3gx1", "Add custom qualifiation questions🙋"],
  ["t-86ex6fdwu", "Card Missing 💳 ❌"],
  ["t-86exj3ngz", "Change Company Address📍"],
  ["t-86exj3n5t", "Change Company Name⏎"],
  ["t-86ex629x6", "Client Offboarding (Media) 👋❌"],
  ["t-86ex629ve", "Client Offboarding (Tech) 👋❌"],
  ["t-86ex63qm7", "Client Pause ⏸️ (Media)"],
  ["t-86ex63qk5", "Client Pause ⏸️ (Tech)"],
  ["t-86exj3g1a", "Client Reactivation Campaign (Media)📣"],
  ["t-86exghd6t", "Client Reactivation Campaign📣"],
  ["t-86exj3h8f", "Client Reactivation Campaign📣 (Tech)"],
  ["t-86ex63qjj", "Client Relaunch 🚀↪️ (Media)"],
  ["t-86ex63qhr", "Client Relaunch 🚀↪️ (Tech)"],
  ["t-86ex09tmh", "Connecting a new lead form"],
  ["t-86exer2gv", "Create Landing Page📊"],
  ["t-86ex6f3q7", "Create Meta Ad Account 🛜"],
  ["t-86ex6ehwe", "Create Snapchat Ad Account 👻"],
  ["t-86ex6ee7a", "Create TikTok Ad Account 🎵"],
  ["t-86ex1964h", "Lanuch New Client Campaign 🚀"],
  ["t-86exj3cvt", "Low Schedule Rate📉 (Ads)"],
  ["t-86exj3d37", "Low Schedule Rate📉 (Call Center)"],
  ["t-86exj3ddv", "Low Show Rate📉"],
  ["t-86ex09vmq", "Missing Leads ❌"],
  ["t-86ex09ytj", "New Employee Onboarding 🙋‍♂️"],
  ["t-86ex63j6n", "New Script Request✍️"],
  ["t-86exy04v4", "Social Media Management Template"],
  ["t-86exj3gk4", "Switch funnel intent level🌪️"],
  ["t-86exj3gfx", "Switch to funnel intent🌪️"],
  ["t-86ex62m1b", "Whatsapp Connection Issue📲❌"],
];

type Option = { id: string; name: string };
export type CatalogField = {
  clickup_field_id: string;
  clickup_name: string;
  kind: "text" | "longtext" | "url" | "number" | "select";
  label: string;
  options: Option[] | null;
};
export type Target = {
  part: string;
  name_suffix: string;
  list_id: string;
  team: string;
  template_id: string | null;
  template_name: string | null;
  owner_rule: string;
  owner_clickup_id: number | null;
  when: { field_key: string; options: string[] } | null;
};
export type Field = {
  key: string;
  label: string;
  kind: string;
  clickup_field_id: string | null;
  required: boolean;
  options: Option[] | null;
  help: string | null;
};
export type RequestType = {
  type_index: number;
  key: string;
  label: string;
  clickup_option_name: string;
  request_type_option_id: string;
  team: string;
  targets: Target[];
  fields: Field[];
  sop_steps: string[] | null;
  sop_steps_state: "none" | "source" | "draft" | "saved";
  sop_url: string | null;
  due_days: number;
  priority: "urgent" | "high" | "normal" | "low";
  set_request_type: boolean;
  enabled: boolean;
  sources?: string[];
};
export type SeedJson = {
  about?: string;
  read_at?: string;
  field_catalog: CatalogField[];
  types: RequestType[];
};

export function readSeedJson(): SeedJson {
  return JSON.parse(readFileSync(JSON_PATH, "utf8")) as SeedJson;
}

/** A standard SQL string literal (standard_conforming_strings is on). */
function lit(value: string | null): string {
  if (value === null) return "NULL";
  if (value.includes("\0")) throw new Error("A NUL byte cannot go into SQL");
  return `'${value.replace(/'/g, "''")}'`;
}
function jsonb(value: unknown): string {
  return value === null || value === undefined
    ? "NULL"
    : `${lit(JSON.stringify(value))}::jsonb`;
}
const bool = (b: boolean) => (b ? "true" : "false");

/** The target and field shapes the type guard reads, keys in a fixed order. */
const target = (t: Target): Target => ({
  part: t.part,
  name_suffix: t.name_suffix,
  list_id: t.list_id,
  team: t.team,
  template_id: t.template_id,
  template_name: t.template_name,
  owner_rule: t.owner_rule,
  owner_clickup_id: t.owner_clickup_id,
  when: t.when
    ? { field_key: t.when.field_key, options: [...t.when.options] }
    : null,
});
const field = (f: Field): Field => ({
  key: f.key,
  label: f.label,
  kind: f.kind,
  clickup_field_id: f.clickup_field_id,
  required: f.required,
  options: f.options ? f.options.map(o => ({ id: o.id, name: o.name })) : null,
  help: f.help,
});

/** What the guard cannot know yet: the templates and the catalog the seed itself writes. */
export function seedProblems(seed: SeedJson): string[] {
  const out: string[] = [];
  const templates = new Map(TEMPLATES);
  const catalog = new Map(seed.field_catalog.map(f => [f.clickup_field_id, f]));
  if (templates.size !== TEMPLATES.length)
    out.push("Two template objects share an id.");
  if (catalog.size !== seed.field_catalog.length)
    out.push("Two catalog fields share an id.");
  for (const f of seed.field_catalog) {
    if ((f.kind === "select") !== Array.isArray(f.options))
      out.push(`Catalog field ${f.clickup_name}: only a select lists options.`);
  }
  const keys = new Set<string>();
  const indexes = new Set<number>();
  const optionIds = new Set<string>();
  for (const t of seed.types) {
    if (keys.has(t.key)) out.push(`Two types share the key ${t.key}.`);
    if (indexes.has(t.type_index))
      out.push(`Two types share the option position ${t.type_index}.`);
    if (optionIds.has(t.request_type_option_id))
      out.push(`Two types share the option ${t.request_type_option_id}.`);
    keys.add(t.key);
    indexes.add(t.type_index);
    optionIds.add(t.request_type_option_id);
    if (t.targets[0]?.team !== t.team)
      out.push(`${t.key}: team is not the first part's team.`);
    for (const g of t.targets) {
      if (g.template_id === null) {
        if (g.template_name !== null)
          out.push(`${t.key}/${g.part}: a template name with no template.`);
        continue;
      }
      const name = templates.get(g.template_id);
      if (name === undefined)
        out.push(
          `${t.key}/${g.part}: template ${g.template_id} is not in ClickUp.`,
        );
      else if (name !== g.template_name)
        out.push(
          `${t.key}/${g.part}: template ${g.template_id} is "${name}" in ClickUp, not "${g.template_name}".`,
        );
    }
    for (const f of t.fields) {
      if (f.clickup_field_id === null) continue;
      const c = catalog.get(f.clickup_field_id);
      if (!c)
        out.push(
          `${t.key}/${f.key}: field ${f.clickup_field_id} is not in the catalog.`,
        );
      else if (c.kind !== f.kind)
        out.push(
          `${t.key}/${f.key}: the catalog field is a ${c.kind}, not a ${f.kind}.`,
        );
    }
  }
  return out;
}

export function buildSeed(seed: SeedJson = readSeedJson()): string {
  const problems = seedProblems(seed);
  if (problems.length)
    throw new Error(`The seed JSON has problems:\n- ${problems.join("\n- ")}`);
  const at = `'${SEED_DAY} 00:00:00+00'::timestamptz`;
  const types = [...seed.types].sort((a, b) => a.type_index - b.type_index);
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(
    "-- Requests: the seed (docs/requests/CONTRACT.md section 2.3). GENERATED: do not edit.",
    "-- bun scripts/gen-request-types-seed.ts > supabase/migrations/20261026s_request_types_seed.sql",
    "-- Source: docs/requests/request-types.json (the folder fields of 901812879297 and the",
    `-- template listing of team 90182518398, both read ${SEED_DAY}). Applies after 20261026r.`,
    "--",
    `-- ${seed.field_catalog.length} ClickUp folder fields, ${TEMPLATES.length} template objects, ${types.length} request types and`,
    "-- their version 1 rows. Every insert is ON CONFLICT DO NOTHING and a type is only",
    "-- offered when its key is new, so an editor's change survives a re-apply.",
    "",
    "BEGIN;",
    "",
    "-- 1. The ClickUp folder fields a request type may write.",
    "INSERT INTO public.cockpit_request_field_catalog (clickup_field_id, clickup_name, kind, label, options, state, read_at, updated_at) VALUES",
  );
  push(
    seed.field_catalog
      .map(
        f =>
          `  (${lit(f.clickup_field_id)}, ${lit(f.clickup_name)}, ${lit(f.kind)}, ${lit(f.label)}, ${jsonb(
            f.options ? f.options.map(o => ({ id: o.id, name: o.name })) : null,
          )}, 'ok', ${at}, ${at})`,
      )
      .join(",\n"),
    "ON CONFLICT (clickup_field_id) DO NOTHING;",
    "",
    "-- 2. The ClickUp template objects (id and name only).",
    "INSERT INTO public.cockpit_request_templates (id, name, state, seen_at) VALUES",
    TEMPLATES.map(
      ([id, name]) => `  (${lit(id)}, ${lit(name)}, 'ok', ${at})`,
    ).join(",\n"),
    "ON CONFLICT (id) DO NOTHING;",
    "",
    "-- 3. The request types, in ClickUp's option order.",
  );
  for (const t of types) {
    push(
      `-- ${t.type_index}. ${t.label}`,
      "INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,",
      "  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)",
      `SELECT ${lit(t.key)}, ${t.type_index}, ${lit(t.label)}, ${lit(t.clickup_option_name)}, ${lit(t.request_type_option_id)}::uuid, ${lit(t.team)},`,
      `  ${jsonb(t.targets.map(target))},`,
      `  ${jsonb(t.fields.map(field))},`,
      `  ${jsonb(t.sop_steps)}, ${lit(t.sop_steps_state)}, ${lit(t.sop_url)}, ${t.due_days}, ${lit(t.priority)}, ${bool(
        t.set_request_type,
      )}, ${bool(t.enabled)}, 1, 'migration'`,
      `WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = ${lit(t.key)})`,
      "ON CONFLICT (key) DO NOTHING;",
    );
  }
  push(
    "",
    "-- 4. Version 1 of each, the whole row as seeded.",
    'INSERT INTO public.cockpit_request_type_versions (key, version, "row", saved_by, note)',
    `SELECT t.key, 1, to_jsonb(t), 'migration', ${lit(SEED_NOTE)}`,
    "  FROM public.cockpit_request_types t",
    " WHERE t.version = 1 AND t.updated_by = 'migration'",
    `   AND t.key IN (${types.map(t => lit(t.key)).join(", ")})`,
    "ON CONFLICT (key, version) DO NOTHING;",
    "",
    "NOTIFY pgrst, 'reload schema';",
    "COMMIT;",
    "",
  );
  return lines.join("\n");
}

if (import.meta.main) process.stdout.write(buildSeed());
