import { Check, ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ICON_NAMES, ICONS, type PageFormSpec } from "@/lib/pageForm";
import { cn } from "@/lib/utils";

/** A photo from the page's own deployment (assets/img), as the visitor sees it. */
export function photoUrl(siteUrl: string, name: string) {
  return `${siteUrl.replace(/\/$/, "")}/assets/img/${encodeURIComponent(name)}.webp`;
}

/** One of the page's icons, drawn from the same paths the page uses. */
export function PageIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-5", className)}
      // The paths are the constant ICONS map, never visitor or draft text.
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
    />
  );
}

export function IconPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (icon: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label={value ? `Icon: ${value}. Change it` : "Choose an icon"}
        >
          {value ? (
            <PageIcon name={value} />
          ) : (
            <span className="text-[11px] text-muted-foreground">Icon</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[248px] p-2">
        <div className="grid grid-cols-6 gap-1">
          {ICON_NAMES.map(name => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={value === name}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
              className={cn(
                "grid size-9 place-items-center rounded-md text-foreground hover:bg-muted",
                value === name &&
                  "bg-primary/15 ring-1 ring-inset ring-primary/40",
              )}
            >
              <PageIcon name={name} />
            </button>
          ))}
        </div>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-8 w-full text-xs text-muted-foreground"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            No icon
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function PhotoPicker({
  siteUrl,
  photos,
  value,
  onChange,
  optional,
  label,
}: {
  siteUrl: string;
  photos: string[];
  value?: string;
  onChange: (photo: string | undefined) => void;
  /** A question's own photo may be left out; an answer card's may not. */
  optional?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            value
              ? `${label}: ${value}. Change it`
              : `Choose ${label.toLowerCase()}`
          }
          className={cn(
            "relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40 text-muted-foreground",
            !value && !optional && "border-dashed border-destructive/60",
          )}
        >
          {value ? (
            <img
              src={photoUrl(siteUrl, value)}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <ImageOff className="size-4" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-2">
        <p className="px-1 pb-2 text-xs text-muted-foreground">
          Photos on this page. New photos are added to the page by the
          developer.
        </p>
        <div className="grid max-h-[300px] grid-cols-3 gap-1.5 overflow-y-auto">
          {photos.map(name => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={value === name}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
              className={cn(
                "relative aspect-[4/3] overflow-hidden rounded-md border",
                value === name && "ring-2 ring-primary",
              )}
            >
              <img
                src={photoUrl(siteUrl, name)}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
              {value === name && (
                <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" aria-hidden />
                </span>
              )}
            </button>
          ))}
        </div>
        {optional && value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-8 w-full text-xs text-muted-foreground"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            No photo
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The live page in a phone frame, in its preview mode (no survey, no live
 * read, no pixel). The draft goes in by message, and the page moves to the
 * screen being edited: 0 is the first screen, 1.. the questions, then the
 * contact step.
 */
export function PagePreview({
  siteUrl,
  spec,
  screen,
  frame = "editor",
}: {
  siteUrl: string;
  spec: PageFormSpec;
  screen: number;
  /** "phone": the instant form preview's own phone, so Open funnel shows both funnels alike. */
  frame?: "editor" | "phone";
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const origin = new URL(siteUrl).origin;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if (e.data?.type === "page-form-ready") setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "page-form-preview",
        spec: { ...spec, version: "preview" },
        screen,
      },
      origin,
    );
  }, [ready, spec, screen, origin]);

  // The page is drawn at a phone's 390px and scaled into the frame.
  const page = (scale: number, height: number) => (
    <>
      <iframe
        ref={frameRef}
        title="Live preview of the page"
        src={`${siteUrl.replace(/\/$/, "")}/?preview=1`}
        className="absolute top-0 left-0 w-[390px] origin-top-left border-0"
        style={{ height, transform: `scale(${scale})` }}
        sandbox="allow-scripts allow-same-origin"
      />
      {!ready && (
        <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-xs text-muted-foreground">
          Loading the page…
        </p>
      )}
    </>
  );
  if (frame === "phone")
    // FormPreview's phone: 272px with an 8px bezel, a 254px by 540px screen.
    return (
      <div className="relative w-[272px] shrink-0 rounded-[2.4rem] border border-white/10 bg-[#05070d] p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.65)]">
        <div className="relative h-[540px] overflow-hidden rounded-[1.95rem] bg-[#f2ede5]">
          {page(254 / 390, Math.round(540 / (254 / 390)))}
        </div>
      </div>
    );
  return (
    <div className="relative h-[620px] w-[290px] shrink-0 overflow-hidden rounded-[34px] border-[6px] border-foreground/85 bg-[#f2ede5] shadow-sm">
      {page(0.7128, 853)}
    </div>
  );
}
