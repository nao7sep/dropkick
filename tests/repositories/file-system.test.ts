import { describe, it, expect, vi } from "vitest";

// file-system.ts imports the Tauri core `invoke` at module top level. The
// serialization helpers under test use only promises, so stub invoke to keep
// the import pure under the node test environment.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../src/repositories/logging", () => ({ log: { debug: vi.fn(), error: vi.fn() }, toErrorFields: (error: unknown) => ({ error }) }));
import { log } from "../../src/repositories/logging";

import { invoke } from "@tauri-apps/api/core";
import {
  saveTaskFile,
  writeJsonFile,
  withSerial,
  withSerialTwo,
  drainRequiredSerial,
  pendingSerialKeys,
  drainSerial,
} from "../../src/repositories/file-system";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withSerial", () => {
  it("runs callbacks for the same key one at a time, in order", async () => {
    const order: string[] = [];
    const gate = deferred();

    const p1 = withSerial("k1", async () => {
      order.push("1-start");
      await gate.promise;
      order.push("1-end");
    });
    const p2 = withSerial("k1", async () => {
      order.push("2-start");
    });

    gate.resolve();
    await Promise.all([p1, p2]);
    // The second callback only starts after the first fully settles.
    expect(order).toEqual(["1-start", "1-end", "2-start"]);
  });

  it("runs callbacks for different keys concurrently", async () => {
    const order: string[] = [];
    const blockA = deferred();

    const pA = withSerial("a", async () => {
      order.push("a-start");
      await blockA.promise;
      order.push("a-end");
    });
    const pB = withSerial("b", async () => {
      order.push("b-start");
    });

    // b completes while a is still blocked -> they are not serialized together.
    await pB;
    expect(order).toContain("b-start");
    expect(order).not.toContain("a-end");

    blockA.resolve();
    await pA;
    expect(order).toEqual(["a-start", "b-start", "a-end"]);
  });

  it("returns the callback's resolved value to its own caller", async () => {
    await expect(withSerial("ret", async () => 42)).resolves.toBe(42);
  });

  it("keeps the chain alive after a rejection so the next caller still runs", async () => {
    const p1 = withSerial("k2", async () => {
      throw new Error("boom");
    });
    await expect(p1).rejects.toThrow("boom");

    const p2 = withSerial("k2", async () => "recovered");
    await expect(p2).resolves.toBe("recovered");
  });
});

describe("withSerialTwo", () => {
  it("delegates to a single lock when both keys are equal", async () => {
    await expect(withSerialTwo("same", "same", async () => "ok")).resolves.toBe("ok");
  });

  it("acquires the pair in a stable order, so opposite-order callers do not deadlock", async () => {
    const order: string[] = [];
    const gate = deferred();

    // Requested as (a, b)…
    const p1 = withSerialTwo("a", "b", async () => {
      order.push("p1-start");
      await gate.promise;
      order.push("p1-end");
    });
    // …and as (b, a). Both normalize to a-then-b, so p2 waits for p1 rather
    // than each holding one lock and waiting on the other.
    const p2 = withSerialTwo("b", "a", async () => {
      order.push("p2");
    });

    gate.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["p1-start", "p1-end", "p2"]);
  });
});

describe("required persistence settlement", () => {
  it("ignores held optional work without releasing its physical reservation", async () => {
    const gate = deferred();
    const order: string[] = [];
    const optional = withSerial("optional-state", async () => { await gate.promise; order.push("optional"); }, "optional");
    const later = withSerial("optional-state", async () => { order.push("later"); }, "optional");
    try {
      await drainRequiredSerial();
      expect(pendingSerialKeys()).not.toContain("optional-state");
      expect(order).toEqual([]);
    } finally { gate.resolve(); await Promise.all([optional, later]); }
    expect(order).toEqual(["optional", "later"]);
  });

  it("waits for required writes behind an optional read and new writes added during settlement", async () => {
    const readGate = deferred(), writeGate = deferred();
    const order: string[] = [];
    const read = withSerial("document", async () => { await readGate.promise; order.push("read"); }, "optional");
    const first = withSerial("document", async () => { order.push("first"); });
    const drain = drainRequiredSerial().then(() => order.push("drained"));
    const second = withSerial("document", async () => { await writeGate.promise; order.push("second"); });
    expect(pendingSerialKeys()).toContain("document");
    readGate.resolve(); await first;
    expect(order).toEqual(["read", "first"]);
    writeGate.resolve(); await Promise.all([read, second, drain]);
    expect(order).toEqual(["read", "first", "second", "drained"]);
    expect(pendingSerialKeys()).not.toContain("document");
  });
});

describe("managed JSON backup policy", () => {
  it.each([true, false])("forwards a store's recording choice (%s) through the atomic-write command", async (recorded) => {
    vi.mocked(invoke).mockClear().mockResolvedValue("digest");
    expect(await writeJsonFile("/store.json", "state", { value: 1 }, recorded)).toBe("digest");
    const writes = vi.mocked(invoke).mock.calls.filter(([command]) => command === "write_text_file_atomic");
    expect(writes).toEqual([["write_text_file_atomic", {
      path: "/store.json", contents: JSON.stringify({ formatVersion: 2, value: 1 }, null, 2),
      ...(recorded ? {} : { recordBackup: false }),
    }]]);
  });
});

describe("drainSerial", () => {
  it("waits for the work already queued for one key, not for others", async () => {
    let releaseA!: () => void;
    let releaseB!: () => void;
    const a = withSerial("a", () => new Promise<void>((resolve) => { releaseA = resolve; }));
    const heldB = new Promise<void>((resolve) => { releaseB = resolve; });
    void withSerial("b", () => heldB);
    let drained = false;
    const drain = drainSerial("a").then(() => { drained = true; });
    releaseB();
    await drainSerial("b");
    expect(drained).toBe(false);
    releaseA();
    await a;
    await drain;
    expect(drained).toBe(true);
  });
});


describe("write failure ownership", () => {
  it("propagates the recorded native diagnostic without recording it again", async () => {
    vi.mocked(log.error).mockClear();
    const native = { kind: "recordedOperation", message: "permission denied: /private/stage" };
    vi.mocked(invoke).mockRejectedValueOnce(native);
    const error = await writeJsonFile("/store.json", "state", {}).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(native.message);
    expect(error.cause).toBe(native);
    expect(log.error).not.toHaveBeenCalled();
  });
  it("records and propagates an invocation that never returned an operation result", async () => {
    vi.mocked(log.error).mockClear();
    const transport = new Error("IPC disconnected");
    vi.mocked(invoke).mockRejectedValueOnce(transport);
    await expect(writeJsonFile("/store.json", "state", {})).rejects.toBe(transport);
    expect(log.error).toHaveBeenCalledExactlyOnceWith("file write invocation failed", { path: "/store.json", error: transport });
  });
});



it("sends the expected hash and exact formatted content in one invocation without duplicating native failures", async () => {
  vi.mocked(invoke).mockClear(); vi.mocked(log.error).mockClear();
  vi.mocked(invoke).mockResolvedValueOnce({ status: "conflict" });
  expect(await saveTaskFile("/task.json", { id: "L", tasks: [] }, "baseline")).toEqual({ status: "conflict" });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("save_task_file", {
    path: "/task.json", contents: JSON.stringify({ formatVersion: 1, id: "L", tasks: [] }, null, 2),
    expectedHash: "baseline",
  });
  vi.mocked(invoke).mockRejectedValueOnce({ kind: "recordedOperation", message: "disk unavailable" });
  await expect(saveTaskFile("/task.json", { id: "L", tasks: [] }, "baseline")).rejects.toThrow("disk unavailable");
  expect(log.error).not.toHaveBeenCalled();
});
