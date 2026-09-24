import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { PageBoundary } from "./components/PageBoundary";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root in the page");

createRoot(root).render(
  <StrictMode>
    <PageBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <App />
      </BrowserRouter>
    </PageBoundary>
  </StrictMode>,
);
