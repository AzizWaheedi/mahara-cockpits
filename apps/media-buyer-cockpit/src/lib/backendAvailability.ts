export type BackendAvailability = "up" | "down" | "offline";

export const CREATIVE_TRIAGE_ORIGIN =
  "https://bldgtotkfmhoxmlzowdx.supabase.co";

/**
 * Probes the cockpit backend function method guard.
 *
 * Sends a harmless GET to /functions/v1/cockpit-media-api with the public anon key.
 * The function allows only POST/OPTIONS requests; a responding function responds HTTP 405.
 * Only HTTP 405 confirms the method guard and that the service is up.
 * HTTP 401, 404, 500, or other statuses mean down.
 * Missing or wrong configuration is down without firing any request.
 * Network failure is offline.
 */
export async function probeCockpitBackend(
  url?: string | null,
  anonKey?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<BackendAvailability> {
  const trimmedUrl = url?.trim();
  const trimmedKey = anonKey?.trim();

  if (!trimmedUrl || !trimmedKey) {
    return "down";
  }

  let parsed: URL;
  try { parsed = new URL(trimmedUrl); } catch { return "down"; }
  if (parsed.origin !== CREATIVE_TRIAGE_ORIGIN) return "down";
  try {
    const endpoint = `${parsed.origin}/functions/v1/cockpit-media-api`;
    const res = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        apikey: trimmedKey,
        Authorization: `Bearer ${trimmedKey}`,
      },
    });

    if (res.status === 405) {
      return "up";
    }
    return "down";
  } catch {
    return "offline";
  }
}
