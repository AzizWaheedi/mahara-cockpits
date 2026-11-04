import { Monitor, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PublicProposal } from "./publicProposal";
import { proposalSrcdoc } from "./srcdoc";

export function ProposalPreview({
  proposal,
  error,
  loading,
}: {
  proposal: PublicProposal | null;
  error?: string;
  loading?: boolean;
}) {
  const [phone, setPhone] = useState(false);
  const [ready, setReady] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 760 });
  const srcdoc = useMemo(proposalSrcdoc, []);
  useEffect(() => {
    if (!well.current) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    observer.observe(well.current);
    return () => observer.disconnect();
  }, []);
  const viewport = phone ? 390 : 1280;
  const scale = Math.min(1, Math.max(1, size.width) / viewport);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (
        e.source === frame.current?.contentWindow &&
        e.data?.type === "offer:ready"
      )
        setReady(x => x + 1);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ready resends the current proposal when the sandbox announces it can receive messages.
  useEffect(() => {
    if (proposal)
      frame.current?.contentWindow?.postMessage(
        { type: "offer:preview", proposal },
        "*",
      );
  }, [proposal, ready]);
  return (
    <section className="proposal-preview" aria-label="Client page preview">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">What your client sees</h2>
          <p className="text-xs text-muted-foreground">
            Preview activity is not counted.
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant={!phone ? "outline" : "ghost"}
            size="icon"
            aria-label="Desktop preview"
            aria-pressed={!phone}
            onClick={() => setPhone(false)}
          >
            <Monitor size={16} />
          </Button>
          <Button
            variant={phone ? "outline" : "ghost"}
            size="icon"
            aria-label="Phone preview"
            aria-pressed={phone}
            onClick={() => setPhone(true)}
          >
            <Smartphone size={16} />
          </Button>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="mx-4 mb-3 rounded-lg border border-destructive/30 p-3 text-sm"
        >
          {error}
        </p>
      ) : null}
      {loading ? (
        <p
          className="px-4 pb-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          Updating preview
        </p>
      ) : null}
      {/* Keep the observer and iframe mounted while hiding a missing or failed preview.
          A successful retry posts fresh content and restores the measured viewport. */}
      <div
        ref={well}
        className="proposal-preview-well"
        hidden={!!error || !proposal}
      >
        <iframe
          ref={frame}
          title="Client proposal preview"
          sandbox="allow-scripts"
          srcDoc={srcdoc}
          onLoad={() => setReady(x => x + 1)}
          className="proposal-frame"
          style={{
            width: viewport,
            height: Math.max(1, size.height) / scale,
            transform: `scale(${scale})`,
            left: Math.max(0, (size.width - viewport * scale) / 2),
          }}
        />
      </div>
    </section>
  );
}
