import type { ReactNode, RefObject } from "react";
import type { Task } from "../../models";
import { taskSelectionKey } from "../../utils";
import { VirtualRows } from "../VirtualRows";

export function VirtualTaskRows(props: {
  tasks: Task[];
  scrollRef: RefObject<HTMLDivElement | null>;
  pinnedKeys: readonly (string | null)[];
  renderRow: (task: Task, ref: (node: HTMLDivElement | null) => void) => ReactNode;
}) {
  return <VirtualRows items={props.tasks} itemKey={taskSelectionKey} estimatedHeight={30}
    scrollRef={props.scrollRef} pinnedKeys={props.pinnedKeys} renderRow={props.renderRow} />;
}
