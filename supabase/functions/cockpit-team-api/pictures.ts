import { isIP } from 'node:net';

export const BUCKET = 'team-docs';
export const MAX_BYTES = 10 * 1024 * 1024;
export const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const PATH = /^[a-z0-9][a-z0-9-]{0,80}\/\d{4}-(?:0[1-9]|1[0-2])\/[a-f0-9]{16,40}\.(png|jpg|gif|webp)$/;
const PUBLIC_ONLY = 'Only pictures on public HTTPS addresses can be copied in.';
export class PictureError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function imageType(type: string, bytes: number): string {
  if (!Object.hasOwn(TYPES, type)) throw new PictureError('Paste a PNG, JPEG, GIF or WebP picture.');
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new PictureError('Choose a nonempty picture with a valid byte count.');
  if (bytes > MAX_BYTES) throw new PictureError('That picture is over 10 MB. Paste a smaller one.');
  return TYPES[type];
}
export function validatePicturePath(meetingId: string, path: string): string {
  if (!PATH.test(path) || path.split('/')[0] !== meetingId) throw new PictureError('That is not one of this meeting’s pictures.');
  return path;
}
export function publicImageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new PictureError('That picture’s address is not a web address.'); }
  const host = url.hostname.toLowerCase();
  if (value.length > 8192 || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.endsWith('.') ||
      !/^[a-z0-9.-]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) throw new PictureError(PUBLIC_ONLY);
  url.hash = '';
  return url;
}
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    // Only global unicast; exclude transition/tunnelling and documentation ranges.
    const [first,second] = address.toLowerCase().split(':').map(x => parseInt(x || '0', 16));
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && !(first === 0x3fff && second < 0x1000);
  }
  return false;
}
export type Address = { address: string; family: number };
export function validateAddresses(addresses: Address[]): Address[] {
  if (!addresses.length || addresses.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new PictureError(PUBLIC_ONLY);
  return addresses;
}
export function validateMetadata(metadata: Record<string, unknown>, contentType: string, expectedBytes: number) {
  const bytes = Number(metadata.size);
  const type = String(metadata.mimetype ?? metadata.contentType ?? '');
  imageType(type, bytes);
  if (type !== contentType || bytes !== expectedBytes) throw new PictureError('The uploaded picture does not match its reservation. Upload it again.');
  return { bytes, contentType: type };
}
export function validateImageBytes(bytes: Uint8Array, type: string): void {
  imageType(type, bytes.length);
  const has = (at: number, signature: number[]) => signature.every((b, i) => bytes[at + i] === b);
  const text = (at: number, value: string) => has(at, [...value].map(c => c.charCodeAt(0)));
  const valid = type === 'image/png' ? has(0,[137,80,78,71,13,10,26,10]) :
    type === 'image/jpeg' ? has(0,[255,216,255]) :
    type === 'image/gif' ? text(0,'GIF87a') || text(0,'GIF89a') :
    type === 'image/webp' ? text(0,'RIFF') && text(8,'WEBP') : false;
  if (!valid) throw new PictureError('The file content is not the claimed picture type.');
}
export async function readImageBody(stream: ReadableStream<Uint8Array> | null, limit = MAX_BYTES): Promise<Uint8Array> {
  if (!stream) throw new PictureError('The picture response was empty.');
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new PictureError('That picture is over 10 MB. Paste a smaller one.');
      parts.push(value);
    }
    if (!size) throw new PictureError('The picture response was empty.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export type ImageBytes = { bytes: Uint8Array; contentType: string };
export async function readImageResponse(response: Response): Promise<ImageBytes> {
  try {
    // Reject redirects rather than trusting a transport to revalidate each hop.
    if (response.status !== 200) throw new PictureError(response.status >= 300 && response.status < 400 ? 'Picture redirects are not allowed. Paste the final public image address.' : 'That picture could not be fetched.');
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') throw new PictureError('Compressed picture responses are not supported.');
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    imageType(contentType, 1);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new PictureError('That picture is over 10 MB or has an invalid size.');
    const bytes = await readImageBody(response.body);
    if (declared !== null && Number(declared) !== bytes.length) throw new PictureError('The picture response was incomplete.');
    validateImageBytes(bytes, contentType);
    return { bytes, contentType };
  } finally { await response.body?.cancel().catch(() => {}); }
}
