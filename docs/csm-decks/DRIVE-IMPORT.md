# CSM decks: their ads from a Drive link, the backend contract

The CEO, 2026-10-20: "for their ads allow just a drive link to work and it
can work with folder or just the video. make it really easy for him to
prepare." The client success manager pastes a Drive link in prep (or in the
notes window during the call), or several at once, straight from a WhatsApp
message; the pictures and videos behind each link arrive in the launch
deck's ads tray exactly as if they had been uploaded by hand. The first
files arrive in about a minute; a folder of twenty videos takes several
minutes, because files come in one after another. A phone video too large
or in a format a browser can't play is converted to MP4 on the desk, so
the CSM never exports anything by hand.

This file is what the migrations build, what the VPS worker does and what
the frontend calls. `DESIGN.md` 22.7 is the box and its states,
`CONTENT.md` and `CONTENT-AR.md` ("The visual pass") the words, and
`VIDEOS.md` 9 the video posters the same worker fills. It is a spec:
nothing here is applied yet. A name, an argument, a return shape, a
sentence, a code or a path changes only by changing this file first.
`DESIGN.md` 22.10 is the change log of its review.

Migrations, on the Creative Triage project (`bldgtotkfmhoxmlzowdx`), each
one `BEGIN; … COMMIT;` that applies twice without error, in this order,
after `20261020120000_csm_deck_videos.sql`:

- `supabase/migrations/20261020160000_csm_launch_ads_drive.sql`: the
  imports (sections 2 to 6).
- `supabase/migrations/20261020160100_csm_deck_prep_dos_ar.sql`: three
  prep keys, `dos_donts_ar`, `example_theme` and `service_chosen_at`
  (section 9).
- `supabase/migrations/20261020160200_csm_deck_video_posters.sql`: the
  video posters (`VIDEOS.md` 9).

Their PGlite tests join `apps/media-buyer-cockpit/scripts/
csm-decks-supabase.test.ts` (section 10), and the census there changes in
the same commit. The worker is a new command of `hermes/editor-desk`
(section 7).

## 1. What it is, in short

- **One import per link.** A row in `public.cockpit_csm_launch_ads_imports`
  holds the link (parsed and rebuilt by the server), who asked, its state
  (queued, working, done, failed), its counts and one entry per file. A
  paste of several links makes one import per link (section 8).
- **The browser never touches the table.** Row security on, no policies, no
  grants to any role. Two `SECURITY DEFINER` functions with
  `search_path = ''` serve the browser (request, read), gated on the
  client success seat for that client (`cockpit_csm_client_gate`). Seven
  serve the worker, executable by `service_role` only (claim, heartbeat,
  plan, file reserve, file landed, file failed, finish).
- **The files land the way an upload does.** For each file the worker
  reserves a `cockpit_csm_launch_ads` row (status `uploading`, the same
  path rule, the same checks), uploads the bytes to the private bucket
  `cockpit-launch-ads`, and the server checks Storage's own metadata before
  the row turns `ready`, as `cockpit_csm_launch_ad_accept` does for the
  browser. A crash leaves an `uploading` row; the next run that takes the
  import resumes it (section 7), and the tray's existing sweep removes any
  row nobody resumes, with its bytes, after a day.
- **Never twice.** A Drive file is in a client's tray at most once: a
  partial unique index on `(task_id, source_drive_id)` for rows not
  removed. Pasting the same folder again brings in only what is new. A
  file the CSM removed from the tray can come back by pasting its link
  again.
- **Every end is the same end.** However an import ends (done, failed by
  the worker, stopped, not started, access revoked), one internal function
  closes it: its unfinished files fail with a sentence and their
  `uploading` rows are removed, so no failed import shows a file still
  "Bringing in" and no orphan row holds the unique index.
- **Every write leaves one `cockpit_audit_log` row**, through the decks'
  audit trigger, with the worker named as the actor; a heartbeat leaves
  none (section 5).
- **Departures from the lead's direction, and why.** The lead named three
  worker calls (claim, file landed, finish). This contract has seven:
  `plan` records what the worker found before any download, so the box can
  say "Bringing in 6 files from Drive…" and skip what is already in the
  tray without fetching it; `file_reserve` creates the row before the bytes
  move, so a crash never leaves an object no row owns; `file_failed`
  records a file's own failure, so the box can say which file failed and
  why while the others land; `heartbeat` keeps a long download's claim and
  the box's "last ran" line true while no other call happens. It also
  adds a one-row worker state table, so the box can say when the importer
  last ran (section 3). The lead's 150 MB limit on a video is now the
  bucket's limit on what lands, not on what Drive holds: a larger phone
  video is converted (section 7).

## 2. The links the server takes

`public.cockpit_csm_drive_link_parse(p_link text) RETURNS jsonb`,
`LANGUAGE plpgsql IMMUTABLE SET search_path = ''`, not a definer, no grant.
The browser runs the same rules in `src/present/driveLink.ts`; both are
tested against one table of cases (`src/present/driveLink.cases.json`,
section 10). The server is the authority. It takes one link; the browser
splits a paste into links first (section 8).

1. Trim. Empty or null: `link_empty`.
2. Longer than 2000 characters, or anything but printable ASCII after
   trimming: `link_bad`.
3. No scheme: `https://` is assumed. A scheme other than `http` or `https`:
   `link_bad`. A user, a password or a port: `link_bad`.
4. Host `docs.google.com` with a path starting `/document/`,
   `/spreadsheets/`, `/presentation/`, `/forms/` or `/drawings/`:
   `link_docs`.
5. Host `drive.google.com` (or `www.drive.google.com`), matched on the path,
   with an optional `/u/<digit>` after `/drive` or `/file`:

| Shape | Kind |
|---|---|
| `/drive/folders/<id>` (with or without `/u/<n>`) | `folder` |
| `/drive/mobile/folders/<id>` (a phone's browser copies it so; with or without `/u/<n>`; the fixer's round) | `folder` |
| `/folderview?id=<id>` | `folder` |
| `/file/d/<id>` followed by nothing, `/view`, `/edit`, `/preview` or `/` | `file` |
| `/open?id=<id>` | `either` (Drive says which, section 7) |
| `/uc?id=<id>` (any `export=`) | `file` |
| `/drive/` followed by `my-drive`, `shared-with-me`, `recent`, `starred`, `home`, `computers`, `search` or nothing, with no id | `link_page` |

6. Host `drive.usercontent.google.com`, path `/download`, `id=<id>`: `file`.
7. Anything else: `link_bad`.

`<id>` is `[A-Za-z0-9_-]{10,200}`. A `resourcekey=<key>` query parameter
(`[A-Za-z0-9_-]{1,100}`) is kept; every other parameter (`usp`, `authuser`,
`pli` and the rest) is dropped, so an email address in `authuser` is never
stored.

Returns `{"ok": true, "id", "kind", "resourceKey", "link"}` with `link`
rebuilt from the id alone: `https://drive.google.com/drive/folders/<id>`,
`https://drive.google.com/file/d/<id>/view` or
`https://drive.google.com/open?id=<id>`, with `?resourcekey=` (or
`&resourcekey=`) when there is one. On a refusal: `{"ok": false, "code"}`.
The sentences are section 6's.

## 3. The tables

```sql
CREATE TABLE IF NOT EXISTS public.cockpit_csm_launch_ads_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  link text NOT NULL CHECK (link ~ '^https://drive[.]google[.]com/' AND char_length(link) <= 400),
  drive_id text NOT NULL CHECK (drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  resource_key text CHECK (resource_key IS NULL OR resource_key ~ '^[A-Za-z0-9_-]{1,100}$'),
  kind text NOT NULL CHECK (kind IN ('file','folder','either')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','working','done','failed')),
  code text CHECK (code IS NULL OR code IN ('not_found','not_media','nothing_found','drive_down',
                                            'access_revoked','stopped','not_started')),
  message text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 300),
  found integer CHECK (found IS NULL OR found BETWEEN 1 AND 20),
  over_limit boolean NOT NULL DEFAULT false,
  landed integer NOT NULL DEFAULT 0 CHECK (landed BETWEEN 0 AND 20),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped BETWEEN 0 AND 20),
  failed integer NOT NULL DEFAULT 0 CHECK (failed BETWEEN 0 AND 20),
  files jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) <= 20),
  -- Takes in a row without a file landing; file_landed sets it back to 0.
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  requested_by uuid NOT NULL,
  requested_by_email text NOT NULL CHECK (btrim(requested_by_email) <> ''),
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text CHECK (claimed_by IS NULL OR claimed_by ~ '^[a-z0-9@._:-]{1,80}$'),
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_csm_launch_ads_imports_state CHECK (
    (status = 'queued'  AND claimed_at IS NULL     AND finished_at IS NULL) OR
    (status = 'working' AND claimed_at IS NOT NULL AND finished_at IS NULL) OR
    (status IN ('done','failed') AND finished_at IS NOT NULL)),
  CONSTRAINT cockpit_csm_launch_ads_imports_failed CHECK (
    (status = 'failed') = (code IS NOT NULL AND message IS NOT NULL)),
  CONSTRAINT cockpit_csm_launch_ads_imports_counts CHECK (
    landed + skipped + failed <= coalesce(found, 0))
);
CREATE INDEX IF NOT EXISTS cockpit_csm_launch_ads_imports_task_idx
  ON public.cockpit_csm_launch_ads_imports (task_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_csm_launch_ads_imports_open_idx
  ON public.cockpit_csm_launch_ads_imports (requested_at) WHERE status IN ('queued','working');
-- One open import per link per client: a second paste returns the first.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_launch_ads_imports_one_open
  ON public.cockpit_csm_launch_ads_imports (task_id, drive_id) WHERE status IN ('queued','working');

-- When the importer last showed it was alive. A heartbeat, not an action:
-- it is written on every worker call and leaves no audit row (the audit log
-- was compacted on 2026-10-09; 525,000 heartbeat rows a year would undo it).
CREATE TABLE IF NOT EXISTS public.cockpit_csm_drive_import_worker (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  worker text NOT NULL CHECK (worker ~ '^[a-z0-9@._:-]{1,80}$'),
  seen_at timestamptz NOT NULL
);

ALTER TABLE public.cockpit_csm_launch_ads_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_drive_import_worker ENABLE ROW LEVEL SECURITY;
-- No policies and no grants, the service key included: the functions below
-- are the only door, and they run as their owner.
REVOKE ALL ON public.cockpit_csm_launch_ads_imports, public.cockpit_csm_drive_import_worker
  FROM PUBLIC, anon, authenticated, service_role;
```

**One entry in `files`** (written only by the functions):

```json
{
  "driveId": "1AbCdEfGhIjKlMnOp", "resourceKey": null,
  "name": "kitchen-reel.mov", "mime": "video/quicktime",
  "bytes": 48213211, "createdTime": "2026-10-18T09:12:00Z",
  "status": "landed", "code": null, "message": null, "note": null,
  "adId": "6f0c…"
}
```

`status` is `queued`, `working`, `landed`, `skipped` (already in the tray) or
`failed`; `code` and `message` are set only on `failed` (section 6); `note`
is `converted` or null, set only on a landed file that was converted to MP4
on the desk (section 6). `resourceKey` is the file's own Drive resource key,
or null.

**The tray's table gains its source** (in the same migration):

```sql
ALTER TABLE public.cockpit_csm_launch_ads
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','drive')),
  ADD COLUMN IF NOT EXISTS source_drive_id text
    CHECK (source_drive_id IS NULL OR source_drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.cockpit_csm_launch_ads_imports(id);
-- Added in a DO block that skips it when it exists, so the file applies twice.
ALTER TABLE public.cockpit_csm_launch_ads ADD CONSTRAINT cockpit_csm_launch_ads_source CHECK (
  (source = 'drive') = (source_drive_id IS NOT NULL AND import_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_launch_ads_drive_once
  ON public.cockpit_csm_launch_ads (task_id, source_drive_id)
  WHERE source_drive_id IS NOT NULL AND status <> 'removed';
```

`cockpit_csm_launch_ad_json` is not changed: the tray's rows keep their
shape, and nothing in the browser's schemas moves. The table's existing
grants (`service_role`: select, insert, update) are not changed.

## 4. The functions

All are `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''` unless the
table at the end of this section says otherwise, raise with the codes of
section 6 (the sentence as the message, the code name as the `HINT`, so the
browser can place it), and name their action for the audit with
`set_config('cockpit.deck_action', …, true)`. The worker's functions also
set `cockpit.deck_actor` to `worker:` and the worker's name (section 5).

### `public.cockpit_csm_launch_ads_import_request(p_task_id text, p_link text) RETURNS jsonb`

`VOLATILE`, `authenticated` only. In order, stopping at the first failure:

1. `g := public.cockpit_csm_client_gate(p_task_id)`: its own sentences and
   `42501` (no client success seat, or not this client's).
2. The link through the parser (section 2); a refusal raises its sentence
   (`22023`).
3. `pg_advisory_xact_lock(hashtextextended('cockpit_csm_launch_ads_imports:'
   || p_task_id, 0))`.
4. An open import (queued or working) of this client with the same
   `drive_id`: returns it with `"existing": true`. Nothing is written.
5. Ten open imports for this client already: `too_many_open`. (Ten, so one
   paste of up to ten links goes in whole, section 8.)
6. Thirty requests by this seat (`requested_by = auth.uid()`) in the last
   hour: `too_many_links`.
7. Inserts the row (`queued`, the rebuilt link, `requested_by`,
   `requested_by_email` = `g->>'email'`), action `driveImport.request`.

Returns the import (the read's shape, below) with `"existing": false`.

### `public.cockpit_csm_launch_ads_imports_read(p_task_id text) RETURNS jsonb`

`STABLE`, `authenticated` only. The gate, then:

```json
{
  "imports": [
    {
      "id": "uuid", "taskId": "86c1abcde", "link": "https://drive.google.com/drive/folders/1AbC…",
      "driveId": "1AbC…", "kind": "folder", "status": "working",
      "code": null, "message": null,
      "found": 6, "overLimit": false, "landed": 2, "skipped": 1, "failed": 0,
      "files": [ { "driveId": "…", "name": "…", "kind": "video", "bytes": 48213211,
                   "status": "landed", "code": null, "message": null, "note": null, "adId": "uuid" } ],
      "requestedBy": "sara@maharamedia.com", "requestedAt": "2026-10-20T13:02:11+00:00",
      "startedAt": "2026-10-20T13:02:40+00:00", "finishedAt": null, "updatedAt": "2026-10-20T13:03:05+00:00"
    }
  ],
  "workerSeenAt": "2026-10-20T13:03:00+00:00",
  "at": "2026-10-20T13:03:07+00:00"
}
```

- `imports`: this client's open imports, whatever their age, and its
  finished ones from the last 14 days, newest first (`requested_at DESC`),
  at most 20 in all (up to ten open, the rest finished).
- A file's `kind` is `image` or `video`, from its `mime`; the entry's
  `mime`, `createdTime` and `resourceKey` are not returned.
- `found` is `null` until the worker has planned (never shown as 0).
- `workerSeenAt`: `greatest(<the worker state row's seen_at>,
  max(heartbeat_at) over every import that is working)`, or `null` when
  both are null. A long download therefore never reads as a worker that
  stopped. `at`: `now()`.

### The worker functions: what every one of them does first

Each of the seven, in this order:

1. `p_worker` must match `^[a-z0-9@._:-]{1,80}$`, else `22023` "Name the
   worker."
2. Upserts the worker state row (`seen_at = now()`, `worker = p_worker`);
   claim's peek is the one call that skips this.
3. Every one but claim: `SELECT * INTO imp FROM
   public.cockpit_csm_launch_ads_imports WHERE id = p_import_id FOR
   UPDATE`; none: `P0002` "No such import."; not `working`, or
   `claimed_by <> p_worker`: `40001` "This import is not yours to work
   on." So a lost claim (another run took it after it expired) stops the
   slower run at its next call, and two calls on one import never
   interleave their writes to `files` and the counters.
4. A function that changes the import also sets `heartbeat_at = now()` in
   the same update. A call that would change nothing writes nothing to the
   import (the heartbeat function is the only write that is a heartbeat
   alone).

`40001` means only a lost claim. The worker stops working that import on
it and writes nothing more.

### `public.cockpit_csm_launch_ads_import_claim(p_worker text, p_peek boolean DEFAULT false) RETURNS jsonb`

`VOLATILE`, `service_role` only.

- **Peek** (`p_peek = true`, the doctor): returns `{"queued", "working",
  "oldestQueuedAt", "workerSeenAt"}` and writes nothing (not even the
  worker row).
- Otherwise it looks at up to twenty imports, oldest first (by
  `requested_at`), that are `queued`, or `working` with `heartbeat_at`
  older than 5 minutes, taken `FOR UPDATE SKIP LOCKED`. For each, in this
  order:
  1. `working` with `attempts = 3` (three takes in a row without a file
     landing): ends it as failed `stopped` (`import_end`) and looks at the
     next.
  2. The requester's access, `public.cockpit_csm_client_gate_for_actor
     (requested_by, task_id)`:
     - `42501`: ends it as failed `access_revoked` and looks at the next.
     - Any other error (the roster being refreshed, or this one client's
       card missing or ambiguous): leaves it as it is and looks at the
       next. If its last activity, `coalesce(heartbeat_at, requested_at)`,
       is over 30 minutes old, it ends instead: a `queued` import as failed
       `not_started`, a `working` one as failed `stopped`. One client's
       broken card therefore never blocks another client's import.
  3. Otherwise it is taken: `status = 'working'`, `claimed_at = coalesce
     (claimed_at, now())`, `claimed_by = p_worker`, `heartbeat_at = now()`,
     `attempts + 1`, action `driveImport.claim`. It is returned.
- Returns `{"import": {… the read's shape, plus "resourceKey", each file's
  "mime" and "resourceKey", and "resumed": found IS NOT NULL}, "queued":
  <imports still waiting>}`; or `{"import": null, "waiting": "<the first
  gate sentence>", "queued": n}` when every import it looked at gave a
  gate error other than `42501`; or `{"import": null, "queued": 0}`.

### `public.cockpit_csm_launch_ads_import_heartbeat(p_import_id uuid, p_worker text) RETURNS void`

`VOLATILE`, `service_role` only. The common checks (they upsert the worker
row's `seen_at`), then `heartbeat_at = now()` on the import. It is the one
write the audit trigger skips (section 5). The worker calls it at most every
60 seconds while it downloads, converts or uploads.

### `public.cockpit_csm_launch_ads_import_plan(p_import_id uuid, p_worker text, p_kind text, p_files jsonb, p_over_limit boolean DEFAULT false) RETURNS jsonb`

What Drive holds behind the link, before any download.

- `p_kind`: `file` or `folder`, what Drive said (it replaces `either`, and a
  link that said `folder` but opens a file is recorded as a file).
- `p_files`: 1 to 20 objects `{id, name, mime, bytes, createdTime,
  resourceKey}`. Each is checked: `id` as section 2; `name` cut to its last
  path segment, control and bidi characters removed, 1 to 200 characters;
  `mime` `^(image|video)/[a-z0-9.+-]{1,60}$`; `bytes` null or 0 to 10^12;
  `createdTime` null or an ISO time; `resourceKey` null or
  `^[A-Za-z0-9_-]{1,100}$`. Empty: `22023` "Send at least one file, or
  finish with nothing_found."
- Each file is `skipped` when this client already has a launch ad with that
  `source_drive_id` that is not removed, else `queued`.
- Sets `files`, `found`, `skipped`, `over_limit`, action `driveImport.plan`.
- A second plan on the same claim replaces the first only while every file
  is still `queued` or `skipped`; else `55000` "This import already started
  its files." (never `40001`, which means only a lost claim). The worker
  never sends a second plan for an import that came back `resumed`.

Returns the import.

### `public.cockpit_csm_launch_ads_import_file_reserve(p_import_id uuid, p_worker text, p_drive_file_id text, p_mime text, p_bytes bigint, p_width integer DEFAULT NULL, p_height integer DEFAULT NULL, p_seconds numeric DEFAULT NULL, p_poster_mime text DEFAULT NULL, p_poster_bytes bigint DEFAULT NULL, p_note text DEFAULT NULL) RETURNS jsonb`

After the worker downloaded, checked, converted if needed and probed the
file, before it uploads.

1. The entry must exist with status `queued` or `working` (`22023` "That
   file is not in this import's plan."). An entry already `landed`,
   `skipped` or `failed`: returns `{"done": true}`, writing nothing.
2. The requester's access, as in claim: on `42501` the import ends as
   failed `access_revoked` (`import_end`) and the call returns
   `{"stopped": true}`.
3. The facts, as `cockpit_csm_launch_ad_reserve` checks them: `p_mime` one of
   the bucket's six (`image/jpeg`, `image/png`, `image/webp`, `video/mp4`,
   `video/quicktime`, `video/webm`); `p_bytes` 1 to 157286400; width and
   height 1 to 20000; seconds above 0 and at most 3600; a poster only for a
   video, JPEG, PNG or WebP, 1 to 5242880 bytes; `p_note` null or
   `converted`. A refusal raises `22023` with the reserve's own sentence
   (the worker never sends one it would refuse; this is the server's
   guard).
4. **A resumed entry.** The entry has an `adId` whose row is `uploading`
   (a run that died after reserving, or a retried call): `p_mime` must equal
   the row's `mime` (else `22023` "That file changed in Drive since it was
   reserved."); the row's facts (`bytes`, width, height, seconds, the
   poster's type and size) are replaced with these; returns `{"adId",
   "path", "posterPath", "resumed": true}`. Its paths do not change.
5. 200 files of this client not removed: the entry fails with `full` and
   the call returns `{"failed": true, "code": "full"}`.
6. A launch ad of this client with this `source_drive_id`, not removed,
   exists now: the entry turns `skipped` (`skipped + 1`) and the call
   returns `{"skipped": true}`.
7. Inserts the launch ad, inside `BEGIN … EXCEPTION WHEN unique_violation
   THEN` (two imports racing for one file: the loser's entry turns
   `skipped` and the call returns `{"skipped": true}`): a new `id`;
   `request_id` random (`gen_random_uuid()`; as built in the fixer's
   round: a resumed reserve finds its row by the entry's `adId`, and an id
   derived from the import and the file could be sent first by a browser's
   own reserve, which takes its request id from the caller); `kind` `custom` (the client's own content);
   `status` `uploading`; `storage_path` `<task_id>/<id>.<ext>` and
   `poster_path` `<task_id>/<id>-poster.<ext>` (the table's own path
   checks); the facts; `file_name` the entry's name; `created_by` and
   `created_by_email` the requester's; `updated_by` `worker:<name>`;
   `source` `drive`, `source_drive_id`, `import_id`. Action
   `driveImport.reserve`. The entry turns `working` with its `adId` and
   `note`.

Returns `{"adId", "path", "posterPath", "resumed": false}` (`posterPath`
null for a picture).

### `public.cockpit_csm_launch_ads_import_file_landed(p_import_id uuid, p_worker text, p_drive_file_id text) RETURNS jsonb`

- The entry `working` with an `adId` whose row is `uploading` (an entry
  already `landed` returns the import, writing nothing).
- Storage's own metadata for the file (and the poster) must match the row's
  size and type, read from `storage.objects` as
  `cockpit_csm_launch_ad_accept` reads it; else `22023` "The file did not
  arrive. Upload it again." (the worker then reports `storage`).
- The row turns `ready` (`ready_at`, `updated_by`), action
  `driveImport.ready`; the entry turns `landed`; `landed + 1`;
  `attempts = 0`.

Returns the import.

### `public.cockpit_csm_launch_ads_import_file_failed(p_import_id uuid, p_worker text, p_drive_file_id text, p_code text) RETURNS jsonb`

- `p_code` one of `too_big`, `wrong_type`, `heic`, `unplayable`,
  `download`, `storage` (else `22023` "Name a file failure.").
- The entry turns `failed` with its code and the sentence built from its
  name (and, for `too_big`, its kind); `failed + 1`. If its row is
  `uploading`, the row turns `removed` (action `driveImport.drop`), so the
  tray's sweep deletes any bytes that arrived.
- An entry already failed, landed or skipped: returns the import, writing
  nothing.

### `public.cockpit_csm_launch_ads_import_finish(p_import_id uuid, p_worker text, p_code text DEFAULT NULL) RETURNS jsonb`

- `p_code` null: the import ends `done` (`import_end`). `code` and `message`
  stay null: the box words a finished import from its counts (`CONTENT.md`,
  "The visual pass").
- `p_code` one of `not_found`, `not_media`, `nothing_found`, `drive_down`:
  the import ends `failed` with that code and its sentence (`not_found`
  takes the folder, file or link variant by `kind`). Any other code:
  `22023` "Name an import failure." (`access_revoked`, `stopped` and
  `not_started` are the server's own and are never sent.)
- An import already finished returns itself, writing nothing.

### Internal: `public.cockpit_csm_launch_ads_import_end(p_import_id uuid, p_code text) RETURNS public.cockpit_csm_launch_ads_imports`

The one way an import ends. Its caller already holds the row (`FOR UPDATE`).

1. Every entry still `queued` or `working` turns `failed` with
   `unfinished` and its sentence (`failed + 1`); each of their rows that is
   `uploading` turns `removed` (action `driveImport.drop`).
2. `p_code` null: `status = 'done'`. Else `status = 'failed'`, `code`,
   `message` from `cockpit_csm_drive_import_sentence`.
3. `finished_at = now()`, action `driveImport.finish`.

Called by finish, by claim (`stopped`, `access_revoked`, `not_started`) and
by file reserve (`access_revoked`).

### Internal (no grant to any role)

| Function | Kind |
|---|---|
| `cockpit_csm_drive_link_parse(text) RETURNS jsonb` | `plpgsql IMMUTABLE SET search_path = ''`, not a definer |
| `cockpit_csm_drive_import_sentence(p_code text, p_name text, p_kind text) RETURNS text` | `sql IMMUTABLE SET search_path = ''`, not a definer: every sentence of section 6 in one place |
| `cockpit_csm_launch_ads_import_json(public.cockpit_csm_launch_ads_imports, p_worker boolean) RETURNS jsonb` | `sql STABLE SECURITY DEFINER SET search_path = ''`: the read's shape (`p_worker` adds `resourceKey`, each file's `mime` and `resourceKey`, and `resumed`) |
| `cockpit_csm_launch_ads_import_end(uuid, text) RETURNS public.cockpit_csm_launch_ads_imports` | `plpgsql SECURITY DEFINER SET search_path = ''` |

### Grants

```sql
REVOKE ALL ON FUNCTION
  public.cockpit_csm_launch_ads_import_request(text, text),
  public.cockpit_csm_launch_ads_imports_read(text),
  public.cockpit_csm_launch_ads_import_claim(text, boolean),
  public.cockpit_csm_launch_ads_import_heartbeat(uuid, text),
  public.cockpit_csm_launch_ads_import_plan(uuid, text, text, jsonb, boolean),
  public.cockpit_csm_launch_ads_import_file_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, bigint, text),
  public.cockpit_csm_launch_ads_import_file_landed(uuid, text, text),
  public.cockpit_csm_launch_ads_import_file_failed(uuid, text, text, text),
  public.cockpit_csm_launch_ads_import_finish(uuid, text, text),
  public.cockpit_csm_launch_ads_import_end(uuid, text),
  public.cockpit_csm_drive_link_parse(text),
  public.cockpit_csm_drive_import_sentence(text, text, text),
  public.cockpit_csm_launch_ads_import_json(public.cockpit_csm_launch_ads_imports, boolean)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_launch_ads_import_request(text, text),
  public.cockpit_csm_launch_ads_imports_read(text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_launch_ads_import_claim(text, boolean),
  public.cockpit_csm_launch_ads_import_heartbeat(uuid, text),
  public.cockpit_csm_launch_ads_import_plan(uuid, text, text, jsonb, boolean),
  public.cockpit_csm_launch_ads_import_file_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, bigint, text),
  public.cockpit_csm_launch_ads_import_file_landed(uuid, text, text),
  public.cockpit_csm_launch_ads_import_file_failed(uuid, text, text, text),
  public.cockpit_csm_launch_ads_import_finish(uuid, text, text)
TO service_role;
```

The browser's functions would refuse a service-role call anyway (the gate
needs `auth.uid()`); the worker's are out of the browser's reach.

## 5. The audit

The imports table takes the decks' trigger, `cockpit_csm_deck_audit()`, on
`AFTER INSERT OR UPDATE OR DELETE … FOR EACH ROW` (trigger
`cockpit_csm_launch_ads_imports_audit`). The launch ads rows the worker
writes are audited by that table's existing trigger. The worker state table
has no trigger.

The migration replaces `cockpit_csm_deck_audit()` with its body unchanged
but for two things:

1. **The actor:** `coalesce(<the signed-in seat's email>,
   nullif(current_setting('cockpit.deck_actor', true), ''), session_user)`,
   so the worker's writes read `worker:editor-desk@<host>`, not
   `authenticator`. Nothing changes for the writes that do not set it.
2. **A branch for `cockpit_csm_launch_ads_imports`**, beside the prep
   branch and modelled on it:
   - An `UPDATE` where `(to_jsonb(NEW) - 'heartbeat_at' - 'updated_at') =
     (to_jsonb(OLD) - 'heartbeat_at' - 'updated_at')` returns at once,
     writing no audit row (the heartbeat, and nothing else).
   - Otherwise `before` and `after` keep only the columns that changed
     (`entity_id` the import's id, `metadata.changed` their names), and
     `files` is kept as an object keyed by `driveId` holding only the
     entries that differ. A 20-file import therefore leaves short rows,
     not twenty copies of its whole list.

| Action | Written by |
|---|---|
| `driveImport.request` | request |
| `driveImport.claim` | claim |
| `driveImport.plan` | plan |
| `driveImport.reserve` | file reserve (on the launch ads row and the import) |
| `driveImport.ready` | file landed (on both) |
| `driveImport.skip` | file reserve, when the file is in the tray already, the tray is full (the entry fails `full`), or a racing import won (the fixer's round; plan's own skipped entries stay under `driveImport.plan`) |
| `driveImport.fileFailed` | file failed, on the import (the fixer's round) |
| `driveImport.drop` | file failed, `import_end` (a removed `uploading` row) |
| `driveImport.finish` | `import_end`, from finish, claim and file reserve |

A call that changes nothing writes nothing, so it leaves no audit row.
Every `set_config` of `cockpit.deck_action` and `cockpit.deck_actor` passes
`is_local` true, so neither outlives its transaction on a pooled
connection.

## 6. Every sentence and code

The browser shows the message as written. Sentences end with a full stop;
the gate's existing sentences are kept as they are.

**Raised by request** (SQLSTATE, then the `HINT`):

| SQLSTATE | Hint | Sentence |
|---|---|---|
| `42501` | | Current confirmed client-success access is required (the gate's) |
| `42501` | | That client is not on your access list (the gate's) |
| `22023` | `link_empty` | Paste a Drive link: a folder, or one video or picture. |
| `22023` | `link_docs` | That's a Google Docs link. Paste a Drive folder, or one video or picture. |
| `22023` | `link_page` | This link opens a Drive page, not a folder. Open the folder and copy its link. |
| `22023` | `link_bad` | This isn't a Drive folder or file link. |
| `22023` | `too_many_open` | Ten imports are already running for this client. Wait for one to finish, then paste the link again. |
| `22023` | `too_many_links` | Too many Drive links in the last hour. Wait a few minutes, then paste it again. |

**Stored on a failed import** (`code`, `message`):

| Code | Sentence |
|---|---|
| `not_found` (folder) | We can't open this folder. Ask the client to share it as anyone with the link, or move it into their Drive folder. |
| `not_found` (file) | We can't open this file. Ask the client to share it as anyone with the link, or move it into their Drive folder. |
| `not_found` (either) | We can't open this link. Ask the client to share it as anyone with the link, or move it into their Drive folder. |
| `not_media` | That file isn't a picture or a video. Paste a folder, or one video or picture. |
| `nothing_found` | There are no pictures or videos in this folder, or in the folders inside it. |
| `drive_down` | Drive can't be reached from our side right now. Upload the files here instead. |
| `access_revoked` | This import stopped: whoever started it can no longer open this client. |
| `stopped` | This import stopped three times without bringing anything in. Paste the link again, or upload the files here. |
| `not_started` | This import couldn't start. Paste the link again, or upload the files here. |

`not_found` covers both "no such file" and "not shared with us": Drive
answers 404 for both to an account without access. The team's Google
account opens anything in a client's Drive folder and any file or folder
shared as "anyone with the link", so the sentence names both fixes.

**Stored on a failed file** (`files[].code`, `files[].message`; `{name}` is
the file's name):

| Code | Sentence |
|---|---|
| `too_big` (video) | {name} is too long or too large to bring in. Upload a cut under 5 minutes, or send it in the group. |
| `too_big` (picture) | {name} is over 150 MB. Export a smaller copy and upload it here. |
| `wrong_type` | {name} isn't a picture or a video we can show. Pictures: JPG, PNG, WebP. Videos: MP4, MOV, WebM. |
| `heic` | {name} is an iPhone photo (HEIC) we couldn't convert. Export it as JPG and upload it here. |
| `unplayable` | {name} couldn't be converted to play in a browser. Export it as MP4 and upload it here. |
| `download` | {name} didn't come through from Drive. Paste the link again; files already in the tray are skipped. |
| `storage` | {name} didn't save. Paste the link again; files already in the tray are skipped. |
| `unfinished` | {name} didn't finish. Paste the link again; files already in the tray are skipped. |
| `full` | This client has 200 files already. Remove some, then paste the link again. |

**A note on a landed file** (`files[].note`, not a failure):

| Code | Sentence |
|---|---|
| `converted` | {name} was converted to MP4 so it plays in every browser. |

**Raised to the worker only:** `22023` "Name the worker.", "Send at least
one file, or finish with nothing_found.", "That file is not in this
import's plan.", "That file changed in Drive since it was reserved.",
"Name a file failure.", "Name an import failure.", "The file did not
arrive. Upload it again."; `55000` "This import already started its
files."; `40001` "This import is not yours to work on."; `P0002` "No such
import.".

The Arabic of every sentence the box shows is in `CONTENT-AR.md` ("The
visual pass"), keyed by the same codes.

## 7. The worker: `python3 desk.py deck-import`

A new command of `hermes/editor-desk`, in `desk/deck_import.py`, beside the
desk's other jobs because the desk already holds what it needs: the team's
Google OAuth refresh token with the full Drive scope that reaches client
folders (`desk/drive.py`), ffmpeg and ffprobe (`desk/media.py`), and the
service key for Creative Triage (`desk/supabase.py`). The same run fills
the video posters (`VIDEOS.md` 9), as its last step.

```text
python3 desk.py deck-import [--limit 3] [--json]
python3 desk.py deck-import --dry-run --link <drive link>   # read-only: what would come in
```

**Keys, by name** (from `~/.editor-desk/env`, as the desk reads them):
`DESK_SUPABASE_URL`, `DESK_SUPABASE_KEY` (the service role key; the
doctor checks it is), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`. Optional: `DESK_SCRATCH` (scratch files go under
`<scratch>/deck-import/<import id>/`). Nothing else, and no key is ever
printed (`http.scrub`).

**What the desk gains for it** (existing callers keep their behaviour,
because every new argument has a default that does what the code does
today):

- `desk/http.py`: `download(url, path, *, max_bytes, timeout=600,
  headers=None, deadline=None, on_chunk=None)`. `deadline` is a
  `time.monotonic()` value; past it the download raises `HttpError(0,
  "download deadline passed")`. `on_chunk(bytes_so_far)` is called after
  each chunk. `timeout` stays urllib's per-read timeout.
- `desk/drive.py`: `IMPORT_FIELDS = "id,name,mimeType,size,createdTime,
  trashed,shortcutDetails,capabilities(canDownload),resourceKey,
  owners(emailAddress),driveId,parents"` (the last three added in the
  fixer's round, for the ownership check in section 11);
  `Drive.get(file_id, *, fields=FILE_FIELDS, resource_keys=None)`;
  `Drive.list_folder(folder_id, *, pages=4, fields=FILE_FIELDS,
  order_by="folder,createdTime", q_extra="", page_size=200,
  resource_keys=None, stop_after=None)`; `Drive.download(file_id, dest, *,
  max_bytes, resource_keys=None, timeout=1800, deadline=None,
  on_chunk=None)`. `resource_keys` is a dict of id to key, sent as one
  header, `X-Goog-Drive-Resource-Keys: <id>/<key>[,<id>/<key>…]`.
- `desk/supabase.py`: `RpcError(SupabaseError)` with `.sqlstate`,
  `.message` and `.hint` read from PostgREST's JSON error (`code`,
  `message`, `hint`); `Supabase.rpc(name, args) -> Any` through
  `rest("POST", f"rpc/{name}", json_body=args)`, turning an `HttpError`
  with a JSON body into `RpcError`; and `Supabase.upload_file(...)` (the
  Upload step below).

**The run.**

1. **Disk.** Free space in scratch under 4 GB: log one line and exit 0
   without claiming (a 1.5 GB source, its conversion and the 2 GB the
   desk's other jobs keep; the doctor's disk line says why).
2. **Claim.** `claim(p_worker = "editor-desk@<hostname>")`. No import:
   on to the posters (step 8). A `waiting` reason: log it, on to the
   posters.
3. **A resumed import** (`resumed` true: a run died after planning, and the
   claim expired): skip steps 4 and 5, and work its entries whose status is
   `queued` or `working` (step 6). Plan is never called again.
4. **Resolve the link.** `Drive.get(drive_id, fields=IMPORT_FIELDS,
   resource_keys={drive_id: resource_key})` with `supportsAllDrives`. A
   shortcut is followed to its target once (`shortcutDetails.targetId`,
   with its `targetResourceKey`). 404, or 403 for permissions:
   `finish(not_found)`. 401 after one token refresh, 403 for rate limits
   after three tries (2, 4 and 8 s), or 5xx after three tries:
   `finish(drive_down)`.
5. **The files.**
   - A folder. Two listings per folder, each with that folder's own
     resource key in the header and `supportsAllDrives` and
     `includeItemsFromAllDrives`:
     - Its media: `q` `'<id>' in parents and trashed=false and mimeType !=
       'application/vnd.google-apps.folder'`, `fields
       nextPageToken,files(IMPORT_FIELDS)`, `orderBy` `createdTime desc`,
       pages of 200, at most 4 pages, stopping once that folder has given
       20 candidates.
     - Its subfolders, for the folder pasted only (one level down): `q`
       `'<id>' in parents and trashed=false and mimeType =
       'application/vnd.google-apps.folder'`, `orderBy` `createdTime desc`,
       one page of 20. Each subfolder's media is then listed as above, with
       the subfolder's own `resourceKey`.
     - A candidate is a file whose `mimeType` starts `image/` or `video/`,
       or whose name ends `.jpg .jpeg .png .webp .heic .heif .mp4 .mov .m4v
       .webm .avi .mkv`; shortcuts and Google Docs are left out silently.
       All candidates are merged newest first (`createdTime` descending,
       then name); the first 20 are taken, and `over_limit` is set when
       there were more, or when a listing stopped with a page left. None:
       `finish(nothing_found)`.
   - A file: that one; not a candidate: `finish(not_media)`.
   - `plan(kind, files, over_limit)`, each file with its own
     `resourceKey`.
6. **Each entry that is `queued` or `working`, one at a time,** inside one
   `try/except Exception` per file, with its scratch files deleted in
   `finally`. A failure maps by the stage it happened in: before the
   download finished, `download`; sniffing, conversion, probe or poster,
   `unplayable` (a HEIC conversion: `heic`); upload or landed, `storage`.
   Each is logged through `http.scrub`. Only an `RpcError` or `HttpError`
   from an import-level RPC (claim, heartbeat, plan, finish) ends this
   import's turn, leaving it `working` for a later run to resume; a
   `40001` stops work on it at once and writes nothing more.
   - **Before downloading.** The cap is 1,610,612,736 bytes (1.5 GB) for a
     file whose Drive `mimeType` starts `video/` or whose name has a video
     extension, else 157,286,400 (150 MB). Drive's `size` over the cap:
     `file_failed(too_big)`; `canDownload` false: `file_failed(download)`;
     neither downloaded.
   - **Download** to scratch: `Drive.download` with the file's own
     resource key (and the pasted folder's, when the file sits in one),
     `max_bytes` the cap, a 60 s socket `timeout`, a `deadline` 15 minutes
     out, and `on_chunk` calling `heartbeat` at most every 60 s. Over the
     cap: `too_big`; past the deadline or any other error
     (`urllib.error.HTTPError` and `URLError` included): `download`.
   - **Sniff the type from the first bytes** (it wins over Drive's
     `mimeType`): `FF D8 FF` JPEG; `89 50 4E 47` PNG; `RIFF….WEBP` WebP;
     `….ftyp` with `heic`, `heix`, `hevc`, `heim`, `heis`, `mif1` or
     `msf1` HEIC; `….ftypqt` QuickTime; `….ftyp` with `isom`, `iso2` to
     `iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `dash`, `3gp4`, `3gp5` or
     `3g2a` MP4 (the last six added in the security review); `1A 45 DF A3` WebM or
     Matroska (ffprobe's `format_name` tells them apart); `RIFF….AVI ` AVI;
     anything else `wrong_type`. A picture over 157,286,400 bytes:
     `too_big`.
   - **HEIC** is converted with `heif-convert` only (`heif-convert -q 90
     in.heic out.jpg`, 120 s timeout), then treated as a JPEG. Without
     `heif-convert`, or when it fails or times out: `heic`. ffmpeg is never
     used for HEIC: before 7.1 (Ubuntu 22.04 ships 4.4, 24.04 ships 6.1) it
     decodes one 512 px tile of an iPhone's grid image, exits 0 and writes
     a fragment of the photo.
   - **Probe** with `media.probe` (ffprobe, 120 s timeout): pictures give
     width and height; videos give width, height, seconds, `video_codec`
     and `format_name`. A video's rotation (the stream's `rotate` tag or its
     display matrix side data, 90 or 270) swaps width and height, so a
     phone video taken upright lands as 9:16. No video stream:
     `unplayable`. Seconds over 3600: `too_big`.
   - **Convert a video when any of these holds:** over 157,286,400 bytes;
     codec `hevc`; codec other than `h264`, `vp8`, `vp9` or `av1` (ProRes,
     MPEG-4 Part 2 and the rest); container AVI or Matroska (not WebM); its
     short side over 1080. Over 300 seconds and needing conversion:
     `too_big`. The command, one at a time (the files are worked in turn,
     so never two at once), run with `subprocess.Popen` and polled every
     5 s so it can `heartbeat` every 60 s, killed after 15 minutes:

     ```text
     nice -n 10 ffmpeg -nostdin -y -loglevel error -protocol_whitelist file -i in.<ext>
       -map 0:v:0 -map 0:a:0?
       -vf scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'
       -c:v libx264 -preset veryfast -crf 23 -maxrate 3500k -bufsize 7000k
       -pix_fmt yuv420p -threads 2 -c:a aac -b:a 128k -movflags +faststart
       -fs 158334976 out.mp4
     ```

     `-protocol_whitelist file` lets the input open local files only, and
     `-fs` stops the output a megabyte past what can land (section 12).

     The short side becomes 1080 at most and never grows; ffmpeg applies the
     rotation first, so `iw` and `ih` are the upright size. `-maxrate`
     keeps five minutes under the bucket's 150 MB (3.5 Mbit/s and 128 kbit/s
     for 300 s is about 136 MB). It writes `video/mp4` and the note
     `converted`; the output is probed again for its facts. A non-zero exit,
     the 15-minute kill, or no video stream in the output: `unplayable`; an
     output over 157,286,400 bytes: `too_big`.
   - **Poster** for a video: `media.frame_at(min(1.0, seconds x 0.1))` at
     width 1080, a JPEG (120 s timeout); none written: `unplayable`.
   - `file_reserve(…)` with the facts; `done`, `skipped` or `failed`: on to
     the next file; `stopped`: end the run's work on this import.
   - **Upload** (`Supabase.upload_file(bucket, path, file_path,
     content_type, *, upsert, on_chunk)`), the file then the poster, with
     the service key:
     - Before uploading, the reserve's `path` and `posterPath` must match
       `^<task_id>/<adId>(-poster)?\.(jpg|png|webp|mp4|mov|webm)$` (the rule
       `checkAd` keeps in `launchAds.ts`); else `storage`.
     - `POST {url}/storage/v1/object/cockpit-launch-ads/<path>`, each path
       segment quoted on its own; headers `Content-Type` the sniffed type,
       `x-upsert` `false` (`true` only when the reserve said `resumed`: the
       path is the row's own, and a half-written object from the dead run
       must be replaced), `cache-control: 3600`, `Content-Length` from
       `os.path.getsize`.
     - Its own loop, not `http.request`: it opens the file afresh on every
       attempt and streams it in 1 MB chunks (calling `on_chunk`, which
       heartbeats at most every 60 s), and retries once on a timeout or a
       5xx.
     - **Already there:** HTTP 409, or a JSON body whose `statusCode` is
       `"409"` or whose `error` is `"Duplicate"` (Storage answers either way
       by version): go to `file_landed`, which checks the bytes.
     - **Too large:** HTTP 413, or HTTP 400 whose body matches
       `/maximum allowed size|payload too large|entity too large|exceeded/i`
       (the test `tooLarge` keeps in `sources.ts`): `too_big`.
     - Anything else after the retry: `storage`.
   - `file_landed`; refused: `file_failed(storage)`.
7. `finish()` once every entry is landed, skipped or failed, then back to
   step 2 for the next import: up to `--limit` imports per run (default 3),
   and no new claim after 8 minutes into the run. Between files, 45 minutes
   into the run, it stops: the import stays `working`, its claim expires 5
   minutes after the last heartbeat, and a later run resumes it.
8. **The posters** (`VIDEOS.md` 9), only when the run is under 8 minutes
   in: `cockpit_csm_deck_video_posters_due(p_worker)`, then for each slot
   (at most 6) its provider's oEmbed, a check of the picture, and
   `cockpit_csm_deck_video_poster_save`. A failure is logged and leaves the
   slot for a day.

**Limits:** 20 files an import; 150 MB a picture and 150 MB for what lands
(the bucket's own limit); 1.5 GB for a video downloaded to be converted,
and 5 minutes of it; one hour for a video that lands as it is; ten open
imports a client; thirty links a seat an hour; three takes in a row without
a file landing; a claim expires 5 minutes after its last heartbeat; 15
minutes a download, 15 minutes a conversion; 50 minutes a run (the cron
line's `timeout`).

**What it never does:** write to Drive, follow a link that is not Drive,
open a file other than the ones it listed, run anything a file contains,
keep a file after its run, or name a stored object after a Drive name (the
path is the row's id).

**The doctor.** `python3 desk.py doctor` gains six lines (the first four
are required):

| Check | OK | Not OK |
|---|---|---|
| `deck-import rpcs` | `claim(p_worker="doctor", p_peek=true)`: "{n} queued, {n} working; last ran {time}" | "missing: apply 20261020160000_csm_launch_ads_drive.sql" (function not found) · "DESK_SUPABASE_KEY is not the service role key: imports can't be claimed" (`42501`) |
| `deck-import bucket` | `POST /storage/v1/object/list/cockpit-launch-ads` with `{"prefix": "", "limit": 1}`: "cockpit-launch-ads reachable" | the error, scrubbed |
| `google token` (exists) | the refresh token mints an access token | "Drive cannot be read" |
| `deck-import disk` | "{n} GB free in scratch" (4 GB or more) | "{n} GB free: deck-import waits for 4 GB" |
| `deck-import heic` | `heif-convert` turns `tests/fixtures/grid-1024.heic` into a JPEG of 1024 x 1024: "heif-convert, grid images whole" | "missing: iPhone photos (HEIC) fail with a sentence; install libheif-examples" · "heif-convert wrote {w} x {h} for a 1024 x 1024 grid" |
| `deck-import posters` | `cockpit_csm_deck_video_posters_due(p_worker="doctor")` answers: "{n} video slots wait for a poster" | "missing: apply 20261020160200_csm_deck_video_posters.sql" |

`ffmpeg`, `ffprobe` and the desk's own disk line already exist.

**The HEIC fixture** `hermes/editor-desk/tests/fixtures/grid-1024.heic` is
an iPhone-shaped grid image, made on a Mac with `sips` (it writes a grid of
512 px tiles, checked 2026-10-20: one `grid` item, four `hvc1` tiles,
`ispe` 512 x 512 and 1024 x 1024): `sips -z 1024 1024 <any picture> --out
sq.png && sips -s format heic sq.png --out grid-1024.heic`. It is about
130 KB.

**Cron** (added to the README's "Cron" block, the whole set, in the same
commit):

```text
* * * * *     flock -n $HOME/.editor-desk/deck-import.lock timeout -k 30 50m bash -c "set -a; . $HOME/.editor-desk/env; set +a; cd $HOME/mahara-cockpits/hermes/editor-desk && python3 desk.py --quiet deck-import" >> $HOME/.editor-desk/out/cron.log 2>&1
```

Every minute, so a pasted link starts within about one; under its own lock,
so a long import never overlaps itself; under a 50-minute ceiling, so a hung
run never holds the lock for good (the next minute's run takes over, and the
import resumes once its claim expires); an idle minute is one claim call
and one posters call. The README's sentence under the block gains:
"deck-import every minute, for the client success Drive links and the
video posters; a run stops itself at 45 minutes and is killed at 50."

**Runbook** (`RUNBOOK.md`, "Editor desk", added rows):

| Symptom | Fix | Who |
| --- | --- | --- |
| Prep's Drive box says "Nothing has picked this up yet" | The `deck-import` cron line is missing or the desk can't reach Supabase. `crontab -l \| grep deck-import`; restore it from the README's Cron block; `python3 desk.py doctor` names the blocker on its `deck-import` lines | Hermes |
| Prep's Drive box says "This stopped part-way" | The importer died mid-import (full disk, a killed run, a missing cron line). `tail ~/.editor-desk/out/cron.log`, `df -h`, `python3 desk.py doctor`; the import resumes on the next run | Hermes |
| "We can't open this folder" (or file, or link) | The client's own link is restricted to the client. Ask the client to share it as anyone with the link, or move it into their Drive folder, then paste the link again | The CSM |
| "Drive can't be reached from our side right now" | The Google refresh token was revoked or expired: `python3 desk.py doctor`, the `google token` line. Aziz signs in again and the token goes into `~/.editor-desk/env` | Aziz |
| iPhone photos fail with "we couldn't convert" | No `heif-convert` on the VPS: the doctor's `deck-import heic` line. Install `libheif-examples` | Hermes |
| A video says "couldn't be converted to play in a browser" | ffmpeg failed or ran past 15 minutes on it: `grep deck-import ~/.editor-desk/out/cron.log` for its line. Export it as H.264 MP4 and upload it by hand, or paste its new link | The CSM |
| An import says "stopped three times without bringing anything in" | The run keeps dying on that import (out of disk, killed at the 50-minute ceiling, or the desk lost Supabase). `python3 desk.py doctor`; `grep deck-import ~/.editor-desk/out/cron.log` | Hermes |

**Tests** (`hermes/editor-desk/tests/test_deck_import.py`, with the desk's
`fakes.py` pattern: a fake Drive, a fake Supabase that records RPCs and
holds storage, a fake ffmpeg and probe stubs; no network):

- a folder of 25 media files, two Docs and a subfolder of 3: the newest 20
  across both, `over_limit`, the Docs left out, the subfolder's files
  counted; the listing asks for `createdTime desc` and `IMPORT_FIELDS`;
- a folder link-shared before 2021 whose child has its own resource key:
  the child's `id/key` goes in `X-Goog-Drive-Resource-Keys` on its
  download, and it lands;
- a file link to a PDF: `not_media`; a folder with no media:
  `nothing_found`; 404 and 403: `not_found`; a revoked token: `drive_down`;
- a 1.6 GB video by Drive's size: `too_big`, never downloaded; a 151 MB
  picture by Drive's size: `too_big`; a download that runs past the cap:
  `too_big`; a download that runs past its deadline: `download`;
- a download that raises `urllib.error.HTTPError` 403, and a probe that
  raises `subprocess.TimeoutExpired`: that file's code (`download`,
  `unplayable`) while the next file lands;
- each sniffed type, including a `.mp4` name over QuickTime bytes and a
  `.jpg` name over HEIC bytes; HEIC with and without `heif-convert`; a
  fake `heif-convert` that times out: `heic`;
- conversion with the fake ffmpeg: a 200 MB H.264 MP4, an HEVC MOV, a
  ProRes MOV, an MKV and a 2160 x 3840 phone video each land as
  `video/mp4` with the note `converted`, and the fake records the exact
  arguments above; a conversion that exits 1: `unplayable`; one over 300 s:
  `too_big`, never run; an output over 150 MB: `too_big`; a rotated phone
  video: width and height swapped;
- a file the plan marks `skipped`;
- a crash between reserve and landed, the claim expired, the import taken
  again: it comes back `resumed`, plan is never called a second time, the
  same row is reserved again (`resumed: true`), the upload goes with
  `x-upsert: true`, and the import finishes `done` with every file;
- upload: a duplicate answered as 409 and as 400 with `{"statusCode":
  "409", "error": "Duplicate"}` both go to `file_landed`; a 413 and a 400
  saying "maximum allowed size" give `too_big`; a 503 then a 200 lands,
  and the second attempt reopened the file and sent the full
  `Content-Length`; a reserve whose path is outside `<task_id>/<adId>`
  gives `storage` without uploading;
- a lost claim (`40001`): the run stops work on that import without
  writing; a `55000` from plan is never treated as a lost claim;
- heartbeats: a fake download of 3 simulated minutes calls `heartbeat`
  three times, never more than once a minute;
- the posters step: a Loom oEmbed's `.gif` saved as its `.jpg` sibling; a
  thumbnail on another host refused; an oEmbed error saves `null`;
- the shared link cases (section 10) through the dry run's parser.

## 8. The frontend calls

In `src/present/sources.ts`, beside the deck's other calls, with zod shapes:

```ts
export const driveImportFile = z.object({
  driveId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  name: z.string().min(1).max(200),
  kind: z.enum(["image", "video"]),
  bytes: z.number().int().nonnegative().nullable(),
  status: z.enum(["queued", "working", "landed", "skipped", "failed"]),
  code: z.enum(["too_big", "wrong_type", "heic", "unplayable", "download",
                "storage", "unfinished", "full"]).nullable(),
  message: z.string().nullable(),
  note: z.literal("converted").nullable(),
  adId: z.string().uuid().nullable(),
});
export const driveImport = z.object({
  id: z.string().uuid(),
  taskId: z.string(),
  link: z.url({ protocol: /^https$/, hostname: /^drive\.google\.com$/ }),
  driveId: z.string(),
  kind: z.enum(["file", "folder", "either"]),
  status: z.enum(["queued", "working", "done", "failed"]),
  code: z.enum(["not_found", "not_media", "nothing_found", "drive_down",
                "access_revoked", "stopped", "not_started"]).nullable(),
  message: z.string().nullable(),
  found: z.number().int().min(1).max(20).nullable(),
  overLimit: z.boolean(),
  landed: z.number().int(), skipped: z.number().int(), failed: z.number().int(),
  files: z.array(driveImportFile).max(20),
  requestedBy: z.string(),
  requestedAt: z.string(), startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(), updatedAt: z.string(),
});
export type DriveImport = z.infer<typeof driveImport>;
export const driveImports = z.object({
  imports: z.array(driveImport).max(20),
  workerSeenAt: z.string().nullable(),
  at: z.string(),
});

/** Ask for one import. An open import of the same link comes back with existing: true. */
export async function requestDriveImport(taskId: string, link: string):
  Promise<DriveImport & { existing: boolean }>;   // rpc cockpit_csm_launch_ads_import_request
/** This client's imports, newest first. */
export async function readDriveImports(taskId: string):
  Promise<z.infer<typeof driveImports>>;           // rpc cockpit_csm_launch_ads_imports_read
```

Both call `client.rpc` with named arguments (`p_task_id`, `p_link`), as the
videos' calls do. An error carries the server's sentence as its message and
the code in `hint`; the box shows the sentence under the field for the
`link_*` codes and under the button for the others.

`src/present/driveLink.ts` exports:

- `parseDriveLink(text): {ok: true, id, kind, resourceKey, link} | {ok:
  false, code}`, the rules of section 2, and the sentences keyed by code
  (from `content.ts`);
- `splitDriveLinks(text): {links: string[], extra: number}`: the text split
  on whitespace (spaces, tabs and new lines), empty pieces dropped, each
  piece trimmed of a trailing `.`, `,`, `)` or `>` (the way WhatsApp and
  mail wrap a link), duplicates (by parsed id) kept once, the first 10 in
  `links` and the count beyond them in `extra`. As built (the fixer's
  round): zero-width and direction marks (U+200B to U+200F, U+202A to
  U+202E, U+2066 to U+2069, U+FEFF), which an Arabic WhatsApp message puts
  around a link, are read as spaces first; and only the pieces meant as
  links are taken (a scheme or `www.`, or a host with a path, up to a
  space, a bracket, a guillemet or a quote), so "the photos:" and
  «الرابط» are never refused as links.

**Sending** (`DESIGN.md` 22.7):

- **On paste.** The field's `paste` handler reads
  `event.clipboardData.getData("text/plain")` (before a single-line input
  flattens its new lines). When at least one piece parses, it calls
  `preventDefault()` and sends at once, with no click: each link that
  parses becomes its own `requestDriveImport`, one after another in the
  paste's order; the button reads "Checking…" while they go, then
  "Started" for 2 s. Each link the parser refuses, and each the server
  refuses, gets its own line under the field: the link cut in the middle,
  then its sentence. The field then holds only the refused links, one
  space apart, so the CSM can fix them. More than ten: the first ten go,
  and a line says so (`CONTENT.md`, "The Drive link"). When nothing in the
  paste parses, the browser's own paste happens and the refusal shows as
  for typed text.
- **Typed text** uses the button ("Bring in"), with the same splitting and
  the same per-link lines.

**The hook** `useDriveImports(taskId)` (in its own file,
`src/present/useDriveImports.ts`):

| State | When | The box shows |
|---|---|---|
| Idle | No open import | The field and the button |
| Refused | `parseDriveLink` refuses every piece of typed text | The sentence under the field; the button off |
| Sending | Requests in flight | "Checking…" on the button, the field read-only |
| Several open | Two or more imports `queued` or `working` | "Bringing in {n} links from Drive…" over the imports' own blocks; with finished imports shown under them too, "Bringing in {n} of {total} links from Drive…", {total} the blocks the box shows (score round 2) |
| Queued | The import is `queued` | "Waiting to start. It usually starts within a minute." |
| Opening | `working`, `found` null | "Opening the Drive link…" |
| Working | `working`, `found` set | "Bringing in {n} files from Drive…" and the file rows |
| Done | `done` | The done line by its counts, and the file rows |
| Failed | `failed` | `message` |
| Nobody picked it up | `queued` for over 3 minutes and `workerSeenAt` null or over 3 minutes old | "Nothing has picked this up yet. The Drive importer last ran {time}. Upload the files here for now." (or the "hasn't run yet" line) |
| Stopped part-way | `working` and `workerSeenAt` (else `startedAt`) over 10 minutes old (STALLED_MS) | "This stopped part-way. The Drive importer last ran {time}. It carries on when it runs again; upload the files here if you need them now." |
| The read failed | `readDriveImports` throws | "Couldn't check the import: {reason}. Trying again." |

- Reads on mount; every 5 s while any import is `queued` or `working`;
  paused while `document.visibilityState` is `hidden`, read at once on
  return; stopped when none is open. A read error backs off to 10, 20, then
  60 s, and a success returns to 5.
- The box lists every open import and the three newest finished ones, the
  newest first.
- When the sum of `landed` across the imports goes up, it calls
  `model.reload()` and posts `{type: "ads"}` on the hub, so the tray, the
  deck window and the other window show the new files.
- `requestDriveImport` with `existing: true` shows that import's progress,
  with no error.
- `{time}` is the CSM's local time, "today, 13:02", or "yesterday, 13:02" (final score round 1: "last ran 09:49" dropped a word); in Arabic with الساعة, as a time is said after a verb: "الساعة 13:02", "أمس الساعة 09:05", "يوم ١٦ أكتوبر الساعة 09:05" (score round 4).

## 9. The prep keys: `dos_donts_ar`, `example_theme` and `service_chosen_at`

`20261020160100_csm_deck_prep_dos_ar.sql` replaces
`public.cockpit_csm_deck_prep_value(text, text, jsonb, jsonb)` with the body
of `20261019120000_csm_decks.sql` (the only file that defines it, checked
at b472bed7), two new branches before its `ELSE`, and one key added to its
stamp branch:

```sql
  WHEN p_key = 'dos_donts_ar' THEN
    -- The Arabic of each Do's & Don'ts card line, keyed by the line as parsed
    -- (DESIGN.md 22.6.2). The browser sends the whole map on each save.
    IF t <> 'object' THEN RAISE EXCEPTION 'dos_donts_ar maps card lines to their Arabic'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 100 THEN RAISE EXCEPTION 'dos_donts_ar holds at most 100 lines'; END IF;
      IF char_length(btrim(k)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'dos_donts_ar has a card line that is empty or too long';
      END IF;
      s := public.cockpit_csm_deck_text(e, 500, 'The Arabic of a card line');
      IF s IS NOT NULL THEN out := out || jsonb_build_object(btrim(k), s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'example_theme' THEN
    RETURN public.cockpit_csm_deck_choice(p_value,
      ARRAY['design-build','interior','architecture','fitout','construction',
            'kitchen','living','majlis','villa','bathroom','pool',
            'landscape','bedroom','office','facade','stairs',
            'designbuild','architecture2','fitout2','fitout3','construction2','construction3'], p_key);
```

As built in the security review (2026-10-21), after the CEO's correction
that the example follows the client's main service, never a sub-trade:
`example_theme` takes one of the five service keys of the kickoff form's
"Which service are we advertising?" (`design-build`, `interior`,
`architecture`, `fitout`, `construction`) or one of the eighteen example
scenes (the first twelve and the six added for the services). Whichever the
browser settles on is accepted; narrow the list in a later migration once
it has.

and the stamp branch reads:

```sql
  WHEN p_key IN ('creative_agreed_at','onboarding_presented_at','service_chosen_at') THEN
```

`service_chosen_at` is O4's "Launch with this" (`DESIGN.md` 22.2.0 and
22.2.4): set with `true` (the server writes its own time, never the
browser's), cleared with `null` or `false` (the notes window's Undo). The
save's keep-the-first-time rule (`cockpit_csm_deck_prep_save`) names only
the two older stamps and is not changed, so a second choice on the call
stamps again; that is the time it was last chosen.

Everything else in the function is unchanged, and its grants stay as they
were (revoked from every role; `cockpit_csm_deck_prep_save` calls it as
owner). The prep row's 64 KB cap and the save's audit row cover the new
keys. The browser's `PREP_KEYS` (`src/present/prep.ts`) gains the three keys
in the same commit, so its "Prep does not keep…" check and the server's
agree, and `applyPatch` gains `RESTAMPS = new Set(["service_chosen_at"])`:
`true` sets it to `now()` every time, `null` or `false` removes it.

`dos_donts_ar` lives on the launch deck's row (L3 reads it);
`example_theme` and `service_chosen_at` on the onboarding deck's row,
beside `service_focus`. `example_theme` is read by both decks (`DESIGN.md`
22.4.5).

## 10. The PGlite test

In `apps/media-buyer-cockpit/scripts/csm-decks-supabase.test.ts`, after the
videos' block, loading the three migrations after the decks and videos
ones, with `storage.objects` and the gate's tables stubbed as that file
already does:

- **The parse:** every row of `driveLink.cases.json` (each shape in section
  2's table, `/u/1/` forms, `resourcekey` kept, `usp` and `authuser`
  dropped, Docs links, Drive pages, other hosts, `javascript:`, a port, a
  user, 2001 characters, an id of 9 characters) gives the same result in
  SQL as the TypeScript test gives in `driveLink.ts`. The TypeScript test
  also runs `splitDriveLinks` over a pasted WhatsApp message with three
  links, a trailing full stop, a duplicate and eleven links.
- **Request:** the gate (no seat, another client); each refusal's code in
  `hint`; the same open link returns the same import with `existing`;
  the eleventh open import refused; the 31st link in an hour refused; the
  rebuilt link stored, never the pasted one.
- **Read:** newest first; open ones whatever their age; 14 days; 20 at
  most; `found` null before the plan; `workerSeenAt` is the later of the
  worker row and a working import's heartbeat.
- **Claim:** oldest first; `pg_get_functiondef('public.
  cockpit_csm_launch_ads_import_claim(text,boolean)'::regprocedure) ~ 'FOR
  UPDATE SKIP LOCKED'` (PGlite is one session, so two sessions cannot be
  run); peek writes nothing; an import whose heartbeat is 5 minutes old is
  taken again with `attempts + 1` and `resumed` true once planned; the
  fourth take without a file landing ends `stopped`, with its unfinished
  entries failed `unfinished` and their `uploading` rows removed; a
  requester without access ends `access_revoked` the same way; "a client
  gone from the roster does not block the next client's import" (the first
  import's gate raises "The client ID is missing or ambiguous", the second
  is taken); that import ends `not_started` once 30 minutes old; a roster
  mid-refresh leaves every import as it was and returns `waiting`.
- **Heartbeat:** refreshes `heartbeat_at` and the worker row, writes no
  audit row; a lost claim gives `40001`.
- **Plan, reserve, landed, failed, finish:** a lost claim (`40001`); a
  second plan after a file started gives `55000`; `skipped` for a file
  already in the tray; reserve's path, `request_id`, `created_by`,
  `source`; "a second import of the same file reserved while the first's
  row is uploading gives skipped, not an error"; a resumed reserve returns
  the same row with new facts and `resumed`; a resumed reserve with
  another mime is refused; landed refused when Storage's size differs;
  landed sets `attempts` to 0; failed removing an `uploading` row; finish
  failing the unfinished; finish refusing `access_revoked`; every counter;
  every call a second time writing nothing.
- **Grants:** `authenticated` cannot call the seven worker functions or
  read either table; `service_role` cannot read either table directly;
  `anon` can call nothing.
- **Audit:** one row per write with its action and the worker as actor;
  only the changed columns and the changed `files` entries in `before` and
  `after`; none for a no-op; none for a heartbeat; none for the worker
  state row.
- **The prep keys:** `dos_donts_ar`, `example_theme` and
  `service_chosen_at` saved, refused when malformed, removed with null;
  `service_chosen_at` is the server's time and a second `true` stamps again;
  the function still refusing an unknown key.
- **The census** (the existing test "the browser functions run only for
  signed-in seats; the helpers run for nobody", changed in the same
  commit):
  - the query also selects `p.proname LIKE 'cockpit_csm_drive%'`;
  - the count goes from 29 to 45: eleven import functions
    (`cockpit_csm_launch_ads_import_request`, `_imports_read`, `_claim`,
    `_heartbeat`, `_plan`, `_file_reserve`, `_file_landed`,
    `_file_failed`, `_finish`, `_json`, `_end`), the two drive helpers, and
    the three poster functions of `VIDEOS.md` 9
    (`cockpit_csm_deck_video_posters_due`,
    `cockpit_csm_deck_video_poster_save`,
    `cockpit_csm_deck_video_poster_reset`);
  - `browser` gains `cockpit_csm_launch_ads_import_request` and
    `cockpit_csm_launch_ads_imports_read`;
  - a new `worker` list (claim, heartbeat, plan, file_reserve, file_landed,
    file_failed, finish, `cockpit_csm_deck_video_posters_due`,
    `cockpit_csm_deck_video_poster_save`) gets `service_role` true and
    `authenticated` false; every other function keeps `service_role`
    false;
  - `notDefiners` gains `cockpit_csm_drive_link_parse` and
    `cockpit_csm_drive_import_sentence`, each `SET search_path = ''` as the
    videos' helpers are;
  - `cockpit_csm_launch_ads_import_json`, `cockpit_csm_launch_ads_import_end`
    and `cockpit_csm_deck_video_poster_reset` are definers callable by
    nobody;
  - and the three files apply twice.
- **The tray's source and two tidy-ups** (`20261020160300`, section 12,
  its own block after the visual pass's): the file applies twice on top of
  the others; the census runs again (still 45; the read stays stable, the
  reserve volatile, both for signed-in seats only); the read returns every
  row and field `cockpit_csm_launch_ads_rows` gives, in its order, plus
  `source`, and on a Drive row the importer's first name (the address's
  local part, then the team list's name, Arabic or mixed case kept) and
  the paste's time, never an address or the link; the deck's own read
  carries none of it; a seat without that client, a seat without client
  success, a signed-out caller and the service key are refused; a hand
  upload's name loses folders and invisible and direction marks, a name
  with nothing left is its id and no name stays none; claim takes the
  next client's import behind six stuck ones.

## 11. As built: the fixer's round (2026-10-21)

The build of sections 2 to 10, and where it adds to them. Each line is in
the code and its tests (`csm-decks-supabase.test.ts`, the block "the visual
pass: Drive imports, prep keys and video posters"; `hermes/editor-desk/
tests/test_deck_import.py`; `scripts/deck-drive.test.tsx`).

**The server (section 4).**
- **Plan refuses a file listed twice** (`22023` "Send each file once."):
  reserve, landed and failed find an entry by its Drive id, so two entries
  with one id would make the second unreachable.
- **Reserve: the requester's gate failing for any reason but access**
  (the roster mid-refresh) raises `55006` with `HINT` `roster` ("The client
  roster is being refreshed. The import carries on shortly."). The worker
  ends its turn and the import stays `working`, to resume; only `42501`
  ends it `access_revoked`.
- **Reserve: a resumed entry whose row is already `ready`** (the
  requester accepted it in the browser) counts as landed (`landed + 1`,
  `attempts = 0`, action `driveImport.ready`) and returns `{"done": true}`;
  one whose row was `removed` (the day-old sweep) is reserved again as a
  new row. A resumed reserve compares the poster's type too.
- **Reserve's race guard is by name:** inside the `unique_violation`
  handler, `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME` must be
  `cockpit_csm_launch_ads_drive_once`; any other unique violation raises
  as it is.
- **Landed with a row already `ready`** marks the entry landed without
  touching the row; a row `removed` while the bytes moved raises "The file
  did not arrive. Upload it again.".
- **`request_id` is random** (section 4, reserve step 7).

**The audit (section 5):** the `driveImport.skip` and
`driveImport.fileFailed` actions, and `is_local` on every `set_config`.

**The worker (section 7).**
- **The scratch is cleared first.** A run killed at the 50-minute ceiling
  skips its `finally`, and its files would pin the disk gate shut; the run
  removes `<scratch>/deck-import/` before the disk check, under the lock.
- **Claim is never retried** (`retry=False` on the RPC): a retried claim
  after a timeout could take a second import while the first stays
  claimed.
- **The access token is minted before any Drive call.** A refresh token
  Google refused (400 `invalid_grant`) is the import's (`drive_down`), at
  once, never a file's failure.
- **The link must be the client's own** (`owned_by_client`). The team's
  token reaches every client's folder, so the gate on the CSM's seat is
  not enough: the link passes when no owner is a `@maharamedia.com`
  address and it is not in a shared drive (the client's own share), or
  when it sits under the client's own folder (`editor_clients.drive_url`,
  at most 10 parents up). Otherwise the import ends `not_found`, whose
  sentence already says to share it or move it into their Drive folder.
- **A per-file disk check:** before each download, the free space less the
  file's size must stay above 4 GB, or the turn ends (`TurnOver`) and the
  import stays `working`.
- **`TurnOver`** names every way a turn ends with the import left
  `working` for a later run: a heartbeat or an import-level call that
  failed, the roster mid-refresh (`55006`), the disk, and the 45-minute
  mark. A file's own failure is never one. A `file_failed` call that
  itself fails ends the turn too, so a file is never left half-reported.

**The browser (section 8):** `splitDriveLinks`'s invisible marks and link
pieces (above), and the mobile folder shape (section 2), in
`driveLink.ts`, the migration's parser and the worker's dry run alike,
pinned by two new rows in `driveLink.cases.json`.

**The PGlite test (section 10).** The census is a new test inside the new
block ("the census: 45 functions, every one with an empty search path; who
may call which"), over a database with the three files applied twice. The
existing census test keeps its 29: its database never has the new files,
so changing it would test nothing new.

## 12. As built: the security review (2026-10-21)

An independent review of the migrations, the worker, its wiring and this
spec, line by line. What it checked and found sound: row security on both
new tables with every grant revoked in the same file (the service key
included); every function `SECURITY DEFINER` with `search_path = ''` but
the two immutable helpers; the two browser functions behind
`cockpit_csm_client_gate` for that client, the seven worker functions and
the two poster functions executable by `service_role` only; the server's
parser (other hosts, look-alike hosts, `docs.google.com` forms and sheets,
userinfo, ports, percent-encoded ids, a backslash or `#@` before the host,
invisible and direction marks, path tricks) with the link rebuilt from the
id and a clean resource key alone; one tray row per client per Drive file
(the partial unique index, plan's skip, reserve's skip and its race guard);
one audit row per write with the worker named; the storage path built from
the task id, the row id and the type alone, the same rule as an upload by
hand, so the deck reads both the same; the worker's limits, the streaming
download to scratch and its cleanup, the type read from the bytes (so an
HLS or concat playlist never reaches ffmpeg), the 50-minute ceiling under
flock, the doctor's lines, scrubbed logs, and no other editor-desk command
changed. No new function collides with an existing name (checked against
every migration on this branch and on `origin/main`).

**Fixed in the review.**
- **Plan never refuses a whole folder for one name.** A name loses C1
  controls, the Arabic letter mark, zero-width space, line and paragraph
  separators, word joiners, the BOM and every direction mark (it lost only
  C0 controls and some direction marks); a name with nothing left is the
  file's Drive id instead of `22023`, which had failed the import three
  times over.
- **The worker sends the plan a type it takes.** Drive's `mimeType` is
  lowercased and used only when it matches the plan's rule; otherwise the
  type comes from the name (a `video/…` type with parameters stays a video,
  so it keeps the 1.5 GB cap). A size over 10^12 is sent as 10^12.
- **A failed read of the client's folder is the turn's, not the link's.**
  `client_folder` treated a Supabase error as "no folder", so a blip closed
  a team-owned link as `not_found` with a sentence telling the CSM to
  reshare. It now ends the turn (`TurnOver`) and the import resumes.
- **Each import starts from empty file facts.** `can_download` and
  `parent_of` outlived their import, so a resumed import could fail a file
  as `download` because another client's plan had said so.
- **The command takes its own lock** (`<scratch>/deck-import.lock`,
  non-blocking): a run started by hand beside the cron run does nothing,
  instead of clearing the scratch of a run that is mid-download.
- **A `not_found` is logged with its reason**, for the runbook's
  `grep deck-import`.
- **`example_theme`** takes the service keys and the new scenes (section 9).

**Fixed in a second pass (the same day).** The fixes above were checked
again line by line, the three migrations applied twice in the PGlite test
(53 pass), and the server's parser, the worker's and `driveLink.ts` run side
by side over 9,696 built links (schemes, look-alike and encoded hosts,
userinfo, ports, every path shape, resource keys, whitespace): they agree
on every one but a link padded with a no-break space, which only the
browser trims, and the browser sends the server the link it rebuilt, so
that one never reaches it.
- **The conversion opens local files only and cannot fill the disk.**
  `-protocol_whitelist file` on the input (the bytes already decide the
  container, so this is a second lock), and `-fs` a megabyte past 150 MB on
  the output: a file whose header lies about its length stops there and is
  `too_big`, instead of writing until the 15-minute kill.
- **Any failed heartbeat is the turn's.** It caught only `RpcError` and
  `HttpError`; `http.client.IncompleteRead` is neither, so a broken answer
  mid-download failed a good file as `download`. It now ends the turn and
  the import resumes.
- **The reserved path is matched whole** (`fullmatch`): with `match` and
  `$`, a path ending in a newline passed.

**Left for a decision (not changed).**
- **A client-owned share is not proved to be this client's.** The
  ownership check passes any link no `@maharamedia.com` address owns and
  that is not in a shared drive. A seat limited to one client that pastes
  another client's own share (or a teammate's personal Gmail folder that
  the desk's account can open) brings it into this client's tray. It needs
  the link, and nothing stops it. Closing it means proving the share is
  public ("anyone with the link") or knowing each client's own Google
  accounts. **Mitigated, not closed** (below): prep's list of the client's
  files now says on each Drive file who pasted it and when, and deletes it
  for good with one more press. It still needs the CSM to look.

**Fixed after the review (2026-10-21).**
- **A working import whose worker stopped no longer shows "Bringing in"
  forever.** A `working` import whose importer has been quiet for over 10
  minutes (`workerSeenAt`, else `startedAt`) says "This stopped part-way.
  The Drive importer last ran {time}. It carries on when it runs again;
  upload the files here if you need them now." (`driveView.ts`
  `STALLED_MS` and `stalledWorking`, `driveCopy.ts` `stalled`, the row in
  section 8's table, its test in `deck-drive.test.tsx`). The harness has
  its own `stalled` scenario (`?drive=stalled`, and a card on the
  `view=drive` sheet): a working import whose worker was last seen 11
  minutes before the harness's clock, so the line can be reviewed.
- **The harness's pretend worker lands files as the server does** (score
  round 1, harness only): a `.mov` lands as `video/mp4` with its poster
  (the tray says Video, not Picture), and a file that another open link
  has already brought in is skipped instead of landing twice, as the
  server's partial unique index refuses it. The harness's Drive file names
  no longer say kitchens (`living-corner.jpg`).
- **Prep names where each file came from** (the guard for a link pasted
  under the wrong client). `20261020160300_csm_launch_ads_source.sql`
  replaces `cockpit_csm_launch_ads_read`: every row and field it returned,
  in the same order (it still reads through `cockpit_csm_launch_ads_rows`),
  plus `source` (`upload` or `drive`) on each row and, on a Drive row,
  `importedBy` (the first word of the importer's name on the team list,
  `cockpit_people`, matched by address, skipping a title ending in a dot
  ("Eng.") or a lone initial; else the address's first part of two letters
  or more between its dots, underscores and pluses, so s.ahmed reads Ahmed;
  capitalised when all lower case; at most 40 characters) and `importedAt`
  (the import's `requested_at`), from this client's own import only (the
  join also matches `task_id`). The three added fields never carry an
  address or the link. The row's own `createdBy`, returned since
  `20261019120000` and kept here, is unchanged, and on a Drive row it is
  the importer's address; only a seat with that client reads the row.
  Grants, `SECURITY DEFINER` and `search_path = ''` are as they were. In the browser, `sources.ts`'s
  `launchAdSchema` takes the three as optional fields (a read from before
  the migration still parses; a source it does not know reads as none),
  and `TrayFiles.tsx` lists the client's files in prep's ads panel, under
  "Add a file", newest first: name, picture or video, kind, hidden, and
  on a Drive file "From Drive · pasted by {first name} · {when}" (the box's
  `timeLabel`, "today, 08:15" for today's paste, so it never reads as
  a bare clock beside "yesterday, 17:40"); newest first by when each file
  was made. Delete asks once more, then calls `launchAds.remove`
  (`cockpit_csm_launch_ad_remove`, unchanged, which keeps the row for the
  audit, and the Edge Function deletes the bytes). The deck window reads
  the same list (`launchAds.list`) but never renders these fields: only
  prep mounts `TrayFiles` (pinned in `deck-tray.test.tsx`), and
  `cockpit_csm_deck_sources`, its fallback, carries none of them. The
  client-facing deck and the notes window never say where a file came
  from.
- **Claim looks at twenty imports a minute** (`LIMIT 20` in
  `20261020160000`, not yet applied, was 5), so a few clients whose cards
  are missing from the roster no longer hold the next client's import for
  up to 30 minutes. The PGlite test queues six stuck imports ahead of
  Acme's and claim takes Acme's.
- **The upload by hand cleans its name as the plan does.**
  `20261020160300` replaces `cockpit_csm_launch_ad_reserve` with the live
  body (read on 2026-10-21; it matched `20261019120000` line for line) and
  one change: the name loses C0 and C1 controls, the Arabic letter mark,
  the zero-width space, line and paragraph separators, direction marks,
  embeddings, overrides and isolates, word joiners and the BOM, as the
  plan's does, with the plan's character class written the same way, as
  `\u` escapes (score round 4: typed literally, U+2028 split the line and
  an editor's "unusual line terminators" fix would have turned the class
  into a range that strips dashes and quotes; GitHub also flags literal
  bidi characters). A name that was sent and has nothing left is the
  file's own id, as the plan's is the Drive id; no name sent stays none.
  Printable marks stay: "site – walk ‘a’….mp4" keeps its dash, quotes and
  ellipsis (pinned).
- **The file refuses to apply before `20261020160000`.** A plpgsql body is
  checked only when it runs, so `20261020160300` alone would apply cleanly
  and then fail every prep tray read with "column a.source does not
  exist". A guard after `BEGIN` raises "Apply
  20261020160000_csm_launch_ads_drive.sql first…" unless the imports
  table, the team list and the tray's `source` and `import_id` columns are
  there (pinned in PGlite).
- **Every ffmpeg-family process that reads the Drive bytes opens local files
  only.** The second pass locked the conversion alone; `ffprobe`
  (`media.probe`, run on every downloaded video) and the poster
  (`media.frame_at`, from the unconverted original when no conversion is
  needed) now take `-protocol_whitelist file` too (`LOCAL_ONLY` in
  `deck_import.py`; `input_args` in `media.py`, empty by default, so the
  other workers' calls are unchanged). Pinned in `test_deck_import.py`.
- **A broken answer is a transport error for every caller.**
  `http.client.IncompleteRead` (and any `http.client.HTTPException`) is
  not an `OSError`, so `desk/http.py` let it through: at `file_reserve` or
  `file_landed` a good file failed as "storage", and at claim, plan or
  finish the run ended in a traceback. `http.request` now retries it and
  raises `HttpError(0)`, so reserve and landed end the turn and the import
  resumes; the storage upload catches it the same way. Pinned in
  `test_deck_import.py`.

**The order to apply (the frontend ships after them).** Live
`cockpit_csm_deck_prep_value` accepts neither `example_theme` nor
`service_chosen_at` (checked read-only), so slide 4's "Launch with this" and
prep's example switch would be refused on save. Apply `20261020160000`,
`20261020160100`, `20261020160200` and `20261020160300`, in that order,
before `scripts/ship.sh client-success`, then check on production that
"Launch with this" and the example switch save.
