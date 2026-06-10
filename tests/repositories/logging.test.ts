import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// The frontend logger forwards every event to the Rust core over `invoke`.
// Mock it so we can inspect exactly what would be written, and drive the
// fallback path by making it reject.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

import { invoke } from "@tauri-apps/api/core";
import {
  log,
  toErrorFields,
  loadFailureFields,
} from "../../src/repositories/logging";

const invokeMock = invoke as unknown as Mock;

// emit() forwards fire-and-forget through a microtask chain; a macrotask tick
// drains it so we can assert on what was forwarded.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function lastForwardedEntry(): Record<string, unknown> {
  const calls = invokeMock.mock.calls.filter((c) => c[0] === "log_event");
  const last = calls.at(-1);
  if (!last) throw new Error("invoke('log_event', ...) was never called");
  return (last[1] as { entry: Record<string, unknown> }).entry;
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve());
});

describe("envelope", () => {
  it("forwards a well-formed envelope with level, message, and a UTC ISO-ms time", async () => {
    log.info("did a thing", { count: 3 });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("did a thing");
    expect(entry.count).toBe(3);
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("carries the level through for warn and error", async () => {
    log.warn("a warning", {});
    log.error("an error", {});
    await flush();

    const levels = invokeMock.mock.calls
      .filter((c) => c[0] === "log_event")
      .map((c) => (c[1] as { entry: { level: string } }).entry.level);
    expect(levels).toEqual(["warn", "error"]);
  });

  it("never lets a field clobber the envelope keys", async () => {
    log.info("real message", {
      message: "imposter",
      level: "debug",
      time: "not-a-time",
    });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.message).toBe("real message");
    expect(entry.level).toBe("info");
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("preserves load failure detail outside the reserved envelope message", async () => {
    log.warn(
      "task list load failed",
      loadFailureFields("/x.json", { status: "invalid", message: "bad json" }),
    );
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.message).toBe("task list load failed");
    expect(entry.status).toBe("invalid");
    expect(entry.error).toEqual({ message: "bad json" });
  });
});

describe("redaction backstop", () => {
  it("redacts denied keys by exact, case-insensitive name", async () => {
    log.info("creds", {
      apiKey: "sk-live-1",
      APIKEY: "sk-live-2",
      Authorization: "Bearer xyz",
      password: "hunter2",
      secret: "s",
      token: "t",
    });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.apiKey).toBe("[redacted]");
    expect(entry.APIKEY).toBe("[redacted]");
    expect(entry.Authorization).toBe("[redacted]");
    expect(entry.password).toBe("[redacted]");
    expect(entry.secret).toBe("[redacted]");
    expect(entry.token).toBe("[redacted]");
  });

  it("never matches a denied key as a substring", async () => {
    log.info("counts", { tokenCount: 5, broken: true, authorizationHeader: "h" });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.tokenCount).toBe(5);
    expect(entry.broken).toBe(true);
    expect(entry.authorizationHeader).toBe("h");
  });

  it("recurses into nested objects and arrays, replacing the whole matched value", async () => {
    log.info("nested", {
      outer: { Password: "x", ok: 1 },
      list: [{ secret: "y" }, { fine: "z" }],
      authorization: { scheme: "Bearer", creds: "abc" },
    });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.outer).toEqual({ Password: "[redacted]", ok: 1 });
    expect(entry.list).toEqual([{ secret: "[redacted]" }, { fine: "z" }]);
    expect(entry.authorization).toBe("[redacted]");
  });

  it("never edits the message, even when it contains secret-like text", async () => {
    log.info("password=hunter2 token=abc", { ok: true });
    await flush();

    expect(lastForwardedEntry().message).toBe("password=hunter2 token=abc");
  });

  it("preserves non-plain object values (Date/Map/Set) instead of flattening them to {}", async () => {
    const when = new Date("2026-06-10T03:15:42.123Z");
    const map = new Map([["k", 1]]);
    const set = new Set([1, 2]);
    log.info("rich values", { when, map, set, nested: { also: when } });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.when).toBeInstanceOf(Date);
    expect((entry.when as Date).toISOString()).toBe("2026-06-10T03:15:42.123Z");
    expect(entry.map).toBeInstanceOf(Map);
    expect(entry.set).toBeInstanceOf(Set);
    // Recursion into plain objects still happens; the Date inside is preserved.
    expect((entry.nested as { also: Date }).also).toBeInstanceOf(Date);
  });

  it("redacts a denied key even when its value is a non-plain object", async () => {
    log.info("secret holders", { token: new Date(), password: new Map() });
    await flush();

    const entry = lastForwardedEntry();
    expect(entry.token).toBe("[redacted]");
    expect(entry.password).toBe("[redacted]");
  });
});

describe("toErrorFields", () => {
  it("captures name, message, and stack of an Error", () => {
    const error = new TypeError("boom");
    const { error: described } = toErrorFields(error) as {
      error: { name: string; message: string; stack?: string };
    };
    expect(described.name).toBe("TypeError");
    expect(described.message).toBe("boom");
    expect(typeof described.stack).toBe("string");
  });

  it("walks the cause chain", () => {
    const root = new Error("root");
    const wrapped = new Error("wrapped", { cause: root });
    const { error: described } = toErrorFields(wrapped) as {
      error: { message: string; cause: { message: string } };
    };
    expect(described.message).toBe("wrapped");
    expect(described.cause.message).toBe("root");
  });

  it("preserves a non-Error rejection value (Tauri rejects with strings)", () => {
    expect(toErrorFields("File not registered: /x.json")).toEqual({
      error: { message: "File not registered: /x.json" },
    });
  });
});

describe("loadFailureFields", () => {
  it("includes the error message when the failure result carries one", () => {
    expect(
      loadFailureFields("/x.json", { status: "invalid", message: "bad json" }),
    ).toEqual({
      path: "/x.json",
      status: "invalid",
      error: { message: "bad json" },
    });
  });

  it("omits error for a result that has none (e.g. missing)", () => {
    expect(loadFailureFields("/x.json", { status: "missing" })).toEqual({
      path: "/x.json",
      status: "missing",
    });
  });
});

describe("console fallback", () => {
  it("degrades to the console when forwarding fails, and never throws", async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error("ipc down")));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => log.error("something failed", { detail: 1 })).not.toThrow();
    await flush();

    expect(consoleError).toHaveBeenCalled();
    const args = consoleError.mock.calls.at(-1) ?? [];
    expect(String(args[0])).toContain("[dropkick:log:error]");
    consoleError.mockRestore();
  });
});
