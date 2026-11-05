/** Local, unconfigured transaction boundary. The service alone owns this pool;
 * never expose a connection, credential or this internal adapter to callers.
 * The pool must lease an exclusive idle connection; its driver must honor
 * cancellation and finite connection/query/rollback limits.
 */
import { READ_SOURCE_SQL } from './source-port.ts';

const RESERVE_SQL = 'select native_research_private.reserve_source($1,$2,$3,$4,$5,$6,$7,$8) as admission';
const ROLE_SQL = 'select current_user as role';
type Result = { rows: Array<Record<string, unknown>>; command?: string };
export type GatewayConnection = {
  idle: boolean;
  execute: (sql: string, params: readonly unknown[], signal: AbortSignal) => Promise<Result>;
  release: (options: { discard: boolean }) => Promise<void> | void;
};
export type OwnedPool = { acquire: (signal: AbortSignal) => Promise<GatewayConnection> };

/** Returns the exact committed-query interface consumed by source-port.ts. */
export function committedGateway(pool: OwnedPool) {
  return async (sql: string, params: readonly unknown[], signal: AbortSignal): Promise<{rows: Array<{snapshot: unknown}>}> => {
    if (signal.aborted || sql !== READ_SOURCE_SQL || !Array.isArray(params) || params.length !== 8) throw new Error('Reader unavailable');
    let conn: GatewayConnection | undefined;
    let inTransaction = false;
    let discard = true;
    const execute = async (statement: string, values: readonly unknown[] = []) => {
      if (signal.aborted) throw new Error('Reader unavailable');
      const result = await conn!.execute(statement, values, signal);
      if (signal.aborted) throw new Error('Reader unavailable');
      return result;
    };
    try {
      conn = await pool.acquire(signal);
      if (signal.aborted || conn.idle !== true) throw new Error('Reader unavailable');
      const role = await execute(ROLE_SQL);
      if (role.rows.length !== 1 || role.rows[0]?.role !== 'cockpit_native_research_reader') throw new Error('Reader unavailable');
      // A separate, committed transaction consumes durable admission before
      // any source answer is read. No automatic retry follows an uncertain commit.
      const reserveBegin = await execute('BEGIN'); inTransaction = true;
      if (reserveBegin.command !== 'BEGIN') throw new Error('Reader unavailable');
      const reserved = await execute(RESERVE_SQL, params);
      const admission = reserved.rows.length === 1 ? reserved.rows[0]?.admission : null;
      if (!admission || typeof admission !== 'object' || Array.isArray(admission)
          || Object.keys(admission).sort().join(',') !== 'admitted,reservation'
          || (admission as {admitted?: unknown}).admitted !== true
          || !Number.isInteger((admission as {reservation?: unknown}).reservation)
          || Number((admission as {reservation: number}).reservation) < 1
          || Number((admission as {reservation: number}).reservation) > 6) throw new Error('Reader unavailable');
      const reserveCommit = await execute('COMMIT');
      if (reserveCommit.command !== 'COMMIT') throw new Error('Reader unavailable');
      inTransaction = false;
      // The source result stays in server memory until COMMIT has succeeded.
      const sourceBegin = await execute('BEGIN'); inTransaction = true;
      if (sourceBegin.command !== 'BEGIN') throw new Error('Reader unavailable');
      const result = await execute(READ_SOURCE_SQL, params);
      if (!Array.isArray(result.rows) || result.rows.length !== 1 || !('snapshot' in result.rows[0])) throw new Error('Reader unavailable');
      const sourceCommit = await execute('COMMIT');
      if (sourceCommit.command !== 'COMMIT') throw new Error('Reader unavailable');
      inTransaction = false;
      discard = false;
      return { rows: [{ snapshot: result.rows[0].snapshot }] };
    } catch {
      if (conn && inTransaction) {
        try { await conn.execute('ROLLBACK', [], new AbortController().signal); } catch { /* discard connection */ }
      }
      // A lost response to COMMIT may have committed; never retry automatically.
      throw new Error('Reader unavailable');
    } finally {
      if (conn) { try { await conn.release({ discard }); } catch { throw new Error('Reader unavailable'); } }
    }
  };
}
