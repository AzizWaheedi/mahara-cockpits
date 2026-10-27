import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { OfferModel } from "../../../present/offer/useOffer";
export function LogPitchDialog({
  offer: m,
  inline = false,
}: {
  offer: OfferModel;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(inline),
    [answer, setAnswer] = useState(m.pitch?.answer ?? ""),
    [follow, setFollow] = useState(m.pitch?.followUpOn ?? ""),
    [why, setWhy] = useState(m.pitch?.noReason ?? "");
  return (
    <div>
      {!inline ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          Log the call
        </Button>
      ) : null}
      {open ? (
        <div className="space-y-3">
          <label className="dko-field">
            What did they decide?
            <select
              value={answer}
              onChange={e => setAnswer(e.target.value as typeof answer)}
            >
              <option value="">Choose an answer</option>
              <option value="yes_paid">Yes, paid</option>
              <option value="yes_unpaid">Yes, waiting for payment</option>
              <option value="not_now">Not now</option>
              <option value="no">No</option>
            </select>
          </label>
          {answer === "not_now" ? (
            <label className="dko-field">
              Follow up on
              <input
                type="date"
                value={follow}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => setFollow(e.target.value)}
              />
            </label>
          ) : null}
          {answer === "no" ? (
            <label className="dko-field">
              Why not?
              <textarea
                maxLength={200}
                value={why}
                onChange={e => setWhy(e.target.value)}
              />
            </label>
          ) : null}
          <Button
            size="sm"
            disabled={
              m.busy ||
              !answer ||
              (answer === "not_now" && !follow) ||
              (answer === "no" && !why.trim()) ||
              !!m.priceProblem
            }
            onClick={() =>
              void m.savePitch({
                answer,
                follow_up_on: answer === "not_now" ? follow : null,
                no_reason: answer === "no" ? why : null,
              })
            }
          >
            {m.busy ? "Saving…" : "Save their answer"}
          </Button>
          {m.pitch?.answer ? (
            <p className="dko-help">
              Saved: {m.pitch.answer.replaceAll("_", " ")} · {m.pitch.pitchedOn}
            </p>
          ) : null}
          {m.error ? (
            <p role="alert" className="txt-bad">
              {m.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
