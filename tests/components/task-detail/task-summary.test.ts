// @vitest-environment happy-dom
//
// The summary draws one rule between each pair of groups that are both present
// and none for an empty group (interface-styling-conventions, "No stray
// separators"). Pending tasks with no Critical, Important or Urgent row used to
// leave an empty priority group whose rule doubled the one below it.

import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskSummary } from "../../../src/components/task-detail/TaskSummary";
import { toTask } from "../../../src/utils";
import { makeNote, makeTask } from "../../helpers/task";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";
import type { TaskDto } from "../../../src/models";

let host: Mounted;
afterEach(async () => {
  await host?.unmount();
});

const tasks = (...dtos: TaskDto[]) => dtos.map((dto) => toTask(dto, "/tasks.json", null, 7));

async function groupsOf(list: ReturnType<typeof tasks>): Promise<string[]> {
  host = await mount(createElement(TaskSummary, { tasks: list }));
  const container = document.querySelector("[data-summary-groups]")!;
  // Every group is one child of a divide-y container, so the rules are exactly
  // the gaps between present children and an absent group draws nothing.
  expect(container.className).toContain("divide-y");
  const groups = [...container.children].map((child) => child.textContent ?? "");
  for (const group of groups) expect(group.trim()).not.toBe("");
  return groups;
}

describe("TaskSummary groups", () => {
  it("leaves out the priority group when nothing pending is prioritised", async () => {
    const actionable = makeNote({ actionability: "Actionable" });
    const groups = await groupsOf(tasks(makeTask(), makeTask({ status: "Completed" }), makeTask({ notes: [actionable] })));
    expect(groups).toHaveLength(3);
    expect(groups[2]).toMatch(/action/i);
  });

  it("shows the priority group only with its present rows", async () => {
    const groups = await groupsOf(tasks(makeTask({ priority: "Critical" }), makeTask()));
    expect(groups).toHaveLength(3);
    expect(groups[2]).toMatch(/Critical/);
    expect(groups[2]).not.toMatch(/Important|Urgent/);
  });

  it("shows just totals and statuses when every other group is empty", async () => {
    expect(await groupsOf(tasks())).toHaveLength(2);
    await host.unmount();
    expect(await groupsOf(tasks(makeTask({ status: "Dismissed" })))).toHaveLength(2);
  });

  it("shows all four groups when each has something to say", async () => {
    const actionable = makeNote({ actionability: "Actionable" });
    const groups = await groupsOf(tasks(makeTask({ priority: "Urgent", notes: [actionable] })));
    expect(groups).toHaveLength(4);
  });
});
