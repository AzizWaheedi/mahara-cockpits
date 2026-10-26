import type { CreateWidget } from "@/forms/useFormPanel";

/**
 * The practice kickoff form (docs/call-guide/DESIGN.md): drawn where
 * Typeform's form sits on the onboarding deck's last slide, three short
 * screens in the kickoff's order, then Submit and the ending's booking
 * button. Plain DOM, as the SDK's iframe would be. Typeform never loads:
 * its sandbox still reaches the live form, and KICKOFF.md 9 keeps Submit
 * out of the sandbox. Submit only calls the panel's own handler.
 */

const FORM_ID = "tG7dnxBn";

const SERVICES = [
  "Design and build",
  "Interior design",
  "Architectural design",
  "Fit out and renovation",
  "Construction",
];

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const button = (act: string, label: string, primary = false) =>
  `<button type="button" data-act="${act}" style="padding:10px 18px;border-radius:8px;font:600 15px/1.2 Geist,sans-serif;cursor:pointer;${
    primary
      ? "border:0;background:#00cfc8;color:#091333"
      : "border:1px solid rgba(242,246,250,.3);background:transparent;color:#f2f6fa"
  }">${esc(label)}</button>`;

export async function practiceForm(): Promise<CreateWidget> {
  return (_formId, options) => {
    const box = document.createElement("div");
    box.setAttribute("data-practice-form", "");
    box.style.cssText =
      "position:absolute;inset:0;display:grid;align-content:center;gap:18px;padding:40px 48px;background:#0b1740;color:#f2f6fa;font:16px/1.5 Geist,'IBM Plex Sans Arabic',sans-serif;text-align:left;overflow:auto";
    const h = (options.hidden ?? {}) as Record<string, string | undefined>;
    let started = false;
    let service = h.service_focus ?? "";

    const head = (n: number) =>
      `<div style="font:11px 'Geist Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:rgba(242,246,250,.55)">Practice form · question ${n} of 3 · nothing is sent</div>`;
    const title = (s: string) =>
      `<div style="font-size:24px;font-weight:600;max-width:600px">${esc(s)}</div>`;

    const screens: Record<string, () => string> = {
      details: () =>
        `${head(1)}${title("Are the business details still correct?")}
        <div style="max-width:600px;color:rgba(242,246,250,.75);white-space:pre-line">${[
          h.legal_name,
          h.phone,
          h.email,
          h.address,
        ]
          .filter(Boolean)
          .map(esc)
          .join("\n")}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${button("yes", "Yes, they are", true)}${button("yes", "Something changed")}</div>`,
      service: () =>
        `${head(2)}${title("Which service are we advertising first?")}
        <div style="display:flex;gap:8px;flex-wrap:wrap;max-width:640px">${SERVICES.map(
          s =>
            `<button type="button" data-act="service" data-value="${esc(s)}" style="padding:9px 14px;border-radius:8px;font:500 14px/1.2 Geist,sans-serif;cursor:pointer;border:1px solid ${
              s === service ? "#00cfc8" : "rgba(242,246,250,.3)"
            };background:${s === service ? "rgba(0,207,200,.14)" : "transparent"};color:#f2f6fa">${esc(s)}</button>`,
        ).join("")}</div>
        <div style="display:flex;gap:10px">${button("next", "OK", true)}</div>`,
      last: () =>
        `${head(3)}${title("Anything to change before we send it?")}
        <div style="max-width:600px;color:rgba(242,246,250,.75)">On a real call, the call recording link and the payment come here, then Submit.</div>
        <div style="display:flex;gap:10px">${button("submit", "Submit", true)}</div>`,
      ending: () =>
        `${title("Kickoff notes received.")}
        <div style="color:rgba(242,246,250,.75)">Next step is the Brand Blueprint call. Book it now if it isn't booked already.</div>
        <div>${button("ending", "Book the Brand Blueprint call", true)}</div>`,
    };
    const show = (s: keyof typeof screens) => {
      box.innerHTML = screens[s]?.() ?? "";
    };

    box.addEventListener("click", e => {
      const el = (e.target as HTMLElement).closest("[data-act]");
      const act = el?.getAttribute("data-act");
      if (!act) return;
      if (!started) {
        started = true;
        options.onStarted?.({ formId: FORM_ID, responseId: "" });
      }
      if (act === "yes") show("service");
      else if (act === "service") {
        service = el?.getAttribute("data-value") ?? service;
        show("service");
      } else if (act === "next") show("last");
      else if (act === "submit") {
        options.onSubmit?.({
          formId: FORM_ID,
          responseId: `practice${Math.random().toString(36).slice(2, 10)}`,
        });
        show("ending");
      } else if (act === "ending")
        options.onEndingButtonClick?.({ formId: FORM_ID });
    });
    show("details");
    // A container already placed (the deck's frame) keeps its place.
    if (getComputedStyle(options.container).position === "static")
      options.container.style.position = "relative";
    options.container.append(box);
    const ready = window.setTimeout(
      () => options.onReady?.({ formId: FORM_ID, isClosed: false }),
      200,
    );
    return {
      unmount: () => {
        window.clearTimeout(ready);
        box.remove();
      },
    };
  };
}
