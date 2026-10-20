-- Editor desk: an end of day read only by the editor who filed it, a note
-- tick that changes only the tick, cockpit notes that cannot pose as another
-- source, and an audit row for every person's write (audit, 2026-10-20).
--
-- Identity stays the live model: the signed-in email, checked by is_editor()
-- against editor_people. The member-list identity in 20261004a never reached
-- production for these tables and is not adopted here; moving to it is a
-- separate decision. The worker writes with the service key and is not
-- limited by any policy below.
BEGIN;

-- 1. An end of day belongs to the editor who filed it. eod-out reads with
-- the service key; EodPage reads only the signed-in editor's own row.
DROP POLICY IF EXISTS editor_requests_read ON public.editor_requests;
CREATE POLICY editor_requests_read ON public.editor_requests
FOR SELECT TO authenticated
USING (
  (SELECT public.is_editor())
  AND (
    kind <> 'eod'
    OR pg_catalog.lower(pg_catalog.btrim(requested_by))
       = pg_catalog.lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
  )
);

-- 2. Ticking a note changes the tick and nothing else (markNoteDone sends
-- only `done`). The table grant implied UPDATE on every column, text and
-- author included.
REVOKE UPDATE ON TABLE public.editor_notes FROM authenticated;
REVOKE UPDATE (id, task_id, version, at_sec, text, by_email, by_name, source, done, at)
  ON TABLE public.editor_notes FROM authenticated;
GRANT UPDATE (done) ON TABLE public.editor_notes TO authenticated;

-- 3. A note written in the cockpit is a cockpit note. It cannot take a
-- ClickUp, Frame.io or client-review id or source, and it starts open
-- (addNote sends exactly this shape).
DROP POLICY IF EXISTS editor_notes_write ON public.editor_notes;
CREATE POLICY editor_notes_write ON public.editor_notes
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_editor())
  AND pg_catalog.lower(by_email) = pg_catalog.lower((SELECT auth.jwt()) ->> 'email')
  AND source = 'cockpit'
  AND id LIKE 'cockpit:%'
  AND done = false
);

-- 4. Every write by a person leaves an audit row: an editor in the cockpit
-- (authenticated) or a client on the review page (anon, via review_decide).
-- Requests are audited for the worker too, so a delivery shows queued,
-- running and done. Notes the worker mirrors from ClickUp and Frame.io are
-- rewritten every hour and keep their own source, so those are not copied.
CREATE OR REPLACE FUNCTION public.cockpit_editor_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := coalesce(pg_catalog.current_setting('role', true), 'none');
BEGIN
  IF TG_TABLE_NAME = 'editor_notes' AND v_role NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app, source_system,
    before, after, metadata
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN v_role = 'authenticated'
      THEN pg_catalog.lower((SELECT auth.jwt()) ->> 'email') END,
    'video-editor',
    CASE v_role
      WHEN 'authenticated' THEN 'cockpit'
      WHEN 'anon' THEN 'review-page'
      ELSE 'editor-desk'
    END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END,
    pg_catalog.jsonb_build_object(
      'database_role', v_role,
      'auth_user_id', CASE WHEN v_role = 'authenticated' THEN auth.uid() END
    )
  );
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.cockpit_editor_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cockpit_editor_request_audit ON public.editor_requests;
CREATE TRIGGER trg_cockpit_editor_request_audit
AFTER INSERT OR UPDATE OR DELETE ON public.editor_requests
FOR EACH ROW EXECUTE FUNCTION public.cockpit_editor_audit();

DROP TRIGGER IF EXISTS trg_cockpit_editor_note_audit ON public.editor_notes;
CREATE TRIGGER trg_cockpit_editor_note_audit
AFTER INSERT OR UPDATE OR DELETE ON public.editor_notes
FOR EACH ROW EXECUTE FUNCTION public.cockpit_editor_audit();

COMMIT;
