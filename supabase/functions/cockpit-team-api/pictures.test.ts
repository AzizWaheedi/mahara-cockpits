import { expect, test } from 'bun:test';
import { MAX_BYTES, imageType, publicImageUrl, publicAddress, validateAddresses, validatePicturePath, validateImageBytes, readImageBody, readImageResponse, validateMetadata } from './pictures';

test('only exact supported image MIME types and positive bounded sizes pass', () => {
  expect(imageType('image/png', MAX_BYTES)).toBe('png');
  for (const size of [0, -1, NaN, 1.1, MAX_BYTES + 1]) expect(() => imageType('image/png', size)).toThrow();
  expect(() => imageType('image/svg+xml', 12)).toThrow();
  expect(() => imageType('image/png; charset=utf8', 12)).toThrow();
});
test('URLs reject credentials, IP encodings, local names, ports and non-HTTPS', () => {
  for (const value of ['http://example.com/a', 'https://user:secret@example.com/a', 'https://127.1/a', 'https://2130706433/a', 'https://0x7f000001/a', 'https://[::1]/a', 'https://foo.internal/a', 'https://localhost./a', 'https://example.com:444/a', 'https://intranet/a', 'https://metadata.google.internal/a']) {
    expect(() => publicImageUrl(value)).toThrow();
  }
  expect(publicImageUrl('https://images.example.com/a.png?signature=secret').hostname).toBe('images.example.com');
});
test('DNS rejects private, mapped, reserved and mixed answers, not just literal hosts', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.2','169.254.169.254','100.100.100.200','0.0.0.0','224.0.0.1','192.0.0.1','198.18.0.1','203.0.113.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::']) expect(publicAddress(address)).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  expect(() => validateAddresses([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])).toThrow();
  expect(() => validateAddresses([])).toThrow();
});
test('paths match the exact meeting, not prefix or sanitized collision', () => {
  const path = 'daily/2026-10/0123456789abcdef0123456789abcdef.png';
  expect(validatePicturePath('daily', path)).toBe(path);
  for (const meeting of ['daily-other','DAILY','../daily']) expect(() => validatePicturePath(meeting, path)).toThrow();
  expect(() => validatePicturePath('daily', 'daily/../secret.png')).toThrow();
});
test('metadata must match both the reserved MIME and actual positive byte count', () => {
  expect(validateMetadata({ size: 20, mimetype: 'image/png' }, 'image/png', 20)).toEqual({ bytes: 20, contentType: 'image/png' });
  for (const metadata of [{ size: 21, mimetype: 'image/png' }, { size: 20, mimetype: 'image/jpeg' }, { size: 0, mimetype: 'image/png' }, {}]) expect(() => validateMetadata(metadata, 'image/png', 20)).toThrow();
});
test('image signatures cannot be replaced by HTML with a forged MIME', () => {
  expect(() => validateImageBytes(new TextEncoder().encode('<html>bad</html>'), 'image/png')).toThrow();
  validateImageBytes(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]), 'image/png');
});
test('bounded streaming stops at the size ceiling and cancels the source', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } });
  await expect(readImageBody(stream, 10)).rejects.toThrow('10 MB');
  expect(cancelled).toBe(true);
});
test('bounded streaming rejects empty and returns only real bytes', async () => {
  await expect(readImageBody(new ReadableStream({ start(c) { c.close(); } }))).rejects.toThrow();
  const value = await readImageBody(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2,3])); c.close(); } }));
  expect([...value]).toEqual([1,2,3]);
});
test('redirects never get followed and invalid response headers fail before reading', async () => {
  for (const status of [301,302,303,307,308]) {
    await expect(readImageResponse(new Response(null, { status, headers: { Location: 'https://127.0.0.1/secret' } }))).rejects.toThrow('redirects');
  }
  await expect(readImageResponse(new Response('bad', { headers: { 'Content-Type': 'text/html' } }))).rejects.toThrow('PNG');
  await expect(readImageResponse(new Response(null, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_BYTES + 1) } }))).rejects.toThrow('10 MB');
  await expect(readImageResponse(new Response(null, { headers: { 'Content-Type': 'image/png', 'Content-Encoding': 'gzip' } }))).rejects.toThrow('Compressed');
});
test('response byte count and image signature are checked after bounded streaming', async () => {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const valid = await readImageResponse(new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': '12' } }));
  expect(valid.bytes).toEqual(bytes);
  await expect(readImageResponse(new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': '13' } }))).rejects.toThrow('incomplete');
});
