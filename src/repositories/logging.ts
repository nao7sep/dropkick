// Frontend logging. The sandboxed webview never writes a record itself; it
// builds the envelope and forwards each structured event to the Rust core (the
// `log_event` command), which owns the records database and writes each entry
// as it arrives. If forwarding fails, this degrades to the console and never
// throws — logging must never break the app.
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

// The native writer uses the same allowance: several ordinary action bursts.
// Keep full admitted diagnostics, with one compact gap record under pressure.
const FORWARD_CAPACITY = 256;
const pending: Record<string, unknown>[] = [];
let forwarding: Promise<void> | null = null;
let overflow: { count: number; levels: Partial<Record<Level, number>>; first: string; last: string } | null = null;

function startForwarding(): void {
  if (forwarding) return;
  forwarding = Promise.resolve().then(async () => {
    let preferGap = false;
    while (pending.length || overflow) {
      let entry: Record<string, unknown>;
      if (overflow && (preferGap || pending.length === 0)) {
        preferGap = false;
        entry = { ...overflow, time: new Date().toISOString(), level: "warn",
          message: "diagnostic queue overflow", source: "frontend" };
        overflow = null;
      } else { entry = pending.shift()!; preferGap = true; }
      try {
        await invoke<void>("log_event", { entry });
      } catch (forwardError) {
        const consoleFn = entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.log;
        consoleFn(`[dropkick:log:${entry.level}] ${entry.message}`, entry, "(forward failed)", forwardError);
      }
    }
  }).finally(() => {
    forwarding = null;
    if (pending.length || overflow) startForwarding();
  });
}

function emit(level: Level, message: string, fields?: LogFields): void {
  if (level === "debug" && !debugEnabled()) return;
  const time = new Date().toISOString();
  const entry = { ...fields, time, level, message };
  if (pending.length === FORWARD_CAPACITY) {
    overflow ??= { count: 0, levels: {}, first: time, last: time };
    overflow.count += 1;
    overflow.levels[level] = (overflow.levels[level] ?? 0) + 1;
    overflow.last = time;
  } else { pending.push(entry); }
  startForwarding();
}

// A close may wait only for its remaining lifetime. Timeout does not cancel
// the owned forwarding operation or claim that stranded events were delivered.
export async function flushForwarded(boundMs: number): Promise<boolean> {
  if (!forwarding) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      forwarding.then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, boundMs)); }),
    ]);
  } finally { clearTimeout(timer); }
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

// Standard fields for a failed load/parse result (the missing/invalid/newer/
// error arms of the repositories' discriminated unions). Centralizes the `path`
// + `status` + optional `error.message` or `formatVersion` shape so every
// load-failure log line is uniform while preserving the envelope's reserved
// `message` key.
export function loadFailureFields(
  path: string,
  result: { status: string; message?: string; formatVersion?: number },
): LogFields {
  const fields: LogFields = { path, status: result.status };
  if (result.message !== undefined) fields.error = { message: result.message };
  if (result.formatVersion !== undefined) fields.formatVersion = result.formatVersion;
  return fields;
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
