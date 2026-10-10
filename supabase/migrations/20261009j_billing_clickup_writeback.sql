-- Billing edits from the cockpits, written back to the ClickUp card (9 Oct 2026).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Needs 20261009a (the
-- billing tables and cockpit_billing_write) and 20261009f (the ClickUp
-- writeback queue and its drain).
--
-- Under Convex, billingCore.applyEdit wrote the card first and the mirror
-- second (apps/media-buyer-cockpit/convex/billingCore.ts). Since 20261009a an
-- edit lands on the mirror and in the billing log only, and billing-sync keeps
-- it only until the card changes after it. Muhammed approved (9 Oct 2026) that
-- cockpit billing edits are written back to ClickUp, behind the same switch as
-- the other ClickUp writes, with ClickUp staying the record.
--
-- 1. The writeback queue takes a 'billing' item.
-- 2. Every billing event cockpit_billing_write inserts (source ceo or csm)
--    queues one item, in the same transaction, carrying every field write the
--    edit makes on the card (or the note comment). cockpit_billing_write itself
--    is unchanged: the trigger sits on cockpit_billing_events, which it writes
--    in the same transaction as the mirror. If the item cannot be queued, the
--    edit is not saved either.
-- 3. The clickup-writeback log job (every 2 minutes) writes the fields exactly
--    as Convex did. Nothing reaches ClickUp unless CLICKUP_WRITEBACK_APPLY is
--    "true" (and the card is on CLICKUP_WRITEBACK_ONLY_TASKS when that is set);
--    otherwise the item is held as 'dry_run' with the planned old and new values.
-- 4. billing-sync keeps a cockpit edit on the mirror while its item is queued,
--    sending, waiting to retry or a dry run, and lets ClickUp's value back in
--    once the write is delivered and the card's date_updated passes the edit.
--
-- What each event writes (field ids in supabase/functions/clickup-writeback/billing.ts):
--   method     Payment Method      the option named to_value
--   plan       Payment Plan        the option named to_value
--   amount     Next Payment Amount to_value as a number
--   date       Next Payment Date   to_value (a Kuwait day)
--   extension  Extension weeks, and Next Payment Date when the date moved
--   pause      Client Status "Paused", then Paused On
--   resume     Client Status "Active", Paused On cleared, Next Payment Date if given
--   payment    Next Payment Date, when the payment moved it
--   note       the comment "Billing note (<email>): <text>"
-- "old" is the mirror's value before the edit where the event records it; the
-- drain uses it to tell a card ClickUp changed after the edit from one it did not.
--
-- Operator note: after CLICKUP_WRITEBACK_APPLY goes live, billing items held as
-- 'dry_run' keep their edits on the mirror until they are delivered or closed.
-- Deliver them with the 20261009f note (state back to 'queued'); the drain
-- leaves any field ClickUp changed after the edit as ClickUp has it.

BEGIN;

-- 1. The new kind ------------------------------------------------------------------

ALTER TABLE public.cockpit_clickup_writeback_queue DROP CONSTRAINT IF EXISTS cockpit_clickup_writeback_queue_kind_check;
ALTER TABLE public.cockpit_clickup_writeback_queue ADD CONSTRAINT cockpit_clickup_writeback_queue_kind_check
 CHECK(kind IN('decision','manual_change','provider_action','tracking_backlog','billing'));
COMMENT ON TABLE public.cockpit_clickup_writeback_queue IS
 'ClickUp writes waiting for the clickup-writeback Edge Function: one row per native decision, typed change, confirmed provider action, weekly tracking backlog or cockpit billing edit. steps freeze the exact writes before the first one; progress records each step so a retry reads back instead of writing twice.';

-- 2. What one billing event writes on the card -------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_writes(p_kind text,p_from text,p_to text,p_detail jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
 d jsonb:=CASE WHEN jsonb_typeof(p_detail)='object' THEN p_detail ELSE '{}'::jsonb END;
 w jsonb:='[]'::jsonb;
 num text:='^-?[0-9]+(\.[0-9]+)?$';
BEGIN
 CASE p_kind
 WHEN 'method' THEN w:=jsonb_build_array(jsonb_build_object('field','method','value',p_to,'old',p_from));
 WHEN 'plan' THEN w:=jsonb_build_array(jsonb_build_object('field','plan','value',p_to,'old',p_from));
 WHEN 'amount' THEN w:=jsonb_build_array(jsonb_build_object('field','nextAmount',
   'value',CASE WHEN p_to~num THEN p_to::numeric END,'old',CASE WHEN p_from~num THEN p_from::numeric END));
 WHEN 'date' THEN w:=jsonb_build_array(jsonb_build_object('field','nextDate','value',p_to,'old',p_from));
 WHEN 'extension' THEN
  w:=jsonb_build_array(jsonb_build_object('field','extension','value',CASE WHEN d->>'weeks'~num THEN (d->>'weeks')::numeric END));
  IF d->'movedDate'='true'::jsonb THEN w:=w||jsonb_build_object('field','nextDate','value',p_to,'old',p_from); END IF;
 WHEN 'pause' THEN
  w:=jsonb_build_array(jsonb_build_object('field','status','value','Paused','old',p_from),
                       jsonb_build_object('field','pausedOn','value',d->>'on'));
 WHEN 'resume' THEN
  -- Paused On is cleared, or the next pause is measured from this one (billingCore).
  w:=jsonb_build_array(jsonb_build_object('field','status','value','Active','old',p_from),
                       jsonb_build_object('field','pausedOn','value',NULL,'clear',true));
  IF d->>'nextDate' IS NOT NULL THEN w:=w||jsonb_build_object('field','nextDate','value',d->>'nextDate'); END IF;
 WHEN 'payment' THEN
  IF p_to IS NOT NULL AND p_to IS DISTINCT FROM p_from THEN
   w:=jsonb_build_array(jsonb_build_object('field','nextDate','value',p_to,'old',p_from));
  END IF;
 ELSE NULL;
 END CASE;
 -- A value the event does not carry is not guessed; only a deliberate clear is empty.
 RETURN (SELECT coalesce(jsonb_agg(x-'clear' ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(w) WITH ORDINALITY AS t(x,n)
         WHERE x->'value'<>'null'::jsonb OR x->'clear'='true'::jsonb);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_writeback_writes(text,text,text,jsonb) IS
 'The ClickUp field writes one cockpit_billing_events row makes, in billingCore.applyEdit''s order: [{field, value, old?}]. A null value is a clear (Paused On on a resume). Empty when the event changes no card field.';

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_writes jsonb; v_note text;
BEGIN
 v_writes:=public.cockpit_billing_writeback_writes(NEW.kind,NEW.from_value,NEW.to_value,NEW.detail);
 v_note:=CASE WHEN NEW.kind='note' THEN nullif(btrim(coalesce(NEW.reason,'')),'') END;
 -- A payment taken in from the inbox, or one that moved no date, writes nothing on the card.
 IF jsonb_array_length(v_writes)=0 AND v_note IS NULL THEN RETURN NEW; END IF;
 -- Not wrapped in an exception handler: an edit that cannot be queued for ClickUp is not saved.
 INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload)
 VALUES('billing:'||NEW.id,'billing','cockpit_billing_events',NEW.id::text,NEW.clickup_task_id,jsonb_build_object(
  'eventId',NEW.id,'taskId',NEW.clickup_task_id,'clientName',NEW.client_name,'kind',NEW.kind,
  'source',NEW.source,'by',NEW.by_whom,'at',round(extract(epoch FROM NEW.at)*1000),
  'writes',v_writes,'note',v_note))
 ON CONFLICT (dedupe_key) DO NOTHING;
 RETURN NEW;
END $$;
COMMENT ON FUNCTION public.cockpit_billing_writeback_enqueue() IS
 'Trigger on cockpit_billing_events: queues the ClickUp write-back of a cockpit billing edit (source ceo or csm) in the same transaction, dedupe key billing:<event id>.';

DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;
CREATE TRIGGER cockpit_billing_events_clickup_writeback AFTER INSERT ON public.cockpit_billing_events
 FOR EACH ROW WHEN (NEW.source IN('ceo','csm') AND NEW.kind IN('method','plan','amount','date','extension','pause','resume','payment','note'))
 EXECUTE FUNCTION public.cockpit_billing_writeback_enqueue();

COMMENT ON FUNCTION public.cockpit_billing_write(text, jsonb) IS
 'Every billing change from a cockpit: edit, payment, assign. CSM, finance or CEO seat; a CSM only on their portal clients; CEO-only for the CEO cockpit and for tying a payer. Each write leaves a cockpit_billing_events row and a cockpit_audit_log row. A change to card fields (or a note) is queued for ClickUp in the same transaction by the cockpit_billing_events trigger (20261009j); clickup-writeback writes it when CLICKUP_WRITEBACK_APPLY is true.';

-- 3. Privileges: nobody calls these directly ----------------------------------------

REVOKE ALL ON FUNCTION
 public.cockpit_billing_writeback_writes(text,text,text,jsonb),
 public.cockpit_billing_writeback_enqueue()
FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
