-- Meeting links, 2026-10-01 (the CEO: "make the churn tracker part of the
-- csm cockpit ... and link to it instead. also link the ads management board
-- for the media buyer slow client call. make everything simple and easy to
-- use ... call center is not the same as sales use the client performance
-- links in dialer.maharamedia.com. call center is for our clients").
--
-- a) Slow Client Call: the media buyer's Ads Management board in ClickUp
--    (its "All Active" board view) and its "911 - Critical CPL & CPB" view,
--    next to the constraints doc, client performance, the cockpit's own ads
--    screen and the Client Success board. The hot list (upsells) goes.
-- b) Call Center: the call centre books for our clients, so the dialer and
--    client performance, not the sales cockpit.
--    Both only where the links are still the ones seeded on 30 September,
--    so an edit made on the page since is never overwritten.
-- c) Every meeting: the churn tracker in the client success cockpit
--    (/client-success/churn, migration 20261001a) instead of the 2026
--    sheet, and names without "(ClickUp)": the address says where it goes.
-- d) Every step is in team_changes, by 'meeting links update'.

begin;

drop table if exists pg_temp.ml_log;
create temporary table ml_log (meeting_id text, what text, detail jsonb);

-- a) ----------------------------------------------------------------------------
with done as (
  update public.team_meetings m
     set links = '[
       {"label": "Diagnosing and fixing acquisition constraints", "url": "https://docs.google.com/document/d/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/edit"},
       {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"},
       {"label": "Ads management board", "url": "https://app.clickup.com/90182518398/v/b/2kzmr1ky-3738"},
       {"label": "911: critical CPL and CPB", "url": "https://app.clickup.com/90182518398/v/l/2kzmr1ky-3818"},
       {"label": "Ads management (cockpit)", "url": "https://cockpit.maharamedia.com/ads"},
       {"label": "Client Success board", "url": "https://app.clickup.com/90182518398/v/li/901816723211"}
     ]'::jsonb,
         updated_at = now()
   where m.id = 'slow-client-call'
     and m.links = '[
       {"label": "Diagnosing and fixing acquisition constraints", "url": "https://docs.google.com/document/d/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/edit"},
       {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"},
       {"label": "Hot list", "url": "https://cockpit.maharamedia.com/client-success/hotlist"},
       {"label": "Ads management board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901817774521"},
       {"label": "Ads management (cockpit)", "url": "https://cockpit.maharamedia.com/ads"},
       {"label": "Client Success board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816723211"}
     ]'::jsonb
  returning m.id
)
insert into ml_log
select id, 'links the media buyer''s Ads Management board and its 911 view (critical CPL and CPB)', null from done;

-- b) ----------------------------------------------------------------------------
with done as (
  update public.team_meetings m
     set links = '[
       {"label": "Call center dialer", "url": "https://dialer.maharamedia.com/"},
       {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"}
     ]'::jsonb,
         updated_at = now()
   where m.id = 'call-center'
     and m.links = '[
       {"label": "Sales cockpit", "url": "https://cockpit.maharamedia.com/sales/"},
       {"label": "Sales numbers", "url": "https://cockpit.maharamedia.com/sales/numbers"},
       {"label": "Sales goals", "url": "https://cockpit.maharamedia.com/sales/goals"},
       {"label": "Call recordings", "url": "https://cockpit.maharamedia.com/sales/recordings"}
     ]'::jsonb
  returning m.id
)
insert into ml_log
select id, 'links the call center dialer and client performance: the call centre books for our clients, it is not sales', null from done;

-- c) ----------------------------------------------------------------------------
with before as (
  select id, links from public.team_meetings
   where links::text like '%1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU%'
      or links::text like '% (ClickUp)%'
),
next as (
  select b.id, b.links,
         (select jsonb_agg(
                   case
                     when e->>'url' like '%1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU%'
                       then jsonb_build_object('label', 'Churn tracker',
                                               'url', 'https://cockpit.maharamedia.com/client-success/churn')
                     else jsonb_build_object('label', replace(e->>'label', ' (ClickUp)', ''),
                                             'url', e->>'url')
                   end order by t.ord)
            from jsonb_array_elements(b.links) with ordinality as t(e, ord)) as links_after
    from before b
),
done as (
  update public.team_meetings m
     set links = n.links_after, updated_at = now()
    from next n
   where m.id = n.id and m.links <> n.links_after
  returning m.id, n.links as links_before
)
insert into ml_log
select id,
       case when links_before::text like '%1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU%'
            then 'links the churn tracker in the client success cockpit instead of the 2026 sheet'
            else 'shortened its link names' end,
       jsonb_build_object('before', links_before)
  from done;

-- d) ----------------------------------------------------------------------------
insert into public.team_changes (by_whom, meeting_id, what, detail)
select 'meeting links update', meeting_id, what, detail from ml_log;

commit;
