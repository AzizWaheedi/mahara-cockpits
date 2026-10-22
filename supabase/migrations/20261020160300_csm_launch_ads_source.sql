-- CSM decks: where each tray file came from, for prep's tray, and the hand
-- upload's names cleaned as a Drive import's are (docs/csm-decks/
-- DRIVE-IMPORT.md 12). Apply after 20261020160200_csm_deck_video_posters.sql:
-- it reads the source and import_id columns and the imports table that
-- 20261020160000_csm_launch_ads_drive.sql adds.
--
-- 1. cockpit_csm_launch_ads_read (20261019120000, live) is replaced. It
--    returns every row and every field it returned, in the same order,
--    through the same internal cockpit_csm_launch_ads_rows, and each row
--    gains `source` ('upload' or 'drive'). A Drive row also gains
--    `importedBy`, the first name of the seat that pasted the link (its name
--    on the team list, cockpit_people, when that address is there, else the
--    address's local part; a title such as "Eng." or a lone initial is
--    skipped), and `importedAt`, when the link was pasted (the import's
--    requested_at), from this client's own import only. The three added
--    fields never carry an address or the link. The row's own createdBy,
--    returned since 20261019120000 and kept here, is unchanged, and on a
--    Drive row it is the importer's address (only a seat with that client
--    reads the row). Prep shows them as "From Drive · pasted by {first name}
--    · {when}" on each Drive file, so a link pasted under the wrong client
--    is seen and the file deleted (cockpit_csm_launch_ad_remove, unchanged).
--    The deck window reads the same list but never renders these fields
--    (only prep mounts TrayFiles; pinned in deck-tray.test.tsx);
--    cockpit_csm_deck_sources, its fallback, carries none of them.
-- 2. cockpit_csm_launch_ad_reserve (20261019120000, live) is replaced with
--    one change: the file name is cleaned as the import's plan cleans a
--    Drive file's name, with the plan's character class written the same
--    way, as \u escapes (C0 and C1 controls, the Arabic letter mark, the
--    zero-width space, line and paragraph separators, the direction marks,
--    embeddings, overrides and isolates, word joiners and the BOM), where it
--    lost C0 controls only. A name that was sent and has nothing left is the
--    file's own id, as the plan's is the file's Drive id; no name sent stays
--    none. The live body was read on 2026-10-21 and matched the repo's.
--
-- Both stay SECURITY DEFINER with search_path '' and keep their grants
-- (restated below as 20261019120000 left them: signed-in seats only, the
-- gate inside deciding). The file applies twice without error, and is
-- refused before 20261020160000 (a plpgsql body is checked only when it
-- runs: applied alone, every prep tray read would fail in production).
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.cockpit_csm_launch_ads_imports') IS NULL
     OR to_regclass('public.cockpit_people') IS NULL
     OR (SELECT count(*) FROM pg_attribute
          WHERE attrelid = 'public.cockpit_csm_launch_ads'::regclass
            AND attname IN ('source', 'import_id') AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'Apply 20261020160000_csm_launch_ads_drive.sql first: this file reads its imports table and the tray''s source and import_id columns';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_read(p_task_id text, p_include_hidden boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN (
    SELECT coalesce(jsonb_agg(
             r.e || jsonb_build_object('source', coalesce(a.source, 'upload'))
                 || CASE WHEN i.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
                      'importedBy', CASE WHEN n.first = lower(n.first) THEN initcap(n.first) ELSE n.first END,
                      'importedAt', i.requested_at) END
             ORDER BY r.o), '[]'::jsonb)
      FROM jsonb_array_elements(public.cockpit_csm_launch_ads_rows(p_task_id, p_include_hidden)) WITH ORDINALITY r(e, o)
      LEFT JOIN public.cockpit_csm_launch_ads a ON a.id = (r.e->>'id')::uuid
      -- This client's own import only: the name can never come from another's.
      LEFT JOIN public.cockpit_csm_launch_ads_imports i
        ON a.source = 'drive' AND i.id = a.import_id AND i.task_id = a.task_id
      -- The team list's name for that address (never one that is itself an
      -- address), and the address before its @.
      LEFT JOIN LATERAL (
        SELECT (SELECT p.name FROM public.cockpit_people p
                 WHERE lower(btrim(p.email)) = lower(btrim(i.requested_by_email))
                   AND p.name NOT LIKE '%@%' AND btrim(p.name) <> ''
                 ORDER BY p.active DESC NULLS LAST, p.id LIMIT 1) AS person,
               split_part(btrim(i.requested_by_email), '@', 1) AS local
      ) src ON i.id IS NOT NULL
      -- Its first word that is a name: not a title ending in a dot ("Eng.")
      -- and not a lone initial; else the address's first such part (s.ahmed
      -- reads Ahmed); else the first word as it is. At most 40 characters.
      LEFT JOIN LATERAL (
        SELECT nullif(left(coalesce(
                 (SELECT u.w FROM unnest(regexp_split_to_array(btrim(src.person), '\s+')) WITH ORDINALITY u(w, k)
                   WHERE char_length(u.w) > 1 AND right(u.w, 1) <> '.' ORDER BY u.k LIMIT 1),
                 (SELECT u.w FROM unnest(regexp_split_to_array(src.local, '[._+]+')) WITH ORDINALITY u(w, k)
                   WHERE char_length(u.w) > 1 ORDER BY u.k LIMIT 1),
                 split_part(btrim(src.person), ' ', 1),
                 regexp_replace(src.local, '[._+].*$', '')), 40), '') AS first
      ) n ON i.id IS NOT NULL);
END $$;

-- Reserves one upload. The same request id returns the same reservation (for
-- the same seat and file only); the Edge Function then signs its upload.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_reserve(
  p_request_id uuid, p_task_id text, p_kind text, p_mime text, p_bytes bigint,
  p_width integer DEFAULT NULL, p_height integer DEFAULT NULL, p_seconds numeric DEFAULT NULL,
  p_file_name text DEFAULT NULL, p_poster_mime text DEFAULT NULL, p_poster_bytes bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; a public.cockpit_csm_launch_ads; v_id uuid; v_ext text; v_pext text; v_name text; v_pending integer; v_count integer;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'An upload request id is required'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('starter','custom','logo','page') THEN RAISE EXCEPTION 'Choose starter, custom, logo or page'; END IF;
  v_ext := CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
                       WHEN 'video/mp4' THEN 'mp4' WHEN 'video/quicktime' THEN 'mov' WHEN 'video/webm' THEN 'webm' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM)'; END IF;
  IF p_kind IN ('logo','page') AND p_mime NOT LIKE 'image/%' THEN RAISE EXCEPTION 'A logo or a page screenshot is a picture (JPG, PNG, WebP)'; END IF;
  IF p_bytes IS NULL OR p_bytes < 1 THEN RAISE EXCEPTION 'The file is empty'; END IF;
  IF p_bytes > 157286400 THEN RAISE EXCEPTION 'The file is over 150 MB. Export a smaller copy to keep it'; END IF;
  IF (p_width IS NOT NULL AND p_width NOT BETWEEN 1 AND 20000) OR (p_height IS NOT NULL AND p_height NOT BETWEEN 1 AND 20000)
     OR (p_seconds IS NOT NULL AND NOT (p_seconds > 0 AND p_seconds <= 3600)) THEN
    RAISE EXCEPTION 'The file''s size or length is not valid';
  END IF;
  IF (p_poster_mime IS NULL) <> (p_poster_bytes IS NULL) THEN RAISE EXCEPTION 'A poster needs its type and size'; END IF;
  IF p_poster_mime IS NOT NULL THEN
    IF p_mime NOT LIKE 'video/%' THEN RAISE EXCEPTION 'Only a video has a poster'; END IF;
    v_pext := CASE p_poster_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
    IF v_pext IS NULL OR p_poster_bytes NOT BETWEEN 1 AND 5242880 THEN RAISE EXCEPTION 'A poster is a JPG, PNG or WebP picture up to 5 MB'; END IF;
  END IF;
  -- The name the notes window shows ("Saving kitchen-reel.mp4"): no folders,
  -- and the import plan's cleaning (20261020160000): no control (C0 or C1),
  -- invisible or direction marks. Empty here is a name with nothing left; it
  -- becomes the file's id below. No name sent stays none.
  v_name := btrim(left(regexp_replace(regexp_replace(p_file_name, '^.*[/\\]', ''),
              E'[[:cntrl:]\u0080-\u009F\u061C\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]',
              '', 'g'), 200));

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_launch_ads:' || p_request_id::text, 0));
  SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.request_id = p_request_id;
  IF a.id IS NOT NULL THEN
    IF a.created_by IS DISTINCT FROM auth.uid() OR a.task_id <> p_task_id OR a.kind <> p_kind OR a.mime <> p_mime OR a.bytes <> p_bytes
       OR a.poster_mime IS DISTINCT FROM p_poster_mime OR a.poster_bytes IS DISTINCT FROM p_poster_bytes THEN
      RAISE EXCEPTION 'This request id belongs to a different file. Add the file again' USING ERRCODE = '42501';
    END IF;
    RETURN public.cockpit_csm_launch_ad_json(a);
  END IF;
  -- A failed upload is removed by the page at once; one left by a closed tab
  -- stops counting after an hour, so the cap clears itself.
  SELECT count(*) INTO v_pending FROM public.cockpit_csm_launch_ads x
   WHERE x.created_by = auth.uid() AND x.status = 'uploading' AND x.created_at > now() - interval '1 hour';
  IF v_pending >= 30 THEN RAISE EXCEPTION 'Too many unfinished uploads in the last hour. Wait a few minutes, then add the file again'; END IF;
  SELECT count(*) INTO v_count FROM public.cockpit_csm_launch_ads x WHERE x.task_id = p_task_id AND x.status <> 'removed';
  IF v_count >= 200 THEN RAISE EXCEPTION 'This client has 200 files already. Remove some first'; END IF;

  v_id := gen_random_uuid();
  IF v_name = '' THEN v_name := v_id::text; END IF;
  PERFORM set_config('cockpit.deck_action', 'launchAds.reserve', true);
  INSERT INTO public.cockpit_csm_launch_ads (id, request_id, task_id, kind, status, storage_path, mime, bytes, width, height, seconds,
      poster_path, poster_mime, poster_bytes, file_name, created_by, created_by_email, updated_by)
  VALUES (v_id, p_request_id, p_task_id, p_kind, 'uploading', p_task_id || '/' || v_id::text || '.' || v_ext, p_mime, p_bytes,
      p_width, p_height, p_seconds,
      CASE WHEN v_pext IS NOT NULL THEN p_task_id || '/' || v_id::text || '-poster.' || v_pext END, p_poster_mime, p_poster_bytes,
      v_name, auth.uid(), g->>'email', g->>'email')
  RETURNING * INTO a;
  RETURN public.cockpit_csm_launch_ad_json(a);
END $$;

REVOKE ALL ON FUNCTION
  public.cockpit_csm_launch_ads_read(text, boolean),
  public.cockpit_csm_launch_ad_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, text, bigint)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_launch_ads_read(text, boolean),
  public.cockpit_csm_launch_ad_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, text, bigint)
TO authenticated;

COMMIT;
