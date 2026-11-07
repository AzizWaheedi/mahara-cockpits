-- ClickUp is the source of truth. NULL means no priority or not yet synced.
ALTER TABLE public.editor_jobs ADD COLUMN IF NOT EXISTS priority text;
COMMENT ON COLUMN public.editor_jobs.priority IS 'ClickUp task priority: urgent, high, normal or low. Synced by the editor desk.';
