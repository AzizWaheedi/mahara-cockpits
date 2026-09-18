/** The four tables the desk fills, as the cockpit reads them. */

export type JobState = "new" | "stale" | "ready" | "blocked" | "delivered";

export interface Person {
  email?: string | null;
  name?: string | null;
}

export interface Job {
  task_id: string;
  name: string | null;
  url: string | null;
  status: string | null;
  client: string | null;
  clients: string[] | null;
  client_task_id: string | null;
  editor: string | null;
  editors: Person[] | null;
  request_type: string | null;
  brief: string | null;
  script: string | null;
  script_task_id: string | null;
  footage_url: string | null;
  raw_url: string | null;
  edited_url: string | null;
  website: string | null;
  due_at: string | null;
  opened_at: string | null;
  state: JobState | null;
  ready: boolean | null;
  missing: string[] | null;
  files: number | null;
  seconds: number | null;
  transcript_chars: number | null;
  prepared_at: string | null;
  attempts: number | null;
  error: string | null;
  synced_at: string | null;
}

export interface Client {
  task_id: string;
  name: string;
  url: string | null;
  status: string | null;
  aliases: string[] | null;
  dos_donts: string | null;
  brand_dna_url: string | null;
  brand_dna: string | null;
  offer_url: string | null;
  offer: string | null;
  drive_url: string | null;
  website: string | null;
  instagram: string | null;
  docs_read_at: string | null;
  docs_error: string | null;
}

export interface Word {
  /** Start second. */
  t: number;
  /** End second. */
  e?: number;
  /** The word itself. */
  w: string;
}

export interface ScriptHit {
  line: string;
  at_sec: number | null;
  to_sec: number | null;
  matched: number;
  of: number;
  confidence: "high" | "partial";
}

export interface Asset {
  id: string;
  task_id: string;
  kind: string | null;
  drive_id: string | null;
  name: string | null;
  mime: string | null;
  bytes: number | null;
  seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_audio: boolean | null;
  preview_url: string | null;
  still_path: string | null;
  language: string | null;
  transcript: string | null;
  words: Word[] | null;
  scenes: number[] | null;
  script_hits: ScriptHit[] | null;
  method: { transcribe?: string | null; confidence?: string | null } | null;
  error: string | null;
  at: string | null;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Version {
  id: string;
  task_id: string;
  n: number | null;
  url: string | null;
  name: string | null;
  seconds: number | null;
  width: number | null;
  height: number | null;
  ratio: string | null;
  loudness: number | null;
  checks: Check[] | null;
  passed: boolean | null;
  by_name: string | null;
  at: string | null;
}

export interface Note {
  id: string;
  task_id: string;
  version: number | null;
  at_sec: number | null;
  text: string | null;
  by_email: string | null;
  by_name: string | null;
  source: string | null;
  done: boolean | null;
  at: string | null;
}

export type RequestKind = "deliver" | "check" | "comment" | "rescan";

export interface WorkRequest {
  id: string;
  kind: RequestKind;
  task_id: string;
  input: string | null;
  params: Record<string, unknown> | null;
  status: "queued" | "running" | "done" | "failed";
  requested_by: string | null;
  created_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface EditorPerson {
  email: string;
  name: string | null;
  role: "editor" | "admin" | string;
  active: boolean;
}
