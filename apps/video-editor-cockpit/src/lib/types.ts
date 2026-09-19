/** The four tables the desk fills, as the cockpit reads them. */

export type JobState = "new" | "stale" | "ready" | "blocked" | "delivered" | "gone";

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
  /** What the editor last asked for on this job, and when. */
  asked_for: string | null;
  asked_at: string | null;
  asked_by: string | null;
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
  /** Drive's modifiedTime for the document, so the desk can tell it changed. */
  brand_dna_rev: string | null;
  offer_url: string | null;
  offer: string | null;
  offer_rev: string | null;
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

/** Everything the cockpit can ask the worker to do. Mirrors KINDS in queue.py. */
export type RequestKind =
  | "deliver"
  | "check"
  | "comment"
  | "rescan"
  | "ask"
  | "status"
  | "eod"
  | "dosdonts"
  | "toideation";

/** What an editor can be short of. Mirrors ASK_FOR in the worker. */
export type AskTopic =
  | "footage"
  | "brief"
  | "script"
  | "brand"
  | "music"
  | "access"
  | "approval"
  | "other";

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

/** A winning ad, mirrored out of the media buyer, which owns the definition. */
export interface WinnerAd {
  ad_id: string;
  ad_name: string | null;
  client: string | null;
  service_line: string | null;
  city: string | null;
  format: string | null;
  cta: string | null;
  headline: string | null;
  body: string | null;
  transcript: string | null;
  hook: string | null;
  voice: string | null;
  thumb_url: string | null;
  spend: number | null;
  leads: number | null;
  cpl: number | null;
  origin: string | null;
  /** Facebook's ordinary video embed. Public, and it does not expire. */
  watch_url: string | null;
  video_id: string | null;
}

/** A post on the ideation board, shared with the creative director. */
export interface Idea {
  key: string;
  platform: string | null;
  url: string;
  status: string | null;
  author_handle: string | null;
  author_name: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  caption: string | null;
  duration_sec: number | null;
  thumb_url: string | null;
  still_path: string | null;
  /** The radar keeps one when the platform gave a playable file. Often not. */
  media_url: string | null;
  industry: string | null;
  multiplier: number | null;
  tier: string | null;
  format: string | null;
  hook: { line?: string; kind?: string } | null;
  why_it_works: string | null;
  transcript: string | null;
  saved_by_name: string | null;
  saved_at: string | null;
  saved_note: string | null;
}

/** A team meeting from Fathom, shown to the people who were on the invite. */
export interface TeamMeeting {
  recording_id: string;
  title: string | null;
  started_at: string | null;
  ended_at: string | null;
  url: string | null;
  share_url: string | null;
  host: string | null;
  invitees: { name: string; email: string; external: boolean }[] | null;
  summary_md: string | null;
  action_items: { text: string; for: string }[] | null;
  language: string | null;
}

/** An ad saved in Foreplay, mirrored into our own store. */
export interface SwipeAd {
  id: string;
  ad_id: string | null;
  name: string | null;
  board_id: string | null;
  board_name: string | null;
  video: string | null;
  image: string | null;
  thumbnail: string | null;
  foreplay_url: string | null;
  link_url: string | null;
  headline: string | null;
  description: string | null;
  cta_title: string | null;
  display_format: string | null;
  publisher_platform: string[] | null;
  niches: string[] | null;
  languages: string[] | null;
  market_target: string | null;
  live: boolean | null;
  started_running: string | null;
  /** Days on air: the strongest single signal that an ad is working. */
  running_duration: number | null;
  video_duration: number | null;
  full_transcription: string | null;
  persona: string | null;
}
