import type { ComponentType } from "react";
import {
  CLIENTS_SKELETON_PATHS,
  ClientDatabaseSkeleton,
} from "./ClientDatabaseSkeleton";
import {
  DASHBOARD_SKELETON_PATHS,
  DashboardSkeleton,
} from "./DashboardSkeleton";

/** One entry per page that has its own skeleton. The page's own loading state draws the same component, so the picture never changes shape. */
export type PageSkeletonEntry = { path: string; Skeleton: ComponentType };

export const PAGE_SKELETONS: PageSkeletonEntry[] = [
  ...DASHBOARD_SKELETON_PATHS.map(path => ({
    path,
    Skeleton: DashboardSkeleton,
  })),
  ...CLIENTS_SKELETON_PATHS.map(path => ({
    path,
    Skeleton: ClientDatabaseSkeleton,
  })),
];
