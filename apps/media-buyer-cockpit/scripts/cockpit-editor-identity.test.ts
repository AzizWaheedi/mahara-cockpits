import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitIdentityTestDb } from "./lib/cockpitIdentityTestDb";
import { actor, member, owner } from "./lib/cockpitTestDb";

const EDITOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const cases: Record<string, {
  email: string;
  roles: string[];
  active: boolean;
  confirmed: boolean;
  allowed: boolean;
  legacyRoster?: { role: string; viaPortal: boolean; viaClickup: boolean };
}> = {
  editor: { email: "editor@example.test", roles: ["editor"], active: true, confirmed: true, allowed: true },
  admin: { email: "admin@example.test", roles: ["admin"], active: true, confirmed: true, allowed: true },
  revokedEditor: { email: "editor@example.test", roles: ["editor"], active: false, confirmed: true, allowed: false },
  revokedAdmin: {
    email: "admin@example.test", roles: ["admin"], active: false, confirmed: true, allowed: false,
    legacyRoster: { role: "admin", viaPortal: true, viaClickup: false },
  },
  inactiveLegacyRosterAdmin: {
    email: "roster-admin@example.test", roles: [], active: true, confirmed: true, allowed: false,
    legacyRoster: { role: "admin", viaPortal: false, viaClickup: false },
  },
  unconfirmedEditor: { email: "editor@example.test", roles: ["editor"], active: true, confirmed: false, allowed: false },
  delegatedCeo: { email: "ordinary@example.test", roles: ["ceo"], active: true, confirmed: true, allowed: false },
  rolelessFounder: { email: "aziz@maharamedia.com", roles: [], active: true, confirmed: true, allowed: true },
  alternateFounder: { email: "  AWAHEEDI2008@gmail.com  ", roles: [], active: true, confirmed: true, allowed: true },
  revokedFounder: {
    email: "aziz@maharamedia.com", roles: [], active: false, confirmed: true, allowed: false,
    legacyRoster: { role: "editor", viaPortal: true, viaClickup: false },
  },
  unconfirmedFounder: {
    email: "aziz@maharamedia.com", roles: [], active: true, confirmed: false, allowed: false,
    legacyRoster: { role: "admin", viaPortal: true, viaClickup: false },
  },
};

const EOD_DAY = "2026-10-04";

function addLegacyRoster(
  db: PGlite,
  email: string,
  role: string,
  viaPortal: boolean,
  viaClickup: boolean,
) {
  return db.query(
    "INSERT INTO public.editor_people(email,role,via_portal,via_clickup) VALUES($1,$2,$3,$4)",
    [email, role, viaPortal, viaClickup],
  );
}

describe("Canonical native editor permission gate", () => {
  for (const [name, entry] of Object.entries(cases)) {
    test(`${name} uses confirmed active directory identity without changing profile or audit state`, async () => {
      const db = await cockpitIdentityTestDb();
      try {
        await member(db, EDITOR, entry.email, entry.roles, entry.active, entry.confirmed);
        if (entry.legacyRoster) {
          await addLegacyRoster(
            db, entry.email, entry.legacyRoster.role,
            entry.legacyRoster.viaPortal, entry.legacyRoster.viaClickup,
          );
        }
        const seats = (await db.query("SELECT * FROM public.cockpit_members ORDER BY id")).rows;
        const people = (await db.query("SELECT * FROM public.editor_people ORDER BY email")).rows;
        const audit = (await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows;
        await actor(db, EDITOR);
        const result = await db.query<{ allowed: boolean }>("SELECT public.is_editor() AS allowed");
        expect(result.rows[0].allowed).toBe(entry.allowed);
        await owner(db);
        expect((await db.query("SELECT * FROM public.cockpit_members ORDER BY id")).rows).toEqual(seats);
        expect((await db.query("SELECT * FROM public.editor_people ORDER BY email")).rows).toEqual(people);
        expect((await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows).toEqual(audit);
      } finally { await db.close(); }
    });
  }

  test("anonymous execute is denied and service role without a caller has no editor identity", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await actor(db, null);
      await expect(db.query("SELECT public.is_editor()")).rejects.toThrow(/permission denied/i);
      await owner(db);
      await db.exec("SET ROLE service_role");
      expect((await db.query<{ allowed: boolean }>("SELECT public.is_editor() AS allowed")).rows[0].allowed).toBe(false);
    } finally { await db.close(); }
  });

  test("another Auth uid cannot borrow an active legacy roster or founder JWT email", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await member(db, EDITOR, "editor@example.test", ["editor"]);
      await addLegacyRoster(db, "editor@example.test", "editor", true, false);
      await member(db, OTHER, "ordinary@example.test", ["ceo"]);
      await actor(db, OTHER);
      for (const email of ["editor@example.test", "aziz@maharamedia.com", "awaheedi2008@gmail.com"]) {
        await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: OTHER, email, role: "authenticated", app_metadata: { roles: ["admin", "editor", "ceo"] } })]);
        expect((await db.query<{ allowed: boolean }>("SELECT public.is_editor() AS allowed")).rows[0].allowed).toBe(false);
      }
    } finally { await db.close(); }
  });

  test("a legitimate editor keeps access when JWT email metadata is stale", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await member(db, EDITOR, "editor@example.test", ["editor"]);
      await addLegacyRoster(db, "editor@example.test", "editor", true, false);
      await actor(db, EDITOR);
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: EDITOR, email: "old@example.test", role: "authenticated" })]);
      expect((await db.query<{ allowed: boolean }>("SELECT public.is_editor() AS allowed")).rows[0].allowed).toBe(true);
    } finally { await db.close(); }
  });

  test("an Auth email change invalidates its old directory link despite matching stale JWT email", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await member(db, EDITOR, "editor@example.test", ["editor"]);
      await addLegacyRoster(db, "editor@example.test", "editor", true, false);
      await db.query("UPDATE auth.users SET email='changed@example.test' WHERE id=$1", [EDITOR]);
      await actor(db, EDITOR);
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: EDITOR, email: "editor@example.test", role: "authenticated" })]);
      expect((await db.query<{ allowed: boolean }>("SELECT public.is_editor() AS allowed")).rows[0].allowed).toBe(false);
    } finally { await db.close(); }
  });

  test("an unlinked confirmed founder cannot bypass the directory through the legacy roster", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await member(db, EDITOR, "aziz@maharamedia.com", []);
      await addLegacyRoster(db, "aziz@maharamedia.com", "admin", true, false);
      await db.query("UPDATE public.cockpit_members SET auth_user_id=NULL WHERE auth_user_id=$1", [EDITOR]);
      await actor(db, EDITOR);
      expect((await db.query<{ allowed: boolean }>("SELECT public.is_editor() AS allowed")).rows[0].allowed).toBe(false);
    } finally { await db.close(); }
  });
});

describe("Editor EOD ownership and audit", () => {
  test("named EOD is author-only while non-EOD work and unowned legacy history stay shared", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await member(db, EDITOR, "editor@example.test", ["editor"]);
      await member(db, OTHER, "peer@example.test", ["editor"]);
      for (const [id, kind, taskId, requestedBy] of [
        ["eod-own", "eod", `eod:${EOD_DAY}`, "editor@example.test"],
        ["eod-peer", "eod", `eod:${EOD_DAY}`, "peer@example.test"],
        ["eod-null-owner", "eod", `eod:${EOD_DAY}`, null],
        ["eod-blank-owner", "eod", `eod:${EOD_DAY}`, "   "],
        ["shared-comment", "comment", "job:shared", "peer@example.test"],
      ] as const) {
        await db.query(
          "INSERT INTO public.editor_requests(id,kind,task_id,status,requested_by) VALUES($1,$2,$3,'queued',$4)",
          [id, kind, taskId, requestedBy],
        );
      }

      await actor(db, EDITOR);
      const editorRows = (await db.query<{ id: string }>(
        "SELECT id FROM public.editor_requests ORDER BY id",
      )).rows.map(row => row.id);
      expect(editorRows).toEqual(["eod-blank-owner", "eod-null-owner", "eod-own", "shared-comment"]);

      await actor(db, OTHER);
      const peerRows = (await db.query<{ id: string }>(
        "SELECT id FROM public.editor_requests ORDER BY id",
      )).rows.map(row => row.id);
      expect(peerRows).toEqual(["eod-blank-owner", "eod-null-owner", "eod-peer", "shared-comment"]);
    } finally { await db.close(); }
  });

  test("authenticated authors are directory-bound and request insert, worker transition, and delete are audited", async () => {
    const db = await cockpitIdentityTestDb();
    try {
      await member(db, EDITOR, "editor@example.test", ["editor"]);
      const grants = (await db.query<{
        authenticated_select: boolean;
        authenticated_insert: boolean;
        authenticated_update: boolean;
        authenticated_delete: boolean;
        worker_update: boolean;
        worker_delete: boolean;
      }>(`
        SELECT
          has_table_privilege('authenticated','public.editor_requests','SELECT') AS authenticated_select,
          has_table_privilege('authenticated','public.editor_requests','INSERT') AS authenticated_insert,
          has_table_privilege('authenticated','public.editor_requests','UPDATE') AS authenticated_update,
          has_table_privilege('authenticated','public.editor_requests','DELETE') AS authenticated_delete,
          has_table_privilege('service_role','public.editor_requests','UPDATE') AS worker_update,
          has_table_privilege('service_role','public.editor_requests','DELETE') AS worker_delete
      `)).rows[0];
      expect(grants).toEqual({
        authenticated_select: true,
        authenticated_insert: true,
        authenticated_update: false,
        authenticated_delete: false,
        worker_update: true,
        worker_delete: true,
      });

      await actor(db, EDITOR);
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: EDITOR, email: "forged@example.test", role: "authenticated" }),
      ]);
      const inserted = await db.query<{ requested_by: string }>(`
        INSERT INTO public.editor_requests(id,kind,task_id,status,requested_by)
        VALUES('browser-eod','eod',$1,'queued','forged@example.test')
        RETURNING requested_by
      `, [`eod:${EOD_DAY}`]);
      expect(inserted.rows[0].requested_by).toBe("editor@example.test");
      await expect(db.query(
        "UPDATE public.editor_requests SET status='done' WHERE id='browser-eod'",
      )).rejects.toThrow(/permission denied/i);
      await expect(db.query(
        "DELETE FROM public.editor_requests WHERE id='browser-eod'",
      )).rejects.toThrow(/permission denied/i);

      await db.exec("RESET ROLE; SET ROLE service_role");
      await db.query(`
        INSERT INTO public.editor_requests(id,kind,task_id,status,requested_by)
        VALUES('worker-eod','eod',$1,'running','historical@example.test')
      `, [`eod:${EOD_DAY}`]);
      await db.query("UPDATE public.editor_requests SET status='done' WHERE id='worker-eod'");
      await db.query(`
        INSERT INTO public.editor_requests(id,kind,task_id,status,requested_by)
        VALUES('worker-delete','eod',$1,'queued','legacy@example.test')
      `, [`eod:${EOD_DAY}`]);
      await db.query("DELETE FROM public.editor_requests WHERE id='worker-delete'");
      await owner(db);

      const audit = (await db.query<{
        action: string;
        entity_id: string;
        actor_email: string | null;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        metadata: Record<string, unknown>;
      }>(`
        SELECT action,entity_id,actor_email,before,after,metadata
        FROM public.cockpit_audit_log
        WHERE entity_type='editor_requests'
      `)).rows;
      expect(audit.map(row => `${row.action}:${row.entity_id}`).sort()).toEqual([
        "DELETE:worker-delete",
        "INSERT:browser-eod",
        "INSERT:worker-delete",
        "INSERT:worker-eod",
        "UPDATE:worker-eod",
      ]);

      const browserInsert = audit.find(row => row.entity_id === "browser-eod");
      expect(browserInsert).toMatchObject({
        action: "INSERT",
        actor_email: "editor@example.test",
        before: null,
        after: { requested_by: "editor@example.test" },
        metadata: { database_role: "authenticated", auth_user_id: EDITOR },
      });
      const workerTransition = audit.find(row => row.action === "UPDATE");
      expect(workerTransition).toMatchObject({
        entity_id: "worker-eod",
        actor_email: null,
        before: { status: "running", requested_by: "historical@example.test" },
        after: { status: "done", requested_by: "historical@example.test" },
        metadata: { database_role: "service_role", auth_user_id: null },
      });
      const workerDelete = audit.find(row => row.action === "DELETE");
      expect(workerDelete).toMatchObject({
        entity_id: "worker-delete",
        before: { requested_by: "legacy@example.test" },
        after: null,
        metadata: { database_role: "service_role", auth_user_id: null },
      });
    } finally { await db.close(); }
  });
});
