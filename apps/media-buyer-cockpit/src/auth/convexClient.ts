import { ConvexReactClient } from "convex/react";

class NullConvexClient {
  watchQuery() {
    return {
      onUpdate: () => () => {},
      localQueryResult: () => undefined,
      localQueryLogs: () => undefined,
      journal: undefined,
    };
  }
  query() {
    return Promise.resolve(undefined);
  }
  mutation() {
    const fn = (() => Promise.resolve(null)) as unknown as {
      (): Promise<unknown>;
      withOptimisticUpdate: () => unknown;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  }
  action() {
    return () => Promise.resolve(null);
  }
  connectionState() {
    return { isConnected: false, hasInflightRequests: false };
  }
  subscribeToConnectionState() {
    return () => {};
  }
  setAuth() {
    return Promise.resolve();
  }
  clearAuth() {
    return Promise.resolve();
  }
  close() {}
}

const url = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim();
export const convex = url
  ? new ConvexReactClient(url)
  : (new NullConvexClient() as unknown as ConvexReactClient);

