import { useState } from "react";

export function ClientLogo({ name, src }: { name: string; src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase() || "?";
  const showImage = Boolean(src) && src !== failedSrc;

  return (
    <span
      className={`inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border p-1 align-middle ${showImage ? "bg-white" : "bg-muted text-muted-foreground"}`}
      title={showImage ? undefined : `${name}: logo unavailable`}
    >
      {showImage ? (
        <img
          key={src}
          src={src}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span
          className="text-[10px] font-medium leading-none"
          aria-hidden="true"
        >
          {initials}
        </span>
      )}
    </span>
  );
}
