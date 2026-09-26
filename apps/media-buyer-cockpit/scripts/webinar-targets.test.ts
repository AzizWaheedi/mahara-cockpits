import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  WEBINAR_TARGETS as baseline,
  inputsToTargets,
  selectTargets,
  type TargetVersion,
  targetsToInputs,
  webinarTargetsSchema,
} from "../convex/ceo/webinarTargetsModel";

const clone = () => structuredClone(baseline);
const invalid = [
  null,
  {},
  { ...baseline, extra: 1 },
  { ...baseline, plannedSpend: "2000" },
  { ...baseline, showRate: {} },
  { ...baseline, closeRate: 1.01 },
  { ...baseline, plannedSpend: 0 },
  { ...baseline, registrations: { low: 1, plan: 1.5, high: 3 } },
  { ...baseline, costPerRegistration: { low: 10, plan: 5, high: 9 } },
  { ...baseline, pageConversion: { floor: 0.2, low: 0.1, high: 0.3 } },
  { ...baseline, showRate: { low: 0.3, high: 0.4, extra: 0 } },
];
const db = new PGlite();
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;",
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../../supabase/migrations/20260926074942_webinar_target_versions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
afterAll(() => db.close());
async function rpc(
  scope: string,
  expected: number,
  id: string,
  values: unknown = baseline,
) {
  return (
    await db.query<{ r: { status: string; version: TargetVersion } }>(
      "select public.cockpit_save_webinar_targets($1,$2,$3::jsonb,'test-ceo',$4::uuid) r",
      [scope, expected, JSON.stringify(values), id],
    )
  ).rows[0].r;
}
describe("target contract", () => {
  test("all displayed fields round trip with readable percentages", () => {
    const inputs = targetsToInputs(baseline);
    expect(inputs.closeRate).toBe("20");
    expect(inputsToTargets(inputs)).toEqual(baseline);
  });
  test.each(invalid)("rejects invalid shape and commercial bounds: %j", value =>
    expect(webinarTargetsSchema.safeParse(value).success).toBe(false),
  );
  test("blank, scientific, infinite and negative input cannot silently become zero", () => {
    for (const value of ["", " ", "1e2", "NaN", "Infinity", "-1"])
      expect(() =>
        inputsToTargets({ ...targetsToInputs(baseline), plannedSpend: value }),
      ).toThrow();
  });
  test("future defaults preserve prior round targets", () => {
    const v: TargetVersion = {
      scope_key: "defaults",
      revision: 1,
      values: { ...clone(), plannedSpend: 5000 },
      changed_at: "2026-09-26T12:00:00Z",
      changed_by: "ceo",
    };
    expect(
      selectTargets([v], "round:old", Date.parse("2026-09-25")).values
        .plannedSpend,
    ).toBe(2000);
    expect(
      selectTargets([v], "round:new", Date.parse("2026-09-27")).values
        .plannedSpend,
    ).toBe(5000);
    expect(selectTargets([v], "round:unknown", null).values.plannedSpend).toBe(
      2000,
    );
    expect(
      selectTargets(
        [
          v,
          {
            ...v,
            scope_key: "round:old",
            values: { ...clone(), plannedSpend: 3000 },
          },
        ],
        "round:old",
        0,
      ).values.plannedSpend,
    ).toBe(3000);
  });
});
describe("actual PostgreSQL migration", () => {
  test("valid baseline passes; invalid contract fails in SQL too", async () => {
    for (const [value, valid] of [
      [baseline, true],
      ...invalid.map(v => [v, false]),
    ] as [unknown, boolean][])
      expect(
        (
          await db.query<{ ok: boolean }>(
            "select public.cockpit_webinar_targets_valid($1::jsonb) ok",
            [JSON.stringify(value)],
          )
        ).rows[0].ok,
      ).toBe(valid);
  });
  test("RLS and browser access are denied", async () => {
    const row = (
      await db.query<{
        rls: boolean;
        anon: boolean;
        auth: boolean;
        rpc: boolean;
      }>(
        `select relrowsecurity rls, has_table_privilege('anon',oid,'select') anon, has_table_privilege('authenticated',oid,'insert') auth, has_function_privilege('authenticated','public.cockpit_save_webinar_targets(text,integer,jsonb,text,uuid)','execute') rpc from pg_class where relname='cockpit_webinar_target_versions'`,
      )
    ).rows[0];
    expect(row).toEqual({ rls: true, anon: false, auth: false, rpc: false });
    await db.exec("set role anon");
    try {
      await expect(
        db.query("select * from public.cockpit_webinar_target_versions"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });
  test("atomic revision, conflict, safe retry and immutable audit under service role", async () => {
    await db.exec("set role service_role");
    try {
      const id = "00000000-0000-4000-8000-000000000001";
      const first = await rpc("defaults", 0, id);
      expect(first.status).toBe("saved");
      expect(first.version.revision).toBe(1);
      expect(await rpc("defaults", 0, id)).toEqual(first);
      expect(
        (await rpc("defaults", 0, "00000000-0000-4000-8000-000000000002"))
          .status,
      ).toBe("conflict");
      const edited = { ...clone(), plannedSpend: 3000 };
      expect(
        (
          await rpc(
            "defaults",
            1,
            "00000000-0000-4000-8000-000000000003",
            edited,
          )
        ).version.revision,
      ).toBe(2);
      const rows = (
        await db.query<{
          revision: number;
          values: unknown;
          changed_by: string;
        }>(
          "select revision,values,changed_by from public.cockpit_webinar_target_versions order by revision",
        )
      ).rows;
      expect(rows).toEqual([
        { revision: 1, values: baseline, changed_by: "test-ceo" },
        { revision: 2, values: edited, changed_by: "test-ceo" },
      ]);
      await expect(
        db.query("delete from public.cockpit_webinar_target_versions"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.query(
          "update public.cockpit_webinar_target_versions set revision=99",
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(rpc("defaults", 2, id, edited)).rejects.toThrow(
        /already used/,
      );
      await expect(
        rpc("defaults", 2, "00000000-0000-4000-8000-000000000004", {}),
      ).rejects.toThrow(/Invalid/);
    } finally {
      await db.exec("reset role");
    }
  });
});
