import type { ComponentType } from "react";
import { ADS_SKELETON_PATHS, AdsSkeleton } from "./AdsSkeleton";
import { CEO_SKELETON_PATHS, CeoSkeleton } from "./CeoSkeleton";
import { CLIENTS_SKELETON_PATHS, ClientsSkeleton } from "./ClientsSkeleton";
import { TODAY_SKELETON_PATHS, TodaySkeleton } from "./TodaySkeleton";

/** One entry per page that has its own skeleton. The page's own loading state draws the same component, so the picture never changes shape. */
export type PageSkeletonEntry = { path: string; Skeleton: ComponentType };

export const PAGE_SKELETONS: PageSkeletonEntry[] = [
  ...TODAY_SKELETON_PATHS.map(path => ({ path, Skeleton: TodaySkeleton })),
  ...ADS_SKELETON_PATHS.map(path => ({ path, Skeleton: AdsSkeleton })),
  ...CLIENTS_SKELETON_PATHS.map(path => ({ path, Skeleton: ClientsSkeleton })),
  ...CEO_SKELETON_PATHS.map(path => ({ path, Skeleton: CeoSkeleton })),
];
