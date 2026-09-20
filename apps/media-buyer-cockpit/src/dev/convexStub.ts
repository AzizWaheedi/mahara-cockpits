/**
 * Fixture-backed stand-ins for `convex/react`, used only by the layout
 * harness (`bun run harness`). Every hook answers from the fixtures the
 * harness loaded, keyed by the Convex function name, so the real screens
 * render with real payloads and no deployment behind them.
 */
import type { FunctionReference } from "convex/server";
import { getFunctionName } from "convex/server";
import { type ReactNode, useCallback } from "react";

type Fixtures = Record<string, unknown>;
let fixtures: Fixtures = {};

/** The harness calls this once, before rendering. */
export function setFixtures(next: Fixtures) {
  fixtures = next;
}

function answer(ref: FunctionReference<"query" | "mutation" | "action">) {
  const name = getFunctionName(ref);
  const hit = fixtures[name];
  return typeof hit === "function" ? (hit as () => unknown)() : hit;
}

export function useQuery(
  ref: FunctionReference<"query">,
  args?: unknown,
): unknown {
  if (args === "skip") return undefined;
  return answer(ref);
}

export function useQueries(
  queries: Record<string, { query: FunctionReference<"query">; args: unknown }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(queries)) out[key] = answer(q.query);
  return out;
}

export function useMutation(ref: FunctionReference<"mutation">) {
  return useCallback(
    (_args?: unknown) => Promise.resolve(answer(ref) ?? {}),
    [ref],
  );
}

export function useAction(ref: FunctionReference<"action">) {
  return useCallback(
    (_args?: unknown) => Promise.resolve(answer(ref) ?? {}),
    [ref],
  );
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}

export function useConvex() {
  return {};
}

export function ConvexProvider({ children }: { children: ReactNode }) {
  return children;
}

export function Authenticated({ children }: { children: ReactNode }) {
  return children;
}

export function Unauthenticated(_props: { children: ReactNode }) {
  return null;
}

export function AuthLoading(_props: { children: ReactNode }) {
  return null;
}

/** Constructed by main.tsx in the real app; the harness never reaches it. */
export class ConvexReactClient {}
