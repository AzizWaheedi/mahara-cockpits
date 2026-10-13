import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { PageBoundary } from "./components/PageBoundary";
import "./index.css";
import { startClarity } from "./lib/clarity";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in the page");

// Recordings of real use, every word masked; off until the id is set.
startClarity("sales");

// A page file that fails to load, usually because a deploy replaced it while
// this tab was open: reload once to pick up the new build. If it still fails
// after that reload and it is only a stylesheet, open the page anyway
// (unstyled beats a dead end); a missing script still reaches PageBoundary.
const RELOADED = "sales-preload-reloaded";
window.addEventListener("vite:preloadError", event => {
  const message = String(
    (event as Event & { payload?: Error }).payload?.message ?? "",
  );
  if (!sessionStorage.getItem(RELOADED)) {
    sessionStorage.setItem(RELOADED, "1");
    event.preventDefault();
    window.location.reload();
    return;
  }
  if (/preload CSS/i.test(message)) event.preventDefault();
});
window.setTimeout(() => sessionStorage.removeItem(RELOADED), 10_000);

createRoot(root).render(
  <StrictMode>
    <PageBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <App />
      </BrowserRouter>
    </PageBoundary>
  </StrictMode>,
);
