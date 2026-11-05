-- OFFLINE REVIEW ONLY. No login or membership, issuer, endpoint or cutover.
-- Depends on the disabled source-reader candidate. Reservations must commit
-- before a separate source transaction starts; callers must never receive the
-- restricted database connection. This is not a source/publication fence.
BEGIN;
CREATE TABLE native_research_private.gateway_quotas (
 capability_sha256 text PRIMARY KEY REFERENCES native_research_private.capabilities(capability_sha256),
 run_id text NOT NULL CHECK (run_id ~ '^[1-9][0-9]{0,19}$'),
 run_attempt integer NOT NULL CHECK (run_attempt BETWEEN 1 AND 9999),
 reservations integer NOT NULL DEFAULT 0 CHECK (reservations BETWEEN 0 AND 6),
 last_reserved_at timestamptz
);
ALTER TABLE native_research_private.gateway_quotas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON native_research_private.gateway_quotas FROM PUBLIC, anon, authenticated, service_role, cockpit_native_research_reader;

-- Output is non-sensitive admission metadata only. An admitted reservation is
-- consumed even if the subsequent source read fails or is rolled back.
CREATE FUNCTION native_research_private.reserve_source(p_secret text,p_task text,p_response uuid,p_version integer,
 p_comment text,p_digest text,p_run text,p_attempt integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '1s' AS $$
DECLARE c native_research_private.capabilities%ROWTYPE; q native_research_private.gateway_quotas%ROWTYPE;
 gate boolean; cap bytea; caphash text;
BEGIN
 SELECT s.enabled INTO gate FROM native_research_private.settings s WHERE s.singleton FOR SHARE;
 IF gate IS DISTINCT FROM true OR p_secret IS NULL OR p_secret !~ '^[A-Za-z0-9_-]{43}$'
 OR p_task IS NULL OR p_task !~ '^[A-Za-z0-9_-]{1,40}$' OR p_response IS NULL OR p_version IS NULL OR p_version NOT IN (2,3)
 OR p_comment IS NULL OR p_comment !~ '^[A-Za-z0-9_-]{1,80}$' OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
 OR p_run IS NULL OR p_run !~ '^[1-9][0-9]{0,19}$' OR p_attempt IS NULL OR p_attempt NOT BETWEEN 1 AND 9999 THEN RETURN NULL; END IF;
 BEGIN cap := decode(translate(p_secret,'-_','+/')||'=', 'base64'); EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
 IF octet_length(cap) <> 32 OR rtrim(translate(encode(cap,'base64'),'+/','-_'),'=') <> p_secret THEN RETURN NULL; END IF;
 caphash := encode(pg_catalog.sha256(cap),'hex');
 SELECT * INTO c FROM native_research_private.capabilities WHERE capability_sha256=caphash FOR UPDATE;
 IF NOT FOUND OR c.task_id IS DISTINCT FROM p_task OR c.response_id IS DISTINCT FROM p_response OR c.form_version IS DISTINCT FROM p_version
 OR c.comment_id IS DISTINCT FROM p_comment OR c.comment_sha256 IS DISTINCT FROM p_digest
 OR c.issued_at > clock_timestamp() OR c.expires_at <= clock_timestamp()
 OR (c.run_id IS NOT NULL AND (c.run_id <> p_run OR c.run_attempt <> p_attempt)) THEN RETURN NULL; END IF;
 INSERT INTO native_research_private.gateway_quotas(capability_sha256,run_id,run_attempt)
 VALUES(caphash,p_run,p_attempt) ON CONFLICT (capability_sha256) DO NOTHING;
 SELECT * INTO q FROM native_research_private.gateway_quotas WHERE capability_sha256=caphash FOR UPDATE;
 IF NOT FOUND OR q.run_id IS DISTINCT FROM p_run OR q.run_attempt IS DISTINCT FROM p_attempt
 OR q.reservations >= 6 OR c.expires_at <= clock_timestamp() THEN RETURN NULL; END IF;
 UPDATE native_research_private.gateway_quotas SET reservations=reservations+1,last_reserved_at=clock_timestamp()
 WHERE capability_sha256=caphash RETURNING * INTO q;
 RETURN jsonb_build_object('admitted',true,'reservation',q.reservations);
END $$;
REVOKE ALL ON FUNCTION native_research_private.reserve_source(text,text,uuid,integer,text,text,text,integer)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION native_research_private.reserve_source(text,text,uuid,integer,text,text,text,integer)
 TO cockpit_native_research_reader;
COMMIT;
