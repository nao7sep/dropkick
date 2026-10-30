// @vitest-environment happy-dom

// The Records window over 10,000 stored records while more keep arriving: the
// first page, live records at the top, a list that holds still while scrolled
// down, and every record paged once, in order, on the way down. The store is
// an in-memory copy of the core's query (newest first, 100 a page, after a
// time-and-id cursor), and the list's scroll box is laid out from its rows,
// since happy-dom lays nothing out.

import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RecordDetail, RecordsPage, RecordsQuery, RecordSources, RecordSummary } from "../../../src/models/records";
import { mount, type Mounted } from "../../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: () => Promise.resolve() }) }));
vi.mock("../../../src/repositories/window-activity", () => ({ closeCurrentWindow: vi.fn() }));

const records = vi.hoisted(() => ({
  readRecordsPage: vi.fn<(query: RecordsQuery) => Promise<RecordsPage>>(),
  readRecordDetail: vi.fn<(id: number) => Promise<RecordDetail | null>>(),
  readRecordSources: vi.fn<() => Promise<RecordSources>>(),
  changed: null as (() => void) | null,
}));

vi.mock("../../../src/repositories/records", () => ({
  readRecordsPage: records.readRecordsPage,
  readRecordDetail: records.readRecordDetail,
  readRecordSources: records.readRecordSources,
  commitRecordsListWidth: () => Promise.resolve(),
  onRecordsChanged: (listener: () => void) => {
    records.changed = listener;
    return () => {
      records.changed = null;
    };
  },
}));

import { RecordsWindow } from "../../../src/components/records/RecordsWindow";
import { RECORDS_LIST_WIDTH } from "../../../src/utils/recordsWindowSizing";

const SESSION = "2026-10-02T08:00:00.000Z";
const SEED = 10_000;
const PAGE_SIZE = 100;
const ROW_HEIGHT = 50;
const VIEW_HEIGHT = 500;
// Three records a second, as a busy launch logs them.
const ARRIVAL_MS = 333;

// Oldest first; ids and times rise together, as the core stores them.
const stored: RecordSummary[] = [];
let clock = Date.parse(SESSION);
function store(message: string): RecordSummary {
  clock += 7;
  const record: RecordSummary = {
    id: stored.length + 1, session: SESSION, time: new Date(clock).toISOString(), level: "info", message, taskId: null,
  };
  stored.push(record);
  return record;
}

function page({ after }: RecordsQuery): RecordsPage {
  const newestFirst = [...stored].reverse();
  const start = after === null ? 0 : newestFirst.findIndex((record) =>
    record.time < after.time || (record.time === after.time && record.id < after.id));
  const rows = start === -1 ? [] : newestFirst.slice(start, start + PAGE_SIZE + 1);
  return { records: rows.slice(0, PAGE_SIZE), more: rows.length > PAGE_SIZE };
}

const box = { scrollTop: 0 };
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const scrollBox = () => listbox().parentElement!;
const isScroll = (element: HTMLElement) => element.firstElementChild?.getAttribute("role") === "listbox";
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')!;
const contentHeight = () => listbox().childElementCount * ROW_HEIGHT;
const ids = () => options().map((option) => Number(option.id.replace("record-option-", "")));
const shownAt = (top: number) => ids()[Math.floor(top / ROW_HEIGHT)];
const loadingMore = () => listbox().lastElementChild?.tagName === "P";
const lastShown = () => Number(listbox().lastElementChild?.id.replace("record-option-", ""));

let mounted: Mounted | null = null;

beforeEach(() => {
  stored.length = 0;
  for (let n = 1; n <= SEED; n++) store(`seed record ${n}`);
  records.readRecordsPage.mockReset().mockImplementation(async (query) => page(query));
  records.readRecordDetail.mockReset().mockImplementation(async (id) => ({ ...stored[id - 1]!, fields: "{}" }));
  records.readRecordSources.mockReset().mockResolvedValue({ currentSession: SESSION, sessions: [SESSION] });
  box.scrollTop = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.scrollTop : 0;
      },
      set(this: HTMLElement, value: number) {
        if (isScroll(this)) box.scrollTop = Math.max(0, Math.min(value, contentHeight() - VIEW_HEIGHT));
      },
    },
    scrollHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? contentHeight() : 0; } },
    clientHeight: { configurable: true, get(this: HTMLElement) { return isScroll(this) ? VIEW_HEIGHT : 0; } },
    clientWidth: { configurable: true, get: () => 2000 },
  });
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ["scrollTop", "scrollHeight", "clientHeight", "clientWidth"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

const scrollTo = async (top: number) => {
  await act(async () => {
    scrollBox().scrollTop = top;
    scrollBox().dispatchEvent(new Event("scroll"));
  });
};

// One record stored, its signal sent, and the time to the next one passed.
let live = 0;
const arrive = async (): Promise<RecordSummary> => {
  const record = store(`live record ${++live}`);
  await act(async () => {
    records.changed!();
    vi.advanceTimersByTime(ARRIVAL_MS);
  });
  return record;
};

it("pages, updates live and holds still over 10,000 records arriving live", async () => {
  mounted = await mount(createElement(RecordsWindow, { initialListWidth: RECORDS_LIST_WIDTH.default, timeZone: "UTC" }));
  vi.useFakeTimers();

  // The first page: the 100 newest, newest first.
  expect(ids()).toEqual(stored.slice(-PAGE_SIZE).map((record) => record.id).reverse());

  // At the top, a record stored now reaches the top on its own.
  let newest = await arrive();
  for (let index = 0; index < 3; index++) newest = await arrive();
  expect(ids()[0]).toBe(newest.id);

  // Scrolled down with a record selected, stored records move nothing.
  await act(async () => vi.advanceTimersByTime(1000));
  await scrollTo(3000);
  const before = { top: box.scrollTop, first: shownAt(3000), count: options().length };
  const target = shownAt(3000 + ROW_HEIGHT)!;
  await act(async () => document.getElementById(`record-option-${target}`)!.click());
  for (let index = 0; index < 5; index++) await arrive();
  await act(async () => vi.advanceTimersByTime(1000));
  expect({ top: box.scrollTop, first: shownAt(box.scrollTop), count: options().length }).toEqual(before);
  expect(document.getElementById(`record-option-${target}`)!.getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector("h2")?.textContent).toBe(stored[target - 1]!.message);

  // Back at the top, everything stored meanwhile is there, and the selection
  // and its detail stayed.
  await scrollTo(0);
  expect(ids()[0]).toBe(stored.at(-1)!.id);
  expect(options().length).toBe(before.count + 5);
  expect(document.getElementById(`record-option-${target}`)!.getAttribute("aria-selected")).toBe("true");
  expect(records.readRecordDetail).toHaveBeenCalledOnce();

  // Walking down a screen at a time, while records keep arriving, reads each
  // older page once and ends with every record shown once, in order.
  await scrollTo(1);
  const cursors = new Set<string>();
  for (let step = 0; step < 2 * SEED / (VIEW_HEIGHT / ROW_HEIGHT); step++) {
    if (!loadingMore() && lastShown() === 1) break;
    await arrive();
    await scrollTo(box.scrollTop + VIEW_HEIGHT);
  }
  for (const [query] of records.readRecordsPage.mock.calls) {
    if (query.after === null) continue;
    const key = `${query.after.time}/${query.after.id}`;
    expect(cursors.has(key)).toBe(false);
    cursors.add(key);
  }
  const walked = ids();
  expect(walked.at(-1)).toBe(1);
  expect(walked).toEqual(Array.from({ length: walked[0]! }, (_, index) => walked[0]! - index));
  expect(walked.length).toBeGreaterThan(SEED);

  // The records stored during the walk wait for the top, then all are shown.
  await scrollTo(0);
  expect(ids()).toEqual(stored.map((record) => record.id).reverse());
}, 0);
