/** Stand-in for `@convex-dev/auth/react` in the layout harness: nobody signs in or out. */
import type { ReactNode } from "react";

export function useAuthActions() {
  return {
    signIn: async () => ({ signingIn: true, redirect: undefined }),
    signOut: async () => {},
  };
}

export function ConvexAuthProvider({ children }: { children: ReactNode }) {
  return children;
}
