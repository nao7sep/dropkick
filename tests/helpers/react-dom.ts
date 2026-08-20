// Driving a React component in a spec.
//
// The suite carries no React testing library: the app's components are thin and
// the few that need exercising need only these lines. Keeping them here also
// declares the act-environment flag in exactly one place. Specs using this must
// opt into the DOM with `// @vitest-environment happy-dom`.

import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

export interface Mounted {
  unmount: () => Promise<void>;
}

export async function mount(element: ReactElement): Promise<Mounted> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
