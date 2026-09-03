import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { reloadForStaleChunk } from "@/lib/lazyWithReload";

// A fresh deploy renames every hashed chunk. An open tab that then preloads or
// lazy-loads a route 404s on the old name; Vite raises `vite:preloadError` for
// it. Reload once (rate-limited) to pick up the new build instead of crashing.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadForStaleChunk();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
