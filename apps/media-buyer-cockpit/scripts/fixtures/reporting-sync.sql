CREATE OR REPLACE FUNCTION public.mahara_reporting_sync(operation text, args jsonb DEFAULT '{}'::jsonb, namespace text DEFAULT 'production'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare ns text:=namespace; j mahara_reporting.sync_jobs%rowtype; item jsonb; client_row record; k text; stamp timestamptz:=statement_timestamp(); result jsonb; complete boolean;
begin
 if ns !~ '^[a-z0-9_-]{1,80}$' then raise exception 'Invalid namespace'; end if;
 if operation='seed' then
  if ns<>'production' then raise exception 'Registry seeding is production only'; end if;
  for client_row in select location_id from public.ghl_clients where status='Active' loop
   foreach k in array array['contacts','opportunities','appointments_recent','appointments_history'] loop
    insert into mahara_reporting.sync_jobs(namespace,id,source,location_id,kind) values(ns,'ghl:'||client_row.location_id||':'||k,'ghl',client_row.location_id,k) on conflict do nothing;
   end loop;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(args->'agents','[]')) loop
   if item#>>'{}' !~ '^[^@ ]+@maharamedia.com$' then raise exception 'Invalid caller identity'; end if;
   insert into mahara_reporting.sync_jobs(namespace,id,source,location_id,kind,cursor)
    values(ns,'maqsam:'||(item#>>'{}'),'maqsam',item#>>'{}','calls','{}') on conflict do nothing;
  end loop;
  return jsonb_build_object('ready',true);
 elsif operation='claim' then
  if length(coalesce(args->>'owner',''))<20 then raise exception 'Missing lease owner'; end if;
  select * into j from mahara_reporting.sync_jobs s where s.namespace=ns and s.due_at<=stamp and coalesce(s.lease_until,'-infinity')<stamp
   and (s.source<>'ghl' or exists(select 1 from public.ghl_clients c where c.location_id=s.location_id and c.status='Active'))
   and (s.source<>'maqsam' or coalesce((args->>'maqsamReady')::boolean,false))
   order by s.due_at,case when s.kind='appointments_history' then 1 else 0 end,s.id for update skip locked limit 1;
  if not found then return 'null'::jsonb; end if;
  update mahara_reporting.sync_jobs set lease_owner=args->>'owner',lease_until=stamp+interval '100 seconds',run_at=coalesce(run_at,stamp) where sync_jobs.namespace=ns and id=j.id returning * into j;
  return to_jsonb(j)-'namespace';
 elsif operation in ('save','fail') then
  select * into j from mahara_reporting.sync_jobs s where s.namespace=ns and s.id=args->>'id' for update;
  if not found or j.lease_owner is distinct from args->>'owner' or j.lease_until<stamp then raise exception 'Sync lease expired'; end if;
  if operation='fail' then
   update mahara_reporting.sync_jobs set error=left(args->>'error',240),failures=failures+1,due_at=stamp+make_interval(secs=>least(3600,60*power(2,least(failures,5)))::double precision),lease_owner=null,lease_until=null where sync_jobs.namespace=ns and id=j.id;
   return jsonb_build_object('retryScheduled',true);
  end if;
  if jsonb_typeof(args->'records')<>'array' or jsonb_array_length(args->'records')>1000 then raise exception 'Invalid page size'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mahara_reporting:'||ns,0));
  for item in select value from jsonb_array_elements(args->'records') loop
   if j.source='ghl' and (item->'data'->>'locationId' is distinct from j.location_id or item->>'id' is distinct from j.location_id||':'||(item->'data'->>'id')) then raise exception 'Location mismatch'; end if;
   perform mahara_reporting.capture(ns,j.source,item->>'kind',item->>'id',(item->>'versionAt')::timestamptz,j.run_at,item->'data');
   insert into mahara_reporting.inventory(namespace,source,kind,external_id,last_seen,checked_at,present)
    values(ns,j.source,item->>'kind',item->>'id',j.run_at,j.run_at,true)
    on conflict on constraint inventory_pkey do update set last_seen=excluded.last_seen,checked_at=excluded.checked_at,present=true
    where inventory.checked_at<=excluded.checked_at;
  end loop;
  complete:=coalesce((args->>'complete')::boolean,false);
  if complete and j.kind in ('contacts','opportunities') then
   update mahara_reporting.inventory inv set present=false,checked_at=j.run_at
    from mahara_reporting.facts f where inv.namespace=ns and inv.source='ghl' and inv.kind=case when j.kind='contacts' then 'contact' else 'opportunity' end
    and inv.checked_at<=j.run_at and inv.last_seen<j.run_at and f.namespace=inv.namespace and f.source=inv.source and f.kind=inv.kind and f.external_id=inv.external_id and f.data->>'locationId'=j.location_id;
  end if;
  if args->'window' is not null then
   if j.kind not in ('appointments_recent','appointments_history') or args->'window'->>'calendarId' is null then raise exception 'Invalid calendar window'; end if;
   update mahara_reporting.inventory inv set present=false,checked_at=j.run_at
    from mahara_reporting.facts f where inv.namespace=ns and inv.source='ghl' and inv.kind='appointment' and inv.checked_at<=j.run_at and inv.last_seen<j.run_at
    and f.namespace=inv.namespace and f.source=inv.source and f.kind=inv.kind and f.external_id=inv.external_id and f.data->>'locationId'=j.location_id
    and f.data->>'calendarId'=args->'window'->>'calendarId' and (f.data->>'startAt')::timestamptz>=(args->'window'->>'start')::timestamptz and (f.data->>'startAt')::timestamptz<(args->'window'->>'end')::timestamptz;
  end if;
  if complete and j.source='maqsam' then
   insert into mahara_reporting.imports(namespace,run_id,source,scope,window_start,window_end,captured_at,record_count)
    values(ns,j.id||':'||j.run_at::text,'maqsam',j.location_id,(args->>'start')::timestamptz,(args->>'end')::timestamptz,stamp,(select count(*) from mahara_reporting.facts f where f.namespace=ns and f.source='maqsam' and f.kind='call' and (f.data->>'timestamp')::timestamptz>=(args->>'start')::timestamptz and (f.data->>'timestamp')::timestamptz<(args->>'end')::timestamptz and f.data->'agents' @> jsonb_build_array(jsonb_build_object('email',j.location_id)))) on conflict do nothing;
  end if;
  update mahara_reporting.sync_jobs set cursor=case when complete then '{}'::jsonb else args->'cursor' end,
   run_at=case when complete then null else run_at end,lease_owner=null,lease_until=null,error=null,failures=0,
   window_end=case when complete and j.source='maqsam' then (args->>'end')::timestamptz else window_end end,
   last_success=stamp,last_complete=case when complete then stamp else last_complete end,
   records=case when complete then 0 else records+jsonb_array_length(args->'records') end,pages=case when complete then 0 else pages+1 end,
   due_at=case when complete then stamp+case when kind='appointments_history' then interval '1 day' when kind in ('contacts','opportunities') then interval '10 minutes' else interval '1 minute' end else stamp end
   where sync_jobs.namespace=ns and id=j.id;
  return jsonb_build_object('accepted',jsonb_array_length(args->'records'),'complete',complete);
 elsif operation='status' then
  return jsonb_build_object('checkedAt',stamp,'jobs',(select coalesce(jsonb_agg(to_jsonb(s)-'namespace'-'cursor'-'lease_owner'),'[]') from mahara_reporting.sync_jobs s where s.namespace=ns),
   'counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select source,kind,data->>'locationId' as "locationId",count(*) as records from mahara_reporting.facts where facts.namespace=ns group by source,kind,data->>'locationId') x));
 elsif operation='sources' then
  -- Contact PII stays private. Reports receive only monthly facts and aggregate contact counts.
  select jsonb_build_object('records',(select coalesce(jsonb_agg(jsonb_build_object('source',f.source,'kind',f.kind,'id',f.data->>'id','data',f.data||jsonb_build_object('missingFromProvider',exists(select 1 from mahara_reporting.inventory inv where inv.namespace=f.namespace and inv.source=f.source and inv.kind=f.kind and inv.external_id=f.external_id and not inv.present)),'conflict',f.conflict)),'[]') from mahara_reporting.facts f where f.namespace=ns and f.source='ghl' and f.kind in ('appointment','opportunity','location','calendar')),
   'contacts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select data->>'locationId' as "locationId",count(*) as total,count(*) filter(where (data->>'createdAt')::timestamptz>=(args->>'start')::timestamptz and (data->>'createdAt')::timestamptz<(args->>'end')::timestamptz) as created from mahara_reporting.facts where facts.namespace=ns and source='ghl' and kind='contact' and not exists(select 1 from mahara_reporting.inventory inv where inv.namespace=ns and inv.source='ghl' and inv.kind='contact' and inv.external_id=facts.external_id and not inv.present) group by data->>'locationId') x)) into result;
  if jsonb_array_length(result->'records')>50000 then raise exception 'Report needs paginated aggregation'; end if;
  return result;
 else raise exception 'Unknown sync operation'; end if;
end $function$

