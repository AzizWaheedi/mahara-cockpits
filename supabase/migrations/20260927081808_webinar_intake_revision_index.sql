-- Cover the complete event-revision foreign key identified by the database advisor.
create index cockpit_webinar_intakes_revision
  on public.cockpit_webinar_intakes(event_id,event_revision);
