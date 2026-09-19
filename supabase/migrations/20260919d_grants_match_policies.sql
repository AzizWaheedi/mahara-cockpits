-- Grants that match the policies, and a denial that says so.
--
-- Two faults found while giving the editor the full ideation section.
--
-- First: a policy without a grant does nothing. `ideation_posts` had an
-- UPDATE policy but only a SELECT grant, so saving an idea from the editor
-- cockpit could never have worked; `ideation_requests`, `ideation_watchlist`
-- and `ideation_scans` had policies and no grants at all. Row security only
-- narrows what a grant already allows -- it cannot widen it.
--
-- Second: several tables still carry PostgREST's default blanket grant to
-- `anon`. Row security makes that harmless (every table here has it on, and
-- a table with no matching policy returns nothing), but it changes how a
-- refusal reads: with the grant, an unauthorised read is 200 and an empty
-- list, so a person who has lost their seat sees "nothing saved yet"
-- instead of being told. Without it, PostgREST answers 401 and the cockpit
-- can say what is actually wrong. The same mistake in the other direction
-- cost a day on the editor sign-in, so: no silent empties.
--
-- The worker and the two Convex deployments hold the service key, which
-- neither grants nor row security apply to, so nothing here touches them.

-- The ideation board, as the policies already describe it.
grant select, insert, update on public.ideation_posts to authenticated;
grant select, insert on public.ideation_requests to authenticated;
grant select, insert, update on public.ideation_watchlist to authenticated;
grant select on public.ideation_scans to authenticated;

-- Everything the editor's browser reads: exactly the verb its policy allows,
-- to signed-in people only.
revoke all on public.foreplay_ads from anon, authenticated;
grant select on public.foreplay_ads to authenticated;

revoke all on public.foreplay_boards from anon, authenticated;
grant select on public.foreplay_boards to authenticated;

revoke all on public.winner_ads from anon, authenticated;
grant select on public.winner_ads to authenticated;

revoke all on public.editor_clients from anon, authenticated;
grant select on public.editor_clients to authenticated;

revoke all on public.editor_people from anon, authenticated;
grant select on public.editor_people to authenticated;

revoke all on public.team_meetings from anon, authenticated;
grant select on public.team_meetings to authenticated;

-- The request queue the cockpit writes and the worker drains.
revoke all on public.editor_requests from anon, authenticated;
grant select, insert on public.editor_requests to authenticated;

-- Nothing signed-out reads any of this.
revoke all on public.ideation_posts from anon;
revoke all on public.ideation_requests from anon;
revoke all on public.ideation_watchlist from anon;
revoke all on public.ideation_scans from anon;
