-- Social Media Tables Access Policies
-- Grants permissions and RLS policies for authenticated cockpit seats to access social tables directly.
-- Target: Creative Triage (bldgtotkfmhoxmlzowdx)

BEGIN;

-- 1. Grant table permissions to authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_bank TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_meta_pages TO authenticated;
GRANT SELECT ON public.social_worker_status TO authenticated;

-- 2. Define RLS Policies for authenticated cockpit seats / CEO

-- social_clients
DROP POLICY IF EXISTS social_clients_seat ON public.social_clients;
CREATE POLICY social_clients_seat ON public.social_clients
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_assets
DROP POLICY IF EXISTS social_assets_seat ON public.social_assets;
CREATE POLICY social_assets_seat ON public.social_assets
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_bank
DROP POLICY IF EXISTS social_bank_seat ON public.social_bank;
CREATE POLICY social_bank_seat ON public.social_bank
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_batches
DROP POLICY IF EXISTS social_batches_seat ON public.social_batches;
CREATE POLICY social_batches_seat ON public.social_batches
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_posts
DROP POLICY IF EXISTS social_posts_seat ON public.social_posts;
CREATE POLICY social_posts_seat ON public.social_posts
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_jobs
DROP POLICY IF EXISTS social_jobs_seat ON public.social_jobs;
CREATE POLICY social_jobs_seat ON public.social_jobs
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_accounts
DROP POLICY IF EXISTS social_accounts_seat ON public.social_accounts;
CREATE POLICY social_accounts_seat ON public.social_accounts
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_meta_pages
DROP POLICY IF EXISTS social_meta_pages_seat ON public.social_meta_pages;
CREATE POLICY social_meta_pages_seat ON public.social_meta_pages
FOR ALL TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())
WITH CHECK (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

-- social_worker_status
DROP POLICY IF EXISTS social_worker_status_seat ON public.social_worker_status;
CREATE POLICY social_worker_status_seat ON public.social_worker_status
FOR SELECT TO authenticated
USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo());

COMMIT;
