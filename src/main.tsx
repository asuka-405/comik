import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { isNativeShell } from "./core/platform";

if (import.meta.env.PROD && !isNativeShell && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => console.error("Service worker registration failed", error));
  });
}

// Packaged shells serve static files with no SPA fallback, so they route with the hash.
const application = isNativeShell
  ? <HashRouter><App /></HashRouter>
  : <BrowserRouter basename="/web"><App /></BrowserRouter>;

createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary scope="app">{application}</ErrorBoundary></StrictMode>);
