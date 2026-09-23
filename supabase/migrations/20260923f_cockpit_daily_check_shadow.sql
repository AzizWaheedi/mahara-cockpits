-- Migration: 20260923f_cockpit_daily_check_shadow.sql
-- Generic version-safe service-only write contract for cockpit daily checks.
-- Additive columns, SECURITY INVOKER RPC, service-only execution grants.

BEGIN;

-- 1. Additive columns for revision tracking and soft tombstones
ALTER TABLE public.cockpit_daily_checks
  ADD COLUMN IF NOT EXISTS source_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_deleted boolean NOT NULL DEFAULT false;

-- 2. Version-safe shadow write RPC
CREATE OR REPLACE FUNCTION public.cockpit_apply_daily_check_shadow(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_owner_app text;
  v_source_deployment text;
  v_source_system text;
  v_source_id text;
  v_day date;
  v_check_key text;
  v_label text;
  v_detail text;
  v_phase text;
  v_block text;
  v_display_order numeric;
  v_href text;
  v_done boolean;
  v_done_at timestamptz;
  v_source_created_at timestamptz;
  v_source_snapshot_ts text;
  v_source_row jsonb;
  v_changed_by text;
  v_source_revision bigint;
  v_source_deleted boolean;

  v_by_source public.cockpit_daily_checks%ROWTYPE;
  v_by_logical public.cockpit_daily_checks%ROWTYPE;
  v_new_id bigint;
BEGIN
  IF p_row IS NULL OR pg_catalog.jsonb_typeof(p_row) <> 'object' THEN
    RAISE EXCEPTION 'p_row must be a valid jsonb object';
  END IF;

  -- Validate role / owner_app / source_deployment mapping for all 3 cockpit owners
  v_role := pg_catalog.btrim(coalesce(p_row ->> 'role', ''));
  v_owner_app := pg_catalog.btrim(coalesce(p_row ->> 'owner_app', ''));
  v_source_deployment := pg_catalog.btrim(coalesce(p_row ->> 'source_deployment', ''));

  IF NOT (
    (v_role = 'media_buyer' AND v_owner_app = 'media-buyer' AND v_source_deployment = 'adorable-seahorse-418') OR
    (v_role = 'csm' AND v_owner_app = 'client-success' AND v_source_deployment = 'impressive-dinosaur-375') OR
    (v_role = 'creative' AND v_owner_app = 'creative-director' AND v_source_deployment = 'colorful-wombat-644')
  ) THEN
    RAISE EXCEPTION 'Invalid role/owner_app/source_deployment mapping: role=%, owner_app=%, source_deployment=%',
      v_role, v_owner_app, v_source_deployment;
  END IF;

  -- Validate source_system is convex
  v_source_system := pg_catalog.btrim(coalesce(p_row ->> 'source_system', ''));
  IF v_source_system <> 'convex' THEN
    RAISE EXCEPTION 'source_system must be convex, got: %', v_source_system;
  END IF;

  -- Validate nonblank source_id, day, check_key, label
  v_source_id := pg_catalog.btrim(coalesce(p_row ->> 'source_id', ''));
  IF v_source_id = '' THEN
    RAISE EXCEPTION 'source_id must not be blank';
  END IF;

  v_check_key := pg_catalog.btrim(coalesce(p_row ->> 'check_key', ''));
  IF v_check_key = '' THEN
    RAISE EXCEPTION 'check_key must not be blank';
  END IF;

  v_label := pg_catalog.btrim(coalesce(p_row ->> 'label', ''));
  IF v_label = '' THEN
    RAISE EXCEPTION 'label must not be blank';
  END IF;

  IF (p_row ->> 'day') IS NULL OR (p_row ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'day must be in YYYY-MM-DD format, got: %', p_row ->> 'day';
  END IF;
  BEGIN
    v_day := (p_row ->> 'day')::pg_catalog.date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid day date: %', p_row ->> 'day';
  END;

  -- Validate boolean done
  IF NOT (p_row ? 'done') OR pg_catalog.jsonb_typeof(p_row -> 'done') <> 'boolean' THEN
    RAISE EXCEPTION 'done must be a boolean';
  END IF;
  v_done := (p_row ->> 'done')::boolean;

  -- Validate positive integral source_revision
  IF NOT (p_row ? 'source_revision') OR pg_catalog.jsonb_typeof(p_row -> 'source_revision') <> 'number' THEN
    RAISE EXCEPTION 'source_revision must be a number';
  END IF;
  IF (p_row ->> 'source_revision')::numeric % 1 <> 0 OR (p_row ->> 'source_revision')::bigint <= 0 THEN
    RAISE EXCEPTION 'source_revision must be a positive integer, got: %', p_row ->> 'source_revision';
  END IF;
  v_source_revision := (p_row ->> 'source_revision')::bigint;

  -- Validate source_deleted (boolean, defaults to false)
  IF p_row ? 'source_deleted' THEN
    IF pg_catalog.jsonb_typeof(p_row -> 'source_deleted') <> 'boolean' THEN
      RAISE EXCEPTION 'source_deleted must be a boolean';
    END IF;
    v_source_deleted := (p_row ->> 'source_deleted')::boolean;
  ELSE
    v_source_deleted := false;
  END IF;

  -- Validate required provenance
  v_changed_by := pg_catalog.btrim(coalesce(p_row ->> 'changed_by', ''));
  IF v_changed_by = '' THEN
    RAISE EXCEPTION 'changed_by must not be blank';
  END IF;

  v_source_snapshot_ts := pg_catalog.btrim(coalesce(p_row ->> 'source_snapshot_ts', ''));
  IF v_source_snapshot_ts = '' THEN
    RAISE EXCEPTION 'source_snapshot_ts must not be blank';
  END IF;

  IF NOT (p_row ? 'source_row') OR pg_catalog.jsonb_typeof(p_row -> 'source_row') <> 'object' THEN
    RAISE EXCEPTION 'source_row must be a jsonb object';
  END IF;
  v_source_row := p_row -> 'source_row';

  -- Optional fields
  v_detail := p_row ->> 'detail';
  v_phase := p_row ->> 'phase';
  v_block := p_row ->> 'block';
  v_href := p_row ->> 'href';

  IF p_row ? 'display_order' AND p_row ->> 'display_order' IS NOT NULL AND p_row ->> 'display_order' <> '' THEN
    IF pg_catalog.jsonb_typeof(p_row -> 'display_order') <> 'number' THEN
      RAISE EXCEPTION 'display_order must be a number';
    END IF;
    v_display_order := (p_row ->> 'display_order')::numeric;
  ELSE
    v_display_order := NULL;
  END IF;

  IF p_row ->> 'done_at' IS NOT NULL AND p_row ->> 'done_at' <> '' THEN
    BEGIN
      v_done_at := (p_row ->> 'done_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid done_at timestamptz: %', p_row ->> 'done_at';
    END;
  ELSE
    v_done_at := NULL;
  END IF;

  IF p_row ->> 'source_created_at' IS NOT NULL AND p_row ->> 'source_created_at' <> '' THEN
    BEGIN
      v_source_created_at := (p_row ->> 'source_created_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid source_created_at timestamptz: %', p_row ->> 'source_created_at';
    END;
  ELSE
    v_source_created_at := NULL;
  END IF;

  -- Transaction advisory locks: serialize per source identity and logical key
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('cockpit_daily_checks:source:' || v_source_deployment || ':' || v_source_id)::bigint
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('cockpit_daily_checks:logical:' || v_role || ':' || v_day::text || ':' || v_check_key)::bigint
  );

  -- Lookup existing records by source key and logical key
  SELECT * INTO v_by_source
  FROM public.cockpit_daily_checks
  WHERE source_deployment = v_source_deployment AND source_id = v_source_id;

  SELECT * INTO v_by_logical
  FROM public.cockpit_daily_checks
  WHERE role = v_role AND day = v_day AND check_key = v_check_key;

  -- Identity conflict checks
  IF v_by_source.id IS NOT NULL AND v_by_logical.id IS NOT NULL AND v_by_source.id <> v_by_logical.id THEN
    RAISE EXCEPTION 'Logical-key/source-ID mismatch: source ID % belongs to row % but logical key belongs to row %',
      v_source_id, v_by_source.id, v_by_logical.id;
  END IF;

  IF v_by_source.id IS NOT NULL AND (v_by_source.role <> v_role OR v_by_source.day <> v_day OR v_by_source.check_key <> v_check_key) THEN
    RAISE EXCEPTION 'Logical-key/source-ID mismatch: source ID % already belongs to logical check (% / % / %)',
      v_source_id, v_by_source.role, v_by_source.day, v_by_source.check_key;
  END IF;

  IF v_by_logical.id IS NOT NULL AND (v_by_logical.source_deployment <> v_source_deployment OR v_by_logical.source_id <> v_source_id) THEN
    RAISE EXCEPTION 'Logical-key/source-ID mismatch: logical check already belongs to source ID (% / %)',
      v_by_logical.source_deployment, v_by_logical.source_id;
  END IF;

  -- Insert new identity
  IF v_by_source.id IS NULL AND v_by_logical.id IS NULL THEN
    INSERT INTO public.cockpit_daily_checks (
      role, owner_app, day, check_key, label, detail, phase, block,
      display_order, href, done, done_at,
      source_system, source_deployment, source_id, source_created_at,
      source_snapshot_ts, source_row, changed_by,
      source_revision, source_deleted
    ) VALUES (
      v_role, v_owner_app, v_day, v_check_key, v_label, v_detail, v_phase, v_block,
      v_display_order, v_href, v_done, v_done_at,
      v_source_system, v_source_deployment, v_source_id, v_source_created_at,
      v_source_snapshot_ts, v_source_row, v_changed_by,
      v_source_revision, v_source_deleted
    ) RETURNING id INTO v_new_id;

    RETURN pg_catalog.jsonb_build_object(
      'status', 'inserted',
      'id', v_new_id,
      'source_revision', v_source_revision
    );
  END IF;

  -- Existing row: compare revision
  -- Case 1: Stale revision -> return without writing/auditing
  IF v_source_revision < v_by_source.source_revision THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'stale',
      'id', v_by_source.id,
      'source_revision', v_by_source.source_revision
    );
  END IF;

  -- Case 2: Same revision
  IF v_source_revision = v_by_source.source_revision THEN
    IF v_by_source.label IS DISTINCT FROM v_label OR
       v_by_source.detail IS DISTINCT FROM v_detail OR
       v_by_source.phase IS DISTINCT FROM v_phase OR
       v_by_source.block IS DISTINCT FROM v_block OR
       v_by_source.display_order IS DISTINCT FROM v_display_order OR
       v_by_source.href IS DISTINCT FROM v_href OR
       v_by_source.done IS DISTINCT FROM v_done OR
       v_by_source.done_at IS DISTINCT FROM v_done_at OR
       v_by_source.source_snapshot_ts IS DISTINCT FROM v_source_snapshot_ts OR
       v_by_source.source_row IS DISTINCT FROM v_source_row OR
       v_by_source.changed_by IS DISTINCT FROM v_changed_by OR
       v_by_source.source_deleted IS DISTINCT FROM v_source_deleted THEN
      RAISE EXCEPTION 'Same-revision divergent content for source_id % at revision %',
        v_source_id, v_source_revision;
    END IF;

    -- Identical content: duplicate replay -> return without writing/auditing
    RETURN pg_catalog.jsonb_build_object(
      'status', 'duplicate',
      'id', v_by_source.id,
      'source_revision', v_by_source.source_revision
    );
  END IF;

  -- Case 3: Revision rises -> update existing row, preserving row ID
  UPDATE public.cockpit_daily_checks
  SET
    label = v_label,
    detail = v_detail,
    phase = v_phase,
    block = v_block,
    display_order = v_display_order,
    href = v_href,
    done = v_done,
    done_at = v_done_at,
    source_created_at = coalesce(v_source_created_at, public.cockpit_daily_checks.source_created_at),
    source_snapshot_ts = v_source_snapshot_ts,
    source_row = v_source_row,
    changed_by = v_changed_by,
    source_revision = v_source_revision,
    source_deleted = v_source_deleted
  WHERE id = v_by_source.id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'updated',
    'id', v_by_source.id,
    'source_revision', v_source_revision
  );
END;
$$;

-- Revoke execute from public/anon/authenticated and grant only service_role
REVOKE ALL ON FUNCTION public.cockpit_apply_daily_check_shadow(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_apply_daily_check_shadow(jsonb) TO service_role;

COMMIT;
