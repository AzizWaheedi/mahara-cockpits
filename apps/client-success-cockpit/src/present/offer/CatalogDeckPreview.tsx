import { ArrowUpRight, Presentation } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OfferCover } from "./OfferCover";
import { listOf } from "./price";
import { type CatalogRow, copyOf } from "./sources";
import "./serviceDeck.css";
import "./quickPitch.css";

const Preview = lazy(() => import("./CatalogDeckCanvas"));

export function QuickPitchDialog({
  row,
  open,
  onOpenChange,
  prepareHref,
  hold,
}: {
  row: CatalogRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prepareHref?: string;
  hold?: string | null;
}) {
  const [listPrice, setListPrice] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every reopened offer starts with pricing hidden.
  useEffect(() => {
    setListPrice(false);
    setExpanded(false);
  }, [open, row.offerKey]);
  const copy = copyOf(row, "en");
  const hasList = !!listOf(row) && row.offerKey !== "closer";
  const closeOrOpen = (next: boolean) => {
    if (!next) setListPrice(false);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={closeOrOpen}>
      <DialogContent
        className={`dks-catalog-dialog dkq-dialog${expanded ? " dkq-expanded" : ""}`}
        onEscapeKeyDown={e => {
          if (expanded) {
            e.preventDefault();
            setExpanded(false);
          }
        }}
      >
        <DialogHeader className="dks-catalog-head dkq-private-head">
          <div>
            <DialogTitle>
              Quick pitch · {copy?.name ?? row.offerKey}
            </DialogTitle>
            <DialogDescription>
              Example presentation. No client details or conversation record.
            </DialogDescription>
          </div>
          <div className="dkq-private-actions">
            {hasList ? (
              <label>
                <input
                  type="checkbox"
                  checked={listPrice}
                  onChange={e => setListPrice(e.target.checked)}
                />
                Include list price
              </label>
            ) : (
              <span>Client pricing stays in preparation.</span>
            )}
            {prepareHref ? (
              <Button asChild variant="outline" size="sm">
                <a href={prepareHref} target="_blank" rel="noreferrer">
                  Prepare for client
                  <ArrowUpRight aria-hidden />
                </a>
              </Button>
            ) : null}
          </div>
          {hold ? (
            <p className="dkq-private-note">Preparation: {hold}</p>
          ) : null}
          {listPrice ? (
            <p className="dkq-private-note">
              Current catalog price only. Confirm the client's price in
              preparation.
            </p>
          ) : null}
        </DialogHeader>
        {open ? (
          <div className="dks-catalog-canvas">
            <Suspense
              fallback={
                <p className="p-6" role="status">
                  Opening the pitch deck…
                </p>
              }
            >
              <Preview
                key={row.offerKey}
                row={row}
                showListPrice={listPrice && hasList}
                expanded={expanded}
                onExpandedChange={setExpanded}
                onClose={() => closeOrOpen(false)}
              />
            </Suspense>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
export function CatalogDeckPreview({ row }: { row: CatalogRow }) {
  const [open, setOpen] = useState(false);
  const copy = copyOf(row, "en");
  return (
    <>
      <button
        type="button"
        className="dkq-deck-card"
        onClick={() => setOpen(true)}
        aria-label={`Quick pitch: ${copy?.name ?? row.offerKey}`}
      >
        <OfferCover offer={row.offerKey} copy={copy} />
        <span className="dkq-card-copy">
          <strong>{copy?.name ?? row.offerKey}</strong>
          <span>{copy?.line ?? "Open the deck details."}</span>
          <span className="dkq-card-action">
            <Presentation aria-hidden />
            Quick pitch
          </span>
        </span>
      </button>
      <QuickPitchDialog
        row={row}
        open={open}
        onOpenChange={setOpen}
        hold={row.waitsOn}
      />
    </>
  );
}
