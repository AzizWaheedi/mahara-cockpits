export const IS_LEAD = `('roas-qualified' = any(coalesce(l.tags, '{}'::text[])) or 'roas-unqualified' = any(coalesce(l.tags, '{}'::text[])))`;
