/** node-postgres 8.21+ adapter, offline candidate. No pool, credential, server,
 * environment variable or network endpoint is created here. The owning service
 * must construct a verified-TLS pool with finite connection/query timeouts and
 * keep both this object and its database credentials inaccessible to callers.
 */
import type { GatewayConnection, OwnedPool } from './gateway.ts';

type PgResult = { rows: Array<Record<string, unknown>>; command?: string };
type PgClient = {
  query: (config: {text:string; values?:unknown[]; query_timeout?:number}) => Promise<PgResult>;
  getTransactionStatus: () => string | null;
  release: (destroy?: boolean) => void;
  connection?: { stream?: { encrypted?: boolean; authorized?: boolean; servername?: string } };
};
type PgPool = { connect: () => Promise<PgClient>; on: (name:string, listener:()=>void) => unknown };
const ownedPools = new WeakSet<object>();
export function isNarrowNodePgPool(pool: unknown): pool is OwnedPool {
  return !!pool && typeof pool === 'object' && ownedPools.has(pool);
}

const IDENTITY_SQL = `select session_user::text as login, current_user::text as active,
 r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
 (select count(*)::int from pg_catalog.pg_auth_members m where m.member=r.oid) as membership_count,
 exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles x on x.oid=m.roleid
   where m.member=r.oid and x.rolname='cockpit_native_research_reader' and not m.admin_option) as reader_member,
 exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname not in ('pg_catalog','information_schema')
 and case when c.relkind in ('r','p','v','m','f') then
   (has_schema_privilege(session_user,n.oid,'USAGE') and has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))
   or (has_schema_privilege('cockpit_native_research_reader',n.oid,'USAGE') and has_table_privilege('cockpit_native_research_reader',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
   else false end) as direct_table_access,
 exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname not in ('pg_catalog','information_schema')
 and case when c.relkind='S' then
   (has_schema_privilege(session_user,n.oid,'USAGE') and has_sequence_privilege(session_user,c.oid,'USAGE,UPDATE'))
   or (has_schema_privilege('cockpit_native_research_reader',n.oid,'USAGE') and has_sequence_privilege('cockpit_native_research_reader',c.oid,'USAGE,UPDATE'))
   else false end) as direct_sequence_access,
 (select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and (n.nspname,c.relname) in
 (('public','cockpit_form_responses'),('public','cockpit_form_invites'),('public','cockpit_form_effects'),
 ('public','cockpit_clickup_writeback_queue'),('public','cockpit_form_versions'),('public','cockpit_settings'),
 ('native_research_private','capabilities'),('native_research_private','settings'),('native_research_private','gateway_quotas'))) as protected_table_count,
 exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname not in ('pg_catalog','information_schema') and p.prosecdef and p.prorettype <> 'pg_catalog.trigger'::regtype
 and ((has_function_privilege(session_user,p.oid,'EXECUTE') and has_schema_privilege(session_user,n.oid,'USAGE'))
   or (has_function_privilege('cockpit_native_research_reader',p.oid,'EXECUTE') and has_schema_privilege('cockpit_native_research_reader',n.oid,'USAGE')
     and not (n.nspname='native_research_private' and p.proname in ('read_source','reserve_source')
       and pg_catalog.oidvectortypes(p.proargtypes)='text, text, uuid, integer, text, text, text, integer'
       and p.prorettype='pg_catalog.jsonb'::regtype)))) as callable_definer,
 current_setting('log_statement') as log_statement,
 current_setting('log_min_duration_statement') as log_min_duration,
 current_setting('log_parameter_max_length_on_error') as log_error_parameters
 from pg_catalog.pg_roles r where r.rolname=session_user`;

/** Wraps an exclusively owned pg.Pool. Never hand this pool to request handlers. */
export function nodePostgresOwnedPool(pool: PgPool, expectedLogin: string, tlsHostname: string): OwnedPool {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.on !== 'function'
      || !/^[a-z][a-z0-9_]{1,62}$/.test(expectedLogin)
      || ['postgres','service_role','anon','authenticated','supabase_admin','authenticator'].includes(expectedLogin)
      || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(tlsHostname) || !tlsHostname.includes('.')) throw new Error('Reader unavailable');
  // pg pools emit asynchronous idle-client errors. Never log provider content.
  pool.on('error', () => {});
  const owned: OwnedPool = {
    acquire: async (signal): Promise<GatewayConnection> => {
      if (signal.aborted) throw new Error('Reader unavailable');
      let client: PgClient | undefined; let released = false; let aborted = false;
      let rejectAbort: (() => void) | undefined;
      const destroy = () => { if (client && !released) { released=true; try { client.release(true); } catch {} } };
      const onAbort = () => { aborted=true; destroy(); rejectAbort?.(); };
      signal.addEventListener('abort', onAbort, {once:true});
      if (signal.aborted) onAbort();
      const acquireTimer=setTimeout(onAbort,3000);
      let pending: Promise<PgClient> | undefined;
      try {
        pending = pool.connect();
        client = await Promise.race([pending, new Promise<never>((_,reject)=>{ rejectAbort=()=>reject(new Error('Reader unavailable')); if (aborted) rejectAbort(); })]);
        clearTimeout(acquireTimer);
        if (aborted || signal.aborted) throw new Error('Reader unavailable');
        const stream=client.connection?.stream;
        if (stream?.encrypted !== true || stream.authorized !== true || stream.servername !== tlsHostname
            || typeof client.getTransactionStatus !== 'function') throw new Error('Reader unavailable');
        const run = async (text:string, values:readonly unknown[], runSignal:AbortSignal):Promise<PgResult> => {
          if (released || runSignal.aborted) throw new Error('Reader unavailable');
          let abortHandler=()=>{};
          const canceled=new Promise<never>((_,reject)=>{ abortHandler=()=>{destroy();reject(new Error('Reader unavailable'));}; runSignal.addEventListener('abort',abortHandler,{once:true}); });
          try {
            const result=await Promise.race([client!.query({text,values:[...values],query_timeout:5000}),canceled]);
            if (runSignal.aborted || released) throw new Error('Reader unavailable');
            return result;
          } finally { runSignal.removeEventListener('abort',abortHandler); }
        };
        // First query also advances pg's initial null transaction status to I.
        const info=await run(IDENTITY_SQL,[],signal);
        if (client.getTransactionStatus() !== 'I' || info.rows.length !== 1) throw new Error('Reader unavailable');
        const i=info.rows[0];
        if (i.login !== expectedLogin || i.active !== expectedLogin || i.rolcanlogin !== true || i.rolinherit !== false
          || i.rolsuper !== false || i.rolcreaterole !== false || i.rolcreatedb !== false || i.rolreplication !== false || i.rolbypassrls !== false
          || i.membership_count !== 1 || i.reader_member !== true || i.protected_table_count !== 9
          || i.direct_table_access !== false || i.direct_sequence_access !== false || i.callable_definer !== false
          || !['none','ddl'].includes(String(i.log_statement)) || i.log_min_duration !== '-1' || i.log_error_parameters !== '0') throw new Error('Reader unavailable');
        await run('SET ROLE cockpit_native_research_reader',[],signal);
        if (client.getTransactionStatus() !== 'I') throw new Error('Reader unavailable');
        signal.removeEventListener('abort',onAbort);
        return {
          idle:true,
          execute: async (text,values,runSignal) => run(text,values,runSignal),
          release: async ({discard}) => {
            if (released) return;
            if (discard || client!.getTransactionStatus() !== 'I') { destroy(); return; }
            try {
              await run('RESET ROLE',[],new AbortController().signal);
              if (client!.getTransactionStatus() !== 'I') throw new Error('Reader unavailable');
              released=true; client!.release();
            } catch { destroy(); throw new Error('Reader unavailable'); }
          },
        };
      } catch {
        clearTimeout(acquireTimer);
        signal.removeEventListener('abort',onAbort);
        if (!client && aborted && pending) void pending.then(late=>{ try { late.release(true); } catch {} }).catch(()=>{});
        destroy(); throw new Error('Reader unavailable');
      }
    },
  };
  ownedPools.add(owned);
  return owned;
}
