/**
 * The Client Performance board in the layout harness: the board's reads,
 * the targets save and the lever function answer from invented data
 * (boardFixture.ts) after a short delay, so every state can be looked at
 * without signing in. Open, for example:
 *
 *   /harness.html?path=/performance
 *   /harness.html?path=%2Fperformance%3Fclient%3DlocFixHarbor01
 *
 * `board=` picks the answer: default, stale (warnings), board_override (a
 * board target), empty, loading, error, refused, missing (the read is not
 * on the database yet), viewer (no target editing). `delay=` sets the wait
 * in ms (600 by default). Never imported by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type BoardScenario,
  boardFixture,
  clientFixture,
} from "./boardFixture";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const today = () =>
  new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

export function installBoardHarness(client: SupabaseClient): void {
  const params = new URLSearchParams(window.location.search);
  if (!/^\/performance\b/.test(params.get("path") ?? "")) return;
  const pick = params.get("board") ?? "default";
  const delay = Number(params.get("delay") ?? 600);
  const wait = () => new Promise(r => setTimeout(r, delay));
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    functions: {
      invoke: (name: string, opts?: { body?: unknown }) => Promise<Answer>;
    };
  };
  const previousRpc = c.rpc.bind(c);
  // supabase-js builds a new `functions` client on every read of the
  // property, so one is kept on the client, or the patch would be lost.
  const functions = c.functions;
  if (!Object.getOwnPropertyDescriptor(client, "functions"))
    Object.defineProperty(client, "functions", {
      configurable: true,
      value: functions,
    });
  const previousInvoke = functions.invoke.bind(functions);
  c.rpc = async (name, args = {}) => {
    if (!name.startsWith("cockpit_board_")) return previousRpc(name, args);
    if (pick === "loading") return new Promise<Answer>(() => {});
    await wait();
    if (pick === "error")
      return {
        data: null,
        error: {
          code: "57014",
          message: "canceling statement due to statement timeout",
        },
      };
    if (pick === "refused")
      return {
        data: null,
        error: {
          code: "42501",
          message:
            "Sign in with an active cockpit seat to see the Client Performance board.",
        },
      };
    if (pick === "missing")
      return {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      };
    if (name === "cockpit_board_read") {
      const data = boardFixture(
        String(args.p_from),
        String(args.p_to),
        today(),
        pick as BoardScenario,
      );
      if (pick === "viewer") data.canEditTargets = false;
      return { data, error: null };
    }
    if (name === "cockpit_board_client") {
      const data = clientFixture(
        String(args.p_location),
        String(args.p_from),
        String(args.p_to),
        today(),
      );
      return data
        ? { data, error: null }
        : {
            data: null,
            error: {
              code: "42501",
              message: "This client is not on your board.",
            },
          };
    }
    if (name === "cockpit_board_targets_save")
      return {
        data: {
          ok: true,
          scope: args.p_scope,
          metric: args.p_metric,
          target: null,
        },
        error: null,
      };
    return {
      data: null,
      error: { message: `The harness has no fixture for ${name}.` },
    };
  };
  functions.invoke = async (name, opts = {}) => {
    if (name !== "cockpit-board-api") return previousInvoke(name, opts);
    await wait();
    const body = (opts.body ?? {}) as {
      args?: Record<string, string>;
      apply?: boolean;
    };
    const a = body.args ?? {};
    if (!body.apply)
      return {
        data: {
          dryRun: true,
          plan: {
            list: "901816723196",
            department: a.department,
            name: `Client - ${a.lever}`,
            description: `Lever from the Client Performance board, added by ceo@example.test.\nMetric: ${a.metric}\nWhy: the harness's invented numbers.`,
            dueDate: Date.parse(`${today()}T09:00:00Z`) + 2 * 86400e3,
            clientTask: "https://app.clickup.com/t/86fixhar1",
          },
          context: {},
        },
        error: null,
      };
    return {
      data: {
        ok: true,
        ticketId: "86fixnew1",
        ticketUrl: "https://app.clickup.com/t/86fixnew1",
        commentId: "90fix1",
        lever: null,
      },
      error: null,
    };
  };
}
