import { lazy, Suspense } from "react";
import {
  useViktorSpaceAccess,
  ViktorSpaceAccessProvider,
} from "@/lib/viktor-spaces-access/ViktorSpaceAccessProvider";

const PublicAppRoutes = lazy(() =>
  import("./public/PublicAppRoutes").then(module => ({
    default: module.PublicAppRoutes,
  })),
);
const AuthenticatedAppRoutes = lazy(() =>
  import("./authenticated/AuthenticatedAppRoutes").then(module => ({
    default: module.AuthenticatedAppRoutes,
  })),
);

function AuthStrategyLoading() {
  return null;
}

export function AuthStrategyRoutes() {
  return (
    <ViktorSpaceAccessProvider>
      <AuthStrategyRoutesInner />
    </ViktorSpaceAccessProvider>
  );
}

function AuthStrategyRoutesInner() {
  const { authEnabled } = useViktorSpaceAccess();

  const routes = authEnabled ? <AuthenticatedAppRoutes /> : <PublicAppRoutes />;

  return <Suspense fallback={<AuthStrategyLoading />}>{routes}</Suspense>;
}
