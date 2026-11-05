import type { ComponentType } from "react";
import { CLIENTS_SKELETON_PATHS, ClientsSkeleton } from "./ClientsSkeleton";
import { INBOX_SKELETON_PATHS, InboxSkeleton } from "./InboxSkeleton";
import { TODAY_SKELETON_PATHS, TodaySkeleton } from "./TodaySkeleton";

/** One entry per page that has its own skeleton. The page's own loading state draws the same component, so the picture never changes shape. */
export type PageSkeletonEntry = { path: string; Skeleton: ComponentType };

export const PAGE_SKELETONS: PageSkeletonEntry[] = [
  ...TODAY_SKELETON_PATHS.map(path => ({ path, Skeleton: TodaySkeleton })),
  ...CLIENTS_SKELETON_PATHS.map(path => ({ path, Skeleton: ClientsSkeleton })),
  ...INBOX_SKELETON_PATHS.map(path => ({ path, Skeleton: InboxSkeleton })),
];
