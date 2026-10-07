// Small helpers shared by the door's modules: control-character stripping,
// redaction (the same rules as sales-api's lib.ts redact) and a fetch with a
// deadline.

// These characters are exactly what must never reach a stored or shown value.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Control characters become spaces. */
export function stripControl(s: string): string {
  return s.replace(CONTROL, " ");
}

/**
 * Strips anything shaped like a key or token, and caps the length. A Zoom
 * host's start link (/s/ or /wc/.../start) goes whole and a zak= token goes,
 * as sales-api's redactRoom and redact do (contract-v2 section 9).
 */
export function redact(s: unknown): string {
  return String(s)
    .replace(/https?:\/\/[^\s"'<>]*zoom(?:gov)?\.(?:us|com)\/(?:s\/|wc\/[^\s"'<>]*\/start)[^\s"'<>]*/gi, "[host link]")
    .replace(/([?&;#](?:z|%7a|%5a)(?:a|%61|%41)(?:k|%6b|%4b)=)[^&\s"'<>]+/gi, "$1[key]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[key]")
    .replace(/sbp_[A-Za-z0-9]+/g, "[key]")
    .replace(/pit-[A-Za-z0-9-]+/g, "[key]")
    .replace(/xox[abposr]-[A-Za-z0-9-]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/((?:api_?key|access_token|token|secret|(?:z|%7a|%5a)(?:a|%61|%41)(?:k|%6b|%4b)|pwd)=)[^&\s"']+/gi, "$1[key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [key]")
    .slice(0, 300);
}

export class Timeout extends Error {
  constructor(readonly ms: number) {
    super(`no answer within ${ms} ms`);
  }
}

/** fetch that gives up after `ms`, as a Timeout error. */
export async function fetchWithin(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetcher(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new Timeout(ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetch plus reading the body, both inside the same `ms`: a server that
 * sends its headers and then stalls cannot hold the caller past its budget.
 */
export async function fetchTextWithin(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  ms: number,
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetcher(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    if (ctl.signal.aborted) throw new Timeout(ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
