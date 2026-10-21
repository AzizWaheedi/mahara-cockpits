# CSM decks: video slots, the backend contract

The data behind the decks' video slots (the CEO, 2026-10-20). `CONTENT.md`
"Video slots" is the registry and the words, `CONTENT-AR.md` the Arabic, and
`DESIGN.md` 21.2 to 21.5 the control, the player, the notes window and prep.
This file describes the migration and frontend contract. The earlier statement
that nothing was applied is superseded: on 21 October 2026 the production table
and configured slots were read back, and the signed-in onboarding deck opened
its Wistia welcome player. See [the readiness check](../ONBOARDING-READINESS-20261021.md).
That check does not certify playback of every configured video.

**Final since the spec review of 2026-10-20** (`DESIGN.md` 21.10 lists the
findings). Two builders work from it in parallel: the backend builds sections
2 to 6 and the PGlite test (section 8); the frontend builds against sections
4, 6 and 7. A name, an argument, a return shape, a sentence or an error code
in this file changes only by changing this file first.

Migration: `supabase/migrations/20261020120000_csm_deck_videos.sql`, on the
Creative Triage project, after `20261020090000`. Like the decks migration it
is one `BEGIN; … COMMIT;` and applies twice without error. Its PGlite test
joins `apps/media-buyer-cockpit/scripts/csm-decks-supabase.test.ts`.

## 1. What it is, in short

- One table, `public.cockpit_csm_deck_videos`, keyed by deck, slot and
  language. A slot is the same for every client: there is no client column.
- Row security on, no policies, no browser grants. The browser reads and
  writes only through three `SECURITY DEFINER` functions with
  `search_path = ''`, each gated on an active client success seat or the
  CEO (`cockpit_csm_actor()`, the gate the CSM read models already use).
- The server checks every link against five providers' hosts and stores
  two addresses: the link people open, and the embed address the player
  frames. The frontend never builds an embed address itself.
- Every write leaves one `cockpit_audit_log` row, through a trigger.
- A clear keeps the row, with its link removed: nobody deletes, and the
  audit row keeps what was there.
- No outside call is made by the server or by a worker. The only thing that
  reaches a provider is the player's frame in the CSM's browser.

## 2. The table

```sql
CREATE TABLE IF NOT EXISTS public.cockpit_csm_deck_videos (
  deck text NOT NULL CHECK (deck IN ('onboarding','launch')),
  slot_key text NOT NULL CHECK (slot_key ~ '^[a-z0-9-]{1,40}$'),
  lang text NOT NULL CHECK (lang IN ('en','ar','any')),
  provider text CHECK (provider IN ('loom','youtube','wistia','vimeo','drive')),
  url text CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 500)),
  embed_url text CHECK (embed_url IS NULL OR (embed_url ~ '^https://' AND char_length(embed_url) <= 600)),
  title text CHECK (title IS NULL OR (title = btrim(title) AND char_length(title) BETWEEN 1 AND 40
                                      AND title !~ E'[[:cntrl:]\u202A-\u202E\u2066-\u2069\u2028\u2029]')),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 10800),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  cleared_at timestamptz,
  PRIMARY KEY (deck, slot_key, lang),
  -- Only the registry's slots (section 3).
  CONSTRAINT cockpit_csm_deck_videos_slot CHECK (public.cockpit_csm_deck_video_slot_ok(deck, slot_key)),
  -- Recorded, or cleared: never half of each.
  CONSTRAINT cockpit_csm_deck_videos_state CHECK (
    (url IS NULL) = (embed_url IS NULL) AND (url IS NULL) = (provider IS NULL)
    AND (url IS NULL) = (cleared_at IS NOT NULL)
    AND (url IS NOT NULL OR (title IS NULL AND duration_seconds IS NULL))),
  -- The table itself refuses a link the parser would not produce, so even
  -- the owner cannot store a host outside the list.
  CONSTRAINT cockpit_csm_deck_videos_link CHECK (url IS NULL OR (
    public.cockpit_csm_deck_video_parse(url) ->> 'url' = url AND
    public.cockpit_csm_deck_video_parse(url) ->> 'embedUrl' = embed_url AND
    public.cockpit_csm_deck_video_parse(url) ->> 'provider' = provider))
);
```

`cockpit_csm_deck_video_slots`, `cockpit_csm_deck_video_slot_ok` and
`cockpit_csm_deck_video_parse` are `IMMUTABLE`, read no table and are
created before the table in the file, so the checks may call them. A link
the parser refuses raises its sentence from inside the check (the insert is
refused either way).

**Grants.** `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, no policies.
`REVOKE ALL ON public.cockpit_csm_deck_videos FROM PUBLIC, anon,
authenticated, service_role;` then `GRANT SELECT … TO service_role` only.
The decks migration gives the service key `SELECT, INSERT, UPDATE` because
its edge function writes uploads; nothing writes videos except the three
functions, so the service key reads and nothing more (no `INSERT`,
`UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER`). This is stricter
than the decks pattern on purpose.

## 3. The slots and the links

### The slot list

One function holds it, and everything else reads it:

```sql
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_slots()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'onboarding:welcome', 'onboarding:meta-access', 'onboarding:whatsapp-calendar', 'onboarding:testing',
    'launch:start-to-finish', 'launch:testing', 'launch:call-team', 'launch:winning',
    'launch:portal-guide', 'launch:calendar-hours', 'launch:first-90-days', 'launch:payments'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_slot_ok(p_deck text, p_slot_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce((p_deck || ':' || p_slot_key) = ANY (public.cockpit_csm_deck_video_slots()), false);
$$;
```

Twelve keys, in slide order, the same as `VIDEO_SLOTS` in
`src/present/videos.ts` (`CONTENT.md`, "The registry"). `coalesce` makes a
null deck or slot `false`, never null. A slot added later changes this
function and the code's list in the same change; the copy test fails when
they differ (section 8).

### The links

`cockpit_csm_deck_video_parse(p_url text) RETURNS jsonb`, `LANGUAGE plpgsql
IMMUTABLE SET search_path = ''`. It returns `{"provider", "url",
"embedUrl"}` or raises one sentence of the table below with `ERRCODE =
'22023'`. The parse is exact, in this order:

1. `v := btrim(p_url)`. Null or empty: the hosts sentence.
2. `char_length(v) > 500`: the long sentence.
3. `v ~* '^http://'`: "Use the https link."
4. `v !~* '^https://'`, or `v !~ '^[!-~]+$'` (anything outside printable
   ASCII: spaces, controls, a non-ASCII homograph), or
   `position(chr(92) IN v) > 0` (a backslash): the hosts sentence. This
   catches `javascript:`, `data:` and the rest.
5. `m := regexp_match(v, '^[Hh][Tt][Tt][Pp][Ss]://([^/?#]+)(/[^?#]*)?(\?[^#]*)?(#.*)?$')`.
   `m IS NULL`, or `m[1] ~ '[@:%]'` (a user, a port or an encoded host):
   the hosts sentence.
6. `h := lower(m[1])`, `p := coalesce(m[2], '')`, `q := coalesce(m[3],
   '')` (with its `?`). The fragment is dropped. Hosts are matched by
   equality (or the one anchored pattern for a Wistia account), so a
   trailing dot, an IP address or `www.loom.com.example.org` fails.
7. Ids are read with anchored patterns: path ids end in `/?$`; query values
   with `(?:^\?|&)name=(value)(?:&|$)`, so a 12-character YouTube id is
   refused, never cut to 11.
8. `url` and `embedUrl` are built only from the constants below and the
   captured ids, never from the input's text. Every other query value is
   dropped.

| Provider | Host (`h`) | Path and query read | `url` (what people open) | `embedUrl` (what the player frames) |
|---|---|---|---|---|
| `loom` | `www.loom.com`, `loom.com` | `p ~ '^/(?:share\|embed)/(?:[A-Za-z0-9-]{1,200}-)?([0-9a-f]{32})/?$'` (a title slug before the id is allowed) | `https://www.loom.com/share/{id}` | `https://www.loom.com/embed/{id}?hideEmbedTopBar=true` |
| `youtube` | `www.youtube.com`, `youtube.com`, `m.youtube.com` | `p ~ '^/watch/?$'` with `q ~ '(?:^\?\|&)v=([A-Za-z0-9_-]{11})(?:&\|$)'`, or `p ~ '^/embed/([A-Za-z0-9_-]{11})/?$'` | `https://www.youtube.com/watch?v={id}`, plus `&t={s}` | `https://www.youtube-nocookie.com/embed/{id}?rel=0&playsinline=1&enablejsapi=1`, plus `&start={s}` |
| `youtube` | `youtu.be` | `p ~ '^/([A-Za-z0-9_-]{11})/?$'` | as above | as above |
| `youtube` | `www.youtube-nocookie.com` | `p ~ '^/embed/([A-Za-z0-9_-]{11})/?$'` | as above | as above |
| `wistia` | `fast.wistia.net` | `p ~ '^/embed/iframe/([a-z0-9]{10})/?$'` | `https://fast.wistia.net/embed/iframe/{id}` | `https://fast.wistia.net/embed/iframe/{id}?seo=false` |
| `wistia` | `h ~ '^[a-z0-9-]{1,63}\.wistia\.com$'` (an account) | `p ~ '^/medias/([a-z0-9]{10})/?$'` | as above (a medias page can ask for a Wistia sign-in; the player page does not) | as above |
| `vimeo` | `vimeo.com`, `www.vimeo.com` | `p ~ '^/([0-9]{6,12})(?:/([0-9a-f]{6,20}))?/?$'` | `https://vimeo.com/{id}`, plus `/{hash}` | `https://player.vimeo.com/video/{id}?dnt=1`, plus `&h={hash}` |
| `vimeo` | `player.vimeo.com` | `p ~ '^/video/([0-9]{6,12})/?$'`, the hash from `q ~ '(?:^\?\|&)h=([0-9a-f]{6,20})(?:&\|$)'` | as above | as above |
| `drive` | `drive.google.com` | `p ~ '^/file/d/([A-Za-z0-9_-]{20,100})(?:/(?:view\|preview))?/?$'`, and `resourcekey` from `q ~ '(?:^\?\|&)resourcekey=([A-Za-z0-9_-]{1,100})(?:&\|$)'` | `https://drive.google.com/file/d/{id}/view`, plus `?resourcekey={k}` | `https://drive.google.com/file/d/{id}/preview`, plus `?resourcekey={k}` |

(The `\|` above is the table's escape; the patterns use a plain `|`.)

**The YouTube start**, from `q`: `(?:^\?|&)(?:t|start)=([0-9]{1,5})s?(?:&|$)`
as seconds, else `(?:^\?|&)t=(?:([0-9]{1,2})h)?(?:([0-9]{1,3})m)?(?:([0-9]{1,5})s)?(?:&|$)`
as hours, minutes and seconds. It is kept only between 1 and 43200 seconds;
0, anything over 12 hours and anything that matches neither pattern are
dropped (so `t=99999999999` is dropped, never cast), and the url stays a
fixed point.

**Drive's `resourcekey`** is kept because files shared before Google's 2021
security update need it: without it the frame shows "you need access",
which the player cannot detect.

**Fixed point.** For every accepted link, `parse(parse(x).url)` equals
`parse(x)`; the table's link check relies on it, and the test checks it for
every accepted form.

**The privacy choices are made here, once:** YouTube through
`youtube-nocookie.com`, Vimeo with `dnt=1`, Loom without its top bar.

**Sentences it raises** (`ERRCODE = '22023'`; shown under the Link field in
prep, as written):

| When | Sentence |
|---|---|
| Not https (`http://`) | Use the https link. |
| Empty, another host, `javascript:` or `data:`, a user, a port, a `%` or a backslash in the host, a space, a control or non-ASCII character | Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive. |
| A Drive folder (`p ~ '^/drive/(?:u/[0-9]+/)?folders/'`) | That Drive link is a folder. Paste the link to the video file. |
| A known host with no video id in the right shape | That {Loom, YouTube, Wistia, Vimeo or Drive} link has no video in it. Copy the video's share link. |
| Over 500 characters | That link is too long. Copy the video's share link. |

## 4. The functions

The three browser functions are `LANGUAGE plpgsql SECURITY DEFINER SET
search_path = ''`. Each checks, in this order, and stops at the first
failure:

1. **The gate:** `PERFORM public.cockpit_csm_actor();`, which raises
   "Active client-success access required" (`42501`) for anyone who is not
   an active, email-confirmed member with the `csm` role (an `admin` seat
   counts, as everywhere `cockpit_has_role` is used) or the CEO
   (`cockpit_has_role('csm') OR cockpit_is_ceo()`). It needs no client: a
   slot belongs to no client. `cockpit_csm_actor()` is revoked from every
   role and is called here as the functions' owner, as the CSM read models
   call it.
2. **The deck:** `IF p_deck IS NULL OR p_deck NOT IN ('onboarding','launch')`.
3. **The slot** (save and clear): `IF NOT
   public.cockpit_csm_deck_video_slot_ok(p_deck, p_slot_key)`. Checked after
   the deck, so the sentence never echoes an unknown deck.
4. **The language** (save and clear): `IF p_lang IS NULL OR p_lang NOT IN
   ('en','ar','any')`.
5. **The revision** (save and clear): `IF p_revision IS NULL OR p_revision
   < 0`.

The saver's email is `lower(btrim(email))` from `auth.users` for
`auth.uid()`.

### Every sentence and code

The browser shows the message as written. The code tells the frontend what
to do with it (section 7).

| Code | Sentence | Raised by | Prep shows it |
|---|---|---|---|
| `42501` | Active client-success access required | all three | the section's head |
| `22023` | Choose the onboarding or the launch deck. | all three | the section's head |
| `22023` | That video slot is not in the {deck} deck. | save, clear | the row |
| `22023` | Choose English, Arabic or any language. | save, clear | Language |
| `22023` | Read the videos again, then save. | save | the row |
| `22023` | Read the videos again, then clear. | clear | the row |
| `22023` | The five link sentences (section 3) | save | Link |
| `22023` | Keep the title under 40 characters. | save | Title |
| `22023` | The title has a character it can't keep. Type it again. | save | Title |
| `22023` | The length must be between 1 second and 3 hours. | save | Length |
| `40001` | Someone else changed this video just now. Check it, then save again. | save | the row, and the section reads again |
| `40001` | Someone else changed this video just now. Check it, then clear it again. | clear | the row, and the section reads again |

`{deck}` is `onboarding` or `launch`, filled only after the deck passed
check 2.

### The revision

`p_revision` is required. It is what the caller last saw for that deck,
slot and language:

- **`0`:** "I saw this slot empty." It matches a missing row or a cleared
  row, and conflicts with a recorded one.
- **`n ≥ 1`:** it must equal the stored revision, else the conflict.
- **`NULL` or negative:** refused ("Read the videos again, then …") and
  nothing is written.

Prep sends the read's `revision` for a recorded row, and `0` for a slot the
read left out. Undo after Clear sends `0` (the slot is cleared now). This
closes the case where two CSMs both see a slot empty and the second save
would silently replace the first on every client's deck: the second save,
sent with `0`, now finds a recorded row and conflicts.

### `public.cockpit_csm_deck_videos_read(p_deck text DEFAULT NULL) RETURNS jsonb`

`STABLE`. Checks 1 and 2: the deck is required (the default only lets a call
that leaves it out reach the sentence instead of "function not found"). The
deck window, the notes window and prep each read their own deck. Returns:

```json
{
  "rows": [
    {
      "deck": "launch", "slotKey": "portal-guide", "lang": "en", "provider": "wistia",
      "url": "https://fast.wistia.net/embed/iframe/lxlse6ckhf",
      "embedUrl": "https://fast.wistia.net/embed/iframe/lxlse6ckhf?seo=false",
      "title": null, "durationSeconds": 277, "revision": 1,
      "updatedBy": "migration 20261020120000_csm_deck_videos",
      "updatedAt": "2026-10-20T12:00:00+00:00"
    }
  ],
  "slots": ["launch:start-to-finish", "launch:testing", "launch:call-team", "launch:winning",
            "launch:portal-guide", "launch:calendar-hours", "launch:first-90-days", "launch:payments"],
  "at": "2026-10-20T12:00:00+00:00"
}
```

- `rows`: this deck's recorded rows only (`url IS NOT NULL`), ordered by
  `slot_key`, then `lang`. A cleared or never-recorded slot is absent, and
  the frontend reads absent as "Not recorded yet" and its revision as `0`.
- `slots`: this deck's keys from `cockpit_csm_deck_video_slots()`, as
  `deck:slot`, in registry order. The frontend uses it to tell a slot the
  server does not know yet (prep says "This slot is not live on the server
  yet." and keeps Save off).
- `at`: `now()`.
- `updatedAt` and `at` are `to_jsonb` of a `timestamptz` (ISO 8601 with an
  offset).

### `public.cockpit_csm_deck_video_save(p_deck text, p_slot_key text, p_lang text, p_url text, p_title text DEFAULT NULL, p_duration_seconds integer DEFAULT NULL, p_revision integer DEFAULT NULL) RETURNS jsonb`

`VOLATILE`. The browser always calls it with named arguments. In order:

1. Checks 1 to 5 above.
2. The link through the parser (section 3).
3. The title: trimmed, blank is null; over 40 characters: "Keep the title
   under 40 characters."; a control character, a bidi embedding, override or isolate
   (U+202A to U+202E, U+2066 to U+2069) or a line or paragraph separator
   (U+2028, U+2029), any of which would reorder or split the recap's
   "- title: link" line in WhatsApp: "The title has a
   character it can't keep. Type it again." Arabic and U+200F pass.
4. The length: null, or 1 to 10800, else "The length must be between 1
   second and 3 hours."
5. `PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_deck_videos:'
   || p_deck || ':' || p_slot_key || ':' || p_lang, 0));`, then the row
   `FOR UPDATE`.
6. The revision (section above). On a conflict nothing is written.
7. When the row is recorded and already has this link, title and length
   (`IS NOT DISTINCT FROM`): returns it with `"changed": false`. Nothing is
   written and no audit row is made.
8. Otherwise `PERFORM set_config('cockpit.deck_action', 'deck_video.save',
   true)`, then an insert (revision 1) or an update: link, embed address,
   provider, title, length, `cleared_at = NULL`, `revision = revision + 1`,
   `updated_by`, `updated_at = now()`.

Returns the row in the read's shape plus `"changed": true` (or `false`, step
7).

### `public.cockpit_csm_deck_video_clear(p_deck text, p_slot_key text, p_lang text, p_revision integer DEFAULT NULL) RETURNS jsonb`

`VOLATILE`. Checks 1 to 5, the lock and the row `FOR UPDATE`, then:

- No row, or a row already cleared: returns `{"deck", "slotKey", "lang",
  "cleared": false, "revision": <the row's revision, or null>}` for any
  `p_revision` of `0` or more, and writes nothing.
- A recorded row and `p_revision` is not its revision (`0` included): the
  conflict, nothing written.
- Otherwise `PERFORM set_config('cockpit.deck_action', 'deck_video.clear',
  true)` and an update that sets the link, embed address, provider, title
  and length to null, `cleared_at = now()`, `revision + 1`, `updated_by`
  and `updated_at`. Returns `{"deck", "slotKey", "lang", "cleared": true,
  "revision": <the new revision>}`.

Prep's Undo is a save of the old values with `p_revision = 0` (a new
revision, its own audit row).

### Internal (no grant to any role)

| Function | Kind |
|---|---|
| `cockpit_csm_deck_video_slots() RETURNS text[]` | `sql IMMUTABLE`, not a definer |
| `cockpit_csm_deck_video_slot_ok(text, text) RETURNS boolean` | `sql IMMUTABLE`, not a definer |
| `cockpit_csm_deck_video_parse(text) RETURNS jsonb` | `plpgsql IMMUTABLE`, not a definer |
| `cockpit_csm_deck_video_json(public.cockpit_csm_deck_videos) RETURNS jsonb` | `sql STABLE SECURITY DEFINER`: the row in the read's shape |
| `cockpit_csm_deck_video_audit() RETURNS trigger` | `plpgsql SECURITY DEFINER` (section 5) |

All eight functions in this file have `SET search_path = ''`.

### Grants

```sql
REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_videos_read(text),
  public.cockpit_csm_deck_video_save(text, text, text, text, text, integer, integer),
  public.cockpit_csm_deck_video_clear(text, text, text, integer)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_deck_videos_read(text),
  public.cockpit_csm_deck_video_save(text, text, text, text, text, integer, integer),
  public.cockpit_csm_deck_video_clear(text, text, text, integer)
TO authenticated;
REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_video_slots(),
  public.cockpit_csm_deck_video_slot_ok(text, text),
  public.cockpit_csm_deck_video_parse(text),
  public.cockpit_csm_deck_video_json(public.cockpit_csm_deck_videos),
  public.cockpit_csm_deck_video_audit()
FROM PUBLIC, anon, authenticated, service_role;
```

The functions run as their owner, so the table's checks may call the
helpers; no other role can call them or write the table.

## 5. The audit

`cockpit_csm_deck_video_audit()`, on `AFTER INSERT OR UPDATE OR DELETE …
FOR EACH ROW` (trigger `cockpit_csm_deck_videos_audit`). One
`public.cockpit_audit_log` row per write, as the decks migration writes
them:

| Column | Value |
|---|---|
| `action` | `current_setting('cockpit.deck_action', true)` (`deck_video.save`, `deck_video.clear`, `deck_video.seed`), else the operation in lower case |
| `entity_type` | `cockpit_csm_deck_videos` |
| `entity_id` | `{deck}:{slot_key}:{lang}` |
| `actor_email` | the signed-in seat's email, else `session_user` (the seed) |
| `source_app`, `source_system` | `client-success`, `supabase` |
| `before`, `after` | the old and new rows as JSON |
| `metadata` | `{op, deck, slot_key, lang, database_role}` |

A `DELETE` cannot happen through any grant; if the owner ever runs one by
hand, the trigger still writes its row.

## 6. Seeds, the frame and the browser's rules

### Seeds

At the end of the migration, inside its transaction, in one block so the
action name reaches the trigger:

```sql
DO $$
BEGIN
  PERFORM set_config('cockpit.deck_action', 'deck_video.seed', true);
  INSERT INTO public.cockpit_csm_deck_videos
    (deck, slot_key, lang, provider, url, embed_url, duration_seconds, updated_by)
  SELECT s.deck, s.slot_key, s.lang, x.p ->> 'provider', x.p ->> 'url', x.p ->> 'embedUrl',
         s.seconds, 'migration 20261020120000_csm_deck_videos'
    FROM (VALUES
      ('onboarding', 'welcome',           'any', 'https://fast.wistia.net/embed/iframe/up0z6n691k',             148),
      ('onboarding', 'meta-access',       'any', 'https://www.loom.com/share/e2d83bffee614d9aa035d898d37d8989', 94),
      ('onboarding', 'whatsapp-calendar', 'any', 'https://www.loom.com/share/4ddc5519935f4ba8bdc7ac6f3667a701', 231),
      ('launch',     'portal-guide',      'en',  'https://fast.wistia.net/embed/iframe/lxlse6ckhf',             277),
      ('launch',     'portal-guide',      'ar',  'https://fast.wistia.net/embed/iframe/hyuxh7skjv',             285),
      ('launch',     'calendar-hours',    'any', 'https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768', 11)
    ) AS s(deck, slot_key, lang, link, seconds)
    CROSS JOIN LATERAL (SELECT public.cockpit_csm_deck_video_parse(s.link) AS p) x
  ON CONFLICT (deck, slot_key, lang) DO NOTHING;
END $$;
```

- `DO NOTHING`, so applying the file again never overwrites a CSM's later
  link and never brings back a seed someone cleared (a cleared row still
  holds its key).
- The first five come from mahara-context `context/projects/mahara-os.md`,
  "Guides and video deliverables". The sixth is the Loom the Gamma launch
  deck embeds on "Blocking Calendar Times", seeded because the CEO asked on
  2026-10-20: "embed the loom of how to block your calendar as well".
- **The lengths** are the providers' own oEmbed durations, read 2026-10-20
  and rounded to the second: Wistia `up0z6n691k` 148.1 s ("Mahara Welcome
  Video"), `lxlse6ckhf` 277.0 s ("How to use Mahara OS | English"),
  `hyuxh7skjv` 285.3 s (its Arabic twin, titled in Arabic); Loom `e2d83bff…`
  94.3 s, `4ddc5519…` 231.5 s, `6aa67297…` 11.1 s ("Untitled design 2"). So
  the control shows a length on day one.
- Their languages and their check against copy rule 11 are `CONTENT.md`
  open question 30.

### The frame

`DESIGN.md` 21.3. The `src` is the `embedUrl` as served. On the deck only,
the frontend adds, with `URL` and `searchParams.set`, never by string
concatenation:

| Provider | Added on the deck |
|---|---|
| `youtube` | `autoplay=1`, `origin={location.origin}` |
| `vimeo` | `autoplay=1` |
| `wistia` | `autoPlay=true` |
| `loom`, `drive` | nothing: they open on their own play button |

Prep's "Check it plays" adds nothing (no autoplay).

### The cockpit's CSP

The client success app already frames Meta ad previews
(`CreativePreview.tsx`, any https host under `facebook.com` or
`instagram.com`, through `lib/metaMedia.ts`) and the ClickUp form
(`PortalTasks.tsx`, `https://forms.clickup.com/…`); `InvoicePaper` uses
`srcdoc`, which `frame-src` does not govern. So the policy names the five
embed hosts plus the hosts the app already frames, never the five alone,
which would blank the creative preview on every client page and the Portal
tasks form on both domains. The header value in
`apps/client-success-cockpit/vercel.json` is exactly:

```text
connect-src 'self' https://bldgtotkfmhoxmlzowdx.supabase.co wss://bldgtotkfmhoxmlzowdx.supabase.co; frame-src https://www.loom.com https://www.youtube-nocookie.com https://fast.wistia.net https://player.vimeo.com https://drive.google.com https://facebook.com https://*.facebook.com https://instagram.com https://*.instagram.com https://forms.clickup.com
```

The portal proxies the client success app, and a browser applies both apps'
policies, so the portal's own (which names no `frame-src`) does not loosen
it. The deck-shots harness runs on Vite without `vercel.json`'s headers, so
it cannot catch a policy that blanks a frame: `DESIGN.md` 17 checks the
three framed things on cockpit.maharamedia.com after the ship.

### Messages to and from a player

Each player (the deck's, and prep's "Check it plays", one per row) keeps
its own frame and reads only its own messages:

- **In:** a message is read only when `event.origin` is exactly that
  provider's origin **and** `event.source === frame.contentWindow` for that
  player's own frame. Anything else is ignored, so a second frame from the
  same provider (prep's check, two slots on onboarding slide 6) can never
  be credited to the wrong player.
- **Out:** the deck posts to a provider only with
  `frame.contentWindow.postMessage(message, PROVIDER_ORIGIN[provider])`,
  the exact origin, never `"*"`.

| Provider | `PROVIDER_ORIGIN` | Out (after the frame's `load`) | In (read) |
|---|---|---|---|
| `youtube` | `https://www.youtube-nocookie.com` | `{"event":"listening","id":1,"channel":"widget"}` (the iframe API's handshake), then `addEventListener` commands for `onStateChange` and `onError` | `onReady`; `onStateChange` with state 1, or `infoDelivery` with `playerState` 1 (playing); `onError` with 100, 101 or 150 |
| `vimeo` | `https://player.vimeo.com` | `{"method":"addEventListener","value":"play"}` and the same for `"error"` | `ready`, `play`, `error` (except `PlaybackError`, see below) |
| `wistia` | `https://fast.wistia.net` | none needed | `"new-wistia-iframe"` (ready); `{"method":"_trigger","args":["play",…]}` or `["statechange","playing",…]` (playing). No error message (see below) |
| `loom` | `https://www.loom.com` | nothing | nothing |
| `drive` | `https://drive.google.com` | nothing | nothing |

The exact message shapes are read from a real frame during the build and
pinned in `videos.test.ts` with recorded samples. If a provider's play
event cannot be read, that provider is treated as Loom and Drive are: the
notes never say "Playing" for it, and the player never says it can't play
(`DESIGN.md` 21.3).

**Read from real frames on 2026-10-20** (the frontend build; the samples
are pinned in `apps/client-success-cockpit/scripts/deck-videos.test.tsx`):
- YouTube sends `onStateChange` only after an `addEventListener` command,
  and also reports playing in `infoDelivery` (`playerState: 1`); a video
  with embedding off sent `{"event":"onError","info":150,…}`.
- Vimeo sent `{"event":"error","data":{"name":"PlaybackError",…}}` for a
  public video in a browser that could not decode it. That is a playback
  hiccup, not a privacy or embedding block, so `PlaybackError` is never
  read as "can't play here"; any other Vimeo error is.
- Wistia's player posts JSON strings, `{"method":"_trigger","args":[…]}`;
  a missing video posted nothing at all, so Wistia never reports a block
  (prep's "Check it plays" is its guard, as for Loom and Drive).
- Loom speaks player.js (`{"context":"player.js","event":"ready",…}`); as
  this section says, its messages are not read.

## 7. The frontend calls

In `src/present/sources.ts`, beside the deck's other calls, with zod shapes:

```ts
export type VideoLang = "en" | "ar" | "any";
export type VideoProvider = "loom" | "youtube" | "wistia" | "vimeo" | "drive";

const EMBED_HOST = {
  loom: "www.loom.com",
  youtube: "www.youtube-nocookie.com",
  wistia: "fast.wistia.net",
  vimeo: "player.vimeo.com",
  drive: "drive.google.com",
} as const;
const OPEN_HOST = /^(www\.loom\.com|www\.youtube\.com|fast\.wistia\.net|vimeo\.com|drive\.google\.com)$/;
const EMBED_HOSTS = /^(www\.loom\.com|www\.youtube-nocookie\.com|fast\.wistia\.net|player\.vimeo\.com|drive\.google\.com)$/;
/** No user, no password, no port. */
const bare = (s: string) => {
  const u = new URL(s);
  return !u.username && !u.password && !u.port;
};

export const videoRow = z
  .object({
    deck: z.enum(["onboarding", "launch"]),
    slotKey: z.string(),
    lang: z.enum(["en", "ar", "any"]),
    provider: z.enum(["loom", "youtube", "wistia", "vimeo", "drive"]),
    url: z.url({ protocol: /^https$/, hostname: OPEN_HOST }).refine(bare),
    embedUrl: z.url({ protocol: /^https$/, hostname: EMBED_HOSTS }).refine(bare),
    title: z.string().nullable(),
    durationSeconds: z.number().int().nullable(),
    revision: z.number().int().min(1),
    updatedBy: z.string(),
    updatedAt: z.string(),
  })
  .refine(r => new URL(r.embedUrl).hostname === EMBED_HOST[r.provider]);
export type VideoRow = z.infer<typeof videoRow>;

export interface DeckVideos {
  rows: VideoRow[];
  /**
   * Rows the server returned that failed the shape: never shown, never "Not
   * recorded yet". Each keeps the server's revision when it has one, so prep
   * saves it again over the row the server still holds (revision 0 would
   * conflict with 40001 on every try).
   */
  refused: Array<{ slotKey: string; lang: VideoLang; revision?: number }>;
  slots: string[];
}

/** cockpit_csm_deck_videos_read, for one deck. */
export function readDeckVideos(client: DeckClient, deck: DeckKind): Promise<DeckVideos>;

/** cockpit_csm_deck_video_save: the saved row, and whether anything changed. */
export function saveDeckVideo(
  client: DeckClient,
  v: {
    deck: DeckKind;
    slotKey: string;
    lang: VideoLang;
    url: string;
    title?: string | null;
    durationSeconds?: number | null;
    /** The read's revision for this slot and language; 0 when the read left it out. */
    revision: number;
  },
): Promise<VideoRow & { changed: boolean }>;

/** cockpit_csm_deck_video_clear. */
export function clearDeckVideo(
  client: DeckClient,
  v: { deck: DeckKind; slotKey: string; lang: VideoLang; revision: number },
): Promise<{ cleared: boolean; revision: number | null }>;

/** A save or clear the server refused, with what prep does with it. */
export class VideoSaveError extends Error {
  code: "42501" | "22023" | "40001" | "other";
  /** The prep field the sentence goes under; null puts it on the row. */
  field: "link" | "title" | "length" | "language" | null;
}
```

- **The read** keeps every row that passes `videoRow` in `rows`, and puts a
  row that fails it in `refused` (by its `slotKey` and `lang`, when those
  two parse). The notes window and prep say "This video's link was refused.
  Save it again in prep." for it, never "Not recorded yet", and the canvas
  shows nothing.
- **When the functions are not live yet** (`code === "PGRST202"`, or a
  message that says the function does not exist): "The deck's videos are
  not live yet, so no video shows." The deck works as it did. This is
  checked before `problem()`, whose own "backend is not live" sentence is
  about the deck's sources.
- **Other errors** go through `problem()`. A save or clear error becomes a
  `VideoSaveError`: `code` from the error's `code`; `field` from section 4's
  table (`link` for the five link sentences, `title`, `length`, `language`,
  else null). On `40001` prep reads the videos again (`DESIGN.md` 21.5).
- **Load** (`load.ts`): `readDeckVideos(client, deck)` runs in the same
  `Promise.allSettled` as the deck's sources. `Loaded` gains `videos:
  DeckVideos | null` (and, since the build, `videosProblem`: the reason, so
  the notes and prep can say it). On failure, `problems` gains "The deck's videos could
  not be read: {reason}" and `videos` is null, never empty: null is "not
  read", and the notes and prep say so instead of "Not recorded yet".
- **After a save or a clear** in prep, the hub posts `{type: "videos"}` and
  every window of the deck reads the videos again (as `{type: "ads"}`
  re-reads the tray).
- **Lookup** (`videos.ts`): for a slot, the row in the deck's language,
  else the row for any language; the other language only for the notes
  window's offer. The mode rule (`CONTENT.md`, "Shown for") decides whether
  the canvas and the recap use it.
- **The frame's address** is built with `new URL(row.embedUrl)` and
  `searchParams.set` (section 6), never by concatenation.
- **The recap** uses `url`, never `embedUrl`, filled without Arabic
  isolates.
- **Prep's length field** turns "2:40" into 160 before the call; the server
  checks the range.

## 8. The PGlite test

Added to `apps/media-buyer-cockpit/scripts/csm-decks-supabase.test.ts`, on
the same fixtures (seats, the CEO, a member without the `csm` role, an
inactive member, anon).

**Setup (`beforeAll`).** The test database never loaded
`cockpit_csm_actor()`, and plpgsql resolves a call only when it runs, so
without it the migration applies and every read, save and clear fails with
"function does not exist". Before the files are applied:

```ts
await db.exec(cut(migration("20260926m_cockpit_csm_state.sql"),
  /CREATE OR REPLACE FUNCTION public\.cockpit_csm_actor\(\)[\s\S]*?END \$\$;/, "csm actor"));
await db.exec("REVOKE ALL ON FUNCTION public.cockpit_csm_actor() FROM PUBLIC, anon, authenticated, service_role;");
```

Then `20261020120000_csm_deck_videos.sql` is applied twice, after the decks
file.

**The census** ("the browser functions run only for signed-in seats; the
helpers run for nobody"), changed in place:
- The count of `cockpit_csm_deck%` and `cockpit_csm_launch%` functions is
  29 (21 plus this file's 8).
- `browser` gains `cockpit_csm_deck_videos_read`,
  `cockpit_csm_deck_video_save` and `cockpit_csm_deck_video_clear`.
- The no-definer exemption gains `cockpit_csm_deck_video_slots`,
  `cockpit_csm_deck_video_slot_ok` and `cockpit_csm_deck_video_parse`.
- The `search_path=""` assertion holds for all 29.

**New tests**

1. **Gate:** read, save and clear raise `42501` for anon, a member without
   the role and an inactive member; a CSM seat and the CEO pass.
2. **The table** (its own test, beside the decks' tables test): anon and
   authenticated have no `SELECT`, `INSERT`, `UPDATE`, `DELETE` or
   `TRUNCATE`; service_role has `SELECT` and no `INSERT`, `UPDATE`,
   `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER`; `relrowsecurity` is
   true; `pg_policies` has 0 rows for it; the trigger
   `cockpit_csm_deck_videos_audit` exists; a CSM seat's direct `SELECT` is
   refused with "permission denied".
3. **Null and unknown arguments:** each RPC called with a null deck, an
   unknown deck, a null slot, a null language and a null revision returns
   its sentence and code (section 4), never a raw not-null violation; an
   unknown deck's sentence is the deck sentence, not the slot's.
4. **Links:** every accepted form in section 3 gives its `url` and
   `embedUrl`, and `parse(parse(x).url) = parse(x)` for each. Accepted:
   the six seeds; `loom.com/share/{id}`; `/embed/{id}`; a Loom title slug
   (`https://www.loom.com/share/Some-Title-{32 hex}`); `HTTPS://WWW.LOOM.COM/share/{id}`
   (accepted, lowered); `youtu.be/{id}`; `watch?v={id}&t=1m30s` (start
   90); `/embed/{id}?start=45`; youtube-nocookie; a Wistia account
   `medias` page; Vimeo with and without its hash, both forms; Drive
   `/view`, `/preview` and with `?resourcekey=`. Refused, each with its
   sentence: `http://`; `www.loom.com.example.org`; `www.loom.com.` (a
   trailing dot); `user@www.loom.com`; a port; a backslash
   (`https://www.loom.com\@evil.org/share/{id}`); a `%`-encoded id; a
   Cyrillic "о" in the host; an IP host; `javascript:`; `data:`; a
   10-character and a 12-character YouTube `v=` (refused, not cut); a Drive
   folder; a Vimeo showcase; a 9-character Wistia id; a 501-character link.
   `t=99999999999` raises nothing and drops the start.
5. **Save:** with revision 0 on a never-seen slot: revision 1 and one audit
   row (`deck_video.save`, `before` null). The same save again with
   revision 1: `changed: false` and no audit row. A new title with revision
   1: revision 2 and one audit row. A stale revision: `40001` and nothing
   written. Revision 0 on a recorded slot: `40001` and nothing written. An
   unknown slot, an unknown language, a 41-character title and a length of
   0 give their sentences.
6. **Clear:** one audit row (`deck_video.clear`); the read leaves the slot
   out; a second clear returns `cleared: false` with no audit row; a save
   with revision 0 on the cleared slot works and records it again; a clear
   with revision 0 on a recorded slot is `40001`.
7. **Seeds:** six rows after the double apply, and exactly six
   `deck_video.seed` audit rows; applying the file a third time inside the
   test leaves six rows, and keeps a seed the test changed or cleared as it
   was. Each seed's `duration_seconds` is as in section 6.
8. **The table's own checks:** as the owner, an insert with an unlisted
   host, a cleared row with a title, or a slot not in the list is refused.
9. **The lists:** the launch read's `slots` are the eight launch keys and
   the onboarding read's the four onboarding keys, in section 3's order;
   `cockpit_csm_deck_video_slots()` has the twelve.

In `apps/client-success-cockpit`, the copy test reads the twelve keys from
the SQL file's `cockpit_csm_deck_video_slots()` and fails when they differ
from `VIDEO_SLOTS`, and the engine test covers the player (`DESIGN.md`
21.3: a stubbed Wistia frame that loads and sends nothing stays up).
