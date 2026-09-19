-- Launch drafts for Mahara's own ad account
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- A draft is a campaign that has been thought through but not created: the
-- kind, the brief, the budget, which winning ad set's settings it copies, the
-- copy variants a person can edit, and, once launched, the Meta ids it became.
-- It follows the launch skill's rule that nothing is created until a human has
-- read the draft, and Meta's objects are created PAUSED and switched on from
-- the Ads tab afterwards.
--
-- The kind is carried explicitly and drives everything downstream, because a
-- lead-gen campaign and a retargeting campaign are different animals: a
-- different audience, a different objective, and a different name, since
-- b2b_campaign_type classifies a campaign by its name ("retarget" in the name
-- means retargeting; anything else is lead gen). Mixing them up would put a
-- warm-audience campaign under the lead-gen totals and poison every cost per
-- lead on the account.

begin;

create table if not exists public.cockpit_ad_drafts (
  id                 bigint generated always as identity primary key,
  /** lead_gen or retargeting. Never both, never blank. */
  kind               text        not null check (kind in ('lead_gen','retargeting')),
  name               text        not null,
  brief              text        not null,
  daily_budget_usd   numeric(10,2) not null check (daily_budget_usd >= 5),
  /** The ad set whose settings were copied: targeting, placements, pixel, page. */
  source_adset_id    text,
  source_adset_name  text,
  source_reason      text,
  source_campaign_id text,
  objective          text,
  optimization_goal  text,
  billing_event      text,
  targeting          jsonb,
  promoted_object    jsonb,
  /** Winning ads whose creatives are cloned into the new ad set, by Meta ad id. */
  clone_ad_ids       text[]      not null default '{}',
  /** Headline and primary text pairs, editable before launch. */
  variants           jsonb       not null default '[]'::jsonb,
  status             text        not null default 'building'
                                 check (status in ('building','ready','launching','launched','failed','discarded')),
  error              text,
  meta_campaign_id   text,
  meta_adset_id      text,
  meta_ad_ids        text[]      not null default '{}',
  created_by         text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  launched_at        timestamptz
);

comment on table public.cockpit_ad_drafts is
  'Campaign drafts for Mahara''s own ad account. Built from a brief, edited by a person, launched paused. The kind is explicit because lead gen and retargeting must never be mixed.';

create index if not exists cockpit_ad_drafts_status_idx on public.cockpit_ad_drafts (status, created_at desc);

alter table public.cockpit_ad_drafts enable row level security;
revoke all on public.cockpit_ad_drafts from anon, authenticated;

drop trigger if exists cockpit_ad_drafts_touch on public.cockpit_ad_drafts;
create trigger cockpit_ad_drafts_touch
  before update on public.cockpit_ad_drafts
  for each row execute function public.cockpit_touch_updated_at();

commit;
