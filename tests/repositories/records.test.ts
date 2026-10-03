import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  emitTo: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlistened: [] as string[],
  register: null as null | Promise<void>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: tauri.emitTo,
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    await tauri.register;
    tauri.listeners.set(event, handler);
    return () => {
      tauri.unlistened.push(event);
      tauri.listeners.delete(event);
    };
  },
}));

import {
  commitRecordsListWidth,
  onRecordsChanged,
  onRecordsContext,
  onRecordsListWidthCommitted,
  openRecordsWindow,
  readRecordDetail,
  readRecordSources,
  readRecordsPage,
  sendRecordsContext,
} from "../../src/repositories/records";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockResolvedValue(undefined);
  tauri.emitTo.mockReset();
  tauri.emitTo.mockResolvedValue(undefined);
  tauri.listeners.clear();
  tauri.unlistened.length = 0;
  tauri.register = null;
});

describe("records commands", () => {
  it("names the Rust core's commands and arguments", async () => {
    const query = { session: null, level: "attention" as const, search: "x", after: { time: "t", id: 3 } };
    await readRecordsPage(query);
    await readRecordSources();
    await readRecordDetail(7);
    const opening = {
      minWidth: 744,
      minHeight: 257,
      listWidth: 380,
      language: "ja" as const,
      locale: "ja-JP",
      timeZone: null,
      theme: "dark" as const,
    };
    await openRecordsWindow(opening);

    expect(tauri.invoke.mock.calls).toEqual([
      ["read_records_page", { query }],
      ["read_record_sources"],
      ["read_record_detail", { id: 7 }],
      ["open_records_window", { context: opening }],
    ]);
  });
});

describe("records events", () => {
  it("sends the settings to the Records window and the width to the main window", async () => {
    await sendRecordsContext({ language: "de", locale: "de-DE", timeZone: "Europe/Berlin" });
    await commitRecordsListWidth(412);

    expect(tauri.emitTo.mock.calls).toEqual([
      ["records", "records-context", { language: "de", locale: "de-DE", timeZone: "Europe/Berlin" }],
      ["main", "records-list-width", 412],
    ]);
  });

  it("hands each payload to its listener until it stops listening", async () => {
    const changed = vi.fn();
    const context = vi.fn();
    const width = vi.fn();
    const stops = [onRecordsChanged(changed), onRecordsContext(context), onRecordsListWidthCommitted(width)];
    await flush();

    tauri.listeners.get("records-changed")!({ payload: null });
    tauri.listeners.get("records-context")!({ payload: { language: "fr", locale: "fr", timeZone: null } });
    tauri.listeners.get("records-list-width")!({ payload: 500 });
    expect(changed).toHaveBeenCalledOnce();
    expect(context).toHaveBeenCalledWith({ language: "fr", locale: "fr", timeZone: null });
    expect(width).toHaveBeenCalledWith(500);

    for (const stop of stops) stop();
    expect(tauri.unlistened.sort()).toEqual(["records-changed", "records-context", "records-list-width"]);
  });

  it("stops a listener that is still registering once it registers", async () => {
    let release!: () => void;
    tauri.register = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = onRecordsChanged(vi.fn());
    stop();
    release();
    await flush();

    expect(tauri.unlistened).toEqual(["records-changed"]);
    expect(tauri.listeners.size).toBe(0);
  });
});
