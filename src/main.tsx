import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Global error handlers — catch anything that slips past React's ErrorBoundary.
window.addEventListener("error", (event) => {
  console.error("[global] Uncaught error:", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[global] Unhandled promise rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
