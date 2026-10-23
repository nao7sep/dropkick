import { message } from "../../src/i18n/translate";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TaskListDto } from "../../src/models";
import { makeTask } from "../helpers/task";

// Spies for the two mocked dependency modules. withSerial/withSerialTwo are
// pass-throughs with a boundary marker; the queue itself is tested separately.
let insideSerial = false;
async function inSerial(fn: () => unknown) {
  insideSerial = true;
  try { return await fn(); } finally { insideSerial = false; }
}
const readJsonFileWithHash = vi.fn();
const nativePublish = vi.fn();
const nativeHash = vi.fn();
const saveTaskFile = vi.fn();
const showMessage = vi.fn();
const chooseSeparateTaskCopy = vi.fn();
const fileExists = vi.fn();
const showFileConflictDialog = vi.fn();
const showFileDeletedDialog = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  saveTaskFile: (...args: unknown[]) => saveTaskFile(...args),
  readJsonFileWithHash: (...args: unknown[]) => readJsonFileWithHash(...args),
  fileExists: (p: string) => fileExists(p),
  createLatestSerial: () => async (_path: string, work: () => Promise<unknown>) => ({ covered: false, value: await inSerial(work) }),
  withSerial: (_p: string, fn: () => unknown) => inSerial(fn),
  withSerialTwo: (_a: string, _b: string, fn: () => unknown) => inSerial(fn),
}));

vi.mock("../../src/repositories/dialogs", () => ({
  showMessage: (...args: unknown[]) => showMessage(...args),
  chooseSeparateTaskCopy: (p: string) => chooseSeparateTaskCopy(p),
  showFileConflictDialog: (p: string) => showFileConflictDialog(p),
  showFileDeletedDialog: (p: string) => showFileDeletedDialog(p),
}));

// Re-imported fresh per test so the module-level knownHashes map is isolated.
let repo: typeof import("../../src/repositories/task-list-repository");

const data = (tasks: TaskListDto["tasks"] = []): TaskListDto => ({ id: "T0", tasks });

beforeEach(async () => {
  vi.resetAllMocks();
  // The core hashes the bytes it wrote and returns the digest.
  nativePublish.mockResolvedValue("HW");
  showMessage.mockResolvedValue(undefined);
  chooseSeparateTaskCopy.mockResolvedValue(null);
  // These spies represent native disk facts/publication within one invocation;
  // the repository must call saveTaskFile, never nativeHash then a separate write.
  saveTaskFile.mockImplementation(async (path, data, admission) => {
    if (admission.kind === "compare") {
      const hash = await nativeHash(path);
      if (hash === null) return { status: "missing" };
      if (hash !== admission.hash) return { status: "conflict" };
    }
    try { return { status: "saved", hash: await nativePublish(path, data), recoveryPath: null }; }
    catch (error) { return { status: "failed", message: String(error), publication: "untouched" }; }
  });
  fileExists.mockResolvedValue(true);
  vi.resetModules();
  repo = await import("../../src/repositories/task-list-repository");
});

// Loads a file so its hash is registered as `hash`, the precondition for flushes.
async function register(filePath: string, hash = "H0") {
  readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: data(), hash });
  await repo.loadTaskList(filePath);
}

describe("loadTaskList", () => {
  it("records the hash and returns the loaded data on success", async () => {
    readJsonFileWithHash.mockResolvedValue({ status: "success", data: data(), hash: "H1" });
    const adopted = vi.fn(() => { expect(insideSerial).toBe(true); return true; });
    const result = await repo.loadTaskList("/f.json", adopted);
    expect(adopted).toHaveBeenCalledWith(data());
    expect(result).toEqual({ status: "success", taskList: { filePath: "/f.json", data: data() } });
  });

  it("passes through a non-success load result", async () => {
    readJsonFileWithHash.mockResolvedValue({ status: "missing" });
    expect(await repo.loadTaskList("/f.json")).toEqual({ status: "missing" });
  });

  it("does not rewrite a file that already has an id", async () => {
    readJsonFileWithHash.mockResolvedValue({
      status: "success",
      data: { id: "EXISTING", tasks: [] },
      hash: "H1",
    });
    const result = await repo.loadTaskList("/f.json");
    expect(nativePublish).not.toHaveBeenCalled();
    if (result.status !== "success") throw new Error("expected success");
    expect(result.taskList.data.id).toBe("EXISTING");
  });
});

describe("createTaskListFile", () => {
  it("writes an empty list and registers the hash the write reported", async () => {
    nativePublish.mockResolvedValue("HNEW");
    const result = await repo.createTaskListFile("/f.json");
    expect(nativePublish).toHaveBeenCalledWith("/f.json", expect.objectContaining({ tasks: [] }));
    expect(result.filePath).toBe("/f.json");
    // Registered: a subsequent matching flush should succeed.
    nativeHash.mockReset();
    nativeHash.mockResolvedValue("HNEW");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
  });

});

describe("flushTaskList — happy path and registration", () => {
  it("errors when the file was never loaded", async () => {
    expect(await repo.flushTaskList("/unknown.json", () => data())).toEqual({
      status: "error",
      message: message("write.notLoaded"),
    });
  });

  it("writes when the on-disk hash matches the known hash", async () => {
    await register("/f.json", "H0");
    // The only nativeHash call is the pre-write check; the write reports its own.
    nativeHash.mockResolvedValue("H0");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "success" });
    expect(nativePublish).toHaveBeenCalledWith("/f.json", data());
  });
});

describe("flushTaskList — conflict resolution", () => {
  beforeEach(async () => {
    await register("/f.json", "H0");
    // Pre-write check sees a different hash -> conflict.
    nativeHash.mockResolvedValue("DIFFERENT");
    // The conflict first reads the disk copy, to refuse a newer build's file.
    readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: data(), hash: "DIFFERENT" });
  });

  it("never offers to overwrite a file a newer build saved", async () => {
    readJsonFileWithHash.mockReset();
    readJsonFileWithHash.mockResolvedValue({ status: "newer", formatVersion: 2 });
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "error", message: message("write.newerOnDisk") });
    expect(showFileConflictDialog).not.toHaveBeenCalled();
    expect(nativePublish).not.toHaveBeenCalled();
    // The hash stays, so the next save finds the same file and says the same.
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual(result);
  });

  it("overwrites when the user chooses overwrite", async () => {
    showFileConflictDialog.mockResolvedValue("overwrite");
    // writeAndRemember remembers the hash returned by the overwrite writer.
    nativeHash.mockResolvedValue("DIFFERENT");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "success" });
    expect(nativePublish).toHaveBeenCalled();
  });

  it("reloads disk data when the user chooses reload", async () => {
    showFileConflictDialog.mockResolvedValue("reload");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: data(), hash: "HDISK" });
    const adopted = vi.fn(() => { expect(insideSerial).toBe(true); return true; });
    const result = await repo.flushTaskList("/f.json", () => data(), adopted);
    expect(adopted).toHaveBeenCalledWith(data());
    expect(result.status).toBe("reloaded");
    expect(result).toMatchObject({ data: data() });
    // Local change was NOT written on reload.
    expect(nativePublish).not.toHaveBeenCalled();
  });

  it("keeps a failed reload retryable when the missing file is restored", async () => {
    showFileConflictDialog.mockResolvedValue("reload");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "missing" });
    expect((await repo.flushTaskList("/f.json", () => data())).status).toBe("error");
    expect(nativePublish).not.toHaveBeenCalled();
    nativeHash.mockResolvedValue("H0");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
    expect(nativePublish).toHaveBeenCalledWith("/f.json", data());
  });

  it("errors when reload fails to parse the file", async () => {
    showFileConflictDialog.mockResolvedValue("reload");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "invalid", message: "bad json" });
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result.status).toBe("error");
    expect(result).toMatchObject({
      message: message("write.reloadFailed"),
    });
    readJsonFileWithHash.mockResolvedValue({ status: "success", data: data(), hash: "REPAIRED" });
    nativeHash.mockResolvedValue("REPAIRED");
    showFileConflictDialog.mockResolvedValue("overwrite");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
    expect(showFileConflictDialog).toHaveBeenCalledTimes(2);
  });
});

describe("flushTaskList — deleted resolution", () => {
  beforeEach(async () => {
    await register("/f.json", "H0");
    // The file vanished from disk. nativeHash is the single source of truth for
    // that now — it returns null for a missing file, so the repository does not
    // ask fileExists the same question a second time.
    nativeHash.mockResolvedValue(null);
  });

  it("recreates the file when the user chooses save", async () => {
    showFileDeletedDialog.mockResolvedValue("save");
    nativePublish.mockResolvedValue("HSAVED");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "success" });
    expect(nativePublish).toHaveBeenCalled();
  });

  it("keeps a cancelled recreation retryable without silently overwriting a returned file", async () => {
    showFileDeletedDialog.mockResolvedValue("cancel");
    expect((await repo.flushTaskList("/f.json", () => data())).status).toBe("error");
    expect(nativePublish).not.toHaveBeenCalled();
    nativeHash.mockResolvedValue("OUTSIDE");
    readJsonFileWithHash.mockResolvedValue({ status: "success", data: data(), hash: "OUTSIDE" });
    showFileConflictDialog.mockResolvedValue("overwrite");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
    expect(showFileConflictDialog).toHaveBeenCalledWith("/f.json");
    expect(nativePublish).toHaveBeenCalledWith("/f.json", data());
  });

  it("can recreate on Retry after cancelling the first request", async () => {
    showFileDeletedDialog.mockResolvedValueOnce("cancel").mockResolvedValueOnce("save");
    expect((await repo.flushTaskList("/f.json", () => data())).status).toBe("error");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
    expect(showFileDeletedDialog).toHaveBeenCalledTimes(2);
  });

});

describe("forgetTaskList", () => {
  it("drops the hash so later flushes report the file as not loaded", async () => {
    await register("/f.json", "H0");
    await repo.forgetTaskList("/f.json");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({
      status: "error",
      message: message("write.notLoaded"),
    });
  });
});

describe("flushMove", () => {
  const SRC = "/src.json";
  const DST = "/dst.json";

  function inputs() {
    return {
      sourceDataPreMove: data([]),
      destDataPreMove: data([]),
      sourceTasksPostMove: [],
      destTasksPostMove: [],
    };
  }

  async function registerBoth() {
    await register(SRC, "S0");
    await register(DST, "D0");
  }

  it("errors when the source is not loaded", async () => {
    await register(DST, "D0");
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({
      status: "error",
      message: message("move.sourceNotLoaded"),
    });
  });

  it("errors when the destination is not loaded", async () => {
    await register(SRC, "S0");
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({
      status: "error",
      message: message("move.destNotLoaded"),
    });
  });

  it("aborts without touching disk when compute returns null", async () => {
    await registerBoth();
    const result = await repo.flushMove(SRC, DST, () => null);
    expect(result).toEqual({ status: "error", message: message("move.nothing") });
    expect(nativePublish).not.toHaveBeenCalled();
  });

  it("writes destination then source on success", async () => {
    await registerBoth();
    // One nativeHash call per file now: the pre-write check. The write reports
    // its own hash, so there is no rehash to sequence.
    nativeHash
      .mockResolvedValueOnce("D0") // dest check matches
      .mockResolvedValueOnce("S0"); // source check matches
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result.status).toBe("success");
    // Destination written before source (addition before deletion).
    expect(nativePublish.mock.calls[0][0]).toBe(DST);
    expect(nativePublish.mock.calls[1][0]).toBe(SRC);
  });

  it("returns dest-conflict and writes nothing when the destination changed", async () => {
    await registerBoth();
    nativeHash.mockResolvedValueOnce("DEST-CHANGED"); // dest check mismatch
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "dest-conflict" });
    expect(nativePublish).not.toHaveBeenCalled();
  });

  it("rolls back the destination when the source write conflicts", async () => {
    await registerBoth();
    nativeHash
      .mockResolvedValueOnce("D0") // dest check matches -> dest write ok
      .mockResolvedValueOnce("SRC-CHANGED") // source check mismatch -> conflict
      .mockResolvedValueOnce("HW"); // rollback dest check matches the write hash
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "source-conflict" });
    // dest written, source NOT written, dest rolled back -> 2 dest writes total.
    const dstWrites = nativePublish.mock.calls.filter((c) => c[0] === DST);
    const srcWrites = nativePublish.mock.calls.filter((c) => c[0] === SRC);
    expect(dstWrites).toHaveLength(2);
    expect(srcWrites).toHaveLength(0);
  });

  it("rolls the destination back when the source write throws", async () => {
    await registerBoth();
    nativeHash
      .mockResolvedValueOnce("D0") // dest check matches -> dest write ok
      .mockResolvedValueOnce("S0") // source check matches
      .mockResolvedValueOnce("HW"); // rollback dest check matches the write hash
    nativePublish
      .mockResolvedValueOnce("HW") // dest write
      .mockRejectedValueOnce(new Error("read-only file system")) // source write
      .mockResolvedValueOnce("HR"); // rollback
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "error", message: message("move.failed") });
    const dstWrites = nativePublish.mock.calls.filter((c) => c[0] === DST);
    expect(dstWrites).toHaveLength(2);
    expect(dstWrites[1][1]).toEqual(inputs().destDataPreMove);
  });

  it("reports the destination unsaved when the rollback write itself throws", async () => {
    await registerBoth();
    nativeHash
      .mockResolvedValueOnce("D0")
      .mockResolvedValueOnce("S0")
      .mockResolvedValueOnce("HW");
    nativePublish
      .mockResolvedValueOnce("HW")
      .mockRejectedValueOnce(new Error("device not configured"))
      .mockRejectedValueOnce(new Error("device not configured"));
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "dest-unsaved" });
  });

  it("reports the destination unsaved when restoring it also conflicts", async () => {
    await registerBoth();
    nativeHash
      .mockResolvedValueOnce("D0").mockResolvedValueOnce("D1") // dest write ok
      .mockResolvedValueOnce("SRC-CHANGED") // source conflict
      .mockResolvedValueOnce("ROLLBACK-CHANGED"); // rollback also conflicts
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "dest-unsaved" });
  });
});

describe("refreshTaskList", () => {
  const changed = data([makeTask({ id: "x" })]);

  it("does nothing for a list that is not loaded", async () => {
    const adopt = vi.fn(() => true);
    expect(await repo.refreshTaskList("/f.json", adopt)).toEqual({ status: "notLoaded" });
    expect(readJsonFileWithHash).not.toHaveBeenCalled();
    expect(adopt).not.toHaveBeenCalled();
  });

  it("reads the app's own save back as unchanged", async () => {
    await register("/f.json", "H0");
    nativePublish.mockResolvedValue("HOURS");
    nativeHash.mockResolvedValue("H0");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
    readJsonFileWithHash.mockResolvedValueOnce({ status: "unchanged" });
    const adopt = vi.fn(() => true);
    expect(await repo.refreshTaskList("/f.json", adopt)).toEqual({ status: "unchanged" });
    expect(adopt).not.toHaveBeenCalled();
    expect(readJsonFileWithHash).toHaveBeenLastCalledWith("/f.json", "HOURS");
  });

  it("offers a changed copy, and an adopted one becomes the copy the next save checks against", async () => {
    await register("/f.json", "H0");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: changed, hash: "HDISK" });
    const adopt = vi.fn(() => true);
    expect(await repo.refreshTaskList("/f.json", adopt)).toEqual({ status: "reloaded" });
    expect(adopt).toHaveBeenCalledWith(changed);

    nativeHash.mockResolvedValue("HDISK");
    expect(await repo.flushTaskList("/f.json", () => changed)).toEqual({ status: "success" });
    expect(showFileConflictDialog).not.toHaveBeenCalled();
  });

  it("keeps the old copy's hash when the caller declines, so its save meets the conflict dialog", async () => {
    await register("/f.json", "H0");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: changed, hash: "HDISK" });
    expect(await repo.refreshTaskList("/f.json", () => false)).toEqual({ status: "kept" });

    nativeHash.mockResolvedValue("HDISK");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: changed, hash: "HDISK" });
    showFileConflictDialog.mockResolvedValue("overwrite");
    await repo.flushTaskList("/f.json", () => data());
    expect(showFileConflictDialog).toHaveBeenCalledWith("/f.json");
  });

  it("reports a missing, invalid or unreadable file and keeps the loaded copy's hash", async () => {
    await register("/f.json", "H0");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "missing" });
    expect(await repo.refreshTaskList("/f.json", () => true)).toEqual({ status: "missing" });
    readJsonFileWithHash.mockResolvedValueOnce({ status: "invalid", message: "bad json" });
    expect(await repo.refreshTaskList("/f.json", () => true)).toEqual({ status: "invalid", message: "bad json" });
    readJsonFileWithHash.mockRejectedValueOnce(new Error("ipc down"));
    expect(await repo.refreshTaskList("/f.json", () => true)).toEqual({ status: "error", message: "ipc down" });

    nativeHash.mockResolvedValue("H0");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
  });
});

it("settles a successful move inside both serial slots, after both writes", async () => {
  await register("/src.json", "S0");
  await register("/dst.json", "D0");
  nativeHash.mockImplementation(async (path) => path === "/src.json" ? "S0" : "D0");
  const onSaved = vi.fn(() => {
    expect(insideSerial).toBe(true);
    expect(nativePublish.mock.calls.map(([path]) => path)).toEqual(["/dst.json", "/src.json"]);
  });
  const result = await repo.flushMove("/src.json", "/dst.json", () => ({ sourceDataPreMove: data(), destDataPreMove: data(), sourceTasksPostMove: [], destTasksPostMove: [], onSaved }));
  expect(result.status).toBe("success");
  expect(onSaved).toHaveBeenCalledTimes(1);
});

it("sends the accepted hash and content together and reports a preserved collision as saved", async () => {
  await register("/f.json");
  saveTaskFile.mockResolvedValueOnce({ status: "saved", hash: "new-hash", recoveryPath: "/f-recovery.json" });
  expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
  expect(saveTaskFile).toHaveBeenCalledWith("/f.json", data(), { kind: "compare", hash: "H0" });
  expect(nativeHash).not.toHaveBeenCalled();
  expect(showMessage).toHaveBeenCalledWith(message("save.collisionTitle"), message("save.collisionBody", { path: "/f.json", recovery: "/f-recovery.json" }));
  saveTaskFile.mockResolvedValueOnce({ status: "saved", hash: "next", recoveryPath: null });
  await repo.flushTaskList("/f.json", () => data());
  expect(saveTaskFile).toHaveBeenLastCalledWith("/f.json", data(), { kind: "compare", hash: "new-hash" });
});

it("saves unsupported-volume work only to a new separate file and keeps the original unsaved", async () => {
  await register("/f.json");
  chooseSeparateTaskCopy.mockResolvedValueOnce("/copy.json");
  saveTaskFile.mockResolvedValueOnce({ status: "unsupported" })
    .mockResolvedValueOnce({ status: "saved", hash: "copy", recoveryPath: null });
  expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "error", message: message("save.copySaved", { path: "/copy.json" }) });
  expect(saveTaskFile).toHaveBeenLastCalledWith("/copy.json", data(), { kind: "create" });
  saveTaskFile.mockResolvedValueOnce({ status: "conflict" });
  readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: data(), hash: "outside" });
  showFileConflictDialog.mockResolvedValueOnce("withdrawn");
  await repo.flushTaskList("/f.json", () => data());
  expect(saveTaskFile).toHaveBeenLastCalledWith("/f.json", data(), { kind: "compare", hash: "H0" });
});

it.each(["native", "transport"])("never compensates the destination after an unknown %s source outcome", async kind => {
  await register("/source.json", "source-before"); await register("/dest.json", "dest-before");
  saveTaskFile.mockResolvedValueOnce({ status: "saved", hash: "dest-after", recoveryPath: null });
  if (kind === "native") saveTaskFile.mockResolvedValueOnce({ status: "failed", message: "partial replacement", publication: "unknown" });
  else saveTaskFile.mockRejectedValueOnce(new Error("IPC lost"));
  const input = { sourceDataPreMove: data([makeTask()]), destDataPreMove: data(), sourceTasksPostMove: [], destTasksPostMove: [makeTask()] };
  expect(await repo.flushMove("/source.json", "/dest.json", () => input)).toEqual({ status: "source-uncertain", message: message("save.moveUncertain") });
  expect(saveTaskFile).toHaveBeenCalledTimes(2);
  saveTaskFile.mockResolvedValueOnce({ status: "saved", hash: "confirmed", recoveryPath: null });
  await repo.flushTaskList("/dest.json", () => data());
  expect(saveTaskFile).toHaveBeenLastCalledWith("/dest.json", data(), { kind: "compare", hash: "dest-before" });
});
