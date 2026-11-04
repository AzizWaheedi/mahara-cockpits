-- A Sales seat saves from Admin (2026-11-04).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). The CEO tried to add a setter in Admin and got "Give them at
-- least one cockpit role or admin". Since the native cutover:
--   cockpit_admin_upsert_member's allowed roles leave out 'sales', so a seat of Sales alone is refused
--   and Sales beside another seat is dropped without a word; the form's Setter/Closer choice is never
--   sent; and nothing writes cockpit_sales_people, the list cockpit_sales_seat() and the sales cockpit
--   read (the Convex portal push that did went away).
--   cockpit_admin_remove_member leaves an open seat row, and the gate reads that row first, so a person
--   removed in Admin could still open the sales cockpit. Nobody is in that state today.
--
-- 1. cockpit_admin_upsert_member allows 'sales', takes p_sales_role (default NULL keeps the seat's own
--    role, so the page live before this ships still saves), keeps cockpit_members.sales_role and the
--    cockpit_sales_people row in step, and audits the seat. The 4-argument signature is replaced: the
--    app calls it by name, so an older page still resolves. Same gate, SECURITY DEFINER, search_path
--    and grants (authenticated, service_role).
-- 2. cockpit_admin_remove_member closes the seat row too.
-- 3. A member with an open seat holds Sales and the seat's role: the form starts at Setter when it has
--    none, so saving Ahmed's seat would have made a closer a setter, and Admin showed Muhammed's manager
--    seat as no Sales at all, so unticking could not close it. Being admin already passes every
--    cockpit_has_role check, so the extra role changes nothing else for him.
--
-- Applies twice. Rollback: ~/.cache/mahara-ship/rollback/cockpit_admin_members.before-20261104a_admin_sales_seat.sql
-- Test: apps/media-buyer-cockpit/scripts/admin-sales-seat-supabase.test.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: the bodies read on 2026-11-04 (20261017b's), unless this file already ran.

DO $$
DECLARE v text;
BEGIN
  IF pg_catalog.to_regprocedure('public.cockpit_admin_upsert_member(text,text,text[],text[])') IS NOT NULL THEN
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.cockpit_admin_upsert_member(text,text,text[],text[])'::regprocedure;
    IF v IS DISTINCT FROM 'd9669c23a1f6a8bac22b1b76388c4eba' THEN
      RAISE EXCEPTION 'cockpit_admin_upsert_member changed since this file read it (2026-11-04); stop and re-read it.'
        USING ERRCODE = '55000';
    END IF;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.cockpit_admin_remove_member(text)'::regprocedure;
    IF v IS DISTINCT FROM 'cb51a0b64b78813d85e049976cdcad69' THEN
      RAISE EXCEPTION 'cockpit_admin_remove_member changed since this file read it (2026-11-04); stop and re-read it.'
        USING ERRCODE = '55000';
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.cockpit_admin_upsert_member(text, text, text[], text[]);

-- ---------------------------------------------------------------------------
-- 1. The Admin save

CREATE OR REPLACE FUNCTION public.cockpit_admin_upsert_member(p_email text, p_name text, p_roles text[], p_clients text[] DEFAULT '{}'::text[], p_sales_role text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_email text;
  v_target_email text;
  v_clean_roles text[];
  v_clean_clients text[];
  v_auth_user_id uuid;
  v_member_id uuid;
  v_allowed_roles CONSTANT text[] := ARRAY['admin', 'media_buyer', 'csm', 'creative', 'editor', 'sales', 'call_center']::text[];
  v_sales_roles CONSTANT text[] := ARRAY['setter', 'closer', 'both', 'manager']::text[];
  v_had_sales boolean;
  v_kept_role text;
  v_sales_role text;
  v_seat public.cockpit_sales_people;
  v_seat_after public.cockpit_sales_people;
  v_editor public.editor_people;
  v_editor_after public.editor_people;
BEGIN
  -- 1. Authorization: admin or founder CEO only
  IF NOT (public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(
    auth.jwt() ->> 'email',
    pg_catalog.current_setting('request.jwt.claim.email', true),
    ''::text
  )));

  v_target_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  IF v_target_email = '' OR pg_catalog.strpos(v_target_email, '@') = 0 THEN
    RAISE EXCEPTION 'Valid email required';
  END IF;

  -- 2. Filter roles to only valid cockpit seats (CEO CANNOT be assigned)
  SELECT coalesce(pg_catalog.array_agg(DISTINCT r ORDER BY r), '{}'::text[])
  INTO v_clean_roles
  FROM pg_catalog.unnest(p_roles) AS r
  WHERE r = ANY(v_allowed_roles);

  IF pg_catalog.cardinality(v_clean_roles) = 0 THEN
    RAISE EXCEPTION 'Give them at least one cockpit role or admin';
  END IF;

  -- team-only: a call center seat sees Team meetings and its clients'
  -- performance only, so it never shares a seat with a cockpit role or admin.
  IF 'call_center' = ANY(v_clean_roles) AND pg_catalog.cardinality(v_clean_roles) > 1 THEN
    RAISE EXCEPTION 'Call center is a seat on its own. Untick the other roles, or untick Call center.';
  END IF;

  -- 3. Prevent an admin from removing their own admin seat
  IF v_target_email = v_caller_email AND NOT ('admin' = ANY(v_clean_roles)) THEN
    RAISE EXCEPTION 'You cannot remove your own admin role';
  END IF;

  -- 4. Clean client restrictions
  SELECT coalesce(pg_catalog.array_agg(DISTINCT pg_catalog.btrim(c) ORDER BY pg_catalog.btrim(c)), '{}'::text[])
  INTO v_clean_clients
  FROM pg_catalog.unnest(p_clients) AS c
  WHERE pg_catalog.btrim(c) <> '';

  -- team-only: a call center seat sees its own clients only. Several helpers
  -- still read an empty list as every client, so the seat always names some.
  IF 'call_center' = ANY(v_clean_roles) AND pg_catalog.cardinality(v_clean_clients) = 0 THEN
    RAISE EXCEPTION 'Tick at least one client for a call center seat.';
  END IF;

  -- sales seat, 2026-11-04: what the person does there. No choice sent keeps the
  -- seat's own role, so a save from an older page never changes it.
  IF p_sales_role IS NOT NULL AND NOT (p_sales_role = ANY(v_sales_roles)) THEN
    RAISE EXCEPTION 'Sales role must be setter, closer, both or manager.';
  END IF;

  SELECT 'sales' = ANY(cm.roles) AND cm.active, cm.sales_role
  INTO v_had_sales, v_kept_role
  FROM public.cockpit_members AS cm
  WHERE cm.email = v_target_email
  FOR UPDATE;
  v_had_sales := coalesce(v_had_sales, false);

  SELECT * INTO v_seat FROM public.cockpit_sales_people WHERE email = v_target_email FOR UPDATE;

  v_sales_role := CASE
    WHEN 'sales' = ANY(v_clean_roles) THEN coalesce(
      p_sales_role,
      -- A closed seat's old role does not come back by itself.
      CASE WHEN v_had_sales OR (v_seat.via_portal AND v_seat.active) THEN v_seat.role END,
      CASE WHEN v_had_sales THEN v_kept_role END,
      CASE WHEN 'admin' = ANY(v_clean_roles) THEN 'manager' ELSE 'setter' END)
    WHEN v_had_sales THEN NULL
    ELSE v_kept_role
  END;

  -- 5. Find existing confirmed Auth user if present
  SELECT au.id INTO v_auth_user_id
  FROM auth.users AS au
  WHERE pg_catalog.lower(pg_catalog.btrim(au.email)) = v_target_email
    AND au.email_confirmed_at IS NOT NULL
  LIMIT 1;

  -- 6. Upsert into cockpit_members (trigger trg_cockpit_members_audit records audit row)
  INSERT INTO public.cockpit_members (
    email,
    name,
    roles,
    clients,
    active,
    auth_user_id,
    sales_role
  ) VALUES (
    v_target_email,
    nullif(pg_catalog.btrim(p_name), ''),
    v_clean_roles,
    v_clean_clients,
    true,
    v_auth_user_id,
    v_sales_role
  )
  ON CONFLICT (email) DO UPDATE
  SET
    name = coalesce(nullif(pg_catalog.btrim(excluded.name), ''), public.cockpit_members.name),
    roles = excluded.roles,
    clients = excluded.clients,
    active = true,
    auth_user_id = coalesce(public.cockpit_members.auth_user_id, excluded.auth_user_id),
    sales_role = excluded.sales_role,
    updated_at = pg_catalog.now()
  RETURNING id INTO v_member_id;

  -- 7. team-only, 2026-10-17: the editor desk's own list (editor_people) follows
  -- the editor role, so an editor added here gets into the desk without waiting
  -- for ClickUp. Only via_portal moves; via_clickup is ClickUp's. Audited.
  SELECT * INTO v_editor FROM public.editor_people WHERE pg_catalog.lower(pg_catalog.btrim(email)) = v_target_email FOR UPDATE;
  IF 'editor' = ANY(v_clean_roles) AND v_editor.email IS NULL THEN
    INSERT INTO public.editor_people (email, name, via_portal)
    VALUES (v_target_email, nullif(pg_catalog.btrim(p_name), ''), true)
    RETURNING * INTO v_editor_after;
  ELSIF v_editor.email IS NOT NULL AND v_editor.via_portal IS DISTINCT FROM ('editor' = ANY(v_clean_roles)) THEN
    UPDATE public.editor_people SET via_portal = ('editor' = ANY(v_clean_roles))
    WHERE email = v_editor.email
    RETURNING * INTO v_editor_after;
  END IF;
  IF v_editor_after.email IS NOT NULL THEN
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after)
    VALUES (CASE WHEN v_editor.email IS NULL THEN 'INSERT' ELSE 'UPDATE' END, 'editor_people', v_editor_after.email,
      nullif(v_caller_email, ''), 'cockpit-access', 'supabase',
      CASE WHEN v_editor.email IS NULL THEN NULL ELSE pg_catalog.to_jsonb(v_editor) END, pg_catalog.to_jsonb(v_editor_after));
  END IF;

  -- 8. sales seat, 2026-11-04: the sales cockpit's seat list follows the Sales
  -- seat here. A manager's pause stands while the person keeps the seat; giving
  -- the seat back reopens it. Taking it away closes the gate and takes them off
  -- every active list. Audited when anything but the stamp moved.
  IF 'sales' = ANY(v_clean_roles) THEN
    INSERT INTO public.cockpit_sales_people AS sp (email, name, role, via_portal, active, updated_by)
    VALUES (v_target_email, nullif(pg_catalog.btrim(p_name), ''), v_sales_role, true, true, nullif(v_caller_email, ''))
    ON CONFLICT (email) DO UPDATE
    SET
      name = coalesce(excluded.name, sp.name),
      role = excluded.role,
      via_portal = true,
      active = CASE WHEN v_had_sales THEN sp.active ELSE true END,
      updated_at = pg_catalog.now(),
      updated_by = excluded.updated_by
    RETURNING * INTO v_seat_after;
  ELSIF v_had_sales AND v_seat.email IS NOT NULL THEN
    UPDATE public.cockpit_sales_people
    SET via_portal = false, active = false, updated_at = pg_catalog.now(), updated_by = nullif(v_caller_email, '')
    WHERE email = v_seat.email
    RETURNING * INTO v_seat_after;
  END IF;
  IF v_seat_after.email IS NOT NULL AND (v_seat.email IS NULL
    OR pg_catalog.to_jsonb(v_seat_after) - ARRAY['updated_at', 'updated_by'] <> pg_catalog.to_jsonb(v_seat) - ARRAY['updated_at', 'updated_by']) THEN
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after)
    VALUES (CASE WHEN v_seat.email IS NULL THEN 'INSERT' ELSE 'UPDATE' END, 'cockpit_sales_people', v_seat_after.email,
      nullif(v_caller_email, ''), 'cockpit-access', 'supabase',
      CASE WHEN v_seat.email IS NULL THEN NULL ELSE pg_catalog.to_jsonb(v_seat) END, pg_catalog.to_jsonb(v_seat_after));
  END IF;

  RETURN v_member_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. The Admin remove

CREATE OR REPLACE FUNCTION public.cockpit_admin_remove_member(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_email text;
  v_target_email text;
  v_editor public.editor_people;
  v_editor_after public.editor_people;
  v_seat public.cockpit_sales_people;
  v_seat_after public.cockpit_sales_people;
BEGIN
  IF NOT (public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  v_caller_email := pg_catalog.lower(pg_catalog.btrim(coalesce(
    auth.jwt() ->> 'email',
    pg_catalog.current_setting('request.jwt.claim.email', true),
    ''::text
  )));

  v_target_email := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  IF v_target_email = '' THEN
    RAISE EXCEPTION 'Target email required';
  END IF;

  IF v_target_email = v_caller_email THEN
    RAISE EXCEPTION 'You cannot remove yourself';
  END IF;

  -- Mark inactive and clear roles/clients (audit trigger captures before/after)
  UPDATE public.cockpit_members
  SET active = false,
      roles = '{}'::text[],
      clients = '{}'::text[],
      sales_role = NULL,
      updated_at = pg_catalog.now()
  WHERE email = v_target_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- team-only, 2026-10-17: the seat no longer has the editor role, so the
  -- editor desk's list drops its portal mark too (ClickUp's stays). Audited.
  SELECT * INTO v_editor FROM public.editor_people
  WHERE pg_catalog.lower(pg_catalog.btrim(email)) = v_target_email AND via_portal FOR UPDATE;
  IF v_editor.email IS NOT NULL THEN
    UPDATE public.editor_people SET via_portal = false WHERE email = v_editor.email RETURNING * INTO v_editor_after;
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after)
    VALUES ('UPDATE', 'editor_people', v_editor.email, nullif(v_caller_email, ''), 'cockpit-access', 'supabase',
      pg_catalog.to_jsonb(v_editor), pg_catalog.to_jsonb(v_editor_after));
  END IF;

  -- sales seat, 2026-11-04: an open seat row kept the sales cockpit open after
  -- the person was removed here, so removing them closes it too. Audited.
  SELECT * INTO v_seat FROM public.cockpit_sales_people
  WHERE email = v_target_email AND (via_portal OR active) FOR UPDATE;
  IF v_seat.email IS NOT NULL THEN
    UPDATE public.cockpit_sales_people
    SET via_portal = false, active = false, updated_at = pg_catalog.now(), updated_by = nullif(v_caller_email, '')
    WHERE email = v_seat.email
    RETURNING * INTO v_seat_after;
    INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after)
    VALUES ('UPDATE', 'cockpit_sales_people', v_seat.email, nullif(v_caller_email, ''), 'cockpit-access', 'supabase',
      pg_catalog.to_jsonb(v_seat), pg_catalog.to_jsonb(v_seat_after));
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cockpit_admin_upsert_member(text, text, text[], text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cockpit_admin_remove_member(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_admin_upsert_member(text, text, text[], text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_admin_remove_member(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Admin shows every open seat: its member holds Sales and the seat's role (the audit trigger
--    records it). The CEO's addresses are left as they are: their gate goes by the address.

UPDATE public.cockpit_members AS m
SET roles = CASE WHEN 'sales' = ANY(m.roles) THEN m.roles ELSE pg_catalog.array_append(m.roles, 'sales') END,
    sales_role = s.role
FROM public.cockpit_sales_people AS s
WHERE s.email = m.email
  AND m.active AND s.via_portal AND s.active
  AND NOT ('ceo' = ANY(m.roles))
  AND (m.sales_role IS NULL OR NOT ('sales' = ANY(m.roles)));

NOTIFY pgrst, 'reload schema';

COMMIT;
