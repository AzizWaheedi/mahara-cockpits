import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

/**
 * The app's own confirm dialog, in place of the browser's window.confirm.
 *
 * `confirm()` answers the way window.confirm did, true for the action and
 * false for Cancel, Escape or a tap outside, so each caller keeps its
 * "stop unless they said yes" line. The dialog element has to be rendered
 * by the component that asks.
 */
type Ask = {
  title: string;
  body?: ReactNode;
  /** The button that goes ahead, named for what it does. */
  action: string;
  destructive?: boolean;
};

export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    answer.current?.(ok);
    answer.current = null;
    setAsk(null);
  }, []);

  const confirm = useCallback(
    (next: Ask) =>
      new Promise<boolean>(resolve => {
        answer.current?.(false);
        answer.current = resolve;
        setAsk(next);
      }),
    [],
  );

  const dialog = (
    <AlertDialog
      open={ask !== null}
      onOpenChange={open => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">
            {ask?.title}
          </AlertDialogTitle>
          {ask?.body ? (
            <AlertDialogDescription>{ask.body}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={
              ask?.destructive
                ? buttonVariants({ variant: "destructive" })
                : undefined
            }
          >
            {ask?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [confirm, dialog] as const;
}
