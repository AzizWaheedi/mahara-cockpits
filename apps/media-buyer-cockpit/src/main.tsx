import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "./lib/theme";

// The app shell installs and updates on its own; a new build takes over on
// the next load, and the numbers were never cached in the first place.
registerSW({ immediate: true });

// The auth library asks the browser to show "changes may not be saved" while
// it is refreshing a token. Nothing here is unsaved, and the prompt fires on
// every cockpit switch that lands during a refresh, so the ask is dropped
// before it reaches the browser. The next page load refreshes again.
window.addEventListener("beforeunload", e => e.stopImmediatePropagation(), {
  capture: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
