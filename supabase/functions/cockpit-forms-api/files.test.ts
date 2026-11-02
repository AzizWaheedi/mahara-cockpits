import { describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { DoorError } from "./door.ts";
import { FILE_URL_SECONDS, FORM_FILES_BUCKET, fileUrl, NO_FILE, NOT_NOW, NOT_YET, PICK_FILE, signFormFile } from "./files.ts";
import { answer, csmActor, fakeDeps, opOf, SERVICE_KEY } from "./testkit.ts";

const URL_BASE = "https://proj.supabase.test";
const RESPONSE = "0f0e0d0c-0b0a-4908-8706-050403020100";
const INVITE = "00000000-0000-4000-8000-00000000f001";
const PATH = `forms/${INVITE}/receipt/${"a".repeat(64)}.jpg`;
const ROW = { path: PATH, mime: "image/jpeg", bytes: 182340, name: "receipt.jpg", bucket: FORM_FILES_BUCKET };

/** Storage's sign endpoint: answers a relative signedURL, as Supabase does. */
const storage = (status = 200, body: unknown = { signedURL: `/object/sign/${FORM_FILES_BUCKET}/${PATH}?token=signed-token` }) =>
  (url: URL) => (url.pathname.startsWith("/storage/v1/object/sign/") ? answer(body, status) : null);

describe("file.url (WAVE56 4.10.4)", () => {
  test("reads the file's place with the seat's own token, then signs it for 5 minutes with the service key", async () => {
    const f = fakeDeps({ seat: { cockpit_form_file_read: ROW }, routes: [storage()], env: { SUPABASE_URL: `${URL_BASE}/` } });
    const got = await fileUrl(opOf(f.deps, csmActor), { responseId: RESPONSE, field: "receipt" });
    expect(got).toEqual({
      url: `${URL_BASE}/storage/v1/object/sign/${FORM_FILES_BUCKET}/${PATH}?token=signed-token`,
      mime: "image/jpeg",
      bytes: 182340,
      name: "receipt.jpg",
      expiresIn: FILE_URL_SECONDS,
      viewable: true,
    });
    expect(f.seat.named("cockpit_form_file_read")[0].args).toEqual({ p_response_id: RESPONSE, p_field: "receipt" });
    expect(f.service.calls).toHaveLength(0);
    expect(f.sent).toHaveLength(1);
    const sent = f.sent[0];
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(`${URL_BASE}/storage/v1/object/sign/${FORM_FILES_BUCKET}/${PATH}`);
    expect(sent.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(sent.headers.apikey).toBe(SERVICE_KEY);
    expect(JSON.parse(sent.body ?? "{}")).toEqual({ expiresIn: 300 });
    expect(FILE_URL_SECONDS).toBe(300);
  });

  test("a HEIC photo is not viewable in the browser: the screen says Download to view", async () => {
    const f = fakeDeps({
      seat: { cockpit_form_file_read: { ...ROW, mime: "image/heic", path: PATH.replace(".jpg", ".heic") } },
      routes: [storage(200, { signedURL: "/object/sign/x.heic?token=t" })],
      env: { SUPABASE_URL: URL_BASE },
    });
    const got = await fileUrl(opOf(f.deps), { responseId: RESPONSE, field: "receipt" });
    expect(got.viewable).toBe(false);
    expect(got.url).toBe(`${URL_BASE}/storage/v1/object/sign/x.heic?token=t`);
  });

  test("a bad answer id or field is refused before any call", async () => {
    const f = fakeDeps({ seat: { cockpit_form_file_read: ROW }, routes: [storage()], env: { SUPABASE_URL: URL_BASE } });
    for (const body of [{}, { responseId: "nope", field: "receipt" }, { responseId: RESPONSE, field: "Receipt!" }, { responseId: RESPONSE }]) {
      const e = await fileUrl(opOf(f.deps), body).catch(x => x);
      expect(e).toBeInstanceOf(DoorError);
      expect([e.message, e.status]).toEqual([PICK_FILE, 400]);
    }
    expect(f.seat.calls).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
  });

  test("the database's refusal passes through as it is, and nothing is signed", async () => {
    const f = fakeDeps({
      seat: {
        cockpit_form_file_read: () => {
          throw new RpcError("Beta Build is not one of your clients.", "42501");
        },
      },
      routes: [storage()],
      env: { SUPABASE_URL: URL_BASE },
    });
    const e = await fileUrl(opOf(f.deps), { responseId: RESPONSE, field: "receipt" }).catch(x => x);
    expect(e).toBeInstanceOf(RpcError);
    expect(e.code).toBe("42501");
    expect(f.sent).toHaveLength(0);
  });

  test("before 20261102i is applied the read is missing: Opens after the next cockpit update.", async () => {
    const f = fakeDeps({ routes: [storage()], env: { SUPABASE_URL: URL_BASE } });
    const e = await fileUrl(opOf(f.deps), { responseId: RESPONSE, field: "receipt" }).catch(x => x);
    expect([e.message, e.status]).toEqual([NOT_YET, 404]);
  });

  test("a row that is not a slot path is not signed", async () => {
    for (const row of [null, { ...ROW, path: "../../etc/passwd" }, { ...ROW, path: "csm-call-transcripts/x.txt" }, { ...ROW, mime: "" }]) {
      const f = fakeDeps({ seat: { cockpit_form_file_read: row }, routes: [storage()], env: { SUPABASE_URL: URL_BASE } });
      const e = await fileUrl(opOf(f.deps), { responseId: RESPONSE, field: "receipt" }).catch(x => x);
      expect([e.message, e.status]).toEqual([NO_FILE, 404]);
      expect(f.sent).toHaveLength(0);
    }
  });

  test("Storage that refuses, fails or answers no link: one plain sentence", async () => {
    const cases = [
      fakeDeps({ seat: { cockpit_form_file_read: ROW }, routes: [storage(400, { error: "Object not found" })], env: { SUPABASE_URL: URL_BASE } }),
      fakeDeps({ seat: { cockpit_form_file_read: ROW }, routes: [storage(200, { nothing: true })], env: { SUPABASE_URL: URL_BASE } }),
      fakeDeps({ seat: { cockpit_form_file_read: ROW }, routes: [], env: { SUPABASE_URL: URL_BASE } }),
      fakeDeps({ seat: { cockpit_form_file_read: ROW }, routes: [storage()] }),
    ];
    for (const f of cases) {
      const e = await fileUrl(opOf(f.deps), { responseId: RESPONSE, field: "receipt" }).catch(x => x);
      expect([e.message, e.status]).toEqual([NOT_NOW, 400]);
      expect(String(e.message)).not.toContain("Object not found");
    }
  });

  test("signFormFile signs only a slot path, and keeps an absolute link as Storage gave it", async () => {
    const f = fakeDeps({ routes: [storage(200, { signedUrl: "https://cdn.example/x?token=t" })], env: { SUPABASE_URL: URL_BASE } });
    expect(await signFormFile(f.deps, "../secret")).toBeNull();
    expect(f.sent).toHaveLength(0);
    expect(await signFormFile(f.deps, PATH)).toBe("https://cdn.example/x?token=t");
  });
});
