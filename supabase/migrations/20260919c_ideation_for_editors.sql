-- The video editor works the same ideation board as the creative director
-- and the media buyer (Aziz, 2026-09-19: "the exact same ideation section
-- for all 3"), and that means the same verbs, not just the same list.
--
-- The other two cockpits reach these tables through a Convex action holding
-- the service key, which bypasses row security entirely. The editor cockpit
-- has no backend: it is the browser talking to PostgREST with the editor's
-- own session, so every verb it needs has to exist as a policy. Same
-- `is_editor()` everyone else on this cockpit is checked against.

-- Paste a link. Reading and keeping already had policies; adding did not,
-- so the editor could save a proposal but never bring in a post of their own.
drop policy if exists ideation_posts_add on public.ideation_posts;
create policy ideation_posts_add on public.ideation_posts
  for insert to authenticated with check (is_editor());

-- Ask the radar to scrape a page or pull an ad library, and watch it work.
-- The worker picks the row up; nothing here runs a scrape by itself.
drop policy if exists ideation_requests_read on public.ideation_requests;
create policy ideation_requests_read on public.ideation_requests
  for select to authenticated using (is_editor());

drop policy if exists ideation_requests_add on public.ideation_requests;
create policy ideation_requests_add on public.ideation_requests
  for insert to authenticated with check (is_editor());

-- The watchlist: accounts and hashtags the weekly scan follows. Removing is
-- a soft delete (active = false), so this needs update rather than delete --
-- and no delete policy, so nothing in the browser can drop a row outright.
drop policy if exists ideation_watchlist_read on public.ideation_watchlist;
create policy ideation_watchlist_read on public.ideation_watchlist
  for select to authenticated using (is_editor());

drop policy if exists ideation_watchlist_add on public.ideation_watchlist;
create policy ideation_watchlist_add on public.ideation_watchlist
  for insert to authenticated with check (is_editor());

drop policy if exists ideation_watchlist_edit on public.ideation_watchlist;
create policy ideation_watchlist_edit on public.ideation_watchlist
  for update to authenticated using (is_editor()) with check (is_editor());

-- When the scan last ran, which the page shows next to the radar line.
drop policy if exists ideation_scans_read on public.ideation_scans;
create policy ideation_scans_read on public.ideation_scans
  for select to authenticated using (is_editor());
