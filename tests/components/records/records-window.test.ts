// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordDetail, RecordsPage, RecordsQuery, RecordSources, RecordSummary } from "../../../src/models/records";
import { mount, type Mounted } from "../../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

const nativeWindow = vi.hoisted(() => ({ setTitle: vi.fn((_title: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));

const records = vi.hoisted(() => ({
  readRecordsPage: vi.fn<(query: RecordsQuery) => Promise<RecordsPage>>(),
  readRecordDetail: vi.fn<(id: number) => Promise<RecordDetail | null>>(),
  readRecordSources: vi.fn<() => Promise<RecordSources>>(),
  commitRecordsListWidth: vi.fn<(width: number) => Promise<void>>(),
  changed: null as (() => void) | null,
}));

vi.mock("../../../src/repositories/records", () => ({
  readRecordsPage: records.readRecordsPage,
  readRecordDetail: records.readRecordDetail,
  readRecordSources: records.readRecordSources,
  commitRecordsListWidth: records.commitRecordsListWidth,
  onRecordsChanged: (listener: () => void) => {
    records.changed = listener;
    return () => {
      records.changed = null;
    };
  },
}));

import { RecordsWindow } from "../../../src/components/records/RecordsWindow";
import { RECORDS_LIST_WIDTH, RECORDS_DETAIL_MIN_WIDTH } from "../../../src/utils/recordsWindowSizing";
import { SPLITTER_WIDTH } from "../../../src/utils/windowSizing";

const SESSION = "2026-10-02T08:00:00.000Z";

function summary(id: number, time: string, level: RecordSummary["level"], message: string): RecordSummary {
  return { id, session: SESSION, time, level, message, taskId: null };
}

const error = summary(4, "2026-10-02T08:01:00.000Z", "error", "command error");
const warn = summary(9, "2026-10-02T08:00:30.000Z", "warn", "window placement could not be loaded");
const newer = summary(12, "2026-10-02T08:02:00.000Z", "info", "view state updated");

const errorDetail: RecordDetail = {
  ...error,
  taskId: "task-1",
  fields: JSON.stringify({ command: "hash_file", error: { message: "denied" } }),
};

// happy-dom lays nothing out, so the list's scroll box and the window's width
// are set here. By default the list is scrolled to the top and far from its end.
const box = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 };
const resizeCallbacks = new Set<() => void>();
class TestResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe(): void {
    resizeCallbacks.add(this.callback);
  }
  disconnect(): void {
    resizeCallbacks.delete(this.callback);
  }
}
const isScroll = (element: HTMLElement) => element.firstElementChild?.getAttribute("role") === "listbox";
const isShell = (element: HTMLElement) =>
  Array.from(element.children).some((child) => child.getAttribute("role") === "separator");

let mounted: Mounted | null = null;

beforeEach(() => {
  records.readRecordsPage.mockReset();
  records.readRecordsPage.mockResolvedValue({ records: [error, warn], more: false });
  records.readRecordDetail.mockReset();
  records.readRecordDetail.mockResolvedValue(errorDetail);
  records.readRecordSources.mockReset();
  records.readRecordSources.mockResolvedValue({ currentSession: SESSION, sessions: [SESSION, "2026-10-01T08:00:00.000Z"] });
  records.commitRecordsListWidth.mockReset();
  records.commitRecordsListWidth.mockResolvedValue();
  records.changed = null;
  Object.assign(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 });
  resizeCallbacks.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.scrollTop : 0;
      },
      set(this: HTMLElement, value: number) {
        if (isScroll(this)) box.scrollTop = value;
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.scrollHeight : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.clientHeight : 0;
      },
    },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return isShell(this) ? box.shellWidth : 0;
      },
    },
  });
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  document.body.className = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ["scrollTop", "scrollHeight", "clientHeight", "clientWidth"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

async function render(): Promise<void> {
  mounted = await mount(createElement(RecordsWindow, { initialListWidth: RECORDS_LIST_WIDTH.default, timeZone: "UTC" }));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')!;
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const messages = () => options().map((option) => option.lastElementChild?.textContent);
const lastQuery = (): RecordsQuery => records.readRecordsPage.mock.calls.at(-1)![0];
const listPane = () => listbox().closest("section")!;
const scrollTo = async (top: number, events = 1) => {
  await act(async () => {
    box.scrollTop = top;
    for (let index = 0; index < events; index++) listbox().parentElement!.dispatchEvent(new Event("scroll"));
  });
};
const press = async (key: string) => {
  await act(async () => {
    listbox().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};
const signal = async () => {
  await act(async () => records.changed!());
};
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("RecordsWindow", () => {
  it("lists the records newest first, with nothing selected and every filter off", async () => {
    await render();

    expect(messages()).toEqual(["command error", "window placement could not be loaded"]);
    expect(lastQuery()).toEqual({ session: null, level: null, search: "", after: null });
    expect(document.body.textContent).toContain("Select a record to see everything it holds.");
    expect(listbox().tabIndex).toBe(0);
    expect(listbox().hasAttribute("aria-activedescendant")).toBe(false);
    expect(options().every((option) => !option.hasAttribute("tabindex"))).toBe(true);
  });

  it("shows everything a selected record holds", async () => {
    await render();
    await act(async () => options()[0]!.click());

    expect(records.readRecordDetail).toHaveBeenCalledWith(4);
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(listbox().getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
    const region = document.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.textContent).toContain("task-1");
    expect(region.textContent).toContain("2026");
    expect(region.textContent).toContain("(this launch)");
    expect(region.querySelector("pre")?.textContent).toBe(
      JSON.stringify({ command: "hash_file", error: { message: "denied" } }, null, 2),
    );
    expect(document.querySelector("h2")?.textContent).toBe("command error");
  });

  it("leaves out the details block when a record holds no other fields", async () => {
    records.readRecordDetail.mockResolvedValue({ ...warn, fields: "{}" });
    await render();
    await act(async () => options()[1]!.click());

    expect(document.querySelector('[role="region"] pre')).toBeNull();
  });

  it("moves the selection with the arrow keys, Home and End", async () => {
    await render();
    await press("ArrowDown");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");

    await press("ArrowDown");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(records.readRecordDetail).toHaveBeenLastCalledWith(9);

    await press("Home");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    await press("End");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    await press("ArrowDown");
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("reads again with each filter, and searches once typing pauses", async () => {
    await render();
    const [launch, level] = Array.from(document.querySelectorAll("select"));
    expect(Array.from(launch!.options).map((option) => option.textContent)).toEqual([
      "All launches",
      expect.stringContaining("(this launch)"),
      expect.not.stringContaining("(this launch)"),
    ]);
    expect(Array.from(level!.options).map((option) => option.textContent)).toEqual([
      "All levels",
      "Needs attention",
      "Error",
      "Warning",
      "Info",
      "Debug",
    ]);
    expect(level!.value).toBe("");

    await choose(launch!, SESSION);
    await choose(level!, "attention");
    expect(lastQuery()).toEqual({ session: SESSION, level: "attention", search: "", after: null });

    vi.useFakeTimers();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(search, "denied");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(299));
    expect(lastQuery().search).toBe("");
    await act(async () => vi.advanceTimersByTime(1));
    expect(lastQuery().search).toBe("denied");
  });

  it("shows a loading note while the first page is read, then the rows", async () => {
    const first = deferred<RecordsPage>();
    records.readRecordsPage.mockReturnValueOnce(first.promise);
    await render();

    expect(document.body.textContent).toContain("Loading records…");
    expect(document.body.textContent).not.toContain("No records match these filters.");
    expect(options()).toHaveLength(0);
    expect(listbox().tabIndex).toBe(0);

    await act(async () => first.resolve({ records: [error, warn], more: false }));
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Loading records…");
  });

  it("says when no record matches, and fills again when one does", async () => {
    records.readRecordsPage.mockResolvedValueOnce({ records: [], more: false });
    await render();
    expect(document.body.textContent).toContain("No records match these filters.");
    expect(listbox().tabIndex).toBe(0);

    records.readRecordsPage.mockResolvedValueOnce({ records: [error], more: false });
    await choose(document.querySelectorAll("select")[1]!, "error");
    expect(options()).toHaveLength(1);
    expect(document.body.textContent).not.toContain("No records match these filters.");
  });

  it("says when the records cannot be read, without the raw error", async () => {
    records.readRecordsPage.mockRejectedValue("SQLITE_CORRUPT /Users/someone/.dropkick/records.sqlite3");
    await render();

    expect(document.body.textContent).toContain("The records could not be read.");
    expect(document.body.textContent).not.toContain("SQLITE_CORRUPT");
  });

  it("has no button to refresh or to load more", async () => {
    records.readRecordsPage.mockResolvedValueOnce({ records: [error, warn], more: true });
    records.readRecordsPage.mockResolvedValueOnce({ records: [], more: false });
    await render();
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("reads the next page from the last row once the list is scrolled near its end", async () => {
    records.readRecordsPage.mockResolvedValueOnce({ records: [error], more: true });
    records.readRecordsPage.mockResolvedValueOnce({ records: [warn], more: false });
    await render();
    expect(records.readRecordsPage).toHaveBeenCalledOnce();

    await scrollTo(700);

    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(lastQuery().after).toEqual({ time: error.time, id: error.id });
    expect(messages()).toEqual(["command error", "window placement could not be loaded"]);
  });

  it("reads the next page when ArrowDown is pressed on the last row", async () => {
    records.readRecordsPage.mockResolvedValueOnce({ records: [error, warn], more: true });
    records.readRecordsPage.mockResolvedValueOnce({ records: [], more: false });
    await render();
    await press("End");
    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(lastQuery().after).toEqual({ time: warn.time, id: warn.id });
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("makes one request for two scroll events together", async () => {
    records.readRecordsPage.mockResolvedValueOnce({ records: [error, warn], more: true });
    records.readRecordsPage.mockReturnValueOnce(new Promise<RecordsPage>(() => {}));
    await render();

    await scrollTo(800, 2);

    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).toContain("Loading records…");
  });

  it("reads the next page by itself while a page does not fill the list", async () => {
    box.scrollHeight = 150;
    records.readRecordsPage.mockResolvedValueOnce({ records: [error], more: true });
    records.readRecordsPage.mockResolvedValueOnce({ records: [warn], more: false });
    await render();

    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(messages()).toEqual(["command error", "window placement could not be loaded"]);
  });

  it("keeps a failed page's note at the end, and reads it again when the end is reached again", async () => {
    records.readRecordsPage.mockResolvedValueOnce({ records: [error], more: true });
    records.readRecordsPage.mockRejectedValueOnce("busy");
    records.readRecordsPage.mockResolvedValueOnce({ records: [warn], more: false });
    await render();

    await scrollTo(700);
    expect(document.body.textContent).toContain("The records could not be read.");
    expect(options()).toHaveLength(1);
    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);

    await scrollTo(750);
    expect(records.readRecordsPage).toHaveBeenCalledTimes(3);
    expect(lastQuery().after).toEqual({ time: error.time, id: error.id });
    expect(messages()).toEqual(["command error", "window placement could not be loaded"]);
    expect(document.body.textContent).not.toContain("The records could not be read.");
  });

  it("re-reads the newest page once for a burst of new records while at the top, keeping the rows shown", async () => {
    await render();
    vi.useFakeTimers();
    const next = deferred<RecordsPage>();
    records.readRecordsPage.mockReturnValueOnce(next.promise);

    await signal();
    await signal();
    await signal();
    await act(async () => vi.advanceTimersByTime(999));
    expect(records.readRecordsPage).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(1));

    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toEqual({ session: null, level: null, search: "", after: null });
    expect(records.readRecordSources).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Loading records…");

    await act(async () => next.resolve({ records: [newer, error, warn], more: false }));
    expect(messages()).toEqual(["view state updated", "command error", "window placement could not be loaded"]);
  });

  it("leaves the list alone while scrolled down, and shows new records once back at the top", async () => {
    await render();
    await scrollTo(300);
    vi.useFakeTimers();
    records.readRecordsPage.mockResolvedValueOnce({ records: [newer, error, warn], more: false });

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(records.readRecordsPage).toHaveBeenCalledOnce();
    expect(options()).toHaveLength(2);

    await scrollTo(0);
    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(messages()).toEqual(["view state updated", "command error", "window placement could not be loaded"]);
  });

  it("keeps the selected record selected through an update", async () => {
    await render();
    await act(async () => options()[1]!.click());
    vi.useFakeTimers();
    records.readRecordsPage.mockResolvedValueOnce({ records: [newer, error, warn], more: false });

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));

    expect(options()).toHaveLength(3);
    expect(options()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(records.readRecordDetail).toHaveBeenCalledOnce();
  });

  it("stops reading on new-record signals after a failed read, until a read succeeds", async () => {
    await render();
    vi.useFakeTimers();
    records.readRecordsPage.mockRejectedValueOnce("busy");

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);

    // The failure the core recorded signals too; it starts no read.
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(records.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);

    // A read the reader asks for succeeds, and signals are heard again.
    await choose(document.querySelectorAll("select")[1]!, "error");
    expect(records.readRecordsPage).toHaveBeenCalledTimes(3);
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(records.readRecordsPage).toHaveBeenCalledTimes(4);
  });

  it("stops listening for new records when it closes", async () => {
    await render();
    expect(records.changed).not.toBeNull();
    await mounted!.unmount();
    mounted = null;
    expect(records.changed).toBeNull();
  });

  it("hands the list width over once when a drag ends, within the pane's bounds", async () => {
    await render();
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!;
    expect(splitter.getAttribute("aria-label")).toBe("Resize list pane");

    await act(async () => {
      splitter.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0 }));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 1000 }));
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 2000 }));
    });
    expect(records.commitRecordsListWidth).not.toHaveBeenCalled();
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(records.commitRecordsListWidth).toHaveBeenCalledExactlyOnceWith(RECORDS_LIST_WIDTH.max);
    expect(listPane().style.width).toBe(`${RECORDS_LIST_WIDTH.max}px`);
  });

  it("narrows the list when the window narrows, handing nothing over", async () => {
    await render();
    expect(listPane().style.width).toBe(`${RECORDS_LIST_WIDTH.default}px`);

    await act(async () => {
      box.shellWidth = RECORDS_LIST_WIDTH.min + SPLITTER_WIDTH + RECORDS_DETAIL_MIN_WIDTH;
      for (const callback of resizeCallbacks) callback();
    });

    expect(listPane().style.width).toBe(`${RECORDS_LIST_WIDTH.min}px`);
    expect(records.commitRecordsListWidth).not.toHaveBeenCalled();
  });

  it("names itself in the interface language", async () => {
    await render();
    expect(document.title).toBe("Records");
    expect(nativeWindow.setTitle).toHaveBeenLastCalledWith("Records");
  });
});
