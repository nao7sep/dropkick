import { describe, it, expect } from "vitest";
import { retainLaterTaskList, settleTaskMove } from "../../src/services/task-list-settlement";
import { makeTask, makeNote } from "../helpers/task";

describe("task list settlement", () => {
  it("accepts disk fields while retaining later task and note edits, additions and removals", () => {
    const original = makeTask({ id: "a", title: "local submitted", description: "before", notes: [makeNote({ id: "n", content: "before" })] });
    const before = { id: "L", tasks: [original, makeTask({ id: "removed" })] };
    const current = { ...before, tasks: [makeTask({ id: "new" }), { ...original, description: "later", notes: [{ ...original.notes[0], content: "later note" }] }] };
    const disk = { id: "L", tasks: [{ ...original, title: "disk title", notes: [makeNote({ id: "disk-note" }), original.notes[0]] }, before.tasks[1]] };
    const result = retainLaterTaskList(before, current, disk);
    expect(result.tasks.map((t) => t.id)).toEqual(["new", "a"]);
    expect(result.tasks[1].title).toBe("disk title");
    expect(result.tasks[1].description).toBe("later");
    expect(result.tasks[1].notes.map((n) => n.id)).toEqual(["disk-note", "n"]);
    expect(result.tasks[1].notes[1].content).toBe("later note");
  });

  it("moves later edits with the task and preserves independent edits in both files", () => {
    const moved = makeTask({ id: "m" });
    const source = { id: "S", tasks: [moved, makeTask({ id: "s" })] };
    const destination = { id: "D", tasks: [makeTask({ id: "d" })] };
    const currentSource = { ...source, tasks: [{ ...moved, title: "later moved" }, { ...source.tasks[1], title: "later source" }] };
    const currentDestination = { ...destination, tasks: [{ ...destination.tasks[0], title: "later destination" }] };
    const result = settleTaskMove(source, destination, currentSource, currentDestination,
      { ...source, tasks: [source.tasks[1]] }, { ...destination, tasks: [moved, ...destination.tasks] });
    expect(result.sourceData.tasks.map((t) => t.title)).toEqual(["later source"]);
    expect(result.destData.tasks.map((t) => t.title)).toEqual(["later moved", "later destination"]);
  });
});
