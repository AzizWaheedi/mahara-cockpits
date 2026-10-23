create schema portal_data;
 create table public.cockpit_board_clients(location_id text primary key,clickup_id text,client_name text);
 create table portal_data.appointments(location_id text,appointment_id text,contact_id text,start_at timestamptz,calendar_id text,deleted_at timestamptz,ad_name text,campaign_name text,primary key(location_id,appointment_id));
 create table portal_data.contacts(location_id text,contact_id text,name text,primary key(location_id,contact_id));
 create table portal_data.appointment_outcomes(location_id text,appointment_id text,revision bigint,attendance text,deal text,lead_quality numeric,feedback text,consultation_feedback text,not_closed_reason text,captured_at timestamptz default now(),source text,request_id text,quotation boolean,project_value numeric,currency text,source_record_id text,source_updated_at timestamptz,primary key(location_id,appointment_id,revision));
 create table portal_data.outbox(location_id text,request_id text,operation text,object_id text,expected_revision text,state text,payload jsonb,next_attempt_at timestamptz,created_at timestamptz,last_error text);
 create table portal_data.journey_outcome_bindings(location_id text,appointment_id text,revision bigint,start_at timestamptz,contact_id text);
 insert into public.cockpit_board_clients values('locA','taskA','Client A'),('locB','taskB','Client B');
 insert into portal_data.appointments values('locA','same-id','leadA','2026-10-20T10:00Z',null,null,'Ad A','Campaign A'),('locB','same-id','leadB','2026-10-20T10:00Z',null,null,null,null);
 insert into portal_data.contacts values('locA','leadA','Fictional A'),('locB','leadB','Fictional B');
 insert into portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,lead_quality,feedback,source,request_id) values
 ('locA','same-id',1,'showed',7,'Original client words','portal-capture',null),
 ('locA','same-id',2,null,9,'ملاحظة العميل','portal','req2'),
 ('locA','same-id',3,null,null,'STALE CAPTURE MUST NOT REPLACE','reporting-capture',null),
 ('locA','same-id',4,'no_show',1,'UNBOUND MUST NOT APPEAR','portal','missing'),
 ('locB','same-id',1,'no_show',10,'Other client words','portal-capture',null);
 insert into portal_data.journey_outcome_bindings select location_id,appointment_id,revision,'2026-10-20T10:00Z',case when location_id='locA' then 'leadA' else 'leadB' end from portal_data.appointment_outcomes;
 insert into portal_data.outbox(location_id,request_id,operation,object_id,expected_revision,state) values('locA','req2','appointment-outcome','same-id','2','pending');
 