import { describe, expect, it } from "vitest";

import { denyUnhandledExternalDrop } from "../../src/utils/externalDropBoundary";

function drag(
  defaultPrevented = false,
  editable = false,
  types: string[] = [],
  items: Array<{ kind: string }> = [],
): DragEvent {
  const event = {
    defaultPrevented,
    preventDefault() { this.defaultPrevented = true; },
    target: editable ? { closest: () => ({}) } : null,
    dataTransfer: { types, items, dropEffect: "copy" },
  };
  return event as unknown as DragEvent;
}

describe("external drop boundary", () => {
  it("denies an unowned drop", () => {
    const event = drag();
    denyUnhandledExternalDrop(event);
    expect(event.defaultPrevented).toBe(true);
    expect(event.dataTransfer?.dropEffect).toBe("none");
  });

  it("does not override an owned drop", () => {
    const event = drag(true);
    denyUnhandledExternalDrop(event);
    expect(event.dataTransfer?.dropEffect).toBe("copy");
  });

  it("retains ordinary non-file editing but denies files over an editor", () => {
    const text = drag(false, true, ["text/plain"]);
    denyUnhandledExternalDrop(text);
    expect(text.defaultPrevented).toBe(false);

    const file = drag(false, true, [], [{ kind: "file" }]);
    denyUnhandledExternalDrop(file);
    expect(file.defaultPrevented).toBe(true);
  });
});
