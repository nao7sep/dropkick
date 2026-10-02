// Frontend logging. The sandboxed webview never writes a record itself; it
// builds the envelope and forwards each structured event to the Rust core (the
// `log_event` command), which owns the records database and writes each entry
// as it arrives (see src-tauri/src/logging.rs). If forwarding fails, this
// degrades to the console and never throws — logging must never break the app.
//
// Levels: error / warn / info / debug. `debug` is developer-only — emitted only
// in a Vite dev build or when the core reports DROPKICK_DEBUG=1 — so the
// per-frame / per-keystroke firehose costs nothing on an end user's machine.

import { invoke } from "@tauri-apps/api/core";

export type LogFields = Record<string, unknown>;

type Level = "debug" | "info" | "warn" | "error";

// The debug gate. `debug` events are dropped (never written) unless this is a
// Vite dev build or the core reports DROPKICK_DEBUG=1. This is a RUNTIME check,
// not dead-code elimination: `import.meta.env.DEV` folds to a constant, but it is
// OR'd with the runtime `runtimeDebug`, so debug call sites are NOT removed in a
// production build — emit() returns at the gate, but the field-arg object is
// still built at the call site. Keep debug field args cheap; don't put expensive
// work (e.g. a full toErrorFields walk) in a debug call expecting it to be free.
//
// Two gates exist by design: this frontend gate avoids forwarding the
// per-frame/per-keystroke firehose over IPC, while the Rust core re-gates as the
// authoritative writer. `runtimeDebug` mirrors the core's gate and is fetched
// once in initLogging(); until that resolves (a brief startup window) a packaged
// DROPKICK_DEBUG=1 build falls back to the dev default, so the earliest frontend
// debug events in that mode may not be forwarded.
let runtimeDebug = false;

function debugEnabled(): boolean {
  return import.meta.env.DEV || runtimeDebug;
}

// The last entry forwarded; the next one is sent once it settles.
let forwarding: Promise<void> = Promise.resolve();

function emit(level: Level, message: string, fields?: LogFields): void {
  if (level === "debug" && !debugEnabled()) return;

  // `time` is stamped at the event instant (UTC ISO 8601 ms + Z). Fields are
  // spread first and the envelope keys last, so a field that happens to be named
  // `time` / `level` / `message` can never clobber the envelope.
  const entry: Record<string, unknown> = {
    ...fields,
    time: new Date().toISOString(),
    level,
    message,
  };

  // Forward to the core (the authoritative writer).
  // Fire-and-forget so logging never blocks the UI. Each entry waits for the
  // previous one, because the core writes off the UI thread and two entries in
  // flight at once could be written out of order. On failure, degrade to the
  // console — never swallow, never throw. The invoke is deferred into a promise
  // chain so a synchronous throw (or a non-promise return) can never escape.
  forwarding = forwarding
    .then(() => invoke<void>("log_event", { entry }))
    .catch((forwardError) => {
      const consoleFn =
        level === "error"
          ? console.error
          : level === "warn"
            ? console.warn
            : console.log;
      consoleFn(
        `[dropkick:log:${level}] ${message}`,
        entry,
        "(forward failed)",
        forwardError,
      );
    });
}

export const log = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};

// Builds an `error` field with full fidelity — name, message, stack, and the
// cause chain — for any caught value. Tauri command rejections surface as plain
// strings, so non-Error values are preserved rather than flattened to "[object].
export function toErrorFields(error: unknown): LogFields {
  return { error: describeError(error) };
}

// Standard fields for a failed load/parse result (the missing/invalid/error
// arms of the repositories' discriminated unions). Centralizes the `path` +
// `status` + optional `error.message` shape so every load-failure log line is
// uniform while preserving the envelope's reserved `message` key.
export function loadFailureFields(
  path: string,
  result: { status: string; message?: string },
): LogFields {
  return result.message !== undefined
    ? { path, status: result.status, error: { message: result.message } }
    : { path, status: result.status };
}

function describeError(error: unknown): unknown {
  if (error instanceof Error) {
    const described: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) described.stack = error.stack;
    // `Error.cause` is ES2022; read it defensively so this does not depend on
    // the project's TS lib target. The Tauri webview supports it at runtime.
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) described.cause = describeError(cause);
    return described;
  }
  if (error !== null && typeof error === "object") {
    return error;
  }
  return { message: String(error) };
}

// Fetches the core's debug gate once at startup, so a packaged build launched
// with DROPKICK_DEBUG=1 also emits frontend debug. Best-effort: on failure the
// import.meta.env.DEV default stands.
export async function initLogging(): Promise<void> {
  try {
    runtimeDebug = await invoke<boolean>("logging_debug_enabled");
  } catch (e) {
    log.warn("logging: could not read debug gate from core", toErrorFields(e));
  }
}
