-- Run after the candidate migration, inside a transaction that is rolled back.
DO $$
DECLARE cid text; cname text; uid uuid; made jsonb; again jsonb; tok text; item text; denied boolean;
BEGIN
 SELECT task_id,name INTO cid,cname FROM public.editor_clients ORDER BY task_id LIMIT 1;
 SELECT auth_user_id INTO uid FROM public.cockpit_members WHERE email='aziz@maharamedia.com' AND active;
 IF cid IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'Fixture prerequisite unavailable'; END IF;
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 INSERT INTO public.editor_jobs(task_id,name,client_task_id,client,status,state,edited_url,synced_at)
 VALUES('codexvideoreviewfixture','[TEST] Video review',cid,cname,'internal review','ready','https://example.com/fixture-v1.mp4',now());
 IF public.cockpit_video_review_panel('codexvideoreviewfixture')->>'clientTaskId' <> cid THEN RAISE EXCEPTION 'Client binding failed'; END IF;
 denied:=false;
 BEGIN PERFORM public.cockpit_video_review_create('codexvideoreviewfixture'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Internal gate failed'; END IF;
 UPDATE public.editor_jobs SET status='internal approved' WHERE task_id='codexvideoreviewfixture';
 made:=public.cockpit_video_review_create('codexvideoreviewfixture');
 again:=public.cockpit_video_review_create('codexvideoreviewfixture');
 tok:=made->>'token';item:=tok||':1';
 IF tok IS NULL OR again->>'token'<>tok THEN RAISE EXCEPTION 'Duplicate create failed'; END IF;
 denied:=false;
 BEGIN PERFORM public.review_decide(tok,item,'approved','',null,'Test Reviewer'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unverified link was usable'; END IF;
 UPDATE public.review_links SET flow_ready_at=now() WHERE token=tok;
 UPDATE public.editor_jobs SET status='client review' WHERE task_id='codexvideoreviewfixture';
 PERFORM public.review_decide(tok,item,'approved','',null,'Test Reviewer');
 IF (SELECT decision FROM public.review_items WHERE id=item)<>'approved' THEN RAISE EXCEPTION 'Approval failed'; END IF;
 PERFORM public.review_decide(tok,item,null,'Fixture comment',10,'Test Reviewer');
 IF NOT EXISTS(SELECT 1 FROM public.review_notes WHERE item_id=item AND task_id='codexvideoreviewfixture' AND body='Fixture comment') THEN RAISE EXCEPTION 'Comment binding failed'; END IF;
 IF (SELECT decision FROM public.review_items WHERE id=item)<>'changes' THEN RAISE EXCEPTION 'Late comment did not reopen review'; END IF;
 UPDATE public.editor_jobs SET edited_url='https://example.com/fixture-v2.mp4',status='internal approved' WHERE task_id='codexvideoreviewfixture';
 denied:=false;
 BEGIN PERFORM public.review_decide(tok,item,'approved','',null,'Test Reviewer'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale approval accepted'; END IF;
 again:=public.cockpit_video_review_create('codexvideoreviewfixture');
 IF again->>'token'=tok OR NOT (SELECT revoked FROM public.review_links WHERE token=tok) THEN RAISE EXCEPTION 'Replacement did not revoke old review'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;
 BEGIN PERFORM public.cockpit_video_review_panel('codexvideoreviewfixture'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unassigned caller could read review'; END IF;
 IF has_function_privilege('anon','public.cockpit_video_review_create(text)','EXECUTE') OR has_function_privilege('anon','public.cockpit_video_review_panel(text)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous staff access exposed'; END IF;
END $$;
SELECT 'video review database checks passed; fixture rolls back' AS result;
