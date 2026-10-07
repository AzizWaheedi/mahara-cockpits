-- Before-migration source: read-only Creative Triage pg_catalog, 2026-10-04.
-- Exact table definitions/constraints and table ACLs; no user or production row data.
-- editor_people.active is catalog-confirmed GENERATED STORED, not a column default.

CREATE TABLE public.editor_jobs (
 task_id text NOT NULL,
 name text DEFAULT ''::text NOT NULL,
 url text,
 status text DEFAULT ''::text NOT NULL,
 client text,
 clients jsonb DEFAULT '[]'::jsonb NOT NULL,
 editor text,
 editors jsonb DEFAULT '[]'::jsonb NOT NULL,
 request_type text,
 brief text,
 script_task_id text,
 script text,
 footage_url text,
 raw_url text,
 edited_url text,
 website text,
 due_at timestamp with time zone,
 opened_at timestamp with time zone,
 state text DEFAULT 'new'::text NOT NULL,
 ready boolean DEFAULT false NOT NULL,
 missing jsonb DEFAULT '[]'::jsonb NOT NULL,
 files integer,
 seconds numeric,
 transcript_chars integer,
 prepared_at timestamp with time zone,
 attempts integer DEFAULT 0 NOT NULL,
 error text,
 synced_at timestamp with time zone DEFAULT now() NOT NULL,
 updated_at timestamp with time zone DEFAULT now() NOT NULL,
 client_task_id text,
 asked_for text,
 asked_at timestamp with time zone,
 asked_by text,
 frameio_file_id text,
 frameio_url text,
 frameio_version integer,
 frameio_share_url text,
 frameio_seen_at timestamp with time zone
);

CREATE TABLE public.editor_people (
 email text NOT NULL,
 name text,
 role text DEFAULT 'editor'::text NOT NULL,
 added_at timestamp with time zone DEFAULT now() NOT NULL,
 via_portal boolean DEFAULT false NOT NULL,
 via_clickup boolean DEFAULT false NOT NULL,
 clickup_seen_at timestamp with time zone,
 active boolean GENERATED ALWAYS AS ((via_portal OR via_clickup)) STORED
);

CREATE TABLE public.editor_requests (
 id text NOT NULL,
 kind text NOT NULL,
 task_id text NOT NULL,
 input text,
 params jsonb DEFAULT '{}'::jsonb NOT NULL,
 status text DEFAULT 'queued'::text NOT NULL,
 requested_by text,
 requested_by_name text,
 created_at timestamp with time zone DEFAULT now() NOT NULL,
 started_at timestamp with time zone,
 finished_at timestamp with time zone,
 attempts integer DEFAULT 0 NOT NULL,
 result jsonb,
 error text,
 updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.editor_jobs ADD CONSTRAINT editor_jobs_pkey PRIMARY KEY (task_id);
ALTER TABLE public.editor_people ADD CONSTRAINT editor_people_pkey PRIMARY KEY (email);
ALTER TABLE public.editor_requests ADD CONSTRAINT editor_requests_pkey PRIMARY KEY (id);

CREATE OR REPLACE FUNCTION public.is_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (
      select 1 from public.editor_people p
      where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and (p.active or p.role = 'admin')
    )
    or lower(coalesce(auth.jwt() ->> 'email', ''))
         in ('aziz@maharamedia.com', 'awaheedi2008@gmail.com');
$function$;

ALTER TABLE public.editor_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.editor_jobs TO service_role;
GRANT SELECT ON TABLE public.editor_jobs TO authenticated;
ALTER TABLE public.editor_people ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.editor_people TO service_role;
GRANT SELECT ON TABLE public.editor_people TO authenticated;
ALTER TABLE public.editor_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.editor_requests TO service_role;
GRANT INSERT, SELECT ON TABLE public.editor_requests TO authenticated;

CREATE POLICY editor_jobs_read ON public.editor_jobs FOR SELECT TO authenticated USING (is_editor());
CREATE POLICY editor_people_read ON public.editor_people FOR SELECT TO authenticated USING (is_editor());
CREATE POLICY editor_requests_read ON public.editor_requests FOR SELECT TO authenticated USING (is_editor());
CREATE POLICY editor_requests_write ON public.editor_requests FOR INSERT TO authenticated WITH CHECK ((is_editor() AND (lower(requested_by) = lower((auth.jwt() ->> 'email'::text))) AND (status = 'queued'::text) AND (kind = ANY (ARRAY['deliver'::text, 'check'::text, 'comment'::text, 'rescan'::text, 'ask'::text, 'status'::text, 'eod'::text, 'dosdonts'::text, 'toideation'::text]))));
