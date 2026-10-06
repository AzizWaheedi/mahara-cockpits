import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { checkServerIdentity } from 'node:tls';
import { PictureError, publicImageUrl, readImageResponse, validateAddresses, type ImageBytes } from './pictures.ts';

type Health = { provider: string; resource: string; phase: 'intent' | 'response' | 'failed'; http_status?: number };
export type ImportedPicture = { bytes: Uint8Array; contentType: string; host: string };
export function pictureTools(health: (row: Health) => Promise<void>) {
  return {
    async storage<T>(resource: string, run: () => Promise<T>): Promise<T> {
      // Labels only: never signed URLs, tokens, upstream errors or source query strings.
      const receipt = { provider: 'supabase-storage', resource };
      await health({ ...receipt, phase: 'intent' });
      try {
        const result = await run();
        await health({ ...receipt, phase: 'response' });
        return result;
      } catch (error) {
        await health({ ...receipt, phase: 'failed' });
        if (error instanceof PictureError) throw error;
        throw new PictureError('Picture storage could not confirm the operation. Retry with the same request.');
      }
    },
    async download(value: string): Promise<ImportedPicture> {
      const url = publicImageUrl(value);
      const receipt = { provider: 'image-import', resource: url.hostname };
      await health({ ...receipt, phase: 'intent' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const addresses = validateAddresses(await Promise.race([
          lookup(url.hostname, { all: true, verbatim: true }),
          new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new PictureError('The picture request timed out.')), { once: true })),
        ]));
        // Pin the connection to one already-vetted answer; no second DNS lookup,
        // redirects, environment proxy, cookie jar, automatic retries or shared agent.
        const address = addresses.find(a => a.family === 4) ?? addresses[0];
        const result = await new Promise<ImageBytes>((resolve, reject) => {
          const request = httpsRequest({
            protocol: 'https:', hostname: address.address, port: 443,
            path: url.pathname + url.search,
            method: 'GET', agent: false, signal: controller.signal,
            autoSelectFamily: false, family: address.family,
            servername: url.hostname, rejectUnauthorized: true,
            checkServerIdentity: (_hostname, certificate) => checkServerIdentity(url.hostname, certificate),
            headers: { Host: url.host, Accept: 'image/png,image/jpeg,image/gif,image/webp', 'Accept-Encoding': 'identity' },
          }, response => {
            void (async () => {
              const status = response.statusCode ?? 0;
              await health({ ...receipt, phase: 'response', http_status: status });
              const headers = new Headers();
              for (const [name, value] of Object.entries(response.headers)) {
                if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
              }
              const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
              // Response disallows a body on these statuses; still reject them.
              if ([204,205,304].includes(status)) {
                response.destroy();
                resolve(await readImageResponse(new Response(null, { status, headers })));
              } else {
                resolve(await readImageResponse(new Response(body, { status, headers })));
              }
            })().catch(error => { response.destroy(); reject(error); });
          });
          request.on('socket', socket => {
            socket.prependOnceListener('secureConnect', () => {
              // Confirm that the transport connected to the pinned IP.
              const remote = socket.remoteAddress?.replace(/^::ffff:/, '');
              if (remote !== address.address) request.destroy(new PictureError('The picture connection did not use its verified public address.'));
            });
          });
          request.on('error', reject);
          request.end();
        });
        return { ...result, host: url.hostname };
      } catch (error) {
        await health({ ...receipt, phase: 'failed' });
        if (error instanceof PictureError) throw error;
        throw new PictureError(controller.signal.aborted ? 'The picture request timed out.' : 'The picture could not be read from its public address.');
      } finally { clearTimeout(timeout); }
    },
  };
}
