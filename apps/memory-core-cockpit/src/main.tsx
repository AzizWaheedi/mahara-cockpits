import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html is missing the #root element.");
}

if (!url) {
  // A build without the backend address is a configuration mistake, and it
  // says which one instead of failing silently on the first query.
  container.innerHTML =
    '<div style="font-family: system-ui; padding: 2rem; max-width: 40rem">' +
    '<h1 style="font-size: 1.1rem">This build has no Convex address</h1>' +
    '<p style="color: #555; line-height: 1.6">Set VITE_CONVEX_URL when building the site — ' +
    "scripts/ship.sh passes the deployment URL for this app. " +
    "Until then nothing can be read or written.</p></div>";
} else {
  createRoot(container).render(
    <StrictMode>
      <ConvexProvider client={new ConvexReactClient(url)}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}
