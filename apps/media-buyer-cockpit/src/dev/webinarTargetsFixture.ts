/** Isolated UI rehearsal. Never imported by the production app and never contacts Supabase. */
import {
  selectTargets,
  type TargetVersion,
  webinarTargetsSchema,
} from "../../convex/ceo/webinarTargetsModel";
export function webinarTargetsFixtures() {
  const versions: TargetVersion[] = [];
  return {
    "ceo/webinarTargets:get": (args: { scope: string }) => ({
      scope: args.scope,
      selection: selectTargets(versions, args.scope, 0),
      history: versions
        .filter(v => v.scope_key === args.scope)
        .reverse()
        .slice(0, 10),
    }),
    "ceo/webinarTargets:save": (args: {
      scope: string;
      expectedRevision: number;
      values: unknown;
    }) => {
      const current = selectTargets(versions, args.scope, 0);
      if (current.revision !== args.expectedRevision) return { conflict: true };
      const version: TargetVersion = {
        scope_key: args.scope,
        revision: current.revision + 1,
        values: webinarTargetsSchema.parse(args.values),
        changed_at: new Date().toISOString(),
        changed_by: "Synthetic preview · resets on page reload",
      };
      versions.push(version);
      return {
        scope: args.scope,
        selection: selectTargets(versions, args.scope, 0),
        history: [version],
      };
    },
  };
}
