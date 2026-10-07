import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import "./index.css";
import { startClarity } from "./lib/clarity";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in the page");

// Recordings of real use, every word masked; off until the id is set.
startClarity("editor");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
