// The Records window's page (records.html), opened by the Rust core
// (src-tauri/src/records_window.rs).

import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import { RecordsApp } from "./components/records/RecordsApp";
import { AppErrorBoundary } from "./components/shared/AppErrorBoundary";
import { log, toErrorFields, initLogging } from "./repositories";
import { installWindowActivity } from "./repositories/window-activity";
import { denyUnhandledExternalDrop } from "./utils/externalDropBoundary";

void initLogging();

// Quiets the focus ring while the native window is inactive.
installWindowActivity();

window.addEventListener("dragover", denyUnhandledExternalDrop);
window.addEventListener("drop", denyUnhandledExternalDrop);

window.addEventListener("error", (event) => {
  log.error("uncaught error", {
    window: "records",
    ...toErrorFields(event.error ?? event.message),
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  log.error("unhandled promise rejection", { window: "records", ...toErrorFields(event.reason) });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RecordsApp search={window.location.search} />
    </AppErrorBoundary>
  </React.StrictMode>,
);
