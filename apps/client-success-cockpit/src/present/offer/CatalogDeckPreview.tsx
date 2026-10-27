import { lazy, Suspense, useState } from "react";
import { Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyOf, type CatalogRow } from "./sources";
import "./serviceDeck.css";
const Preview = lazy(() => import("./CatalogDeckCanvas"));
export function CatalogDeckPreview({ row }: { row: CatalogRow }) {
  const [open, setOpen] = useState(false);
  const name = copyOf(row, "en")?.name ?? row.offerKey;
  return (
    <>
      <Button
        variant="outline"
        className="h-auto justify-start gap-3 py-3"
        onClick={() => setOpen(true)}
        aria-label={`Preview ${name} pitch deck`}
      >
        <Presentation className="size-4 shrink-0" aria-hidden />
        <span className="text-left">
          <span className="block">{name}</span>
          <span className="block text-xs text-muted-foreground">
            Preview pitch deck
          </span>
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dks-catalog-dialog">
          <DialogHeader className="dks-catalog-head">
            <DialogTitle>Deck preview · {name}</DialogTitle>
            <DialogDescription>
              Read-only catalog preview. Choose a client from Clients → Present
              → Prepare an offer to personalise and record the conversation.
            </DialogDescription>
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
                <Preview row={row} onClose={() => setOpen(false)} />
              </Suspense>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
