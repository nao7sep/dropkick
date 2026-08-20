import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TaskListDto } from "../../src/models";

// Spies for the two mocked dependency modules. withSerial/withSerialTwo are
// pass-throughs: the per-path serialization is not what these tests exercise.
const readJsonFileWithHash = vi.fn();
const writeJsonFile = vi.fn();
const hashFile = vi.fn();
const fileExists = vi.fn();
const showFileConflictDialog = vi.fn();
const showFileDeletedDialog = vi.fn();

vi.mock("../../src/repositories/file-system", () => ({
  readJsonFileWithHash: (p: string) => readJsonFileWithHash(p),
  writeJsonFile: (p: string, d: unknown) => writeJsonFile(p, d),
  hashFile: (p: string) => hashFile(p),
  fileExists: (p: string) => fileExists(p),
  withSerial: (_p: string, fn: () => unknown) => fn(),
  withSerialTwo: (_a: string, _b: string, fn: () => unknown) => fn(),
}));

vi.mock("../../src/repositories/dialogs", () => ({
  showFileConflictDialog: (p: string) => showFileConflictDialog(p),
  showFileDeletedDialog: (p: string) => showFileDeletedDialog(p),
}));

// Re-imported fresh per test so the module-level knownHashes map is isolated.
let repo: typeof import("../../src/repositories/task-list-repository");

const data = (tasks: TaskListDto["tasks"] = []): TaskListDto => ({ version: "1.0.0", id: "T0", tasks });

beforeEach(async () => {
  vi.clearAllMocks();
  // The core hashes the bytes it wrote and returns the digest.
  writeJsonFile.mockResolvedValue("HW");
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
    const result = await repo.loadTaskList("/f.json");
    expect(result).toEqual({ status: "success", taskList: { filePath: "/f.json", data: data() } });
  });

  it("passes through a non-success load result", async () => {
    readJsonFileWithHash.mockResolvedValue({ status: "missing" });
    expect(await repo.loadTaskList("/f.json")).toEqual({ status: "missing" });
  });

  it("materializes a missing id: generates one, persists it, and re-hashes", async () => {
    // A legacy file surfaces id === "" (the Rust TaskListDto default).
    readJsonFileWithHash.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", id: "", tasks: [] },
      hash: "OLD",
    });
    // The core returns the hash of the bytes it wrote; nothing is read back.
    writeJsonFile.mockResolvedValue("NEWHASH");

    const result = await repo.loadTaskList("/legacy.json");

    // The persisted file carries a freshly generated, non-empty id...
    expect(writeJsonFile).toHaveBeenCalledTimes(1);
    const [writtenPath, written] = writeJsonFile.mock.calls[0];
    expect(writtenPath).toBe("/legacy.json");
    expect((written as TaskListDto).id).toMatch(/.+/);
    // ...and the returned data carries that same id.
    if (result.status !== "success") throw new Error("expected success");
    expect(result.taskList.data.id).toBe((written as TaskListDto).id);

    // The write's own hash is now the registered hash: a matching flush uses
    // it, no conflict.
    hashFile.mockReset();
    hashFile.mockResolvedValue("NEWHASH");
    expect(await repo.flushTaskList("/legacy.json", () => data())).toEqual({ status: "success" });
  });

  it("does not rewrite a file that already has an id", async () => {
    readJsonFileWithHash.mockResolvedValue({
      status: "success",
      data: { version: "1.0.0", id: "EXISTING", tasks: [] },
      hash: "H1",
    });
    const result = await repo.loadTaskList("/f.json");
    expect(writeJsonFile).not.toHaveBeenCalled();
    if (result.status !== "success") throw new Error("expected success");
    expect(result.taskList.data.id).toBe("EXISTING");
  });
});

describe("createTaskListFile", () => {
  it("writes an empty list and registers the hash the write reported", async () => {
    writeJsonFile.mockResolvedValue("HNEW");
    const result = await repo.createTaskListFile("/f.json");
    expect(writeJsonFile).toHaveBeenCalledWith("/f.json", expect.objectContaining({ tasks: [] }));
    expect(result.filePath).toBe("/f.json");
    // Registered: a subsequent matching flush should succeed.
    hashFile.mockReset();
    hashFile.mockResolvedValue("HNEW");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
  });

});

describe("flushTaskList — happy path and registration", () => {
  it("errors when the file was never loaded", async () => {
    expect(await repo.flushTaskList("/unknown.json", () => data())).toEqual({
      status: "error",
      message: "File not loaded",
    });
  });

  it("writes when the on-disk hash matches the known hash", async () => {
    await register("/f.json", "H0");
    // The only hashFile call is the pre-write check; the write reports its own.
    hashFile.mockResolvedValue("H0");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "success" });
    expect(writeJsonFile).toHaveBeenCalledWith("/f.json", data());
  });
});

describe("flushTaskList — conflict resolution", () => {
  beforeEach(async () => {
    await register("/f.json", "H0");
    // Pre-write check sees a different hash -> conflict.
    hashFile.mockResolvedValue("DIFFERENT");
  });

  it("overwrites when the user chooses overwrite", async () => {
    showFileConflictDialog.mockResolvedValue("overwrite");
    // writeAndRemember rehashes after the overwrite write.
    hashFile.mockResolvedValue("DIFFERENT");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "success" });
    expect(writeJsonFile).toHaveBeenCalled();
  });

  it("reloads disk data when the user chooses reload", async () => {
    showFileConflictDialog.mockResolvedValue("reload");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "success", data: data(), hash: "HDISK" });
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result.status).toBe("reloaded");
    expect(result).toMatchObject({ data: data() });
    // Local change was NOT written on reload.
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("errors and drops the hash when reload finds the file missing", async () => {
    showFileConflictDialog.mockResolvedValue("reload");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "missing" });
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result.status).toBe("error");
    // Hash dropped -> the next flush reports "File not loaded" instead of re-prompting.
    const next = await repo.flushTaskList("/f.json", () => data());
    expect(next).toEqual({ status: "error", message: "File not loaded" });
  });

  it("errors when reload fails to parse the file", async () => {
    showFileConflictDialog.mockResolvedValue("reload");
    readJsonFileWithHash.mockResolvedValueOnce({ status: "invalid", message: "bad json" });
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result.status).toBe("error");
    expect(result).toMatchObject({ message: expect.stringContaining("bad json") });
  });
});

describe("flushTaskList — deleted resolution", () => {
  beforeEach(async () => {
    await register("/f.json", "H0");
    // The file vanished from disk. hashFile is the single source of truth for
    // that now — it returns null for a missing file, so the repository does not
    // ask fileExists the same question a second time.
    hashFile.mockResolvedValue(null);
  });

  it("recreates the file when the user chooses save", async () => {
    showFileDeletedDialog.mockResolvedValue("save");
    writeJsonFile.mockResolvedValue("HSAVED");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result).toEqual({ status: "success" });
    expect(writeJsonFile).toHaveBeenCalled();
  });

  it("errors and drops the hash when the user cancels", async () => {
    showFileDeletedDialog.mockResolvedValue("cancel");
    const result = await repo.flushTaskList("/f.json", () => data());
    expect(result.status).toBe("error");
    const next = await repo.flushTaskList("/f.json", () => data());
    expect(next).toEqual({ status: "error", message: "File not loaded" });
  });
});

describe("forgetTaskList", () => {
  it("drops the hash so later flushes report the file as not loaded", async () => {
    await register("/f.json", "H0");
    await repo.forgetTaskList("/f.json");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({
      status: "error",
      message: "File not loaded",
    });
  });
});

describe("forceFlushTaskList", () => {
  it("writes without any hash check and registers the hash the write reported", async () => {
    writeJsonFile.mockResolvedValue("HFORCE");
    await repo.forceFlushTaskList("/f.json", data());
    expect(writeJsonFile).toHaveBeenCalledWith("/f.json", data());
    // Now registered: a matching flush succeeds without a prior load.
    hashFile.mockReset();
    hashFile.mockResolvedValue("HFORCE");
    expect(await repo.flushTaskList("/f.json", () => data())).toEqual({ status: "success" });
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
    expect(result).toEqual({ status: "error", message: "Source file not loaded" });
  });

  it("errors when the destination is not loaded", async () => {
    await register(SRC, "S0");
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "error", message: "Destination file not loaded" });
  });

  it("aborts without touching disk when compute returns null", async () => {
    await registerBoth();
    const result = await repo.flushMove(SRC, DST, () => null);
    expect(result).toEqual({ status: "error", message: "Nothing to move" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("writes destination then source on success", async () => {
    await registerBoth();
    // One hashFile call per file now: the pre-write check. The write reports
    // its own hash, so there is no rehash to sequence.
    hashFile
      .mockResolvedValueOnce("D0") // dest check matches
      .mockResolvedValueOnce("S0"); // source check matches
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result.status).toBe("success");
    // Destination written before source (addition before deletion).
    expect(writeJsonFile.mock.calls[0][0]).toBe(DST);
    expect(writeJsonFile.mock.calls[1][0]).toBe(SRC);
  });

  it("returns dest-conflict and writes nothing when the destination changed", async () => {
    await registerBoth();
    hashFile.mockResolvedValueOnce("DEST-CHANGED"); // dest check mismatch
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "dest-conflict" });
    expect(writeJsonFile).not.toHaveBeenCalled();
  });

  it("rolls back the destination when the source write conflicts", async () => {
    await registerBoth();
    hashFile
      .mockResolvedValueOnce("D0") // dest check matches -> dest write ok
      .mockResolvedValueOnce("SRC-CHANGED") // source check mismatch -> conflict
      .mockResolvedValueOnce("HW"); // rollback dest check matches the write hash
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({ status: "source-conflict" });
    // dest written, source NOT written, dest rolled back -> 2 dest writes total.
    const dstWrites = writeJsonFile.mock.calls.filter((c) => c[0] === DST);
    const srcWrites = writeJsonFile.mock.calls.filter((c) => c[0] === SRC);
    expect(dstWrites).toHaveLength(2);
    expect(srcWrites).toHaveLength(0);
  });

  it("reports rollback-failed when restoring the destination also fails", async () => {
    await registerBoth();
    hashFile
      .mockResolvedValueOnce("D0").mockResolvedValueOnce("D1") // dest write ok
      .mockResolvedValueOnce("SRC-CHANGED") // source conflict
      .mockResolvedValueOnce("ROLLBACK-CHANGED"); // rollback also conflicts
    const result = await repo.flushMove(SRC, DST, inputs);
    expect(result).toEqual({
      status: "rollback-failed",
      message: expect.stringContaining("could not restore"),
    });
  });
});
