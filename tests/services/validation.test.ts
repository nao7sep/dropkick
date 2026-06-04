import { describe, it, expect } from "vitest";
import { canTransitionStatus } from "../../src/services/validation";
import { makeTask, makeNote } from "../helpers/task";

describe("canTransitionStatus", () => {
  it("blocks completion when an actionable note remains", () => {
    const task = makeTask({ notes: [makeNote({ actionability: "Actionable" })] });
    const result = canTransitionStatus(task, "Completed");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Cannot complete: 1 actionable note remaining");
  });

  it("pluralizes the reason for multiple actionable notes", () => {
    const task = makeTask({
      notes: [
        makeNote({ actionability: "Actionable" }),
        makeNote({ actionability: "Actionable" }),
      ],
    });
    expect(canTransitionStatus(task, "Completed").reason).toBe(
      "Cannot complete: 2 actionable notes remaining",
    );
  });

  it("allows completion when notes are informational or resolved", () => {
    const task = makeTask({
      notes: [
        makeNote({ actionability: "Informational" }),
        makeNote({ actionability: "Resolved" }),
      ],
    });
    expect(canTransitionStatus(task, "Completed")).toEqual({ valid: true, reason: null });
  });

  it("always allows dismissal even with actionable notes", () => {
    const task = makeTask({ notes: [makeNote({ actionability: "Actionable" })] });
    expect(canTransitionStatus(task, "Dismissed").valid).toBe(true);
  });

  it("always allows returning to Pending", () => {
    const task = makeTask({ notes: [makeNote({ actionability: "Actionable" })] });
    expect(canTransitionStatus(task, "Pending").valid).toBe(true);
  });
});
