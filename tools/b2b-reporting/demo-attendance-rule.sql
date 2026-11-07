-- Target only Mahara B2B project flwboeijllbtrufxkhts.
-- Review the live function and approval before applying as a tracked migration.
-- Keep the existing function's owner, grants, other calculations and signature.
-- Refuse to modify a function whose two exact demo rules have changed.
DO $patch$
DECLARE
  fn regprocedure := to_regprocedure('public.b2b_window_metrics(date,date,text[])');
  definition text;
  old_held constant text := $old$call_type='demo'  and (status='showed' or (status in ('confirmed','invalid') and start_at <= now()))$old$;
  new_held constant text := $new$call_type='demo'  and (start_at <= now() and status in ('showed','confirmed','invalid'))$new$;
  old_qualified constant text := $old$call_type='demo'  and (status='showed' or (status='confirmed' and start_at <= now()))$old$;
  new_qualified constant text := $new$call_type='demo'  and (start_at <= now() and status in ('showed','confirmed'))$new$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'B2B window function missing'; END IF;
  definition := pg_get_functiondef(fn);
  IF position(new_held IN definition) > 0 AND position(new_qualified IN definition) > 0
     AND position(old_held IN definition) = 0 AND position(old_qualified IN definition) = 0 THEN
    RETURN;
  END IF;
  IF (length(definition)-length(replace(definition,old_held,'')))/length(old_held) <> 1
     OR (length(definition)-length(replace(definition,old_qualified,'')))/length(old_qualified) <> 1 THEN
    RAISE EXCEPTION 'B2B demo rules changed; stop and review the live function';
  END IF;
  definition := replace(replace(definition,old_held,new_held),old_qualified,new_qualified);
  EXECUTE definition;
END
$patch$;
