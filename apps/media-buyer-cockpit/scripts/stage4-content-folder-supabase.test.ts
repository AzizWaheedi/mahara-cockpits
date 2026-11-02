/**
 * The phase 3 and phase 4 texts with the client's content folder (docs/forms/WAVE56-CONTRACT.md
 * D-S4.0, finding 2): Make 13 [48] and Make 12 [25] end with Client Data column H (Google Drive
 * Link), so stage4.messages keeps {content_folder} there and hermes/client-messages puts the card's
 * link in at send, as it does a form link. This proves the database side needs no change: both
 * verbatim texts pass cockpit_form_stage4_message with {map_link} filled, {content_folder} kept
 * once, under 1,500 characters and under the client text rule, so the draft row stores the
 * template and its fingerprint; the worker's fill and mask give that fingerprint back.
 *
 * The functions are cut from their canonical migrations (20260921a, 20261102a, 20261102j) the way
 * stage4-native-supabase.test.ts stands on what j reads, and each body is the live one: its md5 is
 * the one read from production on 2026-11-02 (pg_proc.prosrc), so a later change says so here.
 * Every client, card and link is invented.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  maskFolder,
  normalise,
  sha256,
  withFolder,
} from "../../../hermes/client-messages/core.ts";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

setDefaultTimeout(60_000);

/** The two texts for stage4.messages, verbatim from the saved blueprints (8922994 [48], 8925654 [25]). */
const MESSAGES = {
  phase3:
    "أكملنا المرحلة الثانية: نموذج التعريف بالنشاط.\nالمرحلة التالية: مكالمة التعريف.\n\nاطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:\n{map_link}\n\n*إذا ما رفعتوا المحتوى للحين:*\nارفعوا كل الصور والفيديوهات في مجلد المحتوى الموحد عشان توصل مباشرة لفريق الإبداع والمونتاج:\n{content_folder}",
  phase4:
    "أكملنا المرحلة الثالثة: مكالمة التعريف.\nالمرحلة التالية: بناء الهوية والعرض.\n\nاطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:\n{map_link}\n\n*إذا ما رفعتوا المحتوى للحين:*\nارفعوا كل الصور والفيديوهات في مجلد المحتوى الموحد عشان توصل مباشرة لفريق الإبداع والمونتاج:\n{content_folder}",
} as const;
const MAPS = {
  "3": "https://mahara-onboarding-map.vercel.app/?phase=3&cid={task}",
  "4": "https://mahara-onboarding-map.vercel.app/?phase=4&cid={task}",
};
const TASK = "86exfix01";
const FOLDER = "https://drive.google.com/drive/folders/1InventedFolderId0000";

/** md5(prosrc) of each function as production holds it (read 2026-11-02, before D-S4.0). */
const LIVE_MD5 = {
  cockpit_client_text_ok: "59ffd40f7f2e7e0ac52340937287ef52",
  cockpit_form_stage4_message: "f7f2e396f1324794593dfbc3e588dcd3",
} as const;

let db: PGlite;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}

async function one<T = any>(text: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(text, params)).rows[0]?.r as T;
}

const setting = (key: string, value: unknown) =>
  db.query(
    "INSERT INTO public.cockpit_settings(key, value, updated_by) VALUES ($1, $2::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)],
  );

const message = (phase: string, client: string | null, map: string | null) =>
  one<{ body?: string; missing?: string }>(
    "SELECT public.cockpit_form_stage4_message($1, $2, $3) AS r",
    [phase, client, map],
  );

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(
    cut(
      migration("20260921a_cockpit_settings.sql"),
      /create table if not exists public\.cockpit_settings \([\s\S]*?\n\);/,
      "settings",
    ),
  );
  await db.exec(
    cut(
      migration("20261102a_forms_invites.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_text_ok\(p_text text\)[\s\S]*?END \$\$;/,
      "client text rule",
    ),
  );
  const j = migration("20261102j_stage4_native.sql");
  for (const [pattern, what] of [
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_form_stage4_setting\(p_key text\)[\s\S]*?\n\$\$;/,
      "stage4 setting",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_form_stage4_message\(p_phase text, p_client text, p_map text\)[\s\S]*?END \$\$;/,
      "stage4 message",
    ],
    [
      /CREATE OR REPLACE FUNCTION public\.cockpit_form_stage4_map_url\(p_phase integer, p_task_id text\)[\s\S]*?\n\$\$;/,
      "stage4 map url",
    ],
    [
      /INSERT INTO public\.cockpit_settings\(key, value, updated_by\)\nVALUES \('onboarding\.map_urls'[^\n]*\n/,
      "map urls row",
    ],
    [
      /INSERT INTO public\.cockpit_settings\(key, value, updated_by\)\nVALUES \('stage4\.messages'[^\n]*\n/,
      "messages row",
    ],
  ] as const)
    await db.exec(cut(j, pattern, what));
});
afterAll(async () => {
  await db?.close();
});

describe("the database keeps {content_folder} for the sender (finding 2)", () => {
  test("the functions proven here are the live bodies", async () => {
    for (const [fn, md5] of Object.entries(LIVE_MD5))
      expect([
        fn,
        await one<string>(
          "SELECT md5(p.prosrc) AS r FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1",
          [fn],
        ),
      ]).toEqual([fn, md5]);
  });

  test("before D-S4.0 fills it, stage4.messages is empty and no phase message is drafted", async () => {
    expect(
      await one(
        "SELECT value AS r FROM public.cockpit_settings WHERE key = 'stage4.messages'",
      ),
    ).toEqual({});
    expect(
      await message("phase3", "Acme Interiors", "https://x.test/m"),
    ).toEqual({
      missing:
        "The phase 3 WhatsApp text is not set up yet (stage4.messages.phase3), so no message was drafted.",
    });
  });

  test("both verbatim texts pass: the map link in, {content_folder} kept once, under 1,500 characters, the client text rule ok", async () => {
    await setting("stage4.messages", MESSAGES);
    await setting("onboarding.map_urls", MAPS);
    for (const [phase, template] of Object.entries(MESSAGES)) {
      // The rule passes the stored template and the drafted text alike.
      expect(
        await one("SELECT public.cockpit_client_text_ok($1) AS r", [template]),
      ).toBeNull();
      const map = await one<string>(
        "SELECT public.cockpit_form_stage4_map_url($1, $2) AS r",
        [Number(phase.slice(-1)), TASK],
      );
      expect(map).toBe(
        MAPS[phase.slice(-1) as "3" | "4"].replace("{task}", TASK),
      );
      const out = await message(phase, "Acme Interiors", map);
      expect(out.missing).toBeUndefined();
      const body = String(out.body);
      expect(body).toBe(template.replace("{map_link}", map));
      expect(body.split("{content_folder}").length).toBe(2);
      expect(body.endsWith("والمونتاج:\n{content_folder}")).toBe(true);
      expect(body).not.toContain("{map_link}");
      expect([...body].length).toBeLessThanOrEqual(1500);
      expect(
        await one<number>("SELECT char_length($1) AS r", [body]),
      ).toBeLessThanOrEqual(1500);
      expect(
        await one("SELECT public.cockpit_client_text_ok($1) AS r", [body]),
      ).toBeNull();
    }
  });

  test("the draft's fingerprint is the template's; the sender's fill and mask give it back", async () => {
    for (const phase of ["phase3", "phase4"]) {
      const map = await one<string>(
        "SELECT public.cockpit_form_stage4_map_url($1, $2) AS r",
        [Number(phase.slice(-1)), TASK],
      );
      const body = String((await message(phase, "Acme Interiors", map)).body);
      // As 20261102j's dispatch stores body_sha256 for the client_message effect.
      const stored = await one<string>(
        "SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS r",
        [body],
      );
      expect(stored).toBe(sha256(body));
      const sent = withFolder(body, FOLDER);
      expect(sent.endsWith(`والمونتاج:\n${FOLDER}`)).toBe(true);
      expect(sent).not.toContain("{content_folder}");
      expect(sha256(normalise(maskFolder(sent, FOLDER)))).toBe(
        sha256(normalise(body)),
      );
    }
  });

  test("a phase text still needs its map link; {content_folder} alone is no reason to refuse", async () => {
    expect(await message("phase4", "Acme Interiors", null)).toEqual({
      missing:
        "The phase 4 WhatsApp text needs the map link, which is not set up yet.",
    });
    await setting("stage4.messages", { phase3: "{content_folder}" });
    expect(await message("phase3", null, null)).toEqual({
      body: "{content_folder}",
    });
    await setting("stage4.messages", MESSAGES);
  });
});
