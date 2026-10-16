-- Client Performance board: ad accounts tied to their client by hand, with the
-- evidence (2026-10-16, Creative Triage bldgtotkfmhoxmlzowdx).
--
-- The second-source check of 2026-10-16 found spending Meta ad accounts that no
-- tie in the spine could reach (no clients row carries them, Meta gives one of
-- them no name). Each row below was read twice: Meta (GET act_<id>?fields=
-- name,business, 16 Oct) and the client registry / the account's own campaigns
-- in cockpit_meta_ad_days. Only ties with strong evidence are here; the unsure
-- ones are listed in docs/client-performance/SOURCES.md for the CEO and client
-- success (Triple Edge has no GoHighLevel location; Art Vision and ريبالو/ORB
-- belong to no client on record; Professional Touch's account is not shared).
-- Alkhalil's SAR account is the client's but holds only the client's own
-- Instagram post boosts, so its row is kept out (kept_out): named, never in
-- Alkhalil's figures, until the media buyer confirms Mahara manages it.
--
-- The table is cockpit-owned (20261016210000_board_facts_checked.sql), so no
-- other team's table (clients, ghl_client_ad_accounts) is written. The spine
-- reads it first on its next refresh (every 30 minutes) and meta-ad-days ties
-- the accounts on its next run (hourly at minute 7). Pidco and AEA Designs are
-- tied to their cancelled locations for the history: the board keeps a
-- cancelled client out of its totals, and meta-ad-days names an account that
-- delivers for a cancelled client (20261016210100_meta_ad_days_checked.sql).
--
-- Safe to apply twice: rows are upserted by account.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.cockpit_board_account_ties') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016210000_board_facts_checked.sql first';
  END IF;
END $$;

INSERT INTO public.cockpit_board_account_ties AS t (account_id, location_id, evidence, added_by, kept_out)
VALUES
  -- Shades Interior Design & General Contracting (Active on its ClickUp card
  -- since 4 Oct). Meta: account "Shades" (SAR, Asia/Riyadh), business
  -- "Sallyalsasi"; campaign "Shades|mahara|14\10" (OUTCOME_LEADS) since 14 Oct.
  -- The registry's meta_ad_account for the location says "Shades". No other
  -- client is called Shades. 30 days to 15 Oct: $446.84.
  ('762687672022667', 'p31docv5H7NNskeyZSlV',
   'Meta account name "Shades", business Sallyalsasi; campaign "Shades|mahara|14\10" (Mahara naming, lead campaign since 14 Oct); ghl_clients.meta_ad_account = "Shades" for this location. Checked 2026-10-16.',
   'board-check-2026-10-16', false),
  -- Alkhalil's second account, KEPT OUT of Alkhalil's figures. Meta lists its
  -- id as its name; it is owned by business "Alkhalil Group" 222790514254404,
  -- the client's own business (the same as the tied "ALKHALIL Ad Acount"
  -- 1649852845764859). All 13 of its campaigns are Instagram post boosts with
  -- Meta's automatic names, from 2021 to the one since 12 Oct (SAR 299.17,
  -- $79.76 to 15 Oct, no leads); none is a Mahara campaign, and Mahara's
  -- Alkhalil work runs on 1649852845764859. Tied, it would have taken
  -- Alkhalil's 9-15 Oct spend from $94.30 to $174.06 and link CTR from 1.73%
  -- to 0.48%. Kept out, it is named "Hidden on purpose" instead of "Not
  -- linked". Tie it (kept_out false) only if the media buyer confirms Mahara
  -- manages it.
  ('640644143620696', 'rcaFzDBHOvxTu6KqXEHG',
   'KEPT OUT: owned by Alkhalil''s own Meta business "Alkhalil Group" 222790514254404; all 13 campaigns are the client''s Instagram post boosts (2021 to 12 Oct), none Mahara''s; Mahara''s Alkhalil work runs on 1649852845764859. Kept out of Alkhalil''s figures until the media buyer confirms Mahara manages it. Checked 2026-10-16.',
   'board-check-2026-10-16', true),
  -- Ardon, tied today only by its board card's name. Meta: owned by business
  -- "Ardon Engineering Office" 594154909255938 (SAR, Asia/Riyadh), campaign
  -- "Ardon_mahar-22\9"; the registry's meta_ad_account for the location names
  -- this account id. The hand tie keeps it tied if the card is renamed.
  ('718146936708597', '9jbzv8wTiJq5vPUJPsDD',
   'Owned by Meta business "Ardon Engineering Office" 594154909255938; campaign "Ardon_mahar-22\9"; ghl_clients.meta_ad_account names this account for this location. Was tied by the card name only. Checked 2026-10-16.',
   'board-check-2026-10-16', false),
  -- Pidco Group (Cancelled in the registry, no ClickUp card). Meta: account
  -- "Pidco Group for Construction" (SAR), business "pidcogroup"; lead campaigns
  -- not in Mahara's naming still delivering ($553.00 in 30 days to 15 Oct).
  -- Tied for the history: the board keeps a cancelled client out of its totals.
  ('134992869555229', '0C0vFErkVeQ2rMOsfPKD',
   'Meta account "Pidco Group for Construction", business "pidcogroup"; ghl_clients "Pidco Group" (Cancelled) has meta_ad_account "Pidco". Tied for the history; still delivering on 16 Oct. Checked 2026-10-16.',
   'board-check-2026-10-16', false),
  -- AEA Designs (Cancelled). Meta: account "AEA Designs" (QAR, UNSETTLED),
  -- business "AEA Designs"; campaign "AEA Designs | Premium | 14-3-26 | MHM™"
  -- (Mahara naming) spent QAR 396.96 ($109.04) on 24-25 Sep, 0 leads.
  ('854779610674376', '7xOnoHe6eubZUbJnvJ4i',
   'Meta account "AEA Designs", business "AEA Designs"; campaign "AEA Designs | Premium | 14-3-26 | MHM" (Mahara naming); ghl_clients "AEA Designs" (Cancelled) has meta_ad_account "AEA Designs". Tied for the history. Checked 2026-10-16.',
   'board-check-2026-10-16', false)
ON CONFLICT (account_id) DO UPDATE SET location_id = EXCLUDED.location_id, evidence = EXCLUDED.evidence,
  added_by = EXCLUDED.added_by, kept_out = EXCLUDED.kept_out
WHERE (t.location_id, t.evidence, t.kept_out) IS DISTINCT FROM (EXCLUDED.location_id, EXCLUDED.evidence, EXCLUDED.kept_out);

INSERT INTO public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after")
VALUES ('board_facts.account_ties', 'cockpit_board_account_ties', 'migration 20261016210200', 'board-check-2026-10-16', 'board',
  'migration', NULL, jsonb_build_object('accounts', jsonb_build_array('762687672022667', '718146936708597',
    '134992869555229', '854779610674376'), 'keptOut', jsonb_build_array('640644143620696')));

COMMIT;
