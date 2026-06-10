import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the repository barrel so the store never touches the filesystem.
// flushWorkspace records the workspace snapshot captured inside the serial slot.
const flushWorkspace = vi.fn(async (_path: string, getWorkspace: () => unknown) => {
  getWorkspace();
});
const loadWorkspace = vi.fn();

vi.mock("../../src/repositories", () => ({
  flushWorkspace: (path: string, getWorkspace: () => unknown) => flushWorkspace(path, getWorkspace),
  loadWorkspace: (path: string) => loadWorkspace(path),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useWorkspaceStore } from "../../src/state/workspace-store";
import { createDefaultWorkspace } from "../../src/models";

function resetStore(filePath = "/ws.json") {
  useWorkspaceStore.setState({
    workspace: createDefaultWorkspace("Test"),
    filePath,
    loaded: true,
  });
}

beforeEach(() => {
  flushWorkspace.mockClear();
  loadWorkspace.mockReset();
  resetStore();
});

const tabNames = () => useWorkspaceStore.getState().workspace.openTabs.map((t) => t.displayName);
const activeIdx = () => useWorkspaceStore.getState().workspace.activeTabIndex;

describe("addTab", () => {
  it("appends a tab, activates it, and flushes", async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    expect(tabNames()).toEqual(["A"]);
    expect(activeIdx()).toBe(0);
    expect(flushWorkspace).toHaveBeenCalledTimes(1);
  });

  it("focuses an already-open file instead of duplicating it (no flush)", async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    await useWorkspaceStore.getState().addTab("/b.json", "B");
    flushWorkspace.mockClear();

    await useWorkspaceStore.getState().addTab("/a.json", "A again");
    expect(tabNames()).toEqual(["A", "B"]); // no duplicate
    expect(activeIdx()).toBe(0); // refocused the existing tab
    expect(flushWorkspace).not.toHaveBeenCalled();
  });
});

describe("addUnifiedViewTab", () => {
  it("prepends the unified view tab and activates index 0", async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    await useWorkspaceStore.getState().addUnifiedViewTab();
    expect(tabNames()).toEqual(["Unified View", "A"]);
    expect(activeIdx()).toBe(0);
  });

  it("does not add a second unified view tab", async () => {
    await useWorkspaceStore.getState().addUnifiedViewTab();
    flushWorkspace.mockClear();
    await useWorkspaceStore.getState().addUnifiedViewTab();
    expect(useWorkspaceStore.getState().workspace.openTabs.filter((t) => t.isUnifiedView)).toHaveLength(1);
    expect(flushWorkspace).not.toHaveBeenCalled();
  });
});

describe("closeTab active-index adjustment", () => {
  beforeEach(async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    await useWorkspaceStore.getState().addTab("/b.json", "B");
    await useWorkspaceStore.getState().addTab("/c.json", "C"); // active = 2
  });

  it("closing a tab before the active one shifts the active index down", async () => {
    await useWorkspaceStore.getState().closeTab(0); // remove A
    expect(tabNames()).toEqual(["B", "C"]);
    expect(activeIdx()).toBe(1); // C still active
  });

  it("closing the active last tab clamps to the new last index", async () => {
    await useWorkspaceStore.getState().closeTab(2); // remove C (active)
    expect(tabNames()).toEqual(["A", "B"]);
    expect(activeIdx()).toBe(1);
  });

  it("closing a tab after the active one leaves the active index unchanged", async () => {
    await useWorkspaceStore.getState().setActiveTab(0); // active = A
    await useWorkspaceStore.getState().closeTab(2); // remove C
    expect(activeIdx()).toBe(0);
  });
});

describe("setActiveTab", () => {
  it("updates the runtime active index without flushing", async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    await useWorkspaceStore.getState().addTab("/b.json", "B");
    flushWorkspace.mockClear();

    await useWorkspaceStore.getState().setActiveTab(0);
    expect(activeIdx()).toBe(0);
    expect(flushWorkspace).not.toHaveBeenCalled();
  });
});

describe("renameTab", () => {
  it("renames by file path, not index", async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    await useWorkspaceStore.getState().addTab("/b.json", "B");
    await useWorkspaceStore.getState().renameTab("/a.json", "Renamed");
    expect(tabNames()).toEqual(["Renamed", "B"]);
  });
});

describe("reorderTabs active-index tracking", () => {
  beforeEach(async () => {
    await useWorkspaceStore.getState().addTab("/a.json", "A");
    await useWorkspaceStore.getState().addTab("/b.json", "B");
    await useWorkspaceStore.getState().addTab("/c.json", "C");
  });

  it("moves the active tab and follows it", async () => {
    await useWorkspaceStore.getState().setActiveTab(0); // A active
    await useWorkspaceStore.getState().reorderTabs(0, 2); // A -> end
    expect(tabNames()).toEqual(["B", "C", "A"]);
    expect(activeIdx()).toBe(2);
  });

  it("adjusts the active index when a tab moves across it", async () => {
    await useWorkspaceStore.getState().setActiveTab(1); // B active
    await useWorkspaceStore.getState().reorderTabs(0, 2); // A moves past B
    expect(tabNames()).toEqual(["B", "C", "A"]);
    expect(activeIdx()).toBe(0); // B is now at index 0
  });
});

describe("addRecentFile", () => {
  it("prepends, de-duplicates, and caps at 50", async () => {
    const store = useWorkspaceStore.getState();
    await store.addRecentFile("/x.json");
    await store.addRecentFile("/y.json");
    await store.addRecentFile("/x.json"); // re-open x -> moves to front, no dup

    const recents = useWorkspaceStore.getState().workspace.recentFiles;
    expect(recents.map((r) => r.filePath)).toEqual(["/x.json", "/y.json"]);
  });

  it("never keeps more than 50 entries", async () => {
    const store = useWorkspaceStore.getState();
    for (let i = 0; i < 60; i++) {
      await store.addRecentFile(`/file-${i}.json`);
    }
    expect(useWorkspaceStore.getState().workspace.recentFiles).toHaveLength(50);
    // Most recent first.
    expect(useWorkspaceStore.getState().workspace.recentFiles[0].filePath).toBe("/file-59.json");
  });
});

describe("load startup tab selection", () => {
  it("prefers the unified view tab as the active startup tab", async () => {
    loadWorkspace.mockResolvedValue({
      status: "success",
      workspace: {
        ...createDefaultWorkspace("L"),
        openTabs: [
          { filePath: "/a.json", displayName: "A", isUnifiedView: false },
          { filePath: "", displayName: "Unified View", isUnifiedView: true },
        ],
        activeTabIndex: 0,
      },
    });
    await useWorkspaceStore.getState().load("/ws.json");
    expect(activeIdx()).toBe(1); // the unified view tab
  });

  it("falls back to the first tab when there is no unified view", async () => {
    loadWorkspace.mockResolvedValue({
      status: "success",
      workspace: {
        ...createDefaultWorkspace("L"),
        openTabs: [{ filePath: "/a.json", displayName: "A", isUnifiedView: false }],
        activeTabIndex: -1,
      },
    });
    await useWorkspaceStore.getState().load("/ws.json");
    expect(activeIdx()).toBe(0);
  });
});
