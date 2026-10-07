import { Flag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

/**
 * "This screen is wrong", said where it was noticed. It files an owned fix
 * task rather than becoming a message someone forgets.
 *
 * It used to float over the bottom of every screen, where its invisible box
 * took the taps meant for the page on a phone and sat on top of "File my
 * EOD". Now it is a quiet action in the page header that opens a small
 * panel; questions still go to Ask Hermes, bottom right. [aziz, 2026-09-26]
 */
export function ReportIssue({ page }: { page: string }) {
  const auth = useCockpitAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      if (!auth.client) throw new Error("Sign in to report an issue.");
      const { error } = await auth.client.rpc("cockpit_submit_issue_report", {
        p_app: "client-success",
        p_role: "csm",
        p_page: page,
        p_text: body,
      });
      if (error) throw error;
      toast.success("Issue recorded for review");
      setOpen(false);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-mx-2 px-2 text-muted-foreground hover:text-foreground"
        >
          <Flag aria-hidden />
          Report an issue
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-2xl dark:shadow-none"
      >
        <div>
          <p className="text-sm font-semibold">This screen is wrong</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Wrong client, wrong instruction or a missing field: say it here and
            it is recorded for review. Questions go to Ask Hermes.
          </p>
        </div>
        <Textarea
          rows={3}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What is wrong, and what should it say instead?"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="pointer-coarse:h-10"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="pointer-coarse:h-10"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
          >
            Send the report
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
