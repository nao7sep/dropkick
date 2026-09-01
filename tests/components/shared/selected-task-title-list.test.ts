// @vitest-environment happy-dom

import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectedTaskTitleList } from "../../../src/components/shared/SelectedTaskTitleList";
import { toTask } from "../../../src/utils";
import { makeTask } from "../../helpers/task";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
});

describe("SelectedTaskTitleList", () => {
  it("uses list semantics without typing bullet characters into task titles", async () => {
    const tasks = [
      toTask(makeTask({ title: "First" }), "/tasks.json", null, 7),
      toTask(makeTask({ title: "" }), "/tasks.json", null, 7),
    ];

    host = await mount(createElement(SelectedTaskTitleList, { tasks }));

    const list = document.querySelector("ul");
    expect(list).toBeTruthy();
    expect(list?.querySelectorAll("li")).toHaveLength(2);
    expect(list?.textContent).toContain("First");
    expect(list?.textContent).toContain("Untitled");
    expect(list?.textContent).not.toContain("•");
  });
});
