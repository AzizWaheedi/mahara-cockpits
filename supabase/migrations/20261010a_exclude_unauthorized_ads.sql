-- Exclude spend from ads placed by unauthorized actors (Meta incident, 23 Sep to 9 Oct 2026).
-- Excluded ads stay in the Meta incident evidence, but never count toward cost per lead,
-- spend, or other cockpit metrics. Rows are archived, not destroyed.

create table if not exists public.cockpit_excluded_ads (
  ad_id text primary key,
  account_id text not null,
  campaign_id text,
  reason text not null,
  excluded_at timestamptz not null default now(),
  excluded_by text not null default 'faris'
);
alter table public.cockpit_excluded_ads enable row level security;
revoke all on public.cockpit_excluded_ads from anon, authenticated;

create table if not exists public.ads_daily_snapshots_excluded_archive (
  archived_at timestamptz not null default now(),
  row_data jsonb not null
);
alter table public.ads_daily_snapshots_excluded_archive enable row level security;
revoke all on public.ads_daily_snapshots_excluded_archive from anon, authenticated;

insert into public.cockpit_excluded_ads (ad_id, account_id, campaign_id, reason) values
 ('120246624477980705','act_1938709086836136','120246624477970705','unauthorized_meta_incident_2026_10'),
 ('120246699622910088','act_1275190574533155','120246699622900088','unauthorized_meta_incident_2026_10'),
 ('120246747852310705','act_1938709086836136','120246747852320705','unauthorized_meta_incident_2026_10'),
 ('120246747887330705','act_1938709086836136','120246747852320705','unauthorized_meta_incident_2026_10'),
 ('120246795745520088','act_1275190574533155','120246795745530088','unauthorized_meta_incident_2026_10'),
 ('120246876560950088','act_1275190574533155','120246876560960088','unauthorized_meta_incident_2026_10'),
 ('120246877123380088','act_1275190574533155','120246876560960088','unauthorized_meta_incident_2026_10'),
 ('120246911751100088','act_1275190574533155','120246911751090088','unauthorized_meta_incident_2026_10'),
 ('120246911853480088','act_1275190574533155','120246911751090088','unauthorized_meta_incident_2026_10'),
 ('120246912291150088','act_1275190574533155','120246912291130088','unauthorized_meta_incident_2026_10'),
 ('120246912291170088','act_1275190574533155','120246912291130088','unauthorized_meta_incident_2026_10'),
 ('120250570737440269','act_1034584029438250','120250570737450269','unauthorized_meta_incident_2026_10'),
 ('120250615876980269','act_1034584029438250','120250615876960269','unauthorized_meta_incident_2026_10'),
 ('120250733492810269','act_1034584029438250','120250733492780269','unauthorized_meta_incident_2026_10'),
 ('120250733606890269','act_1034584029438250','120250733492780269','unauthorized_meta_incident_2026_10'),
 ('120250765395660269','act_1034584029438250','120250765395670269','unauthorized_meta_incident_2026_10'),
 ('120250765528850269','act_1034584029438250','120250765395670269','unauthorized_meta_incident_2026_10'),
 ('120252448730350064','act_1009665871644699','120252448730360064','unauthorized_meta_incident_2026_10'),
 ('52557072938435','act_985366551096162','52557072938635','unauthorized_meta_incident_2026_10')
on conflict (ad_id) do nothing;

-- Any sync that later upserts an excluded ad is silently skipped.
create or replace function public.cockpit_skip_excluded_ad_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ad_id is not null and exists (select 1 from public.cockpit_excluded_ads e where e.ad_id = new.ad_id::text) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists cockpit_skip_excluded_ad_snapshot on public.ads_daily_snapshots;
create trigger cockpit_skip_excluded_ad_snapshot
  before insert or update on public.ads_daily_snapshots
  for each row execute function public.cockpit_skip_excluded_ad_snapshot();

with gone as (
  delete from public.ads_daily_snapshots s
  using public.cockpit_excluded_ads e
  where s.ad_id::text = e.ad_id
  returning s.*
)
insert into public.ads_daily_snapshots_excluded_archive (row_data)
select to_jsonb(gone) from gone;
