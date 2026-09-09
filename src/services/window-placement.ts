import { isTauri } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import type { WindowBounds, WindowPlacementRecord } from "../models";

const DEBOUNCE_MS = 400;
type MonitorWorkArea = {
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};
let suppression = 0;
let flushPlacement: (() => Promise<void>) | null = null;

export function usableWindowBounds(
  bounds: WindowBounds,
  minimum: { width: number; height: number },
  monitors: readonly MonitorWorkArea[],
): boolean {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every(Number.isFinite) || !values.every(Number.isInteger)) return false;
  return monitors.some((monitor) => {
    const area = monitor.workArea;
    return bounds.width >= Math.ceil(minimum.width * monitor.scaleFactor)
      && bounds.height >= Math.ceil(minimum.height * monitor.scaleFactor)
      && bounds.x >= area.position.x && bounds.y >= area.position.y
      && bounds.x + bounds.width <= area.position.x + area.size.width
      && bounds.y + bounds.height <= area.position.y + area.size.height;
  });
}

export function resolveWindowRestoration(
  saved: WindowPlacementRecord | null,
  minimum: { width: number; height: number },
  monitors: readonly MonitorWorkArea[],
): WindowPlacementRecord {
  return {
    normalBounds: saved?.normalBounds && usableWindowBounds(saved.normalBounds, minimum, monitors)
      ? { ...saved.normalBounds }
      : null,
    mode: saved?.mode === "maximized" ? "maximized" : "normal",
  };
}

export function settledWindowPlacement(
  previous: WindowPlacementRecord,
  snapshot: { bounds: WindowBounds; minimized: boolean; fullscreen: boolean; maximized: boolean },
): WindowPlacementRecord {
  if (snapshot.minimized || snapshot.fullscreen) return structuredClone(previous);
  if (snapshot.maximized) return { normalBounds: structuredClone(previous.normalBounds), mode: "maximized" };
  return { normalBounds: { ...snapshot.bounds }, mode: "normal" };
}

export async function withWindowPlacementSuppressed<T>(operation: () => Promise<T>): Promise<T> {
  suppression += 1;
  try { return await operation(); } finally { suppression -= 1; }
}

export async function initializeMainWindowPlacement(
  saved: WindowPlacementRecord | null,
  minimum: { width: number; height: number },
  persist: (record: WindowPlacementRecord) => Promise<void>,
): Promise<void> {
  if (!isTauri() || flushPlacement) return;
  const win = getCurrentWindow();
  const restoration = resolveWindowRestoration(saved, minimum, await availableMonitors());
  const [openingPosition, openingSize, openingInnerSize] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    win.innerSize(),
  ]);
  // Windows can ignore positioning and maximization requests made while the
  // native HWND is still hidden. Make it visible before applying either state.
  await win.show();
  if (restoration.normalBounds) {
    const bounds = restoration.normalBounds;
    try {
      await withWindowPlacementSuppressed(async () => {
        // Tauri setSize() accepts an inner/client size, while the placement
        // record stores outer bounds. Preserve the current native frame delta.
        await win.setSize(new PhysicalSize(
          Math.max(1, bounds.width - Math.max(0, openingSize.width - openingInnerSize.width)),
          Math.max(1, bounds.height - Math.max(0, openingSize.height - openingInnerSize.height)),
        ));
        await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
      });
      const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
      if (position.x !== bounds.x || position.y !== bounds.y || size.width !== bounds.width || size.height !== bounds.height) {
        throw new Error("Tauri adjusted the restored window bounds");
      }
    } catch {
      await withWindowPlacementSuppressed(async () => {
        await win.setSize(openingInnerSize);
        await win.setPosition(openingPosition);
      });
    }
  }
  const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
  let normalBounds: WindowBounds = { x: position.x, y: position.y, width: size.width, height: size.height };
  let mode = restoration.mode;
  let enabled = false;
  let timer: number | undefined;
  let eventQueue = Promise.resolve();
  const cancel = () => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };
  const save = () => persist({ normalBounds: { ...normalBounds }, mode });
  const inspect = async () => {
    if (!enabled || suppression > 0) return;
    const [minimized, fullscreen, maximized] = await Promise.all([
      win.isMinimized(), win.isFullscreen(), win.isMaximized(),
    ]);
    if (minimized || fullscreen) { cancel(); return; }
    if (maximized) {
      cancel();
      if (mode !== "maximized") { mode = "maximized"; await save(); }
      return;
    }
    cancel();
    timer = window.setTimeout(() => {
      timer = undefined;
      eventQueue = eventQueue.then(async () => {
        if (!enabled || suppression > 0 || await win.isMinimized() || await win.isFullscreen() || await win.isMaximized()) return;
        const [nextPosition, nextSize] = await Promise.all([win.outerPosition(), win.outerSize()]);
        normalBounds = { x: nextPosition.x, y: nextPosition.y, width: nextSize.width, height: nextSize.height };
        mode = "normal";
        await save();
      }).catch(() => {});
    }, DEBOUNCE_MS);
  };
  const enqueueInspect = () => { eventQueue = eventQueue.then(inspect).catch(() => {}); };
  await Promise.all([win.onMoved(enqueueInspect), win.onResized(enqueueInspect)]);
  flushPlacement = async () => {
    cancel();
    await eventQueue;
    if (!enabled) return;
    const [minimized, fullscreen, maximized] = await Promise.all([
      win.isMinimized(), win.isFullscreen(), win.isMaximized(),
    ]);
    if (!minimized && !fullscreen) {
      if (maximized) {
        mode = "maximized";
      } else {
        const [nextPosition, nextSize] = await Promise.all([win.outerPosition(), win.outerSize()]);
        normalBounds = {
          x: nextPosition.x,
          y: nextPosition.y,
          width: nextSize.width,
          height: nextSize.height,
        };
        mode = "normal";
      }
    }
    await save();
  };
  if (restoration.mode === "maximized") {
    // Give Windows one browser event-loop turn after show() so maximize reaches
    // the titled HWND rather than being lost during native-window creation.
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    await withWindowPlacementSuppressed(() => win.maximize());
  }
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  enabled = true;
  if (restoration.mode === "maximized" && !await win.isMaximized()) mode = "normal";
}

export async function flushMainWindowPlacement(): Promise<void> {
  await flushPlacement?.();
}

export async function showMainWindowWithoutPlacement(): Promise<void> {
  if (isTauri()) await getCurrentWindow().show();
}
