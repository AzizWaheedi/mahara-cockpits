import { lazy, Suspense, useState } from "react";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

const OfferPicker = lazy(() =>
  import("./OfferPicker").then(m => ({ default: m.OfferPicker })),
);
export function OfferPickerItem({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenuItem
        onSelect={e => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        Prepare an offer
      </DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>One useful next step</DialogTitle>
            <DialogDescription>
              Readiness and context for this client.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <Suspense
              fallback={
                <LoadingSkeleton variant="list" label="Reading offers" />
              }
            >
              <OfferPicker taskId={taskId} />
            </Suspense>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
