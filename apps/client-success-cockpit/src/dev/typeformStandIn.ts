import type { CreateWidget } from "@/forms/useFormPanel";

/**
 * Typeform's stand-in for the harnesses (the kickoff window's and the
 * deck's last slide): plain DOM in the container, as the SDK's iframe
 * would be. No Typeform page loads and nothing is submitted anywhere: its
 * "submit" only calls the panel's own handler, with a made-up response ID.
 */
export function standIn(opts: {
  autoSubmit: boolean;
  fail?: boolean;
  response: string;
  /** Wait before the stand-in says it is ready (and, with autoSubmit, submits). */
  readyMs?: number;
}) {
  return async (): Promise<CreateWidget> => {
    if (opts.fail) throw Error("The stand-in was told not to load.");
    return (_formId, options) => {
      const box = document.createElement("div");
      box.setAttribute("data-typeform-stand-in", "");
      box.style.cssText =
        "position:absolute;inset:0;display:grid;place-content:center;gap:18px;padding:32px;background:#0b1740;color:#f2f6fa;font:16px/1.5 Geist,'IBM Plex Sans Arabic',sans-serif;text-align:left";
      const h = options.hidden ?? {};
      const say = (html: string) => {
        box.innerHTML = html;
      };
      const question = () =>
        say(`
          <div style="font:11px 'Geist Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:rgba(242,246,250,.55)">Typeform stand-in (harness) · nothing loads or submits</div>
          <div style="font-size:22px;font-weight:600;max-width:560px">1 → Are the business details still correct?</div>
          <div style="max-width:560px;color:rgba(242,246,250,.75);white-space:pre-line">${[
            h.legal_name,
            h.phone,
            h.email,
            h.address,
          ]
            .filter(Boolean)
            .map(v => String(v).replace(/</g, "&lt;"))
            .join("\n")}</div>
          <div style="display:flex;gap:10px">
            <button data-act="start" style="padding:8px 16px;border-radius:6px;border:0;background:#00cfc8;color:#091333;font-weight:600">Yes</button>
            <button data-act="submit" style="padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#f2f6fa">Stand-in submit (nothing is sent)</button>
          </div>`);
      const ending = () =>
        say(`
          <div style="font-size:20px;font-weight:600;max-width:520px">Kickoff notes received. The client will receive their summary shortly.</div>
          <div style="color:rgba(242,246,250,.75)">Next step is the Brand Blueprint call. Book it now if it isn't booked already.</div>
          <div><button data-act="ending" style="padding:8px 16px;border-radius:6px;border:0;background:#00cfc8;color:#091333;font-weight:600">Book the Brand Blueprint call</button></div>`);
      box.addEventListener("click", e => {
        const act = (e.target as HTMLElement).getAttribute("data-act");
        if (act === "start")
          options.onStarted?.({
            formId: "tG7dnxBn",
            responseId: opts.response,
          });
        if (act === "submit") {
          options.onSubmit?.({ formId: "tG7dnxBn", responseId: opts.response });
          ending();
        }
        if (act === "ending")
          options.onEndingButtonClick?.({ formId: "tG7dnxBn" });
      });
      question();
      // A container already placed (the deck's frame) keeps its place.
      if (getComputedStyle(options.container).position === "static")
        options.container.style.position = "relative";
      options.container.append(box);
      const ready = window.setTimeout(() => {
        options.onReady?.({ formId: "tG7dnxBn", isClosed: false });
        if (opts.autoSubmit) {
          options.onSubmit?.({ formId: "tG7dnxBn", responseId: opts.response });
          ending();
        }
      }, opts.readyMs ?? 250);
      return {
        unmount: () => {
          window.clearTimeout(ready);
          box.remove();
        },
      };
    };
  };
}
