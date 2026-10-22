/**
 * CSM form sends (20261023a_csm_form_sends.sql, docs/csm-forms/KICKOFF.md
 * 5.1) on an isolated PostgreSQL with Supabase's default privileges on, so a
 * missing REVOKE opens the object here as it would in production.
 *
 * It stands on the real client gate (cockpit_csm_client_gate from 20261006c,
 * the seat rule from 20260927a, the roster tables from 20260927v). The
 * onboarding mirror is a cut-down stand-in with the live column names. Every
 * person, client and response is invented. Nothing here reaches Typeform or
 * Make: a send is a row and an audit row, nothing more.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261023a_csm_form_sends.sql";

const CSM_A = "00000000-0000-4000-8000-0000000000a1"; // csm, Acme only
const CSM_ALL = "00000000-0000-4000-8000-0000000000a3"; // csm, every client
const CSM_B = "00000000-0000-4000-8000-0000000000b1"; // csm, Beta only
const BUYER = "00000000-0000-4000-8000-0000000000c1"; // media buyer only
const CEO = "00000000-0000-4000-8000-0000000000c3";
const GONE = "00000000-0000-4000-8000-0000000000c4"; // csm, deactivated

const A = "taskA1"; // Acme: onboarding, no kickoff on record
const B = "taskB1"; // Beta: a kickoff already on record
const C = "taskC1"; // Gamma: no mirror row yet

const SHA = "a".repeat(64);
const KEYS = ["onboarding_client_id", "legal_name", "email"];

let db: PGlite;
type Row = Record<string, any>;

function cut(sql: string, pattern: RegExp, what: string): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${what}`);
  return hit[0];
}
async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function one<T = any>(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  await actor(db, who);
  try {
    return (await db.query<{ r: T }>(text, params)).rows[0].r;
  } finally {
    await asOwner();
  }
}
async function refused(
  who: string | null,
  text: string,
  params: unknown[] = [],
): Promise<string> {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    return (e as Error).message;
  } finally {
    await asOwner();
  }
  throw new Error(`Expected a refusal for ${text}`);
}
const SENT = "SELECT public.cockpit_csm_form_sent($1,$2,$3,$4::text[],$5,$6) r";
const send = (
  who: string,
  task: string,
  response: string,
  extra: Partial<{
    form: string;
    keys: string[] | null;
    sha: string;
    carried: string | null;
  }> = {},
) =>
  one<Row>(who, SENT, [
    task,
    extra.form ?? "kickoff",
    response,
    "keys" in extra ? extra.keys : KEYS,
    extra.sha ?? SHA,
    "carried" in extra ? extra.carried : task,
  ]);
const sendRefused = (
  who: string | null,
  task: string,
  response: string,
  extra: Partial<{
    form: string;
    keys: string[] | null;
    sha: string;
    carried: string | null;
  }> = {},
) =>
  refused(who, SENT, [
    task,
    extra.form ?? "kickoff",
    response,
    "keys" in extra ? extra.keys : KEYS,
    extra.sha ?? SHA,
    "carried" in extra ? extra.carried : task,
  ]);
const read = (who: string, task: string, form = "kickoff") =>
  one<Row>(who, "SELECT public.cockpit_csm_form_sends_read($1,$2) r", [
    task,
    form,
  ]);
async function count(sql: string, params: unknown[] = []): Promise<number> {
  await asOwner();
  return Number((await db.query<{ n: number }>(sql, params)).rows[0].n);
}
const sends = () =>
  count("SELECT count(*) n FROM public.cockpit_csm_form_sends");
const audits = () =>
  count(
    "SELECT count(*) n FROM public.cockpit_audit_log WHERE action='csm_form.sent'",
  );

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });

  // The roster and the client gate, from their canonical migrations.
  const roster = migration("20260927v_csm_read_models.sql");
  await db.exec(
    cut(
      roster,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_source_state\([^\n]*\n/,
      "cockpit_csm_source_state",
    ),
  );
  await db.exec(
    cut(
      roster,
      /INSERT INTO public\.cockpit_csm_source_state[^\n]*\n/,
      "cockpit_csm_source_state rows",
    ),
  );
  await db.exec(
    cut(
      roster,
      /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_sources\([^\n]*\n/,
      "cockpit_csm_sources",
    ),
  );
  await db.exec(
    "REVOKE ALL ON public.cockpit_csm_source_state, public.cockpit_csm_sources FROM anon, authenticated;",
  );
  await db.exec(
    cut(
      migration("20260927a_cockpit_ask_ai_jobs.sql"),
      /CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/,
      "cockpit_ask_ai_owner_allowed",
    ),
  );
  const gate = migration("20261006c_csm_onboarding_checkins.sql");
  await db.exec(
    cut(
      gate,
      /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor\([\s\S]*?END \$\$;/,
      "gate for actor",
    ),
  );
  await db.exec(
    cut(
      gate,
      /CREATE FUNCTION public\.cockpit_csm_client_gate\(p_task_id text\)[^\n]*\n/,
      "gate",
    ),
  );
  await db.exec(
    cut(
      gate,
      /REVOKE ALL ON FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
      "gate grants",
    ),
  );

  // The onboarding mirror, cut down to the columns the function reads.
  await db.exec(`
    CREATE TABLE public.cockpit_client_onboarding(clickup_task_id text PRIMARY KEY, client_name text NOT NULL,
      forms jsonb NOT NULL DEFAULT '{}', synced_at timestamptz);
    REVOKE ALL ON public.cockpit_client_onboarding FROM anon, authenticated;`);

  await member(db, CSM_A, "csm-a@tests.invalid", ["csm"]);
  await member(db, CSM_ALL, "csm-all@tests.invalid", ["csm"]);
  await member(db, CSM_B, "csm-b@tests.invalid", ["csm"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, GONE, "gone@tests.invalid", ["csm"], false);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Acme Interiors"], CSM_A],
  );
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Beta Build"], CSM_B],
  );
  await db.query(
    "UPDATE public.cockpit_members SET name='noura al-sabah' WHERE auth_user_id=$1",
    [CSM_A],
  );
  await db.query(
    "UPDATE public.cockpit_members SET name='csm-all@tests.invalid' WHERE auth_user_id=$1",
    [CSM_ALL],
  );

  const snap = "2026-10-22T08:00:00Z";
  const clients = [
    {
      taskId: A,
      name: "Acme Interiors",
      stage: "Onboarding Booked",
      bucket: "onboarding",
    },
    {
      taskId: B,
      name: "Beta Build",
      stage: "Brand Blueprint Booked♠️",
      bucket: "onboarding",
    },
    {
      taskId: C,
      name: "Gamma Design",
      stage: "Needs Contacting",
      bucket: "onboarding",
    },
  ];
  for (const c of clients)
    await db.query(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients',$1,$2,$3::jsonb,$4)",
      [
        `c-${c.taskId}`,
        [c.name],
        JSON.stringify({ _id: `c-${c.taskId}`, ...c }),
        snap,
      ],
    );
  await db.query(
    "UPDATE public.cockpit_csm_source_state SET ready=true,row_count=$1,source_snapshot_at=$2 WHERE table_name='clients'",
    [clients.length, snap],
  );
  await db.query(
    `INSERT INTO public.cockpit_client_onboarding(clickup_task_id,client_name,forms) VALUES
    ($1,'Acme Interiors',$3::jsonb),($2,'Beta Build',$4::jsonb)`,
    [
      A,
      B,
      JSON.stringify({
        onboarding: {
          form_id: "KFRCXPFx",
          response_id: "onbacme0001",
          submitted_at: "2026-10-13T10:00:00Z",
          answers: [],
        },
      }),
      JSON.stringify({
        kickoff: {
          form_id: "tG7dnxBn",
          response_id: "kickbeta0001",
          submitted_at: "2026-10-15T10:00:00Z",
          answers: [],
        },
      }),
    ],
  );

  // Applied twice: the second run must change nothing and raise nothing.
  await db.exec(migration(FILE));
  await db.exec(migration(FILE));
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("the table and its grants", () => {
  test("browser roles cannot touch the table; the service role only reads it; row security is on", async () => {
    for (const role of ["anon", "authenticated"])
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
      ])
        expect(
          (
            await db.query<{ ok: boolean }>(
              "SELECT has_table_privilege($1,'public.cockpit_csm_form_sends',$2) ok",
              [role, privilege],
            )
          ).rows[0].ok,
        ).toBe(false);
    expect(
      (
        await db.query<{ ok: boolean }>(
          "SELECT has_table_privilege('service_role','public.cockpit_csm_form_sends','SELECT') ok",
        )
      ).rows[0].ok,
    ).toBe(true);
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
      expect(
        (
          await db.query<{ ok: boolean }>(
            "SELECT has_table_privilege('service_role','public.cockpit_csm_form_sends',$1) ok",
            [privilege],
          )
        ).rows[0].ok,
      ).toBe(false);
    expect(
      (
        await db.query<{ rls: boolean }>(
          "SELECT relrowsecurity rls FROM pg_class WHERE oid='public.cockpit_csm_form_sends'::regclass",
        )
      ).rows[0].rls,
    ).toBe(true);
    expect(
      await refused(CSM_A, "SELECT * FROM public.cockpit_csm_form_sends"),
    ).toContain("permission denied");
  });

  test("authenticated may execute the two functions; anon and the service role may not; the helper runs for nobody", async () => {
    const can = async (role: string, sig: string) =>
      (
        await db.query<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
          [role, sig],
        )
      ).rows[0].ok;
    const sent =
      "public.cockpit_csm_form_sent(text,text,text,text[],text,text)";
    const readSig = "public.cockpit_csm_form_sends_read(text,text)";
    const helper =
      "public.cockpit_csm_form_send_json(public.cockpit_csm_form_sends)";
    for (const sig of [sent, readSig]) {
      expect(await can("authenticated", sig)).toBe(true);
      expect(await can("anon", sig)).toBe(false);
      expect(await can("service_role", sig)).toBe(false);
    }
    for (const role of ["anon", "authenticated", "service_role"])
      expect(await can(role, helper)).toBe(false);
    const fns = (
      await db.query<{ definer: boolean; config: string[] | null }>(`
      SELECT p.prosecdef definer, p.proconfig config FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'cockpit_csm_form_se%'`)
    ).rows;
    expect(fns.length).toBe(3);
    for (const fn of fns) {
      expect(fn.definer).toBe(true);
      expect(fn.config).toContain('search_path=""');
    }
    expect(
      await refused(null, SENT, [A, "kickoff", "resp00000001", KEYS, SHA, A]),
    ).toContain("permission denied");
  });
});

describe("noting a send", () => {
  test("refuses another seat's client, a seat without client-success access and a deactivated seat", async () => {
    expect(await sendRefused(CSM_B, A, "respnope0001")).toContain(
      "not on your access list",
    );
    expect(await sendRefused(BUYER, A, "respnope0002")).toContain(
      "client-success access",
    );
    expect(await sendRefused(GONE, A, "respnope0003")).toContain(
      "client-success access",
    );
    expect(await sends()).toBe(0);
    expect(await audits()).toBe(0);
  });

  test("refuses an unknown form, the Blueprint for now, Typeform's sandbox and a made-up response ID", async () => {
    expect(
      await sendRefused(CSM_A, A, "respnope0004", { form: "nope" }),
    ).toContain("Only the kickoff");
    expect(
      await sendRefused(CSM_A, A, "respnope0005", { form: "blueprint" }),
    ).toContain("Only the kickoff");
    expect(await sendRefused(CSM_A, A, "__sandbox")).toContain("sandbox");
    expect(await sendRefused(CSM_A, A, "short")).toContain(
      "not a Typeform response ID",
    );
    expect(await sendRefused(CSM_A, A, "has spaces in it")).toContain(
      "not a Typeform response ID",
    );
    expect(await sends()).toBe(0);
  });

  test("refuses an ID the form did not carry for this card, and hidden fields without the client ID", async () => {
    expect(
      await sendRefused(CSM_A, A, "respnope0006", { carried: B }),
    ).toContain("The form carried another card's ID");
    expect(
      await sendRefused(CSM_A, A, "respnope0007", { carried: null }),
    ).toContain("another card's ID");
    expect(
      await sendRefused(CSM_A, A, "respnope0008", { keys: ["legal_name"] }),
    ).toContain("client ID");
    expect(
      await sendRefused(CSM_A, A, "respnope0009", { keys: null }),
    ).toContain("client ID");
    expect(
      await sendRefused(CSM_A, A, "respnope0010", {
        keys: ["onboarding_client_id", "Bad Key"],
      }),
    ).toContain("hidden field name");
    expect(
      await sendRefused(CSM_A, A, "respnope0011", { sha: "not-a-hash" }),
    ).toContain("SHA-256");
    expect(await sends()).toBe(0);
    expect(await audits()).toBe(0);
  });

  test("one send writes exactly one row and one audit row; the form ID and the client come from the server", async () => {
    const r = await send(CSM_A, A, "respacme0001");
    expect(r.noted).toBe(true);
    expect(r.send).toMatchObject({
      responseId: "respacme0001",
      formKey: "kickoff",
      formId: "tG7dnxBn",
      taskId: A,
      clientName: "Acme Interiors",
      hiddenKeys: KEYS,
      second: false,
      sentBy: "Noura",
    });
    // The read shows a first name only: the address stays in the table.
    expect(r.send).not.toHaveProperty("sentByEmail");
    expect(typeof r.send.sentAt).toBe("string");
    expect(await sends()).toBe(1);
    expect(await audits()).toBe(1);
    await asOwner();
    const audit = (
      await db.query<Row>(
        "SELECT * FROM public.cockpit_audit_log WHERE action='csm_form.sent'",
      )
    ).rows[0];
    expect(audit).toMatchObject({
      entity_type: "cockpit_csm_form_sends",
      entity_id: "respacme0001",
      actor_email: "csm-a@tests.invalid",
      source_app: "client-success",
      source_system: "typeform",
      before: null,
    });
    expect(audit.after).toMatchObject({
      response_id: "respacme0001",
      task_id: A,
      form_id: "tG7dnxBn",
      hidden_sha256: SHA,
    });
    expect(audit.metadata).toEqual({
      client_name: "Acme Interiors",
      form_key: "kickoff",
      second: false,
      task_id: A,
    });
  });

  test("a repeat response ID writes neither a row nor an audit row, and answers with the first send", async () => {
    const again = await send(CSM_A, A, "respacme0001", { sha: "b".repeat(64) });
    expect(again.noted).toBe(false);
    expect(again.send.responseId).toBe("respacme0001");
    expect(await sends()).toBe(1);
    expect(await audits()).toBe(1);
    // The same response cannot be moved onto another client.
    expect(await sendRefused(CSM_ALL, B, "respacme0001")).toContain(
      "already noted for another client",
    );
    expect(await sends()).toBe(1);
  });

  test("the server decides 'second': an earlier send, or another kickoff on the record", async () => {
    const two = await send(CSM_A, A, "respacme0002");
    expect(two.send.second).toBe(true);
    // Beta has a kickoff on record already: its first cockpit send is a second kickoff.
    const beta = await send(CSM_B, B, "respbeta0001");
    expect(beta.send.second).toBe(true);
    // The record's kickoff is this very response (Make and the sync were quick): not a second.
    await asOwner();
    await db.query(
      "UPDATE public.cockpit_client_onboarding SET forms=$2::jsonb WHERE clickup_task_id=$1",
      [
        B,
        JSON.stringify({
          kickoff: {
            form_id: "tG7dnxBn",
            response_id: "respbeta0002",
            submitted_at: "2026-10-22T10:00:00Z",
            answers: [],
          },
        }),
      ],
    );
    await db.query(
      "DELETE FROM public.cockpit_csm_form_sends WHERE task_id=$1",
      [B],
    );
    const own = await send(CSM_B, B, "respbeta0002");
    expect(own.send.second).toBe(false);
    // No mirror row at all (Gamma): a first send.
    const gamma = await send(CSM_ALL, C, "respgamma001");
    expect(gamma.send.second).toBe(false);
    // A seat whose name is an address has no first name to show.
    expect(gamma.send.sentBy).toBeNull();
  });

  test("the CEO may note a send for any client", async () => {
    const r = await send(CEO, C, "respgamma002");
    expect(r.noted).toBe(true);
    expect(r.send).not.toHaveProperty("sentByEmail");
    await asOwner();
    const who = await db.query<{ sent_by_email: string }>(
      "SELECT sent_by_email FROM public.cockpit_csm_form_sends WHERE response_id='respgamma002'",
    );
    expect(who.rows[0]?.sent_by_email).toBe("aziz@maharamedia.com");
  });
});

describe("reading sends", () => {
  test("the card's sends of one form, newest first, ten at most, with the server's clock", async () => {
    await asOwner();
    for (let i = 0; i < 12; i++)
      await db.query(
        `INSERT INTO public.cockpit_csm_form_sends(response_id,form_key,form_id,task_id,client_name,hidden_keys,hidden_sha256,second,sent_by,sent_by_email,sent_at)
        VALUES($1,'kickoff','tG7dnxBn',$2,'Acme Interiors',$3,$4,true,$5,'csm-a@tests.invalid',$6)`,
        [
          `respbulk${String(i).padStart(4, "0")}`,
          A,
          KEYS,
          SHA,
          CSM_A,
          `2026-10-0${1 + (i % 9)}T0${i % 10}:00:00Z`,
        ],
      );
    const r = await read(CSM_A, A);
    expect(r.sends.length).toBe(10);
    expect(typeof r.now).toBe("string");
    const at = r.sends.map((s: Row) => Date.parse(s.sentAt));
    expect([...at].sort((x, y) => y - x)).toEqual(at);
    // The two sends made just now are the newest.
    expect(
      r.sends
        .slice(0, 2)
        .map((s: Row) => s.responseId)
        .sort(),
    ).toEqual(["respacme0001", "respacme0002"]);
    expect(
      r.sends.every((s: Row) => s.taskId === A && s.formKey === "kickoff"),
    ).toBe(true);
    expect((await read(CSM_A, A, "blueprint")).sends).toEqual([]);
  });

  test("is gated the same way, and knows only its forms", async () => {
    expect(
      await refused(
        CSM_B,
        "SELECT public.cockpit_csm_form_sends_read($1,'kickoff')",
        [A],
      ),
    ).toContain("not on your access list");
    expect(
      await refused(
        BUYER,
        "SELECT public.cockpit_csm_form_sends_read($1,'kickoff')",
        [A],
      ),
    ).toContain("client-success access");
    expect(
      await refused(
        CSM_A,
        "SELECT public.cockpit_csm_form_sends_read($1,'nope')",
        [A],
      ),
    ).toContain("Choose a form");
  });

  test("applying the file again keeps every row and every grant", async () => {
    const before = await sends();
    await asOwner();
    await db.exec(migration(FILE));
    expect(await sends()).toBe(before);
    expect(
      (
        await db.query<{ ok: boolean }>(
          "SELECT has_table_privilege('authenticated','public.cockpit_csm_form_sends','SELECT') ok",
        )
      ).rows[0].ok,
    ).toBe(false);
    expect((await read(CSM_A, A)).sends.length).toBe(10);
  });
});
