import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import {
  budgetLine,
  budgetUsd,
  INDICATIVE_ONLY_USD_PER,
} from "../../client-success-cockpit/src/lib/kickoffBudget";
import { usdToBudget } from "../convex/currency";
import { migration } from "./lib/cockpitTestDb";

const SQL = migration("20261105163527_bhd_omr_indicative_rates.sql");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE FUNCTION public.cockpit_board_usd_rate(p_currency text)
    RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
      SELECT CASE upper(btrim(coalesce(p_currency,'')))
        WHEN 'USD' THEN 1 WHEN 'KWD' THEN 3.26 WHEN 'AED' THEN 0.2723
        WHEN 'SAR' THEN 0.2666 WHEN 'QAR' THEN 0.2747 END::numeric;
    $$;
  `);
  await db.exec(SQL);
});
afterAll(async () => {
  await db?.close();
});

describe("informational rate estimates remain separate from action rates", () => {
  test("BHD and OMR agree between the UI and restricted read helper", async () => {
    for (const code of ["BHD", "OMR"]) {
      const result = await db.query<{ r: string }>(
        `SELECT public.cockpit_indicative_usd_rate($1)::text AS r`,
        [` ${code.toLowerCase()} `],
      );
      expect(Number(result.rows[0].r)).toBe(INDICATIVE_ONLY_USD_PER[code]);
      expect(budgetUsd(100, code)).toBeNull();
      expect(() => usdToBudget(100, code)).toThrow();
      const actionRate = await db.query<{ r: string | null }>(
        `SELECT public.cockpit_board_usd_rate($1)::text AS r`,
        [code],
      );
      expect(actionRate.rows[0].r).toBeNull();
      expect(budgetLine(100, code)).toContain(
        "Estimate only; this is not yet used for launch or card budgets.",
      );
    }
  });

  test("existing rates and unknown currencies remain unchanged", async () => {
    for (const [code, expected] of [
      ["USD", 1],
      ["SAR", 0.2666],
      ["KWD", 3.26],
      ["AED", 0.2723],
      ["QAR", 0.2747],
      ["EUR", null],
      [null, null],
    ] as const) {
      const result = await db.query<{
        old: string | null;
        info: string | null;
      }>(
        `SELECT public.cockpit_board_usd_rate($1)::text AS old, public.cockpit_indicative_usd_rate($1)::text AS info`,
        [code],
      );
      expect(result.rows[0].info).toBe(result.rows[0].old);
      expect(
        result.rows[0].info === null ? null : Number(result.rows[0].info),
      ).toBe(expected);
    }
  });

  test("only the service role can execute the new helper", async () => {
    const result = await db.query<{
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      SELECT has_function_privilege('anon','public.cockpit_indicative_usd_rate(text)','EXECUTE') AS anon,
             has_function_privilege('authenticated','public.cockpit_indicative_usd_rate(text)','EXECUTE') AS authenticated,
             has_function_privilege('service_role','public.cockpit_indicative_usd_rate(text)','EXECUTE') AS service
    `);
    expect(result.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service: true,
    });
  });

  test("reapplication succeeds, but a changed function is not overwritten", async () => {
    await db.exec(SQL);
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_indicative_usd_rate(p_currency text)
      RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 99::numeric $$;`);
    await expect(db.exec(SQL)).rejects.toThrow("has changed");
  });
});
