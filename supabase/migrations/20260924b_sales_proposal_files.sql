-- Where the AI sales proposals are kept: a private bucket, readable by a
-- sales seat, written only by the worker with the service key.
--
-- A proposal carries a client's name, numbers and quotes from their call,
-- so the bucket is never public and a link is never shared from it. A rep
-- reads the file through their own session; a client gets the PDF the
-- closer sends.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-proposals',
  'sales-proposals',
  false,
  20971520,
  array['text/html', 'application/pdf', 'application/json']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sales_proposals_seat_read on storage.objects;
create policy sales_proposals_seat_read on storage.objects
  for select to authenticated
  using (bucket_id = 'sales-proposals' and public.cockpit_sales_seat());

commit;
