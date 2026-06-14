import { describe, it, expect, vi } from "vitest";

// file-system.ts imports the Tauri core `invoke` at module top level. The
// serialization helpers under test use only promises, so stub invoke to keep
// the import pure under the node test environment.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { withSerial, withSerialTwo, drainAllSerial } from "../../src/repositories/file-system";

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

describe("drainAllSerial", () => {
  it("resolves only after an in-flight chain settles", async () => {
    const events: string[] = [];
    const gate = deferred();

    const p = withSerial("d1", async () => {
      await gate.promise;
      events.push("work");
    });
    const drain = drainAllSerial().then(() => events.push("drain"));

    gate.resolve();
    await Promise.all([p, drain]);
    expect(events).toEqual(["work", "drain"]);
  });

  it("waits for callbacks enqueued behind a chain it is already draining", async () => {
    const order: string[] = [];
    const gate1 = deferred();
    const gate2 = deferred();

    const p1 = withSerial("d2", async () => {
      await gate1.promise;
      order.push("p1");
    });
    // Start draining while p1 is still in flight.
    const drain = drainAllSerial().then(() => order.push("drain"));
    // Enqueue p2 behind p1 *after* the drain loop has begun.
    const p2 = withSerial("d2", async () => {
      await gate2.promise;
      order.push("p2");
    });

    gate1.resolve();
    await p1;
    gate2.resolve();
    await Promise.all([p2, drain]);
    // Drain must not resolve until the later-enqueued p2 has also run.
    expect(order).toEqual(["p1", "p2", "drain"]);
  });
});
