/**
 * The Lead page section and question editor against the real page, without
 * signing in. Serve the page's build on :5191 (the "mergestudio-form" launch
 * entry), `bun run harness`, then open /page-form-harness.html
 * (light: ?theme=light; a failed read: ?fail=read).
 *
 * The fixture is the page's own dist/form.json, copied to
 * tmp/harness/mergestudio-form.json (ignored by git and Vercel). The server
 * is stood in for in memory, with the same rules (pageForm.ts) it uses.
 */
import "@/components/ceo/ceo.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LeadPageSection } from "@/components/pageform/LeadPageSection";
import { Toaster } from "@/components/ui/sonner";
import type { PageFormSpec } from "@/lib/pageForm";
import { usePageForms } from "@/lib/pageFormClient";
import { ThemeProvider } from "@/lib/theme";
import { answerWith, fakeServer } from "./pageFormFake";
import "@/index.css";

const SITE = "http://localhost:5191";
function Demo() {
  const read = usePageForms("mergestudio.kw");
  return (
    <div className="ceo-root mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">mergestudio.kw</h2>
      <LeadPageSection read={read} />
    </div>
  );
}

async function main() {
  const built = (await fetch("/tmp/harness/mergestudio-form.json").then(r =>
    r.json(),
  )) as PageFormSpec & { version: string };
  // The section's calls go through mediaAction, answered here.
  answerWith(fakeServer(built, SITE));
  const light =
    new URLSearchParams(window.location.search).get("theme") === "light";
  window.localStorage.setItem("mahara-cockpit-theme", light ? "light" : "dark");
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <ThemeProvider>
        <Toaster />
        <Demo />
      </ThemeProvider>
    </StrictMode>,
  );
}

void main();
