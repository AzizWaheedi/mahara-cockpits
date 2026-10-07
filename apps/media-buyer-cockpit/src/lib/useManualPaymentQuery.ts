import { useEffect, useState } from "react";
import { useCockpitAuth } from "../auth/SupabaseAuthProvider";
import { MANUAL_PAYMENTS_CHANGED } from "./ceoManualPaymentsClient";
/** Scoped read state with explicit errors and refresh after confirmed payment writes. */
export function useManualPaymentQuery(
  query: (args?: any) => Promise<any>,
  args?: any,
) {
  const auth = useCockpitAuth();
  const key = JSON.stringify([
    auth.session?.user.id,
    auth.isCeo,
    auth.ready,
    args ?? {},
  ]);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    query: typeof query;
    key: string;
    data: any;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    let sequence = 0;
    setState({ query, key, data: undefined, error: null });
    const load = async () => {
      const request = ++sequence;
      try {
        const data = await query(args);
        if (live && request === sequence)
          setState({ query, key, data, error: null });
      } catch (error) {
        const detail = (error as { data?: { message?: unknown } })?.data
          ?.message;
        if (live && request === sequence)
          setState({
            query,
            key,
            data: undefined,
            error:
              typeof detail === "string"
                ? detail
                : error instanceof Error
                  ? error.message
                  : "The payment log could not be loaded.",
          });
      }
    };
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener(MANUAL_PAYMENTS_CHANGED, refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener(MANUAL_PAYMENTS_CHANGED, refresh);
    };
  }, [query, key, version]);
  const own = state?.key === key && state.query === query ? state : null;
  return {
    data: own?.data,
    error: own?.error ?? null,
    retry: () => setVersion(v => v + 1),
  };
}
