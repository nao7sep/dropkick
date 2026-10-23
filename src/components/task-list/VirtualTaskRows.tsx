import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Task } from "../../models";
import { taskSelectionKey } from "../../utils";

// Only the viewport and its neighbouring screenfuls need DOM rows. The logical
// tasks remain complete for selection, ordering and counts. The editor and
// keyboard target stay mounted even outside that range.
export function VirtualTaskRows({ tasks, scrollRef, pinnedKeys, renderRow }: {
  tasks: Task[];
  scrollRef: RefObject<HTMLDivElement | null>;
  pinnedKeys: readonly (string | null)[];
  renderRow: (task: Task, ref: (node: HTMLDivElement | null) => void) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const heights = useRef(new Map<string, number>());
  const [measurement, setMeasurement] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: window.innerHeight });
  const keys = useMemo(() => tasks.map(taskSelectionKey), [tasks]);
  const keyIndices = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  // Before a row has been measured use the ordinary row's 20px line, 8px
  // vertical padding and 2px gap. Real measurements include wrapped errors.
  const offsets = useMemo(() => {
    const result = [0];
    for (const key of keys) result.push(result[result.length - 1] + (heights.current.get(key) ?? 30));
    return result;
  }, [keys, measurement]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const body = container.current;
    if (!scroller || !body) return;
    let width = scroller.clientWidth;
    const updateViewport = () => {
      const top = scroller.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const height = scroller.clientHeight || window.innerHeight;
      setViewport((old) => old.top === top && old.height === height ? old : { top, height });
    };
    const resize = new ResizeObserver(() => {
      if (width !== scroller.clientWidth) {
        width = scroller.clientWidth;
        heights.current.clear();
        setMeasurement((value) => value + 1);
      }
      updateViewport();
    });
    resize.observe(scroller);
    resize.observe(body);
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", updateViewport, { passive: true });
    updateViewport();
    return () => { resize.disconnect(); scroller.removeEventListener("scroll", updateViewport); };
  }, [scrollRef]);

  useEffect(() => {
    for (const key of heights.current.keys()) if (!keyIndices.has(key)) heights.current.delete(key);
  }, [keyIndices]);

  useLayoutEffect(() => {
    const measure = () => {
      let changed = false;
      let correction = 0;
      const scroller = scrollRef.current;
      const top = scroller?.getBoundingClientRect().top ?? 0;
      for (const [key, node] of nodes.current) {
        const rect = node.getBoundingClientRect();
        const height = rect.height + (parseFloat(getComputedStyle(node).marginBottom) || 0);
        if (height <= 0) continue;
        const previous = heights.current.get(key) ?? 30;
        if (height === previous) continue;
        heights.current.set(key, height);
        // Preserve the reader's offset when a measured row above it grows.
        if (rect.bottom < top) correction += height - previous;
        changed = true;
      }
      if (scroller && correction) scroller.scrollTop += correction;
      if (changed) setMeasurement((value) => value + 1);
    };
    const observer = new ResizeObserver(measure);
    for (const node of nodes.current.values()) observer.observe(node);
    measure();
    return () => observer.disconnect();
  });

  const indices = new Set<number>();
  // Binary search the compact height index instead of visiting every task on
  // each scroll event. Overscan is based on the measured viewport, not a cap.
  const firstAt = (position: number) => {
    let low = 0, high = tasks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (offsets[middle + 1] < position) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = firstAt(viewport.top - viewport.height);
  const end = firstAt(viewport.top + viewport.height * 2);
  for (let index = start; index <= end && index < tasks.length; index++) indices.add(index);
  for (const key of pinnedKeys) {
    const index = key === null ? -1 : keyIndices.get(key) ?? -1;
    if (index >= 0) indices.add(index);
  }
  let cursor = 0;
  const rows = [...indices].sort((a, b) => a - b).map((index) => {
    const gap = offsets[index] - offsets[cursor];
    cursor = index + 1;
    const key = keys[index];
    return <Fragment key={key}>
      {gap > 0 && <div aria-hidden="true" style={{ height: gap }} />}
      {renderRow(tasks[index], (node) => {
        if (node) nodes.current.set(key, node);
        else nodes.current.delete(key);
      })}
    </Fragment>;
  });
  const tail = offsets[tasks.length] - offsets[cursor];
  return <div ref={container}>
    {rows}
    {tail > 0 && <div aria-hidden="true" style={{ height: tail }} />}
  </div>;
}
