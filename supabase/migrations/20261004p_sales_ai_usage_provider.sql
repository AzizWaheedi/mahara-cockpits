-- Which provider answered each of the sales desk's model calls (2026-10-04).
-- Proposals now draft through a fallback (SALES_MODEL_FALLBACK, OpenAI's gpt-5
-- on the VPS) when the primary (the Claude proxy on the VPS) cannot answer, so
-- a usage row has to say which one it was: "opus" through the VPS plan costs no
-- API credit, gpt-5 through OpenAI does.
--
-- The desk writes the column when it exists and, until this is applied, puts
-- the provider inside `model` instead ("openai:gpt-5"),
-- so no call goes uncounted either way. Existing rows keep provider null: they
-- were written before the desk said, and the model names them (opus = vps,
-- gpt-5-* = openai). The table's row security and grants are unchanged: seats
-- read it, the service key writes it.

begin;

alter table public.cockpit_sales_ai_usage add column if not exists provider text;

comment on column public.cockpit_sales_ai_usage.provider is
  'The provider that answered: vps, openai, anthropic or openrouter (null before 2026-10-04).';

notify pgrst, 'reload schema';

commit;
