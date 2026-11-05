import type { HTMLAttributes } from "react";

/** A neutral block the size of content still being read. */
function Skeleton({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-md bg-muted motion-safe:animate-pulse ${className}`}
      {...props}
    />
  );
}

export { Skeleton };
