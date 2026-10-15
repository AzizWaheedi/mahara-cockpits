-- The end of day post reads cleanly in Slack, 2026-10-15 (Creative Triage
-- bldgtotkfmhoxmlzowdx).
--
-- The CEO, 2026-10-15: "the media buyer eods arent pulling into slack
-- correctly fix it". 20261009g copied the old media buyer form's output
-- "quirks included", and the posts of 10-11 and 10-13 in #media-eods show
-- them: the Date line opens a bold it never closes ("*Date - 13-10-2026"),
-- Food, sleep, water and "Any Clients Above KPI?" put their value on the next
-- line, a blank answer posts as a dangling "Focus - ", and a pasted answer
-- posts as typed (a leading blank line on 10-11, the first bullet missing on
-- 10-13). The video editor and creative director posts in the same channel
-- close the bold ("*Date - 14-10-2026*").
--
-- What changes, in the Slack text only:
-- * The Date line is bold and closed, for every role. EOD Radar credits a
--   post by its "*Name - " and "Submitted by: <@id>" lines; both are as before.
-- * Every answer sits on its question's line ("Food, Sleep, Water - 7"). An
--   answer of more than one line goes under its question, which is bold on a
--   line of its own; never with a blank line before it.
-- * A list (the clients out of KPI, the CSM's one-client-per-line answers)
--   has "• " on every item: no missing first bullet, no blank or "-----"
--   lines between. Other answers keep their lines as typed, trimmed.
-- * An answer left blank reads "Not answered" ("None" where the form says
--   blank means none), and so does one of only dashes or marks ("-", "--",
--   "----": how the media buyer writes "nothing", and the old builder's own
--   blank marker). A number the cockpit did not send reads "n/a", never 0.
-- * A one-line answer after an answer of several lines has a blank line
--   before it, so it does not read as the last item of that list.
-- * Money reads as the CEO kit's money() in components/ceo/format.ts: "$1,234",
--   cents only under $100 when there are any ("$84.50"). Counts as count():
--   "1,234". Text that is not a number ("no leads") stays as it is.
-- * &, < and > in typed answers are escaped as Slack asks, so "CPL < $15" is
--   not read as a link and "Marble & More" shows as typed.
--
-- The sheet rows. The media buyer's 21 values are unchanged, value for value:
-- they follow the 'Media Buyer' tab header (read 2026-10-15: Submitted At,
-- Name, Response ID, Date For, Energy, Focus, Biology, ... Account Summary,
-- Clients Out of KPI, 1% Better). The CSM and creative director rows were 10
-- values in an order that matches neither of their tabs: under the 'Account
-- Manager' header (Submitted At, Name, Response ID, Date For, Stress, Energy,
-- Call Summary, ...) the CSM's energy landed under Stress and his call summary
-- nowhere. Each now follows its tab's header, read the same day, with the date
-- written as that tab's other rows write it (YYYY-MM-DD). No CSM or creative
-- director EOD has been queued since 20261009g, so no existing row moves.
--
-- Only rows queued after this applies change: the delivery trigger
-- (20260927b) refuses to rewrite a row that was claimed or sent, so outbox
-- rows 3 and 4 (posted 2026-10-14) keep their text.
BEGIN;

DO $$
BEGIN
 IF to_regprocedure('public.cockpit_eod_pick(jsonb,text[])') IS NULL
  OR to_regprocedure('public.cockpit_enqueue_personal_eod(bigint)') IS NULL THEN
  RAISE EXCEPTION 'Apply 20261009g_eod_outbox_native.sql first';
 END IF;
END $$;

-- &, < and > as Slack's text wants them; the "<@id>" mention is ours and is
-- never passed through here.
CREATE OR REPLACE FUNCTION public.cockpit_eod_slack_escape(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT replace(replace(replace(coalesce(p,''),'&','&amp;'),'<','&lt;'),'>','&gt;');
$$;

-- One typed answer, tidied for Slack. '' when nothing was typed, or only
-- dashes or marks were. Spaces at line ends, carriage returns and blank lines at either end go;
-- blank lines inside collapse to one. One line loses a lone bullet mark.
-- A list (p_list) becomes one "• item" a line, whatever marks it was typed
-- with (pasted from the cockpit's preview, the first line often has none).
CREATE OR REPLACE FUNCTION public.cockpit_eod_tidy(p_value text,p_list boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
 -- A bullet, dash, star or "1." / "1)" that starts an item, with what follows it.
 mark constant text:='^([•·▪◦‣●]|[*–—-](?=[[:space:]])|[0-9]{1,2}[.)](?=[[:space:]]))[[:space:]]*';
 t text; x text; lines text[]; items text[]:='{}'; n integer:=0;
BEGIN
 t:=replace(replace(coalesce(p_value,''),E'\r',''),chr(160),' ');
 t:=regexp_replace(t,E'[ \t]+(\n|$)',E'\\1','g');
 t:=regexp_replace(t,E'\n{3,}',E'\n\n','g');
 t:=btrim(t,E' \t\n');
 IF t='' THEN RETURN ''; END IF;
 -- Only dashes, dots or marks ("-", "--", "----", "—") is how a person writes
 -- "nothing", and was the old builder's own blank marker: not an answer.
 IF t ~ '^[-–—_=*•·▪◦‣●.~[:space:]]+$' THEN RETURN ''; END IF;
 lines:=regexp_split_to_array(t,E'\n');
 FOREACH x IN ARRAY lines LOOP
  IF btrim(x)<>'' THEN n:=n+1; END IF;
 END LOOP;
 IF n=1 THEN RETURN public.cockpit_eod_slack_escape(btrim(regexp_replace(t,mark,''))); END IF;
 IF NOT p_list THEN RETURN public.cockpit_eod_slack_escape(t); END IF;
 FOREACH x IN ARRAY lines LOOP
  x:=btrim(regexp_replace(btrim(x),mark,''));
  -- Blank lines and separator lines ("-----") are not items.
  CONTINUE WHEN x='' OR x ~ '^[-–—_=*•·.~[:space:]]+$';
  items:=items||x;
 END LOOP;
 IF cardinality(items)=0 THEN RETURN ''; END IF;
 IF cardinality(items)=1 THEN RETURN public.cockpit_eod_slack_escape(items[1]); END IF;
 RETURN public.cockpit_eod_slack_escape('• '||array_to_string(items,E'\n• '));
END;
$$;

-- "Question - answer" on one line; an answer of several lines under its
-- bold question; p_empty when nothing was typed.
CREATE OR REPLACE FUNCTION public.cockpit_eod_answer(p_label text,p_value text,p_list boolean DEFAULT false,
 p_empty text DEFAULT 'Not answered')
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN t='' THEN p_label||' - '||p_empty
  WHEN strpos(t,E'\n')>0 THEN '*'||p_label||'*'||E'\n'||t
  ELSE p_label||' - '||t END
 FROM (SELECT public.cockpit_eod_tidy(p_value,p_list) AS t) s;
$$;

-- The text under a bold section heading ("*CALLS*"): the tidied answer, or p_empty.
CREATE OR REPLACE FUNCTION public.cockpit_eod_block(p_value text,p_list boolean DEFAULT false,
 p_empty text DEFAULT 'Not answered')
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(nullif(public.cockpit_eod_tidy(p_value,p_list),''),p_empty);
$$;

-- components/ceo/format.ts money(): "$12,450"; cents only under $100 when
-- there are any ("$84.50"); U+2212 for a minus. Blank is "n/a", never $0.
CREATE OR REPLACE FUNCTION public.cockpit_eod_money(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t text:=btrim(coalesce(p,'')); v numeric; a numeric;
BEGIN
 IF t='' THEN RETURN 'n/a'; END IF;
 IF t !~ '^-?\$?[0-9][0-9,]*(\.[0-9]+)?$' THEN RETURN public.cockpit_eod_slack_escape(t); END IF;
 v:=replace(replace(t,'$',''),',','')::numeric;
 a:=abs(v);
 IF a<100 AND round(a*100)%100<>0 THEN
  RETURN CASE WHEN v<0 THEN '−' ELSE '' END||'$'||to_char(round(a,2),'FM990.00');
 END IF;
 a:=round(a);
 RETURN CASE WHEN v<0 AND a>0 THEN '−' ELSE '' END||'$'||to_char(a,'FM999,999,999,990');
END;
$$;

-- components/ceo/format.ts count(): "1,284", rounded. Blank is "n/a", never 0.
CREATE OR REPLACE FUNCTION public.cockpit_eod_count(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t text:=btrim(coalesce(p,'')); v numeric;
BEGIN
 IF t='' THEN RETURN 'n/a'; END IF;
 IF t !~ '^-?[0-9][0-9,]*(\.[0-9]+)?$' THEN RETURN public.cockpit_eod_slack_escape(t); END IF;
 v:=round(replace(t,',','')::numeric);
 RETURN CASE WHEN v<0 THEN '−' ELSE '' END||to_char(abs(v),'FM999,999,999,990');
END;
$$;

-- The Slack message and the sheet row for one report, per role. Channels and
-- tabs are the ones the Convex producers wrote to (20261009g).
CREATE OR REPLACE FUNCTION public.cockpit_eod_outbox_payload(r public.cockpit_eod_reports,p_name text,p_slack_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
 a jsonb:=coalesce(r.answers,'{}'::jsonb);
 c jsonb:=coalesce(r.computed,'{}'::jsonb);
 v_date text:=to_char(r.day,'DD-MM-YYYY');
 v_iso_date text:=to_char(r.day,'YYYY-MM-DD');
 v_submitted text:=to_char(coalesce(r.submitted_at,now()) AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
 v_response text:='cockpit-'||to_char(r.day,'YYYY-MM-DD')||'-'||r.id::text;
 v_energy text;
 v_stress text:=coalesce(r.stress::text,'');
 v_by text;
 v_head text[];
 v_channel text;
 v_tab text;
 v_body text[];
 v_lines text[]:='{}';
 v_values jsonb;
 i integer;
BEGIN
 v_energy:=public.cockpit_eod_pick(a,'energy');
 IF v_energy='' THEN v_energy:=coalesce(r.energy::text,''); END IF;
 v_by:='Submitted by: '||CASE WHEN nullif(btrim(p_slack_id),'') IS NOT NULL THEN '<@'||btrim(p_slack_id)||'>' ELSE p_name END;
 v_head:=ARRAY['*Date - '||v_date||'*','','*Name - '||p_name||'*',v_by,''];
 IF r.role='media_buyer' THEN
  v_channel:='C0AQ2LD0PL1';v_tab:='Media Buyer';
  v_body:=ARRAY['*MEDIA BUYER EOD*']||v_head||ARRAY[
   '*HEALTH*',
   public.cockpit_eod_answer('Focus',public.cockpit_eod_pick(a,'focus')),
   public.cockpit_eod_answer('Energy',v_energy),
   public.cockpit_eod_answer('Food, Sleep, Water',public.cockpit_eod_pick(a,'biology')),
   '',
   '*TASKS*',
   public.cockpit_eod_answer('Did you check and update the Master Fulfillment Dashboard for all active clients today?',public.cockpit_eod_pick(a,'dashboard')),
   public.cockpit_eod_answer('Are all client ad accounts within their daily budget targets?',public.cockpit_eod_pick(a,'onBudget')),
   public.cockpit_eod_answer('Did you flag any off-KPI client accounts to the CSM today?',public.cockpit_eod_pick(a,'flagged')),
   public.cockpit_eod_answer('Did you submit any video requests or creative briefs that were due today?',public.cockpit_eod_pick(a,'videoRequests')),
   public.cockpit_eod_answer('Did you upload any approved creatives to the client''s Google Drive Creatives folder?',public.cockpit_eod_pick(a,'creativesUploaded')),
   '',
   '*Today''s Numbers*',
   'Total Ad Spend Today - '||public.cockpit_eod_money(public.cockpit_eod_pick(c,'spend')),
   'Leads Generated - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'leads')),
   'Average CPL - '||public.cockpit_eod_money(public.cockpit_eod_pick(c,'cpl')),
   'Active Accounts Managed - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'accounts')),
   public.cockpit_eod_answer('Any Clients Above KPI?',public.cockpit_eod_pick(c,'overGate'),false,'n/a'),
   public.cockpit_eod_answer('Any new creatives launched or paused today?',public.cockpit_eod_pick(a,'launchedPaused')),
   '',
   '*DAILY WRAP UP*',
   public.cockpit_eod_answer('Account Summary',public.cockpit_eod_pick(a,'accountSummary')),
   public.cockpit_eod_answer('Actions to get back into KPI',public.cockpit_eod_pick(a,'outOfKpi'),true),
   '',
   '*ADDITIONAL NOTES*',
   public.cockpit_eod_answer('1% improvement',public.cockpit_eod_pick(a,'one_percent_better'))];
  -- Unchanged from 20261009g: the 'Media Buyer' tab's 21 columns, in its header's order.
  v_values:=jsonb_build_array(v_submitted,p_name,v_response,v_date,v_energy,
   public.cockpit_eod_pick(a,'focus'),public.cockpit_eod_pick(a,'biology'),public.cockpit_eod_pick(a,'dashboard'),
   public.cockpit_eod_pick(a,'onBudget'),public.cockpit_eod_pick(a,'flagged'),public.cockpit_eod_pick(a,'videoRequests'),
   public.cockpit_eod_pick(a,'creativesUploaded'),public.cockpit_eod_pick(c,'spend'),public.cockpit_eod_pick(c,'leads'),
   public.cockpit_eod_pick(c,'cpl'),public.cockpit_eod_pick(c,'accounts'),public.cockpit_eod_pick(c,'overGate'),
   public.cockpit_eod_pick(a,'launchedPaused'),public.cockpit_eod_pick(a,'accountSummary'),
   public.cockpit_eod_pick(a,'outOfKpi'),public.cockpit_eod_pick(a,'one_percent_better'));
 ELSIF r.role='csm' THEN
  v_channel:='#eods-csms';v_tab:='Account Manager';
  v_body:=ARRAY['*CSM EOD*']||v_head||ARRAY[
   '*HEALTH*',public.cockpit_eod_answer('Energy',v_energy),public.cockpit_eod_answer('Stress',v_stress),'',
   '*OUTPUT*',
   'Clients handled today - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'handled','contacted')),
   'Calls held - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'calls')),
   'Signups or onboarding steps - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'signups')),
   'Upsells, referrals or reviews logged - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'hot')),
   'Tickets rerouted - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'tickets')),
   'Clients marked left - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'left')),
   '',
   '*CALLS*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'callSummary')),'',
   '*EXPECTATIONS*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'expectations')),'',
   '*CHECKLIST*',
   public.cockpit_eod_answer('Touchpoints for DEFCON 3 clients',public.cockpit_eod_pick(a,'touchpoints')),
   public.cockpit_eod_answer('Fathom summaries sent',public.cockpit_eod_pick(a,'fathom')),
   public.cockpit_eod_answer('New signups or pre-onboarding',public.cockpit_eod_pick(a,'newSignups')),
   public.cockpit_eod_answer('Upsells',public.cockpit_eod_pick(a,'upsells')),
   public.cockpit_eod_answer('Google reviews',public.cockpit_eod_pick(a,'reviews')),
   public.cockpit_eod_answer('Referrals',public.cockpit_eod_pick(a,'referrals')),
   '',
   -- The form says blank means none for these four, one client per line.
   '*LOST OR AT RISK*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'lost'),true,'None'),'',
   '*OFFBOARDED*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'offboarded'),true,'None'),'',
   '*EXTENDED*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'extended'),true,'None'),'',
   '*PAUSED*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'paused'),true,'None'),'',
   '*1% BETTER*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'onePercent','one_percent_better')),'',
   '*DAY SUMMARY*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'rollup','summary'))];
  -- The 'Account Manager' tab's 17 columns, in its header's order (read 2026-10-15).
  v_values:=jsonb_build_array(v_submitted,p_name,v_response,v_iso_date,v_stress,v_energy,
   public.cockpit_eod_pick(a,'callSummary'),public.cockpit_eod_pick(a,'expectations'),
   public.cockpit_eod_pick(a,'touchpoints'),public.cockpit_eod_pick(a,'fathom'),public.cockpit_eod_pick(a,'newSignups'),
   public.cockpit_eod_pick(a,'lost'),public.cockpit_eod_pick(a,'upsells'),public.cockpit_eod_pick(a,'reviews'),
   public.cockpit_eod_pick(a,'referrals'),public.cockpit_eod_pick(a,'onePercent','one_percent_better'),
   public.cockpit_eod_pick(a,'rollup','summary'));
 ELSIF r.role='creative' THEN
  v_channel:='C0AQ2LD0PL1';v_tab:='Creative Director';
  v_body:=ARRAY['*CREATIVE DIRECTOR EOD*']||v_head
   -- His form asks no health questions; the section shows only when a score was sent.
   ||CASE WHEN v_energy='' AND v_stress='' THEN ARRAY[]::text[] ELSE ARRAY[
    '*HEALTH*',public.cockpit_eod_answer('Energy',v_energy),public.cockpit_eod_answer('Stress',v_stress),''] END
   ||ARRAY[
   '*OUTPUT*',
   public.cockpit_eod_answer('Scripts completed today',public.cockpit_eod_pick(a,'scripts')),
   public.cockpit_eod_answer('Videos briefed to editors today',public.cockpit_eod_pick(a,'briefed')),
   public.cockpit_eod_answer('Client adjustments: all feedback received &amp; logged?',public.cockpit_eod_pick(a,'feedbackLogged')),
   public.cockpit_eod_answer('Client adjustments: all clients replied to?',public.cockpit_eod_pick(a,'clientsReplied')),
   public.cockpit_eod_answer('Client adjustments: all adjustments sent to editors?',public.cockpit_eod_pick(a,'adjustmentsSent')),
   '',
   '*TODAY IN THE COCKPIT*',
   'Checks done - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'checksDone'))||' of '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'checksTotal')),
   'Touchpoints done - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'touchpointsDone')),
   'Brand DNA open - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'brandDnaOpen')),
   'Scripts open - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'scriptsOpen'))||' ('||public.cockpit_eod_count(public.cockpit_eod_pick(c,'scriptsStale'))||' stale)',
   'Videos late - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'videosOverdue')),
   'Posts past date - '||public.cockpit_eod_count(public.cockpit_eod_pick(c,'postsLate')),
   '',
   '*IDEAS*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'ideas')),'',
   '*BLOCKERS*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'blockers')),'',
   '*TOMORROW*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'priorities','tomorrow')),'',
   '*DAY SUMMARY*',public.cockpit_eod_block(public.cockpit_eod_pick(a,'summary'))];
  -- The 'Creative Director' tab's 13 columns, in its header's order (read 2026-10-15).
  v_values:=jsonb_build_array(v_submitted,p_name,v_response,v_iso_date,
   public.cockpit_eod_pick(a,'scripts'),public.cockpit_eod_pick(a,'briefed'),public.cockpit_eod_pick(a,'feedbackLogged'),
   public.cockpit_eod_pick(a,'clientsReplied'),public.cockpit_eod_pick(a,'adjustmentsSent'),public.cockpit_eod_pick(a,'ideas'),
   public.cockpit_eod_pick(a,'blockers'),public.cockpit_eod_pick(a,'priorities','tomorrow'),public.cockpit_eod_pick(a,'summary'));
 ELSE
  RAISE EXCEPTION 'No EOD channel is set for the % role',r.role;
 END IF;
 -- A one-line answer right after an answer of several lines gets a blank
 -- line first, or it reads as the last item of that answer's list.
 FOR i IN 1..cardinality(v_body) LOOP
  IF i>1 AND v_body[i]<>'' AND strpos(v_body[i],E'\n')=0 AND strpos(v_body[i-1],E'\n')>0 THEN
   v_lines:=v_lines||''::text;
  END IF;
  v_lines:=v_lines||v_body[i];
 END LOOP;
 RETURN jsonb_build_object('channel',v_channel,'tab',v_tab,'body',array_to_string(v_lines,E'\n'),'row_values',v_values);
END;
$$;

-- Internal: called only inside the definer functions above (owner rights).
REVOKE ALL ON FUNCTION public.cockpit_eod_slack_escape(text),public.cockpit_eod_tidy(text,boolean),
 public.cockpit_eod_answer(text,text,boolean,text),public.cockpit_eod_block(text,boolean,text),
 public.cockpit_eod_money(text),public.cockpit_eod_count(text),
 public.cockpit_eod_outbox_payload(public.cockpit_eod_reports,text,text) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
