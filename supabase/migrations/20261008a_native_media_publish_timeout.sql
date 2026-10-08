BEGIN;

-- The service role otherwise inherits the API's eight-second limit.
-- Keep this exemption scoped to the fenced, atomic source publisher.
ALTER FUNCTION public.cockpit_native_media_publish(uuid,uuid,jsonb,text,jsonb)
  SET statement_timeout = '50s';

NOTIFY pgrst, 'reload schema';

COMMIT;
