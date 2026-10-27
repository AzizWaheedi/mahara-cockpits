import { lazy, Suspense, useState } from "react";
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
            <Suspense fallback={<p>Reading offers…</p>}>
              <OfferPicker taskId={taskId} />
            </Suspense>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
