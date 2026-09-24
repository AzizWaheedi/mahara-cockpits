import { SUPABASE_URL, supabase } from "./supabase";

/**
 * Every change goes through the sales-api function, never straight into a
 * table: it checks the seat, writes the audit row, and is the only thing
 * that talks to HighLevel. The session the cockpit already holds is the
 * proof of who is asking.
 *
 * Throws a sentence a person can act on; the server writes those.
 */
export async function api<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again.");
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/sales-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, action }),
    });
  } catch {
    throw new Error(
      "The cockpit could not reach its server. Check the connection and try again.",
    );
  }
  const out = (await res.json().catch(() => null)) as
    | ({ ok?: boolean; error?: string } & T)
    | null;
  if (!res.ok || !out?.ok)
    throw new Error(
      out?.error ?? `The server answered ${res.status}. Try again.`,
    );
  return out as T;
}
