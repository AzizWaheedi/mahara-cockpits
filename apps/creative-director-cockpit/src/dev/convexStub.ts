/**
 * An in-memory stand-in for `convex/react`, used only by the social
 * calendar harness (`bun run harness`). `useAction` answers from the
 * handlers the harness registers, keyed by the Convex function name, so
 * the real screens run against a fake backend that keeps its state for
 * the length of the page.
 */
import type { FunctionReference } from "convex/server";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler> = {};
const fns = new Map<string, (args?: unknown) => Promise<unknown>>();

export function setHandlers(next: Record<string, Handler>) {
  handlers = next;
}

function call(name: string, args: unknown): Promise<unknown> {
  const h = handlers[name];
  if (!h)
    return Promise.reject(new Error(`The harness does not answer ${name}.`));
  return new Promise((resolve, reject) =>
    // A little latency, so loading states are seen.
    setTimeout(() => {
      try {
        resolve(h((args ?? {}) as Record<string, unknown>));
      } catch (e) {
        reject(e);
      }
    }, 120),
  );
}

export function useAction(ref: FunctionReference<"action">) {
  const name = getFunctionName(ref);
  let fn = fns.get(name);
  if (!fn) {
    fn = (args?: unknown) => call(name, args);
    fns.set(name, fn);
  }
  return fn;
}

export function useMutation(ref: FunctionReference<"mutation">) {
  return useAction(ref as unknown as FunctionReference<"action">);
}

export function useQuery(): unknown {
  return undefined;
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}

export class ConvexReactClient {}

export function ConvexProvider({ children }: { children: ReactNode }) {
  return children;
}

export const ConvexProviderWithAuth = ConvexProvider;
