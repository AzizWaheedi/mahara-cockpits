/** Composition only. No server, endpoint, credentials or activation switch.
 * Publication is not fenced, so even a correctly configured pool stays held.
 */
import {candidateHandler} from './handler.ts';
import {committedGateway} from './gateway.ts';
import {committedSourcePort} from './source-port.ts';
import {isNarrowNodePgPool} from './pg-driver.ts';

type ReaderConfig = NonNullable<Parameters<typeof candidateHandler>[0]>;
type ReaderPorts = NonNullable<Parameters<typeof candidateHandler>[1]>;
type IdentityPorts = Pick<ReaderPorts,'githubKeys'|'comment'|'permit'>;

/** The only assembled entry point is hard-disabled until the publication fence exists. */
export function heldNativeReader(config:ReaderConfig, ports:IdentityPorts, pool:unknown) {
  if (!isNarrowNodePgPool(pool)) return candidateHandler(null,null);
  const read=committedSourcePort(committedGateway(pool));
  return candidateHandler({...config,enabled:false},{...ports,readAtomic:read,recheckAtomic:read});
}
