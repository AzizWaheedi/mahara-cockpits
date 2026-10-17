-- Team-only seats: call center agents in Team meetings and Client performance
-- (contract: docs/access/TEAM-ONLY-SEATS.md, Aziz 2026-10-17).
--
-- A member whose roles are only `call_center` (not admin, not the CEO's
-- address) is a team-only seat. It reads and edits the Team meetings it is in
-- and reads the Client performance board for its own clients. One helper
-- decides it: public.cockpit_is_team_only(). Every other seat keeps today's
-- rules: everyone reads all meetings, and an empty client list still means
-- every client for them.
--
-- AUDIT, read on Creative Triage 2026-10-17 (pg_policies and pg_proc whose
-- text names cockpit_has_active_seat, plus every SECURITY DEFINER function
-- authenticated can run that reads cockpit_members or cockpit_client_allowed).
-- Decision for each: "team" = add cockpit_team_member_of(<meeting>);
-- "board" = client-filtered; "not team-only" = add NOT cockpit_is_team_only().
--
-- Row policies that admit any active seat (34):
--   cockpit_billing_accounts.cockpit_billing_accounts_seat (SELECT)    not team-only
--   cockpit_billing_events.cockpit_billing_events_seat (ALL)           not team-only
--   cockpit_billing_inbox.cockpit_billing_inbox_seat (ALL)             not team-only
--   social_accounts.social_accounts_read (SELECT)                      not team-only
--   social_assets.social_assets_read (SELECT)                          not team-only
--   social_bank.social_bank_read (SELECT)                              not team-only
--   social_batches.social_batches_read (SELECT)                        not team-only
--   social_clients.social_clients_read (SELECT)                        not team-only
--   social_jobs.social_jobs_read (SELECT)                              not team-only
--   social_meta_pages.social_meta_pages_read (SELECT)                  not team-only
--   social_posts.social_posts_read (SELECT)                            not team-only
--   social_worker_status.social_worker_status_seat (SELECT)            not team-only
--     (the social write policies need cockpit_social_writer(): creative or
--     the CEO, so a team-only seat never passes them; unchanged)
--   team_meetings.team_native_read / team_native_write                 team (by id)
--   team_sittings.team_native_read / team_native_write                 team
--   team_agenda.team_native_read / team_native_write                   team
--   team_meeting_blocks.team_native_read / team_native_write           team
--   team_changes.team_native_read / team_native_write                  team (a change
--     with no meeting is not shown to a team-only seat)
--   team_wheels.team_native_read / team_native_write                   team (a wheel
--     on no meeting, a prize wheel for everyone, is not shown to a team-only seat)
--   team_wheel_options.team_native_read / team_native_write            team, through
--     the option's wheel
--   team_wheel_spins.team_native_read                                  team, through
--     the spin's wheel
--   team_meeting_people.team_native_read                               team
--   team_meeting_series.team_native_read                               team
--   team_calendar_ops.team_native_read                                 team
--   team_recordings.team_native_read                                   team: a recording
--     has no meeting column, so a team-only seat reads the recordings it was
--     invited to (invitee_emails holds its address), as team_recordings_invited
--     does for editors
--   team_creative_rows.team_native_read                                team: no meeting
--     column; a team-only seat reads the rows only while it is in an active
--     meeting that shows the pipeline (pipeline 'board' or 'strip'), and only
--     its own clients' rows (cockpit_client_allowed(client))
--   team_creative_rows.team_native_write                               not team-only
--     (the editable board is the creative team's)
--   team_people.team_native_read                                       unchanged: names
--     and roles of colleagues stay readable
--
-- SECURITY DEFINER functions that admit any active seat (9):
--   cockpit_board_read            board: rows through cockpit_client_allowed (below);
--                                 the whole-board extras (spend off the board,
--                                 accounts not linked, the Meta jobs' notes) are
--                                 never for a team-only seat. Replaced.
--   cockpit_board_client          board: through cockpit_client_allowed. Unchanged.
--   cockpit_board_lever_context   board write: refuses a team-only seat. Replaced.
--                                 (cockpit_board_targets_save is CEO or admin only:
--                                 already refused, unchanged.)
--   cockpit_team_can_edit_doc     team. Replaced. It also gates the doc pictures
--                                 (cockpit_team_picture_reserve/context/accept),
--                                 cockpit_team_ensure_sitting, cockpit_team_spin
--                                 (through ensure_sitting) and the storage policy
--                                 cockpit_team_picture_read on team-docs, whose
--                                 object path starts with the meeting id: a team-only
--                                 seat reads only its meetings' pictures with no
--                                 storage change.
--   cockpit_team_can_manage       team. Replaced. Every cockpit_team_calendar_command
--                                 action on a meeting goes through it.
--   cockpit_team_guard_write      team: a team-only seat writes only rows of its
--                                 meetings, so never the roster, the creative
--                                 rows or a new meeting. Replaced.
--   cockpit_team_calendar_command team through can_manage and the guard (creating
--                                 a meeting inserts a team_meetings row the guard
--                                 refuses). setEmail decides which meetings a
--                                 team-only seat is in (cockpit_team_member_of
--                                 matches the roster email), so only the CEO or
--                                 an admin sets a roster email now; a host could
--                                 before. Replaced whole from the live definition;
--                                 only the setEmail check is new.
--   cockpit_team_member_of        a roster row that is not active puts no one in
--                                 a meeting (team_people.active).
--   cockpit_team_spin             team through ensure_sitting. Unchanged.
--   cockpit_team_calendar_ready   takes no meeting and says only whether the
--                                 calendar worker is ready. Unchanged.
--
-- Found beyond "any active seat":
--   cockpit_client_allowed        an empty client list meant every client; for a
--                                 team-only seat it now means none. Replaced.
--   cockpit_get_my_access         a team-only seat gets cockpits [] and home /team.
--                                 Replaced.
--   cockpit_admin_upsert_member   allows call_center (alone, with at least one
--                                 client: several live helpers still read an empty
--                                 list as every client) and keeps
--                                 editor_people.via_portal in step with editor.
--                                 Replaced.
--   cockpit_admin_remove_member   a removed seat loses editor_people.via_portal too
--                                 (it loses the editor role). Replaced.
--   cockpit_csm_projection_actor  the door of cockpit_csm_projection_read, _edit
--                                 and _booking_context (a meeting's projections
--                                 strip, embed cs-projections or cs-daily). It let
--                                 in any confirmed seat that is a participant of
--                                 the meeting and never checked the role, so a
--                                 team-only seat added to such a meeting read
--                                 billing (payments, lifetime value), wrote renewal
--                                 plans and projections (a renewal posts a Won
--                                 decision and a Slack line) and read contact ids.
--                                 It now refuses a team-only seat. Replaced.
--   cockpit_csm_scope_all         true for a seat with an empty client list and no
--                                 role check, so "empty is every client" for a
--                                 team-only seat in projection_read. Now false for
--                                 a team-only seat. Replaced.
--   Every other definer function authenticated can run that reads cockpit_members
--   or cockpit_client_allowed checks a named role (admin, media_buyer, csm,
--   creative, editor, sales, finance), the CEO, an actor helper built on those, or
--   is_editor() first; cockpit_has_role(r) is false for a team-only seat for every
--   r but 'call_center', which nothing checks. cockpit_call_centre_seat() (client
--   call numbers) stays CEO, csm and media_buyer. Unchanged.
--   Storage "editors upload review media" let any signed-in user add to the
--   public review-videos bucket. The only browser that uploads there is the
--   editor desk's Send for review page, and the desk opens only for is_editor();
--   the review-import worker uses the service key. The policy now needs
--   is_editor() and not a team-only seat (is_editor() reads the email, so a call
--   center address that is also on the editor list is still kept out). Replaced,
--   only where storage.objects exists.
--
-- House style: one transaction, safe to apply twice, SECURITY DEFINER with
-- search_path '' on the new helpers (the replaced functions keep their live
-- settings), new functions granted to authenticated only, audit rows for every
-- write. The replaced bodies are the live definitions read on 2026-10-17
-- (pg_get_functiondef) with only the lines marked "team-only" added.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The helpers.

-- The caller has an active, linked, confirmed seat whose roles are non-empty
-- and all call_center, and it is neither the CEO nor an admin.
CREATE OR REPLACE FUNCTION public.cockpit_is_team_only()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cockpit_members cm
    JOIN auth.users au ON au.id = cm.auth_user_id
    WHERE cm.auth_user_id = auth.uid()
      AND cm.active IS TRUE
      AND au.email_confirmed_at IS NOT NULL
      AND cm.email = pg_catalog.lower(pg_catalog.btrim(au.email))
      AND pg_catalog.cardinality(cm.roles) > 0
      AND cm.roles <@ ARRAY['call_center']::text[]
  )
  -- roles <@ {call_center} already rules out admin; the CEO is an address.
  AND NOT coalesce(public.cockpit_is_ceo(), false);
$$;

-- True for every seat that is not team-only. A team-only seat is in a meeting
-- when team_meeting_people has a row, not removed, for the active team_people
-- person whose email is the seat's email.
CREATE OR REPLACE FUNCTION public.cockpit_team_member_of(p_meeting_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT public.cockpit_is_team_only()
    OR (p_meeting_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.team_meeting_people mp
      JOIN public.team_people p ON p.id = mp.person_id
      JOIN public.cockpit_members cm ON cm.auth_user_id = auth.uid() AND cm.active IS TRUE
      WHERE mp.meeting_id = p_meeting_id
        AND mp.removed IS FALSE
        AND p.active IS TRUE
        AND pg_catalog.lower(pg_catalog.btrim(p.email)) = cm.email
    ));
$$;

REVOKE ALL ON FUNCTION public.cockpit_is_team_only() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cockpit_team_member_of(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_is_team_only() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_team_member_of(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Seats: the Admin save, the remove, the access answer, the client rule.

CREATE OR REPLACE FUNCTION public.cockpit_admin_upsert_member(p_email text, p_name text, p_roles text[], p_clients text[] DEFAULT '{}'::text[])
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
  v_allowed_roles CONSTANT text[] := ARRAY['admin', 'media_buyer', 'csm', 'creative', 'editor', 'call_center']::text[];
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
    auth_user_id
  ) VALUES (
    v_target_email,
    nullif(pg_catalog.btrim(p_name), ''),
    v_clean_roles,
    v_clean_clients,
    true,
    v_auth_user_id
  )
  ON CONFLICT (email) DO UPDATE
  SET
    name = coalesce(nullif(pg_catalog.btrim(excluded.name), ''), public.cockpit_members.name),
    roles = excluded.roles,
    clients = excluded.clients,
    active = true,
    auth_user_id = coalesce(public.cockpit_members.auth_user_id, excluded.auth_user_id),
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

  RETURN v_member_id;
END;
$function$;

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
END;
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_get_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid;
  v_email text;
  v_confirmed timestamptz;
  v_member record;
  v_is_ceo boolean;
  v_is_admin boolean;
  v_cockpits text[];
  v_home text;
  v_team_only boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.lower(pg_catalog.btrim(email)), email_confirmed_at
  INTO v_email, v_confirmed
  FROM auth.users
  WHERE id = v_uid;

  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_member
  FROM public.cockpit_members
  WHERE active = true
    AND auth_user_id = v_uid
    AND email = v_email;

  IF v_member.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_ceo := (v_email IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com'));
  v_is_admin := ('admin' = ANY(v_member.roles));
  -- team-only: Team meetings and Client performance, no cockpit.
  v_team_only := coalesce(public.cockpit_is_team_only(), false);

  IF v_is_admin THEN
    v_cockpits := ARRAY['media_buyer', 'csm', 'creative', 'editor', 'sales'];
  ELSIF v_team_only THEN
    v_cockpits := '{}'::text[];
  ELSE
    SELECT pg_catalog.array_agg(c ORDER BY c)
    INTO v_cockpits
    FROM pg_catalog.unnest(ARRAY['media_buyer', 'csm', 'creative', 'editor', 'sales']) AS c
    WHERE c = ANY(v_member.roles);
    v_cockpits := COALESCE(v_cockpits, '{}'::text[]);
  END IF;

  IF v_is_ceo THEN
    v_home := '/ceo';
  ELSIF v_is_admin THEN
    v_home := '/admin';
  ELSIF v_team_only THEN
    v_home := '/team';
  ELSIF 'media_buyer' = ANY(v_member.roles) THEN
    v_home := '/dashboard';
  ELSIF 'csm' = ANY(v_member.roles) THEN
    v_home := '/go/csm';
  ELSIF 'creative' = ANY(v_member.roles) THEN
    v_home := '/go/creative';
  ELSIF 'editor' = ANY(v_member.roles) THEN
    v_home := '/go/editor';
  ELSIF 'sales' = ANY(v_member.roles) THEN
    v_home := '/go/sales';
  ELSE
    v_home := NULL;
  END IF;

  RETURN jsonb_build_object(
    'email', v_member.email,
    'name', v_member.name,
    'roles', to_jsonb(v_member.roles),
    'clients', to_jsonb(v_member.clients),
    'is_admin', v_is_admin,
    'is_ceo', v_is_ceo,
    'cockpits', to_jsonb(v_cockpits),
    'home', v_home
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_client_allowed(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_team_only boolean;
BEGIN
  IF p_name IS NULL OR btrim(p_name)='' THEN RETURN false; END IF;
  IF public.cockpit_has_role('admin') OR public.cockpit_is_ceo() THEN RETURN true; END IF;
  -- team-only: an empty client list is no clients, never every client.
  v_team_only := coalesce(public.cockpit_is_team_only(), false);
  RETURN EXISTS (
    SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
    WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL
      AND m.email=lower(btrim(u.email))
      AND ((cardinality(m.clients)=0 AND NOT v_team_only) OR EXISTS (
        SELECT 1 FROM unnest(m.clients) n WHERE lower(btrim(n))=lower(btrim(p_name))
      ))
  );
END $function$;

-- ---------------------------------------------------------------------------
-- 3. Team meetings: the doc, the managers and the write guard.

CREATE OR REPLACE FUNCTION public.cockpit_team_can_edit_doc(p_meeting_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.cockpit_has_active_seat() and public.cockpit_team_member_of(p_meeting_id) and exists(select 1 from public.team_meetings where id=p_meeting_id);
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_team_can_manage(p_meeting_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select public.cockpit_has_active_seat() and public.cockpit_team_member_of(p_meeting_id) and (
   public.cockpit_is_ceo() or public.cockpit_has_role('admin') or exists(
     select 1 from public.team_meeting_people mp join public.team_people p on p.id=mp.person_id
     join auth.users u on u.id=auth.uid() and lower(u.email)=lower(p.email)
     where mp.meeting_id=p_meeting_id and mp.part='host' and not mp.removed and p.active));
$function$;

CREATE OR REPLACE FUNCTION public.cockpit_team_guard_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 before_row jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 after_row jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 mid text; wid text; wheel public.team_wheels; actor text; boss boolean;
 trusted boolean := coalesce(auth.role()='service_role',false) or current_setting('request.jwt.claims',true) is null or current_setting('request.jwt.claims',true)='';
 -- An unset flag is NULL. Treat it as false so direct writes stay guarded.
 command boolean := coalesce(current_setting('cockpit.team_command',true)='on',false);
begin
 mid := row_data->>'meeting_id';
 if tg_table_name='team_meetings' then mid:=row_data->>'id'; end if;
 if tg_table_name in ('team_wheel_options','team_wheel_spins') then
   wid:=row_data->>'wheel_id'; select * into wheel from public.team_wheels where id=wid; mid:=wheel.meeting_id;
 end if;
 select lower(email) into actor from auth.users where id=auth.uid();
 actor:=coalesce(actor,case when trusted then 'native team worker' else 'unknown' end);
 if not trusted then
   if not public.cockpit_has_active_seat() then raise exception 'An active verified cockpit seat is required'; end if;
   -- team-only: a call center seat writes only rows of the meetings it is in,
   -- so never a new meeting, the roster or the creative rows.
   if not public.cockpit_team_member_of(mid) then
     if tg_table_name='team_meetings' and tg_op='INSERT' then
       raise exception 'Call center seats cannot create meetings. Ask a host to add you to one.' using errcode='42501';
     end if;
     raise exception 'This meeting is not one of yours. Ask its host to add you.' using errcode='42501';
   end if;
   boss:=public.cockpit_is_ceo() or public.cockpit_has_role('admin');
   if tg_table_name in ('team_people','team_meeting_series','team_recordings','team_calendar_ops') and not command then
     raise exception 'Use the authorized team command';
   elsif tg_table_name='team_meetings' and not command then
     if tg_op<>'UPDATE' or (before_row-array['doc','doc_by','doc_at','doc_version','links']) is distinct from (after_row-array['doc','doc_by','doc_at','doc_version','links']) then
       raise exception 'Use the authorized meeting command';
     end if;
     if new.doc is distinct from old.doc then
       if new.doc_version<>old.doc_version+1 or length(new.doc)>400000 then raise exception 'Invalid document version or length'; end if;
       new.doc_by:=actor; new.doc_at:=now();
     end if;
     if jsonb_typeof(new.links)<>'array' or jsonb_array_length(new.links)>30 or exists(
       select 1 from jsonb_array_elements(new.links) x where coalesce(x->>'url','') !~ '^https?://' or length(x->>'url')>1000 or length(x->>'label')>80
     ) then raise exception 'Invalid meeting links'; end if;
   elsif tg_table_name='team_meeting_people' and not command then
     raise exception 'Use the authorized guest command';
   elsif tg_table_name='team_sittings' and not command then
     if tg_op<>'UPDATE' or (before_row-array['notes','notes_by','notes_at','notes_version','goal_hit']) is distinct from (after_row-array['notes','notes_by','notes_at','notes_version','goal_hit']) then
       raise exception 'Use the authorized sitting command';
     end if;
     if new.goal_hit is distinct from old.goal_hit and not public.cockpit_team_can_manage(mid) then raise exception 'Only meeting hosts or admins set the goal'; end if;
     if new.notes is distinct from old.notes then
       if new.notes_version<>old.notes_version+1 then raise exception 'Invalid notes version'; end if;
       new.notes_by:=actor; new.notes_at:=now();
     end if;
   elsif tg_table_name='team_wheels' then
     if (row_data->>'kind'='prize' or before_row->>'kind'='prize' or mid is null) and not boss then raise exception 'Only CEO and admins change prize wheels'; end if;
     if not boss and (not public.cockpit_team_can_manage(mid) or (tg_op='UPDATE' and not public.cockpit_team_can_manage(old.meeting_id))) then raise exception 'Only meeting hosts change wheels'; end if;
   elsif tg_table_name='team_wheel_options' then
     if wheel.kind='prize' and not boss then raise exception 'Only CEO and admins change prizes'; end if;
     if tg_op='UPDATE' and old.wheel_id<>new.wheel_id then raise exception 'An option cannot change wheels'; end if;
   elsif tg_table_name='team_wheel_spins' and not command then
     raise exception 'Use the server wheel draw';
   elsif tg_table_name='team_changes' then
     if tg_op<>'INSERT' then raise exception 'Team audit is immutable'; end if;
     new.by_whom:=actor; new.at:=now();
   end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Team row policies: every table that belongs to a meeting adds
--    cockpit_team_member_of(<meeting>) to read and write. Grants are the ones
--    20261011a_team_access_restore gave and are not touched. team_people keeps
--    its policy. A table that is not there is skipped.

DO $team$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('team_meetings',       '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(id))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(id))'),
    ('team_sittings',       '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))'),
    ('team_agenda',         '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))'),
    ('team_meeting_blocks', '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))'),
    ('team_changes',        '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))'),
    ('team_wheels',         '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))'),
    ('team_wheel_options',  '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of((SELECT w.meeting_id FROM public.team_wheels w WHERE w.id = wheel_id)))',
                            '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of((SELECT w.meeting_id FROM public.team_wheels w WHERE w.id = wheel_id)))'),
    ('team_wheel_spins',    '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of((SELECT w.meeting_id FROM public.team_wheels w WHERE w.id = wheel_id)))',
                            NULL),
    ('team_meeting_people', '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))', NULL),
    ('team_meeting_series', '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))', NULL),
    ('team_calendar_ops',   '(NOT (SELECT public.cockpit_is_team_only()) OR public.cockpit_team_member_of(meeting_id))', NULL),
    ('team_recordings',     '(NOT (SELECT public.cockpit_is_team_only()) OR invitee_emails ? lower(coalesce(auth.jwt() ->> ''email'', '''')))',
                            NULL),
    ('team_creative_rows',  '(NOT (SELECT public.cockpit_is_team_only()) OR (public.cockpit_client_allowed(client) AND EXISTS (SELECT 1 FROM public.team_meetings m WHERE m.active AND m.pipeline IN (''board'', ''strip'') AND public.cockpit_team_member_of(m.id))))',
                            'NOT (SELECT public.cockpit_is_team_only())')
  ) AS v(t, read_rule, write_rule)
  LOOP
    IF to_regclass('public.' || r.t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS team_native_read ON public.%I', r.t);
    EXECUTE format('CREATE POLICY team_native_read ON public.%I FOR SELECT TO authenticated '
      'USING ((SELECT public.cockpit_has_active_seat()) AND %s)', r.t, r.read_rule);
    IF r.write_rule IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS team_native_write ON public.%I', r.t);
      EXECUTE format('CREATE POLICY team_native_write ON public.%I FOR ALL TO authenticated '
        'USING ((SELECT public.cockpit_has_active_seat()) AND %s) WITH CHECK ((SELECT public.cockpit_has_active_seat()) AND %s)',
        r.t, r.write_rule, r.write_rule);
    END IF;
  END LOOP;
END $team$;

-- ---------------------------------------------------------------------------
-- 5. Client billing and the social calendar: not for team-only seats. Same
--    commands and names as the live policies; only the rule changes.

DO $notteam$
DECLARE
  rule CONSTANT text := '((SELECT public.cockpit_has_active_seat()) AND NOT (SELECT public.cockpit_is_team_only())) OR (SELECT public.cockpit_is_ceo())';
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_clients','social_assets','social_bank','social_batches',
    'social_posts','social_jobs','social_accounts','social_meta_pages']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', t || '_read', t, rule);
  END LOOP;
  IF to_regclass('public.social_worker_status') IS NOT NULL THEN
    DROP POLICY IF EXISTS social_worker_status_seat ON public.social_worker_status;
    EXECUTE format('CREATE POLICY social_worker_status_seat ON public.social_worker_status FOR SELECT TO authenticated USING (%s)', rule);
  END IF;
  IF to_regclass('public.cockpit_billing_accounts') IS NOT NULL THEN
    DROP POLICY IF EXISTS cockpit_billing_accounts_seat ON public.cockpit_billing_accounts;
    EXECUTE format('CREATE POLICY cockpit_billing_accounts_seat ON public.cockpit_billing_accounts FOR SELECT TO authenticated USING (%s)', rule);
  END IF;
  FOREACH t IN ARRAY ARRAY['cockpit_billing_events','cockpit_billing_inbox']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_seat', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', t || '_seat', t, rule, rule);
  END LOOP;
END $notteam$;

-- ---------------------------------------------------------------------------
-- 6. The Client performance board: rows through cockpit_client_allowed (above),
--    no whole-board extras and no levers for a team-only seat.

CREATE OR REPLACE FUNCTION public.cockpit_board_read(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_meta jsonb;
  v_rows jsonb;
  v_facts record;
  v_notes text[] := '{}';
  v_hourly jsonb;
  v_whole boolean;
  v_off jsonb;
  v_bud_at timestamptz;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the Client Performance board.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  -- Ad accounts tied to no client, and the Meta jobs' own notes, name other
  -- clients' accounts: only the CEO, admins and seats not limited to some
  -- clients see them (cockpit_client_allowed's rule for the whole board).
  -- team-only: a call center seat is never a whole-board seat.
  v_whole := coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)
    OR (NOT coalesce(public.cockpit_is_team_only(), false) AND EXISTS (SELECT 1 FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
               WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL
                 AND cm.email = lower(btrim(au.email)) AND cardinality(coalesce(cm.clients, '{}'::text[])) = 0));
  v_meta := public.cockpit_meta_ad_days_status();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'clientName', x->>'locationId'), '[]'::jsonb) INTO v_rows
  FROM jsonb_array_elements(public.cockpit_board_rows(p_from, p_to, NULL, v_meta)) x
  WHERE public.cockpit_client_allowed(x->>'clientName');

  -- Spend in these days on ad accounts no client row carries: a cancelled
  -- client's account still delivering, a client that is not Active (paused,
  -- stopped, launching, ghosting: off the board since 2026-10-17), an account
  -- tied to no client, or one kept out on purpose. It names other clients, so
  -- only whole-board seats see it; the rows' totals never include it.
  IF v_whole THEN
    WITH shown AS (
      SELECT DISTINCT a FROM public.cockpit_board_clients b, unnest(b.ad_account_ids) a
      WHERE b.status = 'Active'
    ), owner AS (
      SELECT a, min(b.client_name) AS client_name, min(b.status) AS status
      FROM public.cockpit_board_clients b, unnest(b.ad_account_ids) a GROUP BY a
    ), acct AS (
      SELECT m.account_id, max(m.account_name) AS account_name, sum(m.spend_usd) AS spend,
        count(*) FILTER (WHERE m.spend > 0 AND m.spend_usd IS NULL) AS unpriced
      FROM public.cockpit_meta_ad_days m
      WHERE m.day BETWEEN p_from AND p_to
        AND m.day < (public.cockpit_meta_ad_days_now() AT TIME ZONE coalesce(m.account_timezone, 'Asia/Kuwait'))::date
        AND NOT EXISTS (SELECT 1 FROM shown s WHERE s.a = m.account_id)
      GROUP BY m.account_id
      HAVING sum(m.spend) > 0
    )
    SELECT jsonb_build_object(
        'spend', round(coalesce(sum(x.spend), 0), 2),
        'unpriced', coalesce(sum(x.unpriced), 0) > 0,
        'accounts', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'accountId', x.account_id, 'name', x.account_name, 'spend', round(x.spend, 2),
          'client', coalesce(o.client_name, k.client_name),
          'clientStatus', CASE WHEN NOT coalesce(k.kept_out, false) AND o.status NOT IN ('Cancelled', 'Removed from sheet') THEN o.status END,
          'reason', CASE WHEN k.kept_out THEN 'kept_out'
                         WHEN o.status IN ('Cancelled', 'Removed from sheet') THEN 'cancelled'
                         WHEN o.client_name IS NOT NULL THEN 'not_active'
                         ELSE 'not_tied' END)) ORDER BY x.spend DESC NULLS LAST), '[]'::jsonb))
      INTO v_off
    FROM acct x
    LEFT JOIN owner o ON o.a = x.account_id
    LEFT JOIN LATERAL (
      SELECT t.kept_out, b.client_name FROM public.cockpit_board_account_ties t
      LEFT JOIN public.cockpit_board_clients b ON b.location_id = t.location_id
      WHERE t.account_id = x.account_id ORDER BY t.kept_out DESC LIMIT 1) k ON true;
  END IF;

  SELECT s.last_run_at, s.last_ok_at, s.ok, s.note INTO v_facts FROM public.cockpit_sync_state s WHERE s.key = 'board-facts';
  IF v_facts.last_run_at IS NULL THEN
    v_notes := v_notes || 'The client facts have not been worked out yet, so the business columns are empty.'::text;
  ELSIF v_facts.last_run_at < now() - interval '2 hours' THEN
    v_notes := v_notes || format('The client facts last refreshed %s Kuwait time; they refresh every 30 minutes.',
      to_char(v_facts.last_run_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'));
  END IF;
  IF v_facts.ok IS FALSE THEN
    v_notes := v_notes || coalesce(v_facts.note, 'The last client facts refresh could not read every source.');
  END IF;
  v_hourly := v_meta->'jobs'->'hourly';
  IF coalesce((v_meta->'store'->>'rows')::bigint, 0) = 0 THEN
    v_notes := v_notes || 'The Meta ad store has no rows yet, so the ad columns are empty.'::text;
  ELSIF v_hourly IS NULL OR (v_hourly->>'startedAt')::timestamptz < now() - interval '3 hours' THEN
    v_notes := v_notes || format('Meta was last read %s Kuwait time; it is read every hour.',
      coalesce(to_char((v_meta->'store'->>'lastFetchedAt')::timestamptz AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'), 'at an unknown time'));
  ELSIF v_hourly->>'state' IN ('failed', 'partial') THEN
    v_notes := v_notes || CASE WHEN v_whole THEN coalesce(v_hourly->>'note', 'The last Meta read did not finish every ad account.')
                               ELSE 'The last Meta read did not finish every ad account.' END;
  END IF;
  -- Budgets (2026-10-17): read every hour by meta-ad-days, with their own
  -- state (a failed budgets read never makes the ad numbers incomplete).
  v_bud_at := (v_meta->'budgets'->>'newestFetchedAt')::timestamptz;
  IF v_bud_at IS NULL THEN
    v_notes := v_notes || 'Meta budgets have not been read yet, so Budget/day and Budget used are empty.'::text;
  ELSIF v_bud_at < now() - interval '3 hours' THEN
    v_notes := v_notes || format('Budgets were last read at %s Kuwait time.',
      to_char(v_bud_at AT TIME ZONE 'Asia/Kuwait',
        CASE WHEN (v_bud_at AT TIME ZONE 'Asia/Kuwait')::date = v_today THEN 'HH24:MI' ELSE 'HH24:MI on DD Mon' END));
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'from', p_from, 'to', p_to, 'today', v_today, 'days', p_to - p_from + 1,
    'adWindow', jsonb_build_object('from', p_from, 'to', least(p_to, v_today - 1),
      'note', 'Ad numbers end yesterday on each ad account''s own clock (most are Kuwait or Riyadh time); today is not in yet. The business numbers run to the end of the time frame on Kuwait time.'),
    'generatedAt', now(),
    'targets', public.cockpit_board_targets_map(NULL),
    'canEditTargets', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false),
    'clients', v_rows,
    'notLinked', CASE WHEN v_whole THEN coalesce(v_meta->'notLinked', '[]'::jsonb) ELSE '[]'::jsonb END,
    'offBoard', v_off,
    'freshness', jsonb_build_object(
      'facts', jsonb_build_object('lastRunAt', v_facts.last_run_at, 'lastOkAt', v_facts.last_ok_at, 'ok', v_facts.ok, 'note', v_facts.note),
      'meta', jsonb_build_object('lastFetchedAt', v_meta->'store'->'lastFetchedAt', 'firstDay', v_meta->'store'->'firstDay',
        'lastDay', v_meta->'store'->'lastDay',
        'hourly', CASE WHEN v_whole THEN v_hourly ELSE v_hourly - 'note' END,
        'nightly', CASE WHEN v_whole THEN v_meta->'jobs'->'nightly' ELSE (v_meta->'jobs'->'nightly') - 'note' END,
        'note', CASE WHEN NOT v_whole AND (v_hourly->>'state' IN ('failed', 'partial') OR v_meta->'jobs'->'nightly'->>'state' IN ('failed', 'partial'))
                     THEN 'The last Meta read did not finish every ad account.' END)),
    'notes', to_jsonb(v_notes));
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_board_lever_context(p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_email text;
  c public.cockpit_board_clients;
  d record;
  v_metric text := p_args->>'metric';
  v_lever text := btrim(coalesce(p_args->>'lever', ''));
  v_dep text := p_args->>'department';
  v_note text := nullif(btrim(coalesce(p_args->>'note', '')), '');
  v_meeting text := nullif(btrim(coalesce(p_args->>'meetingId', '')), '');
  v_from date;
  v_to date;
  v_row jsonb;
  v_cell jsonb;
  v_t jsonb;
  v_evidence text;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to add a lever.' USING ERRCODE = '42501';
  END IF;
  -- team-only: a call center seat reads its clients' rows; levers go through
  -- the client's media buyer or CSM.
  IF coalesce(public.cockpit_is_team_only(), false) THEN
    RAISE EXCEPTION 'Call center seats can read the board but not add levers. Ask the client''s media buyer or CSM to add it.' USING ERRCODE = '42501';
  END IF;
  SELECT cm.email INTO v_email FROM public.cockpit_members cm JOIN auth.users au ON au.id = cm.auth_user_id
  WHERE cm.auth_user_id = auth.uid() AND cm.active AND au.email_confirmed_at IS NOT NULL ORDER BY cm.email LIMIT 1;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object'
     OR p_args - ARRAY['locationId', 'metric', 'lever', 'department', 'note', 'meetingId', 'from', 'to'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the client, the metric, the lever and the department that owns it.' USING ERRCODE = '22023';
  END IF;
  IF length(v_lever) < 3 OR length(v_lever) > 200 THEN
    RAISE EXCEPTION 'Write the lever in 3 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_dep IS NULL OR v_dep NOT IN ('creative', 'tech', 'client_success', 'call_center', 'media_buyer') THEN
    RAISE EXCEPTION 'Choose the department that owns the lever: creative, tech, client success, call centre or media buyer.' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Keep the note to 1,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_meeting IS NOT NULL AND v_meeting !~ '^[A-Za-z0-9_-]{1,80}$' THEN
    RAISE EXCEPTION 'That meeting is not known.' USING ERRCODE = '22023';
  END IF;
  IF v_meeting IS NOT NULL AND to_regclass('public.team_meetings') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.team_meetings m WHERE m.id = v_meeting) THEN
      RAISE EXCEPTION 'That meeting is not known.' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO d FROM public.cockpit_board_default_targets() x WHERE x.metric = v_metric;
  IF d.metric IS NULL AND v_metric IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'Choose the metric the lever moves.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_from := coalesce((p_args->>'from')::date, v_today - 29);
    v_to := coalesce((p_args->>'to')::date, v_today);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Choose a time frame: a first and a last day.' USING ERRCODE = '22023';
  END;
  PERFORM public.cockpit_board_check_window(v_from, v_to);
  SELECT * INTO c FROM public.cockpit_board_clients b WHERE b.location_id = p_args->>'locationId';
  IF c.location_id IS NULL OR NOT coalesce(public.cockpit_client_allowed(c.client_name), false) THEN
    RAISE EXCEPTION 'This client is not on your board.' USING ERRCODE = '42501';
  END IF;
  IF c.clickup_id IS NULL OR c.clickup_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'This client has no ClickUp card, so the lever cannot be filed. Link the card first.' USING ERRCODE = '22023';
  END IF;

  IF d.metric IS NOT NULL THEN
    v_row := public.cockpit_board_rows(v_from, v_to, c.location_id, public.cockpit_meta_ad_days_status())->0;
    v_cell := v_row->'values'->d.value_key;
    v_t := public.cockpit_board_targets_map(c.clickup_id)->d.metric;
    v_evidence := format('%s %s, %s to %s: %s', c.client_name, d.label, to_char(v_from, 'DD Mon'), to_char(v_to, 'DD Mon'),
      CASE
        WHEN (v_cell->>'v') IS NOT NULL THEN public.cockpit_board_fmt((v_cell->>'v')::numeric, d.unit)
          || format(' against a good line of %s', public.cockpit_board_fmt((v_t->>'good')::numeric, d.unit))
          || CASE v_cell->>'status' WHEN 'good' THEN ' (good)' WHEN 'watch' THEN ' (watch)' WHEN 'off' THEN ' (off target)'
               WHEN 'too_few' THEN ' (too few to judge)' ELSE '' END
        WHEN v_cell->>'status' = 'not_filled_in' THEN 'not filled in by the client'
        WHEN v_cell->>'status' = 'too_few' THEN 'too few to judge'
        ELSE 'not measured' END || '.');
  ELSE
    v_evidence := format('%s, %s to %s: raised in a board review.', c.client_name, to_char(v_from, 'DD Mon'), to_char(v_to, 'DD Mon'));
  END IF;

  RETURN jsonb_build_object(
    'actorId', auth.uid(), 'email', v_email,
    'locationId', c.location_id, 'taskId', c.clickup_id, 'clientName', c.client_name,
    'metric', v_metric, 'metricLabel', coalesce(d.label, 'Other'),
    'lever', v_lever, 'department', v_dep, 'note', v_note, 'meetingId', v_meeting,
    'evidence', left(v_evidence, 500), 'day', v_today, 'from', v_from, 'to', v_to);
END $function$;

-- ---------------------------------------------------------------------------
-- 7. Client success projections in a meeting: never for a team-only seat, and
--    an empty client list is never "every client" for one. Live definitions
--    (2026-10-17) with only the team-only lines added; grants as live.

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_actor(p_meeting_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid:=auth.uid(); actor_email text;
BEGIN
 SELECT m.email INTO actor_email FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=uid AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
 IF actor_email IS NULL THEN RAISE EXCEPTION 'Active verified membership required' USING ERRCODE='42501'; END IF;
 -- team-only, 2026-10-17: projections carry billing, renewal plans and client
 -- contacts; a call center seat never opens them, even as a meeting participant.
 IF coalesce(public.cockpit_is_team_only(), false) THEN RAISE EXCEPTION 'Call center seats do not open client success projections. Ask the meeting''s host for the numbers.' USING ERRCODE='42501'; END IF;
 IF p_meeting_id IS NULL THEN RETURN public.cockpit_csm_actor(); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_meetings WHERE id=p_meeting_id AND active AND embed IN ('cs-projections','cs-daily')) THEN RAISE EXCEPTION 'This meeting does not show client success projections'; END IF;
 IF NOT(public.cockpit_is_ceo() OR public.cockpit_has_role('admin')) AND NOT EXISTS(
 SELECT 1 FROM public.team_meeting_people mp JOIN public.team_people p ON p.id=mp.person_id
 WHERE mp.meeting_id=p_meeting_id AND NOT mp.removed AND lower(btrim(p.email))=actor_email) THEN
 RAISE EXCEPTION 'The projections are for this meeting''s participants' USING ERRCODE='42501'; END IF;
 RETURN uid;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_scope_all()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 -- team-only: a call center seat's empty client list is no clients, never all.
 SELECT public.cockpit_has_role('admin') OR public.cockpit_is_ceo() OR EXISTS(SELECT 1 FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email)) AND cardinality(m.clients)=0 AND NOT coalesce(public.cockpit_is_team_only(), false))
$function$;

REVOKE ALL ON FUNCTION public.cockpit_csm_projection_actor(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_csm_scope_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_scope_all() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The team command: only the CEO or an admin sets a roster email. Live
--    definition (2026-10-17, the same as 20261007d) with only the setEmail
--    check added; grants as live.

CREATE OR REPLACE FUNCTION public.cockpit_team_calendar_command(p_action text, p_args jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
<<command>>
declare
 mid text:=coalesce(p_args->>'meetingId',p_args->>'id'); actor text; pid text;
 m public.team_meetings; s public.team_sittings; person public.team_people; prev public.team_meeting_people;
 title text; purpose text; dept text; base text; n integer:=1; day date; start_at time; duration integer; days smallint[];
 sid text:=p_args->>'sittingId'; stamp timestamptz; part text:=p_args->>'part'; operation text; payload jsonb;
 today date:=(now() at time zone 'Asia/Kuwait')::date; on_calendar boolean; guest_action text;
begin
 if not public.cockpit_has_active_seat() then raise exception 'An active verified cockpit seat is required'; end if;
 select lower(email) into actor from auth.users where id=auth.uid();
 perform set_config('cockpit.team_command','on',true);
 if p_action='saveMeeting' and nullif(mid,'') is null then
  title:=left(btrim(p_args->>'title'),120); purpose:=left(btrim(p_args->>'purpose'),300); dept:=nullif(left(btrim(p_args->>'department'),60),'');
  if coalesce(length(title),0)<3 or coalesce(length(purpose),0)<8 then raise exception 'Give the meeting a name and a purpose'; end if;
  if coalesce(p_args->>'cadence','')<>all(array['daily','three times a week','twice a week','weekly','every two weeks','monthly','quarterly','as needed']) then raise exception 'Pick how often it meets'; end if;
  on_calendar:=coalesce((p_args->>'onCalendar')::boolean,true);
  select coalesce(array_agg(distinct value::smallint order by value::smallint),'{}'::smallint[]) into days from jsonb_array_elements_text(coalesce(p_args->'weekdays','[]'));
  if not days<@array[0,1,2,3,4,5,6]::smallint[] then raise exception 'Invalid meeting weekdays'; end if;
  if on_calendar or nullif(p_args->>'startTime','') is not null then
   if coalesce(p_args->>'startTime','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Give it a start time'; end if;
   start_at:=(p_args->>'startTime')::time; duration:=(p_args->>'minutes')::integer;
   if duration is null or duration not between 5 and 480 then raise exception 'Meeting length must be 5 to 480 minutes'; end if;
  end if;
  day:=nullif(p_args->>'firstDate','')::date;
  if on_calendar and cardinality(days)=0 and day is null then raise exception 'Pick its days or the one sitting date'; end if;
  base:=left(trim(both '-' from regexp_replace(lower(title),'[^a-z0-9]+','-','g')),48); if base='' then base:='meeting'; end if;
  perform pg_advisory_xact_lock(hashtextextended('team-create:'||base,0));
  mid:=base; while exists(select 1 from public.team_meetings where id=mid) loop n:=n+1;mid:=base||'-'||n;end loop;
  select id into pid from public.team_people where lower(email)=actor and active limit 1;
  insert into public.team_meetings(id,title,purpose,cadence,department,host_id,active,managed,created_by,tz,start_time,minutes,weekdays,ends_on)
  values(mid,title,purpose,p_args->>'cadence',dept,pid,true,'cockpit',actor,'Asia/Kuwait',start_at,duration,nullif(days,'{}'),case when cardinality(days)=0 then day end);
  if pid is not null then insert into public.team_meeting_people(meeting_id,person_id,part,source,changed_by,changed_at) values(mid,pid,'host','cockpit',actor,now()); end if;
  if cardinality(days)=0 and day is not null then
   stamp:=(day+start_at) at time zone 'Asia/Kuwait';
   insert into public.team_sittings(id,meeting_id,on_date,starts_at,ends_at,held) values(mid||':'||day,mid,day,stamp,stamp+make_interval(mins=>duration),day<=today);
  end if;
  if on_calendar then operation:='create';payload:=jsonb_build_object('from',coalesce(day,today));end if;
 else
  if mid is null and sid is not null then mid:=left(sid,length(sid)-11); end if;
  if not public.cockpit_team_can_manage(mid) then raise exception 'Only this meeting''s hosts, admins and CEO manage it'; end if;
  select * into m from public.team_meetings where id=mid for update;
  if not found then raise exception 'That meeting is not in the list';end if;
  if sid is not null then
   s:=public.cockpit_team_ensure_sitting(mid,sid);
   if s.meeting_id<>mid then raise exception 'That sitting is another meeting''s';end if;
  end if;
  case p_action
  when 'saveMeeting' then
   title:=left(btrim(p_args->>'title'),120);purpose:=left(btrim(p_args->>'purpose'),300);dept:=nullif(left(btrim(p_args->>'department'),60),'');
   if coalesce(length(title),0)<3 or coalesce(length(purpose),0)<8 then raise exception 'Give the meeting a name and a purpose';end if;
   if coalesce(p_args->>'cadence','')<>all(array['daily','three times a week','twice a week','weekly','every two weeks','monthly','quarterly','as needed']) then raise exception 'Pick how often it meets';end if;
   update public.team_meetings set title=command.title,purpose=command.purpose,cadence=p_args->>'cadence',department=dept,managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null and (m.title is distinct from title or m.purpose is distinct from purpose) then operation:='describe';payload:=jsonb_build_object('title',title,'oldTitle',m.title,'purpose',purpose);end if;
  when 'setPart' then
   if part is null or part<>all(array['host','required','optional','off']) then raise exception 'Choose a part';end if;
   select * into person from public.team_people where id=p_args->>'personId' and active;
   if not found then raise exception 'Choose a person on the roster';end if;
   select * into prev from public.team_meeting_people where meeting_id=mid and person_id=person.id;
   if prev.part='host' and not prev.removed and part<>'host' and not exists(select 1 from public.team_meeting_people where meeting_id=mid and person_id<>person.id and part='host' and not removed) then raise exception 'Make somebody else the host first';end if;
   if m.cal_event_id is not null and (person.email is null or person.email!~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'Give this person an email address for the invite';end if;
   if m.cal_event_id is not null and lower(person.email)=lower(m.cal_calendar) and part='off' then raise exception 'The organizer cannot be taken off the invite';end if;
   guest_action:=case when part='off' then 'remove' when prev.person_id is null or prev.removed then 'add' else 'part' end;
   insert into public.team_meeting_people(meeting_id,person_id,part,removed,source,changed_by,changed_at)
   values(mid,person.id,case when part='off' then coalesce(prev.part,'required') else part end,part='off','cockpit',actor,now())
   on conflict(meeting_id,person_id) do update set part=excluded.part,removed=excluded.removed,source='cockpit',changed_by=actor,changed_at=now();
   update public.team_meetings set host_id=(select person_id from public.team_meeting_people where meeting_id=mid and part='host' and not removed order by changed_at limit 1),managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null then operation:='guests';payload:=jsonb_build_object('changes',jsonb_build_array(jsonb_build_object('personId',person.id,'email',person.email,'action',guest_action,'optional',part='optional')));end if;
  when 'setEmail' then
   -- team-only, 2026-10-17: the roster email decides which meetings a call
   -- center seat is in (cockpit_team_member_of), so only the CEO or an admin sets it.
   if not (public.cockpit_is_ceo() or public.cockpit_has_role('admin')) then raise exception 'Only the CEO or an admin changes a roster email. Ask one of them to change it.' using errcode='42501';end if;
   if coalesce(p_args->>'email','')!~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'That is not an email address';end if;
   if exists(select 1 from public.team_people where lower(email)=lower(btrim(p_args->>'email')) and id<>p_args->>'personId') then raise exception 'That address already belongs to someone on the roster';end if;
   -- Roster email establishes host identity. A host must not reassign another verified seat.
   if not (public.cockpit_is_ceo() or public.cockpit_has_role('admin')) and exists(select 1 from public.team_people p join auth.users u on lower(u.email)=lower(p.email) where p.id=p_args->>'personId' and u.email_confirmed_at is not null and lower(p.email)<>lower(btrim(p_args->>'email'))) then raise exception 'Ask an admin to change an existing signed-in identity';end if;
   update public.team_people set email=lower(btrim(p_args->>'email')),updated_at=now() where id=p_args->>'personId';
   if not found then raise exception 'That person is not on the roster';end if;
  when 'setSeries' then
   select array_agg(distinct value::smallint order by value::smallint) into days from jsonb_array_elements_text(p_args->'weekdays');
   if coalesce(days,'{}')<@array[0,1,2,3,4,5,6]::smallint[] is not true or (m.rrule is not null and coalesce(cardinality(days),0)=0) then raise exception 'Choose the repeating days';end if;
   if coalesce(p_args->>'startTime','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Pick a start time';end if;
   start_at:=(p_args->>'startTime')::time;duration:=(p_args->>'minutes')::integer;day:=(p_args->>'from')::date;
   if duration is null or duration not between 5 and 480 or day is null then raise exception 'Pick a valid length and date';end if;
   update public.team_meetings set weekdays=days,start_time=start_at,minutes=duration,managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null then operation:='series';payload:=jsonb_build_object('weekdays',coalesce(days,'{}'),'startTime',to_char(start_at,'HH24:MI'),'minutes',duration,'from',day);
   else update public.team_sittings set starts_at=(on_date+start_at) at time zone m.tz,ends_at=((on_date+start_at) at time zone m.tz)+make_interval(mins=>duration) where meeting_id=mid and on_date>=day and status<>'cancelled';end if;
  when 'moveSitting' then
   day:=(p_args->>'day')::date;start_at:=(p_args->>'startTime')::time;duration:=(p_args->>'minutes')::integer;
   if day is null or start_at is null or duration is null or duration not between 5 and 480 then raise exception 'Pick a day, start and length';end if;
   stamp:=(day+start_at) at time zone m.tz;
   update public.team_sittings set starts_at=stamp,ends_at=stamp+make_interval(mins=>duration),status='moved' where id=sid;
   if s.cal_instance_id is not null then operation:='move';payload:=jsonb_build_object('day',day,'startTime',to_char(start_at,'HH24:MI'),'minutes',duration);end if;
  when 'cancelSitting' then
   update public.team_sittings set status='cancelled' where id=sid;
   if s.cal_instance_id is not null then operation:='cancel';end if;
  when 'addSitting' then
   day:=(p_args->>'date')::date;start_at:=coalesce(nullif(p_args->>'startTime','')::time,m.start_time);duration:=coalesce((p_args->>'minutes')::integer,m.minutes,30);
   if day is null or day<today-60 or day>today+370 or duration not between 5 and 480 then raise exception 'Pick a date within the year and a valid length';end if;
   sid:=mid||':'||day;
   if exists(select 1 from public.team_sittings where id=sid and status<>'cancelled') then raise exception 'It already meets that day. Move that sitting instead';end if;
   stamp:=(day+start_at) at time zone m.tz;
   insert into public.team_sittings(id,meeting_id,on_date,held,status,starts_at,ends_at,cal_instance_id) values(sid,mid,day,day<=today,'scheduled',stamp,stamp+make_interval(mins=>duration),null)
   on conflict(id) do update set held=excluded.held,status='scheduled',starts_at=excluded.starts_at,ends_at=excluded.ends_at,cal_instance_id=null;
   if m.cal_event_id is not null and start_at is not null then operation:='addOne';payload:=jsonb_build_object('day',day,'startTime',to_char(start_at,'HH24:MI'),'minutes',duration);end if;
  when 'endMeeting' then
   day:=(p_args->>'lastDate')::date;if day is null then raise exception 'Pick the last meeting date';end if;
   update public.team_meetings set ends_on=day,managed='cockpit',updated_at=now() where id=mid;
   if m.cal_event_id is not null then operation:='end';payload:=jsonb_build_object('lastDate',day);
   else update public.team_sittings set status='cancelled',held=false where meeting_id=mid and on_date>day and on_date>=today;end if;
  when 'putOnCalendar' then
   if m.cal_event_id is not null then raise exception 'That meeting is already on Google Calendar';end if;
   if m.start_time is null or m.minutes is null then raise exception 'Give the meeting a start time and length';end if;
   operation:='create';payload:=jsonb_build_object('from',coalesce(nullif(p_args->>'from','')::date,today));
  when 'takeOver' then
   if m.cal_event_id is null or m.cal_writable then raise exception 'That meeting does not need taking over';end if;
   operation:='takeover';payload:=jsonb_build_object('from',today);
  when 'retryCalendar' then
   update public.team_calendar_ops set status='pending',attempts=0,error=null,tried_at=null,claim_token=null,lease_until=null where meeting_id=mid and status='failed';
  when 'setGoalHit' then
   update public.team_sittings set goal_hit=(p_args->>'hit')::boolean where id=sid;
  else raise exception 'Unknown team command: %',p_action;
  end case;
 end if;
 if operation is not null then insert into public.team_calendar_ops(meeting_id,sitting_id,op,payload,requested_by) values(mid,sid,operation,payload,actor);end if;
 insert into public.team_changes(meeting_id,by_whom,what,detail) values(mid,actor,p_action,jsonb_build_object('command',p_args,'queued',operation));
 return mid;
end;
$function$;

REVOKE ALL ON FUNCTION public.cockpit_team_calendar_command(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_team_calendar_command(text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Review videos (public bucket): only the editor desk's people upload, and
--    never a team-only seat. The review-import worker uses the service key and
--    is not affected. Only where storage exists (PGlite has none).

DO $review$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "editors upload review media" ON storage.objects';
    EXECUTE $q$CREATE POLICY "editors upload review media" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'review-videos' AND public.is_editor() AND NOT public.cockpit_is_team_only())$q$;
  END IF;
END $review$;

COMMIT;
