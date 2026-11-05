/** Offline adapter contract only. No driver, credentials, endpoint or logging.
 * The injected gateway MUST own the database connection, commit before this
 * promise resolves, and enforce a separately durable replay/rate limit. A
 * rolled-back function call can otherwise expose answers without using quota.
 */
import type { Identity, Request as Binding } from './auth.ts';
import type { Snapshot } from './handler.ts';

export const READ_SOURCE_SQL = 'select native_research_private.read_source($1,$2,$3,$4,$5,$6,$7,$8) as snapshot';
type QueryResult = { rows: Array<{ snapshot: unknown }> };
type CommittedQuery = (sql: string, params: readonly unknown[], signal: AbortSignal) => Promise<QueryResult>;

export function committedSourcePort(queryCommitted: CommittedQuery) {
  return async (binding: Omit<Binding, 'capability'>, capability: string, identity: Identity, signal: AbortSignal): Promise<Snapshot | null> => {
    if (signal.aborted || !identity || typeof identity.runId !== 'string' || typeof identity.attempt !== 'string'
        || !/^[1-9][0-9]{0,19}$/.test(identity.runId)
        || !/^[1-9][0-9]{0,3}$/.test(identity.attempt)) return null;
    try {
      const result = await queryCommitted(READ_SOURCE_SQL,
        [capability, binding.taskId, binding.responseId, binding.schemaVersion, binding.commentId,
         binding.commentSha256, identity.runId, Number(identity.attempt)], signal);
      if (signal.aborted || !result || !Array.isArray(result.rows) || result.rows.length !== 1) return null;
      // The HTTP handler independently validates every field before use.
      const snapshot = result.rows[0]?.snapshot;
      return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot as Snapshot : null;
    } catch { return null; }
  };
}
