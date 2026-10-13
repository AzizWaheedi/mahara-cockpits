/**
 * Maqsam, read only, for call recordings. The same receipt pattern as
 * cockpit-csm-api/tools.ts: an intent row before the call, a response row
 * with the HTTP status after it, an unknown row when it never answered. The
 * rows go to public.cockpit_csm_provider_health (provider 'maqsam'), which the
 * native monitor already reads; the resource is generic and never carries the
 * signed link, so the ledger can never leak it.
 */
export type HealthRow = {
  provider: "maqsam";
  method: "GET";
  resource: "v3/recording/id" | "storage/recording";
  phase: "intent" | "response" | "unknown";
  http_status?: number | null;
  object_id?: string | null;
};
export type Health = (row: HealthRow) => Promise<void>;

const API = "https://api.mq.maqsam.com/v3/recording/id/";
/** The only hosts a recording may stream from (as the client portal allows). */
export const STORAGE_HOSTS = ["storage.mq.maqsam.com", "storage.maqsam.com"];

/** The signed link when it is https on a Maqsam storage host, else "". */
export function safeRecordingUrl(raw: unknown): string {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" &&
      STORAGE_HOSTS.includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.port
      ? u.href
      : "";
  } catch {
    return "";
  }
}

export class ProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function maqsamRecordings(
  creds: { key: string; secret: string },
  health: Health,
  request: typeof fetch = fetch,
) {
  if (!creds.key || !creds.secret)
    throw new ProviderError(
      "Recordings are not connected yet: the Maqsam keys are missing on the server. Tell the CEO.",
      503,
    );
  const auth = `Basic ${btoa(`${creds.key}:${creds.secret}`)}`;
  return {
    /** Maqsam's short-lived signed link for one call, checked against the allow-list. */
    async signedUrl(callId: string): Promise<string> {
      if (!/^[0-9]{1,20}$/.test(callId))
        throw new ProviderError("Choose a call to play.", 400);
      const row = {
        provider: "maqsam",
        method: "GET",
        resource: "v3/recording/id",
        object_id: callId,
      } as const;
      await health({ ...row, phase: "intent" });
      let res: Response;
      try {
        res = await request(`${API}${callId}?return_url=true`, {
          headers: { Authorization: auth, Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        await health({ ...row, phase: "unknown" });
        throw new ProviderError(
          "Maqsam did not answer. Try again in a minute.",
          502,
        );
      }
      await health({ ...row, phase: "response", http_status: res.status });
      if (res.status === 404) {
        await res.body?.cancel();
        throw new ProviderError("Maqsam has no recording of this call.", 404);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new ProviderError(
          `Maqsam would not give the recording (${res.status}). Try again in a minute.`,
          502,
        );
      }
      const data = (await res.json().catch(() => null)) as {
        result?: unknown;
        message?: { url?: unknown };
      } | null;
      const url =
        data?.result === "success" ? safeRecordingUrl(data.message?.url) : "";
      if (!url)
        throw new ProviderError(
          "Maqsam sent a recording link the cockpit does not trust, so it was not played.",
          502,
        );
      return url;
    },

    /** The audio itself, with the browser's Range passed on. No credentials go to storage. */
    async audio(
      url: string,
      callId: string,
      range: string | null,
    ): Promise<Response> {
      if (!safeRecordingUrl(url))
        throw new ProviderError(
          "Maqsam sent a recording link the cockpit does not trust, so it was not played.",
          502,
        );
      const row = {
        provider: "maqsam",
        method: "GET",
        resource: "storage/recording",
        object_id: callId,
      } as const;
      await health({ ...row, phase: "intent" });
      let res: Response;
      try {
        res = await request(url, {
          headers: range ? { Range: range } : {},
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        await health({ ...row, phase: "unknown" });
        throw new ProviderError(
          "The recording could not be fetched. Press play again.",
          502,
        );
      }
      await health({ ...row, phase: "response", http_status: res.status });
      return res;
    },
  };
}
