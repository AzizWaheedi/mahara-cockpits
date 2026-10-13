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

// A page file (script or CSS) that fails to load, usually because a deploy
// replaced it while this tab was open: reload once to pick up the new build.
// The flag stops a reload loop if the file is really missing.
const RELOADED = "sales-preload-reloaded";
window.addEventListener("vite:preloadError", event => {
  if (sessionStorage.getItem(RELOADED)) return;
  sessionStorage.setItem(RELOADED, "1");
  event.preventDefault();
  window.location.reload();
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
