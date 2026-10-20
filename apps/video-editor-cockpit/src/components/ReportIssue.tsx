import { Flag } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import { FIELD } from "./bits";
import { Button } from "./ui/button";

/**
 * "This screen is wrong", said where it was noticed: the same quiet header
 * action and the same RPC as the client success cockpit (ReportIssue.tsx).
 * The report is filed with app "editor" and role "editor"; the database
 * checks the seat and writes the audit row.
 */
export function ReportIssue() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { pathname } = useLocation();
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const { error } = await supabase.rpc("cockpit_submit_issue_report", {
      p_app: "editor",
      p_role: "editor",
      p_page: pathname || "/",
      p_text: body,
    });
    setBusy(false);
    if (error) {
      toast.error(`That did not send: ${error.message}`);
      return;
    }
    toast.success("Issue recorded for review");
    setOpen(false);
    setText("");
  }

  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Flag aria-hidden />
        Report an issue
      </Button>
      {open ? (
        <div
          id={id}
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-2xl border bg-card p-4"
        >
          <div>
            <p className="text-sm font-semibold">This screen is wrong</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Wrong job, wrong status or a missing file: say it here and it is
              recorded for review.
            </p>
          </div>
          <textarea
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            aria-label="What is wrong"
            placeholder="What is wrong, and what should it say instead?"
            className={`${FIELD} py-2`}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
            >
              Send the report
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
