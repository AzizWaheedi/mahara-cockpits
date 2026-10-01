-- One more way a staff contract is named: "Web Developer — Engagement
-- Agreement", like the staff template "Creative Strategist — Engagement
-- Agreement". On 2026-10-01 those were the only two of HighLevel's 391
-- documents with "engagement agreement" in the name. "developer" alone is
-- not used: many clients are developers.

begin;

update public.cockpit_sales_settings
   set value = jsonb_set(value, '{staff,words}',
         coalesce(value #> '{staff,words}', '[]'::jsonb) || '["engagement agreement"]'::jsonb),
       updated_by = 'migration 20261001d',
       updated_at = now()
 where key = 'contracts'
   and not coalesce(value #> '{staff,words}', '[]'::jsonb) ? 'engagement agreement';

commit;
