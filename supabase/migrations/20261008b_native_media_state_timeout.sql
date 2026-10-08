BEGIN;
ALTER FUNCTION public.cockpit_native_media_state() SET statement_timeout='50s';
NOTIFY pgrst,'reload schema';
COMMIT;
