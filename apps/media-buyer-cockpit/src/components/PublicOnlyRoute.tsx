import { useConvexAuth } from "convex/react";
import { Navigate, Outlet, useSearchParams } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Skeleton } from "./ui/skeleton";

function AuthFormSkeleton() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Skeleton className="h-9 w-32 mx-auto mb-8" />
        <Card>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-6 w-32" />
            </CardTitle>
            <CardDescription>
              <Skeleton className="h-4 w-48" />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
        <Skeleton className="h-4 w-48 mx-auto mt-4" />
      </div>
    </div>
  );
}

export function PublicOnlyRoute() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [params] = useSearchParams();

  if (isLoading) {
    return <AuthFormSkeleton />;
  }

  if (isAuthenticated) {
    // Only a path on this site: never an address someone pasted into the link.
    const next = params.get("next") ?? "";
    const safe = /^\/(?!\/)[^\s]*$/.test(next) ? next : "/";
    return <Navigate to={safe} replace />;
  }

  return <Outlet />;
}
