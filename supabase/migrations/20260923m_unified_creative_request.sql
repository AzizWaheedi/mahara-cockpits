-- One creative request can start from a campaign or from a specific Meta ad.
-- Existing ad-linked requests retain their source and audit history.
begin;

alter table public.cockpit_creative_requests
  alter column source_meta_ad_id drop not null,
  alter column source_ad_name drop not null,
  add column if not exists request_reason text;

alter table public.cockpit_creative_requests
  add constraint cockpit_creative_request_reason_valid
  check (request_reason in (
    'more_ads', 'new_angle', 'fatigue', 'edit_visuals'
  ));

create unique index if not exists cockpit_creative_requests_one_open_campaign_reason
  on public.cockpit_creative_requests (campaign_name, request_reason)
  where source_meta_ad_id is null
    and status not in ('reviewed', 'cancelled');

commit;
