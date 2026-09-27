/**
 * Fixture-backed stand-ins for `convex/react`, used only by the layout
 * harness (`bun run harness`). Every hook answers from the fixtures the
 * harness loaded, keyed by the Convex function name, so the real screens
 * render with real payloads and no deployment behind them. A function the
 * fixtures do not name answers with one shared empty list, so lists render
 * their empty states and nothing loops on a fresh object each render.
 */
import type { FunctionReference } from "convex/server";
import { getFunctionName } from "convex/server";
import { type ReactNode, useEffect, useRef, useState } from "react";

type Fixtures = Record<string, unknown>;
let fixtures: Fixtures = {};
const EMPTY: readonly never[] = Object.freeze([]);
type Stub = ((args?: unknown) => Promise<unknown>) & {
  withOptimisticUpdate: (update: unknown) => Stub;
};
const fns = new Map<string, Stub>();

/** The harness calls this once, before rendering. */
export function setFixtures(next: Fixtures) {
  fixtures = next;
}

function answer(
  ref: FunctionReference<"query" | "mutation" | "action">,
  args?: unknown,
) {
  const name = getFunctionName(ref);
  if (!(name in fixtures)) return EMPTY;
  const hit = fixtures[name];
  return typeof hit === "function"
    ? (hit as (args?: unknown) => unknown)(args)
    : hit;
}

/** One stable function per Convex function name, the way the real hooks behave. */
function stable(ref: FunctionReference<"mutation" | "action">): Stub {
  const name = getFunctionName(ref);
  let fn = fns.get(name);
  if (!fn) {
    const made = ((args?: unknown) =>
      Promise.resolve(answer(ref, args))) as Stub;
    // Real mutations carry this; the screens that call it get the same stub back.
    made.withOptimisticUpdate = () => made;
    fn = made;
    fns.set(name, fn);
  }
  return fn as Stub;
}

export function useQuery(
  ref: FunctionReference<"query">,
  args?: unknown,
): unknown {
  if (args === "skip") return undefined;
  return answer(ref);
}

type Queries = Record<
  string,
  { query: FunctionReference<"query">; args: unknown }
>;

/** What a queries object asks for, so two objects can be compared by content. */
function asked(queries: Queries): string {
  return JSON.stringify(
    Object.entries(queries).map(([key, q]) => [
      key,
      getFunctionName(q.query),
      q.args,
    ]),
  );
}

/**
 * The real hook keys its subscription on the identity of this object: a new
 * object with the same queries on every render makes it resubscribe and set
 * state during render, forever. In production that is React error #301 (the
 * account page, 2026-09-27, which the harness rendered happily). So this one
 * fails the same way, and renders once more after mounting, as the real hook
 * does when it subscribes, so the check runs on the first view.
 */
export function useQueries(queries: Queries): Record<string, unknown> {
  const last = useRef<{ queries: Queries; asked: string } | null>(null);
  const now = asked(queries);
  if (
    last.current &&
    last.current.queries !== queries &&
    last.current.asked === now
  ) {
    throw new Error(
      "useQueries got a new object asking for the same queries. Memoize it (useMemo): the real hook re-renders forever on this (React error #301).",
    );
  }
  last.current = { queries, asked: now };
  const [, settle] = useState(false);
  useEffect(() => {
    settle(true);
  }, []);
  const out: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(queries)) out[key] = answer(q.query);
  return out;
}

export function useMutation(ref: FunctionReference<"mutation">) {
  return stable(ref);
}

export function useAction(ref: FunctionReference<"action">) {
  return stable(ref);
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
