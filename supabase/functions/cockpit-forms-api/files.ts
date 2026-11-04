/**
 * file.url (docs/forms/WAVE56-CONTRACT.md 4.10.4): a staff seat opens a file a client sent with a form,
 * the bank transfer receipt first. The database decides who may see it: cockpit_form_file_read runs with
 * the seat's own token (the CEO, an admin, finance, or a CSM allowed on the client) and answers the
 * object's place in the private bucket cockpit-form-files. This op then asks Storage, with the service
 * key, for a download link that lives 5 minutes, and returns it once. The link, the key and the path are
 * never logged; a refusal is one sentence.
 *
 * Storage is the project's own service (like the transcripts bucket the 1-1 notes read), so it is called
 * here directly by its REST path, not through a provider helper.
 */
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { DoorError, type Deps, type OpCtx } from "./door.ts";

export const FORM_FILES_BUCKET = "cockpit-form-files";
export const FILE_URL_SECONDS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = /^[a-z][a-zA-Z0-9]{1,30}$/;
/** The slot path of 20261102i: forms/{invite}/{field}/{sha256}.{ext}. */
const PATH = /^forms\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z][a-zA-Z0-9]{1,30}\/[0-9a-f]{64}\.(jpg|png|webp|heic|pdf)$/;

export const PICK_FILE = "Pick the answer and its file.";
export const NO_FILE = "That file could not be found.";
export const NOT_NOW = "The file could not be opened just now. Try again in a minute.";
export const NOT_YET = "Opens after the next cockpit update.";

export type FileUrl = {
  url: string;
  mime: string;
  bytes: number;
  name: string | null;
  expiresIn: number;
  /** A HEIC photo does not show in most browsers: the screen says Download to view (5.6). */
  viewable: boolean;
};

type FileRow = { path?: unknown; mime?: unknown; bytes?: unknown; name?: unknown };

/** A 5-minute signed download link for one object of the private bucket, or null when Storage did not give one. */
export async function signFormFile(deps: Deps, path: string, seconds = FILE_URL_SECONDS): Promise<string | null> {
  const base = (deps.env("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!base || !deps.serviceKey || !PATH.test(path)) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response = await deps.fetch(`${base}/storage/v1/object/sign/${FORM_FILES_BUCKET}/${encoded}`, {
      method: "POST",
      headers: {
        apikey: deps.serviceKey,
        Authorization: `Bearer ${deps.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: seconds }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const signed =
    body && typeof body === "object"
      ? ((body as { signedURL?: unknown }).signedURL ?? (body as { signedUrl?: unknown }).signedUrl)
      : null;
  if (typeof signed !== "string" || signed.trim() === "") return null;
  if (/^https:\/\//.test(signed)) return signed;
  return `${base}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}

/** file.url {responseId, field}: the seat's gate in the database, then the signed link. */
export async function fileUrl(ctx: OpCtx, body: Record<string, unknown>): Promise<FileUrl> {
  const responseId = typeof body.responseId === "string" ? body.responseId.trim() : "";
  const field = typeof body.field === "string" ? body.field.trim() : "";
  if (!UUID.test(responseId) || !FIELD.test(field)) throw new DoorError(PICK_FILE, 400);
  let row: FileRow | null;
  try {
    row = (await ctx.userRpc("cockpit_form_file_read", { p_response_id: responseId, p_field: field })) as FileRow | null;
  } catch (error) {
    // Before 20261102i is applied the read is not there: the door's own words, not the 1-1 notes'.
    if (error instanceof RpcError && (error.code === "PGRST202" || error.code === "42883")) throw new DoorError(NOT_YET, 404);
    throw error;
  }
  const path = typeof row?.path === "string" ? row.path : "";
  const mime = typeof row?.mime === "string" ? row.mime : "";
  const bytes = typeof row?.bytes === "number" ? row.bytes : Number(row?.bytes);
  if (!PATH.test(path) || !mime || !Number.isFinite(bytes)) throw new DoorError(NO_FILE, 404);
  const url = await signFormFile(ctx.deps, path);
  if (!url) throw new DoorError(NOT_NOW, 400);
  return {
    url,
    mime,
    bytes,
    name: typeof row?.name === "string" && row.name.trim() !== "" ? row.name.slice(0, 120) : null,
    expiresIn: FILE_URL_SECONDS,
    viewable: mime !== "image/heic",
  };
}
