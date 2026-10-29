-- Requests: every seat may save a request the writer cannot send now; it is
-- held and goes to ClickUp by itself (2026-10-29, Creative Triage
-- bldgtotkfmhoxmlzowdx; docs/requests/CLICKUP-DOWNGRADE.md section 4.2).
--
-- Live body, read only on 2026-10-29: public.cockpit_request_send_gate(jsonb, text)
-- prosrc md5 945810c7e12cda1635830359a3793d7e (pg_get_functiondef md5
-- 9009f817df22b86493940d846cecf1d4), byte for byte its body in
-- 20261026r_requests.sql. Check it has not moved before applying:
--   SELECT md5(prosrc) FROM pg_catalog.pg_proc
--    WHERE oid = 'public.cockpit_request_send_gate(jsonb,text)'::regprocedure;
-- The file checks it too: it refuses, and changes nothing, when the live body
-- is neither that one nor this file's own (prosrc md5
-- f3f83c347523ec15a73c436d2256f337), so a change made since is never
-- overwritten and a second run changes nothing.
--
-- Why: the CEO moves ClickUp from Business Plus to Business, which has no
-- conditional logic in ClickUp Forms, and the cockpit's own request form
-- ("Ask a team") replaces the old ticket form (2kzmr1ky-1178). The send gate
-- still refused a seat that is not an editor, an admin or the CEO in five
-- cases and sent it to that form with "Use the ClickUp request form". One of
-- them is reachable today: the requests writer has not reported for 15
-- minutes after requests opened. Once form 1178 closes, that seat would have
-- nowhere to file.
--
-- What changes: the gate keeps its shape {allowed, held, note}; allowed is
-- now true for every seat in every mode. When the writer would not send the
-- request now (dry run, the canary off its card, or a writer quiet for 15
-- minutes), the request is held for every seat, as it already was for
-- editors, admins and the CEO: its rows are committed and queued, the writer
-- claims nothing it would not send, and it goes to ClickUp by itself once the
-- writer takes its card. No note mentions a form. The notes, word for word:
--
--   apply, or apply_limited on a card in onlyCards: sends, note null.
--   apply_limited on another card or none (any seat), and unknown with a last
--     report of apply_limited for a card off the canary list or no card (a
--     seat that is not an editor, admin or CEO):
--     "Requests are being tested on the internal test card only, where they
--     go to ClickUp at once. Anything else you send is saved and goes to
--     ClickUp by itself once they open to everyone."
--   dry_run (any seat), and unknown with no report or a last dry run (a seat
--     that is not an editor, admin or CEO): "Requests are not open yet. What
--     you send is saved and goes to ClickUp by itself once they are."
--   unknown, an editor, an admin or the CEO: "The requests writer has not
--     reported in the last 15 minutes. What you send is saved and goes to
--     ClickUp by itself once it runs with requests open. Check it on the
--     Machine tab."
--   unknown with a last report of apply, or of apply_limited with this card on
--     the canary list (cockpit_request_writer_silent, the test the row's held
--     note uses, so the form and the list say the same), anyone else: "The
--     requests writer has not reported in the last 15 minutes. What you send
--     is saved and goes to ClickUp by itself when the writer is back."
--
-- What reads the gate: cockpit_request_submit (a refusal is now unreachable),
-- cockpit_request_can_send, cockpit_request_writer_view (canSend is true for
-- every seat, held says whether it waits) and cockpit_request_can_route (a
-- team seat may now route an old form ticket while requests are held; the
-- routing request is held like any other, and the canary rule for old tickets,
-- cockpit_request_replaces_ok, is untouched). Nothing else changes: the queue,
-- the claim, the writer, cockpit_request_held and cockpit_request_row's held
-- notes (already true for every seat) are as they were. Every guarantee holds:
-- a held request is committed rows, never lost; a held part was never tried,
-- so no create is in doubt and the writer still reads back by its Cockpit ref
-- before any create; the same lifecycle request filed again is "duplicate";
-- submit writes its audit row as before (this file replaces a read-only
-- function and adds no write); and a quiet writer fails the guardian's
-- native-jobs check after 10 minutes, before the gate calls it quiet at 15.
--
-- The function keeps its signature, STABLE SECURITY DEFINER with an empty
-- search path, and its grant exactly as live: revoked from PUBLIC, anon,
-- authenticated and service_role, granted to nobody ({postgres=X/postgres});
-- only the database functions above call it. No table, row or other object
-- changes.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/request-held-gate-supabase.test.ts
-- applies it twice on top of 20261026r and 20261026s and checks every mode and
-- last report for a plain seat and an editor, that the gate's note and the
-- row's held note agree for the same card, a plain seat's held request from
-- submit to the writer's claim (taken once, only after the mode says apply),
-- the duplicate answer, the grant and the guard. It runs in scripts/ship.sh's
-- requests block.
--
-- Read-back after applying: the md5 above for this file's body; proacl
-- {postgres=X/postgres} unchanged; select
-- public.cockpit_request_send_gate('{}'::jsonb, null) answers
-- {"held": false, "note": null, "allowed": true} while the writer is in apply.
-- Rollback: run the send gate definition of 20261026r_requests.sql again (its
-- lines 1180 to 1225; CREATE OR REPLACE keeps the grant), then
-- NOTIFY pgrst, 'reload schema'. Nothing to re-run. Safe to apply twice.

BEGIN;

DO $$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_request_send_gate(jsonb,text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('945810c7e12cda1635830359a3793d7e', 'f3f83c347523ec15a73c436d2256f337') THEN
    RAISE EXCEPTION 'cockpit_request_send_gate is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $$;

-- Who may file a request now, by the writer's mode (contract 2.8, as changed
-- by 20261029p): {allowed, held, note}. Every seat may file. When the writer
-- would not send it now (dry run, the canary off its card, or a writer that
-- has not reported for 15 minutes), the request is HELD: its queue rows stay
-- queued (the writer claims nothing it would not send) and go to ClickUp by
-- themselves once the writer takes the card. note says so plainly, and is
-- worded to be true before and after Send. No note points to a ClickUp form.
CREATE OR REPLACE FUNCTION public.cockpit_request_send_gate(p_seat jsonb, p_client_task text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_mode jsonb := public.cockpit_clickup_requests_mode();
  v_priv boolean := coalesce((p_seat->>'isEditor')::boolean, false) OR coalesce((p_seat->>'isAdmin')::boolean, false)
                    OR coalesce((p_seat->>'isCeo')::boolean, false);
  v_testing constant text := 'Requests are being tested on the internal test card only, where they go to ClickUp at once. Anything else you send is saved and goes to ClickUp by itself once they open to everyone.';
  v_not_open constant text := 'Requests are not open yet. What you send is saved and goes to ClickUp by itself once they are.';
BEGIN
  CASE v_mode->>'mode'
    WHEN 'apply' THEN
      RETURN jsonb_build_object('allowed', true, 'held', false, 'note', NULL);
    WHEN 'apply_limited' THEN
      IF p_client_task IS NOT NULL AND coalesce(v_mode->'onlyCards', '[]'::jsonb) ? p_client_task THEN
        RETURN jsonb_build_object('allowed', true, 'held', false, 'note', NULL);
      END IF;
      RETURN jsonb_build_object('allowed', true, 'held', true, 'note', v_testing);
    WHEN 'dry_run' THEN
      RETURN jsonb_build_object('allowed', true, 'held', true, 'note', v_not_open);
    ELSE
      IF v_priv THEN
        RETURN jsonb_build_object('allowed', true, 'held', true,
          'note', 'The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself once it runs with requests open. Check it on the Machine tab.');
      END IF;
      -- A writer that stopped reporting while it was sending this card (its last
      -- report was apply, or apply_limited with this card on the canary list):
      -- the request waits for it, and the team is told so. The same test as the
      -- row's held note (cockpit_request_row), so the form and the list agree;
      -- the editors' note asks them to check the writer.
      IF public.cockpit_request_writer_silent(p_client_task) THEN
        RETURN jsonb_build_object('allowed', true, 'held', true,
          'note', 'The requests writer has not reported in the last 15 minutes. What you send is saved and goes to ClickUp by itself when the writer is back.');
      END IF;
      -- Its last report was the test on the canary cards, and this card is not
      -- one of them (or there is no card).
      IF v_mode->>'lastMode' = 'apply_limited' THEN
        RETURN jsonb_build_object('allowed', true, 'held', true, 'note', v_testing);
      END IF;
      RETURN jsonb_build_object('allowed', true, 'held', true, 'note', v_not_open);
  END CASE;
END $$;

-- The grant as it is live: revoked from all four roles and given to none;
-- only the database functions that read the gate call it.
REVOKE ALL ON FUNCTION public.cockpit_request_send_gate(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
