// Typeform signs every webhook delivery: the Typeform-Signature header is
// "sha256=" + base64(HMAC-SHA256(secret, raw body)). Checked before anything
// in the body is trusted. Web Crypto only, so it runs in Deno and in bun.

const enc = new TextEncoder();

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function typeformSignature(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return `sha256=${btoa(bin)}`;
}

export async function signedByTypeform(secret: string | undefined, rawBody: string, header: string | null): Promise<boolean> {
  if (!secret || secret.length < 16 || !header || !header.startsWith("sha256=")) return false;
  return sameText(await typeformSignature(secret, rawBody), header.trim());
}
