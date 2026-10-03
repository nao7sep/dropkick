// The Records window (records.html): records.sqlite3, newest first, beside the
// selected record whole. The Rust core reads the database
// (src-tauri/src/records.rs) and signals after each record it stores; the
// window pages itself as it scrolls and takes new records in as they arrive.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../../i18n/I18nContext";
import type { RecordDetail, RecordLevel, RecordLevelFilter, RecordSources, RecordsQuery, RecordSummary } from "../../models/records";
import { RECORD_LEVEL_FILTERS } from "../../models/records";
import {
  commitRecordsListWidth,
  onRecordsChanged,
  readRecordDetail,
  readRecordSources,
  readRecordsPage,
} from "../../repositories/records";
import { log, toErrorFields } from "../../repositories/logging";
import {
  LEVEL_FILTER_LABELS,
  LEVEL_LABELS,
  cursorAfter,
  hasFields,
  mergeNewestPage,
  prettyJson,
} from "../../services/records";
import { pageStepIndex, stepIndex } from "../../utils/selection";
import { SPLITTER_WIDTH } from "../../utils/windowSizing";
import {
  RECORDS_DETAIL_MIN_WIDTH,
  RECORDS_LIST_MIN_HEIGHT,
  RECORDS_LIST_WIDTH,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH,
  clampRecordsListWidth,
} from "../../utils/recordsWindowSizing";

type Filters = Omit<RecordsQuery, "after">;

const NO_FILTERS: Filters = { session: null, level: null, search: "" };
const SEARCH_DELAY_MS = 300;
// New records are read at most this often while they keep arriving.
const LIVE_INTERVAL_MS = 1000;

type ListState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; records: RecordSummary[]; more: boolean; loadingMore: boolean; moreFailed: boolean };

type DetailState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; record: RecordDetail };

// A level reads in its own colour, on a tint of it.
const LEVEL_PILLS: Record<RecordLevel, string> = {
  error: "bg-danger-surface text-danger",
  warn: "bg-warning-surface text-warning",
  info: "bg-surface-muted text-ink-soft",
  debug: "bg-surface-muted text-ink-muted",
};

const PILL_CLASS =
  "inline-flex shrink-0 items-center rounded-full px-2 text-[11px] font-semibold leading-[18px]";

const NOTE_CLASS = "m-0 p-4 text-sm text-ink-muted";
const FAILED_NOTE_CLASS = "m-0 p-4 text-sm text-danger";

// Within about one screen of the end of what is loaded.
function nearEnd(scroll: HTMLElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= scroll.clientHeight;
}

function atTop(scroll: HTMLElement): boolean {
  return scroll.scrollTop < 1;
}

function optionId(id: number): string {
  return `record-option-${id}`;
}

function LevelPill({ level }: { level: RecordLevel }) {
  const { t } = useI18n();
  return <span className={`${PILL_CLASS} ${LEVEL_PILLS[level]}`}>{t(LEVEL_LABELS[level])}</span>;
}

export function RecordsWindow({ initialListWidth, timeZone }: { initialListWidth: number; timeZone: string | null }) {
  const { t, locale } = useI18n();
  const [sources, setSources] = useState<RecordSources | null>(null);
  const [sourceReads, setSourceReads] = useState(0);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "none" });
  const [listWidth, setListWidth] = useState(initialListWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [available, setAvailable] = useState(0);
  const listGeneration = useRef(0);
  // The busy claim for the next page (PLAYBOOK, Own the work in flight).
  const fetchingMore = useRef(false);
  // The filters the current list was read for, for the live reads below.
  const filtersRef = useRef(filters);
  // New records arrived while the list was scrolled away from the top.
  const newestPending = useRef(false);
  // A failed read is itself logged as a record, whose signal would start the
  // next read; live reads stop after a failure and resume after a read succeeds.
  const liveSuspended = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Pane sizing: window-conventions. The shown width is re-derived from the
  // intent on every resize; only a drag changes the intent.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const measure = () => setAvailable(shell.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    measure();
    return () => observer.disconnect();
  }, []);
  const shownListWidth = clampRecordsListWidth(dragWidth ?? listWidth, available);

  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium", timeZone: timeZone ?? undefined }),
    [locale, timeZone],
  );

  // The window names itself in the interface language, and follows it.
  useEffect(() => {
    const title = t("records.title");
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch((error) => log.warn("window setTitle failed", { title, ...toErrorFields(error) }));
  }, [t]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.search === searchText ? current : { ...current, search: searchText }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    readRecordSources().then(
      (next) => {
        if (!cancelled) setSources(next);
      },
      () => {
        // The core recorded the failure.
        liveSuspended.current = true;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceReads]);

  // A page applies only while the filters it was read for are still the
  // newest ones asked for.
  useEffect(() => {
    filtersRef.current = filters;
    const generation = ++listGeneration.current;
    fetchingMore.current = false;
    newestPending.current = false;
    setList({ status: "loading" });
    readRecordsPage({ ...filters, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = false;
        setList({ status: "ready", records: page.records, more: page.more, loadingMore: false, moreFailed: false });
      },
      () => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = true;
        setList({ status: "failed" });
      },
    );
  }, [filters]);

  // The newest page read again for new records. It joins the rows already
  // shown rather than replacing them, so the list never falls back to the
  // loading note and the pages already read stay. It reads only refs, so one
  // copy serves the live subscription below.
  const readNewest = useCallback((): void => {
    const generation = listGeneration.current;
    readRecordsPage({ ...filtersRef.current, after: null }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = false;
        setList((current) =>
          current.status === "ready"
            ? { ...current, ...mergeNewestPage(current.records, current.more, page) }
            : { status: "ready", records: page.records, more: page.more, loadingMore: false, moreFailed: false },
        );
      },
      () => {
        if (generation !== listGeneration.current) return;
        liveSuspended.current = true;
      },
    );
  }, []);

  // A stored record reaches the list at once while it is scrolled to the top;
  // otherwise it waits until the list is back there, so the list never moves
  // under the reader.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onRecordsChanged(() => {
      if (timer !== null || liveSuspended.current) return;
      timer = setTimeout(() => {
        timer = null;
        setSourceReads((count) => count + 1);
        const scroll = scrollRef.current;
        if (scroll === null || atTop(scroll)) readNewest();
        else newestPending.current = true;
      }, LIVE_INTERVAL_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [readNewest]);

  useEffect(() => {
    if (selected === null) {
      setDetail({ status: "none" });
      return;
    }
    let cancelled = false;
    setDetail({ status: "loading" });
    readRecordDetail(selected).then(
      (record) => {
        if (!cancelled) setDetail(record === null ? { status: "failed" } : { status: "ready", record });
      },
      () => {
        if (!cancelled) setDetail({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Loading more: composite-control-conventions, Integration Points. A failed
  // page is read again when the end is reached again.
  const loadMore = (): void => {
    if (list.status !== "ready" || !list.more || fetchingMore.current) return;
    fetchingMore.current = true;
    const generation = listGeneration.current;
    setList((current) => (current.status === "ready" ? { ...current, loadingMore: true, moreFailed: false } : current));
    readRecordsPage({ ...filters, after: cursorAfter(list.records) }).then(
      (page) => {
        if (generation !== listGeneration.current) return;
        fetchingMore.current = false;
        liveSuspended.current = false;
        setList((current) =>
          current.status === "ready"
            ? { ...current, records: [...current.records, ...page.records], more: page.more, loadingMore: false }
            : current,
        );
      },
      () => {
        if (generation !== listGeneration.current) return;
        fetchingMore.current = false;
        liveSuspended.current = true;
        setList((current) => (current.status === "ready" ? { ...current, loadingMore: false, moreFailed: true } : current));
      },
    );
  };

  // A page that leaves the list short of the end reads the next one; a failed
  // page waits for the reader instead.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (list.status !== "ready" || list.loadingMore || list.moreFailed || scroll === null) return;
    if (nearEnd(scroll)) loadMore();
    // Only a new list state can change what is loaded.
  }, [list]);

  const onListScroll = (): void => {
    const scroll = scrollRef.current;
    if (scroll === null) return;
    if (newestPending.current && atTop(scroll)) {
      newestPending.current = false;
      readNewest();
    }
    if (nearEnd(scroll)) loadMore();
  };

  const records = list.status === "ready" ? list.records : [];
  const selectedIndex = selected === null ? -1 : records.findIndex((record) => record.id === selected);

  // The selected row is kept in view as the keyboard moves it.
  useEffect(() => {
    if (selected === null) return;
    document.getElementById(optionId(selected))?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  // The list is one listbox (composite-control-conventions, Listbox): the
  // container holds focus and points at the selected row, and the selection
  // follows the keyboard.
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const length = records.length;
    const pageRows = (): number => {
      const scroll = scrollRef.current;
      const row = listRef.current?.querySelector<HTMLElement>('[role="option"]');
      return scroll && row?.offsetHeight ? Math.max(1, Math.floor(scroll.clientHeight / row.offsetHeight)) : 10;
    };
    let target: number;
    switch (event.key) {
      case "ArrowDown":
        target = selectedIndex === -1 ? 0 : stepIndex(selectedIndex, 1, length);
        break;
      case "ArrowUp":
        target = selectedIndex === -1 ? length - 1 : stepIndex(selectedIndex, -1, length);
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = length - 1;
        break;
      case "PageDown":
        target = selectedIndex === -1 ? 0 : pageStepIndex(selectedIndex, 1, pageRows(), length);
        break;
      case "PageUp":
        target = selectedIndex === -1 ? length - 1 : pageStepIndex(selectedIndex, -1, pageRows(), length);
        break;
      default:
        return;
    }
    event.preventDefault();
    const record = records[target];
    if (record === undefined) return;
    setSelected(record.id);
    const forward = event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End";
    if (forward && target === length - 1) loadMore();
  };

  // Drag intent: window-conventions, Content-based minimum size. Only the end
  // of a drag saves, and the main window, which owns state.json, persists it.
  const onSplitterDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = shownListWidth;
    let latest = startWidth;
    document.body.classList.add("divider-dragging");
    const move = (moveEvent: MouseEvent): void => {
      latest = Math.max(
        RECORDS_LIST_WIDTH.min,
        Math.min(RECORDS_LIST_WIDTH.max, Math.round(startWidth + moveEvent.clientX - startX)),
      );
      setDragWidth(latest);
    };
    const up = (): void => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("divider-dragging");
      setListWidth(latest);
      setDragWidth(null);
      commitRecordsListWidth(latest).catch((error) =>
        log.warn("records list width save failed", { width: latest, ...toErrorFields(error) }),
      );
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const launchLabel = (session: string): string => {
    const time = timeFormat.format(new Date(session));
    return session === sources?.currentSession ? t("records.thisLaunch", { time }) : time;
  };

  let listBody: ReactNode;
  if (list.status === "failed") {
    listBody = <p className={FAILED_NOTE_CLASS} role="alert">{t("records.loadFailed")}</p>;
  } else if (list.status === "loading") {
    listBody = <p className={NOTE_CLASS}>{t("records.loading")}</p>;
  } else if (records.length === 0) {
    listBody = <p className={NOTE_CLASS}>{t("records.empty")}</p>;
  } else {
    listBody = records.map((record) => {
      const isSelected = record.id === selected;
      return (
        <div
          key={record.id}
          id={optionId(record.id)}
          role="option"
          aria-selected={isSelected}
          onClick={() => setSelected(record.id)}
          // A flat row: hover and selection are fills, and the keyboard cursor,
          // while the keyboard drives the list, is a ring inside the row.
          className={`mx-1.5 mb-0.5 flex cursor-pointer flex-col gap-0.5 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors duration-[var(--motion)] ${
            isSelected
              ? "bg-primary-surface-strong group-focus-visible:ring-[1.5px] group-focus-visible:ring-inset group-focus-visible:ring-primary-ring"
              : "hover:bg-control-hover"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span className="tabular-nums">{timeFormat.format(new Date(record.time))}</span>
            <LevelPill level={record.level} />
          </div>
          <div className="line-clamp-2 text-sm text-ink [overflow-wrap:anywhere]">{record.message}</div>
        </div>
      );
    });
  }

  return (
    <div
      ref={shellRef}
      className="flex h-screen overflow-hidden bg-background"
      style={{ minWidth: `${RECORDS_WINDOW_MIN_WIDTH}px`, minHeight: `${RECORDS_WINDOW_MIN_HEIGHT}px` }}
    >
      <section
        aria-label={t("records.title")}
        className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface"
        style={{ width: `${shownListWidth}px` }}
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t("records.search")}
            aria-label={t("records.search")}
            className="dk-field w-full"
          />
          <div className="grid grid-cols-2 gap-2">
            <FilterSelect
              label={t("records.launch")}
              value={filters.session}
              allLabel={t("records.allLaunches")}
              options={(sources?.sessions ?? []).map((session) => ({ value: session, label: launchLabel(session) }))}
              onChange={(session) => setFilters({ ...filters, session })}
            />
            <FilterSelect
              label={t("records.level")}
              value={filters.level}
              allLabel={t("records.allLevels")}
              options={RECORD_LEVEL_FILTERS.map((level) => ({ value: level, label: t(LEVEL_FILTER_LABELS[level]) }))}
              onChange={(level) => setFilters({ ...filters, level: level as RecordLevelFilter | null })}
            />
          </div>
        </div>
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto py-1.5"
          style={{ minHeight: `${RECORDS_LIST_MIN_HEIGHT}px` }}
          aria-busy={list.status === "loading"}
          onScroll={onListScroll}
        >
          {/* One tab stop for the whole list, also while it holds only a note.
              It draws no ring of its own: the selected row shows the cursor
              (composite-control-conventions). */}
          <div
            ref={listRef}
            role="listbox"
            aria-label={t("records.title")}
            aria-activedescendant={selectedIndex === -1 ? undefined : optionId(selected!)}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="group focus:outline-none"
          >
            {listBody}
            {list.status === "ready" && list.loadingMore ? <p className={NOTE_CLASS}>{t("records.loading")}</p> : null}
            {list.status === "ready" && list.moreFailed ? (
              <p className={FAILED_NOTE_CLASS} role="alert">{t("records.loadFailed")}</p>
            ) : null}
          </div>
        </div>
      </section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("records.resizeList")}
        onMouseDown={onSplitterDown}
        className="shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary-accent active:bg-primary-accent-strong"
        style={{ width: `${SPLITTER_WIDTH}px` }}
      />
      <section
        className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface"
        style={{ minWidth: `${RECORDS_DETAIL_MIN_WIDTH}px` }}
        aria-busy={detail.status === "loading"}
      >
        {detail.status === "ready" ? (
          <RecordDetailView record={detail.record} launchLabel={launchLabel} timeZone={timeZone} />
        ) : detail.status === "failed" ? (
          <p className={FAILED_NOTE_CLASS}>{t("records.detailFailed")}</p>
        ) : detail.status === "none" ? (
          <p className={NOTE_CLASS}>{t("records.noSelection")}</p>
        ) : null}
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  // A chosen value the sources no longer list stays selectable until changed.
  const shown =
    value === null || options.some((option) => option.value === value) ? options : [{ value, label: value }, ...options];
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      className="dk-field w-full min-w-0"
    >
      <option value="">{allLabel}</option>
      {shown.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function RecordDetailView({
  record,
  launchLabel,
  timeZone,
}: {
  record: RecordDetail;
  launchLabel: (session: string) => string;
  timeZone: string | null;
}) {
  const { t, locale } = useI18n();
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
        timeZone: timeZone ?? undefined,
      }),
    [locale, timeZone],
  );

  const fields: { label: string; value: ReactNode }[] = [
    { label: t("records.time"), value: <span className="tabular-nums">{timeFormat.format(new Date(record.time))}</span> },
    { label: t("records.launch"), value: launchLabel(record.session) },
  ];
  if (record.taskId !== null) {
    fields.push({ label: t("records.task"), value: <code className="font-mono text-xs">{record.taskId}</code> });
  }

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="m-0 min-w-0 text-[15px] font-semibold text-ink-strong [overflow-wrap:anywhere]">{record.message}</h2>
        <LevelPill level={record.level} />
      </div>
      <div
        className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        role="region"
        tabIndex={0}
        aria-label={t("records.details")}
      >
        <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-3">
          {fields.map((field) => (
            <div key={field.label} className="min-w-0">
              <dt className="dk-label">{field.label}</dt>
              <dd className="m-0 text-sm text-ink [overflow-wrap:anywhere]">{field.value}</dd>
            </div>
          ))}
        </dl>
        {hasFields(record.fields) ? (
          <section className="flex min-w-0 flex-col gap-1.5">
            <h3 className="dk-label m-0">{t("records.details")}</h3>
            <pre className="m-0 whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-surface-sunken px-3 py-2.5 font-mono text-xs leading-normal text-ink [overflow-wrap:anywhere]">
              {prettyJson(record.fields)}
            </pre>
          </section>
        ) : null}
      </div>
    </>
  );
}
