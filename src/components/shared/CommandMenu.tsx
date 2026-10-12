// Keep Radix's popup, dismissal, type-ahead and roving focus. Its defaults
// couple hover to focus and leave pointer entry on the container; this local
// integration initializes command navigation and makes hover visual only.
import { createContext, useContext, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, PropsWithChildren, RefObject } from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";

const MenuContext = createContext<{
  open: (value: boolean) => void;
  entry: RefObject<"first" | "last">;
} | null>(null);

function useMenu() {
  const context = useContext(MenuContext);
  if (!context) throw new Error("Command menu needs its Root");
  return context;
}

export function Root({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const entry = useRef<"first" | "last">("first");
  return (
    <MenuContext.Provider value={{ open: setOpen, entry }}>
      <Primitive.Root open={open} onOpenChange={setOpen}>{children}</Primitive.Root>
    </MenuContext.Provider>
  );
}

export function Trigger(props: ComponentPropsWithoutRef<typeof Primitive.Trigger>) {
  const menu = useMenu();
  return <Primitive.Trigger {...props}
    onPointerDown={(event) => {
      props.onPointerDown?.(event);
      menu.entry.current = "first";
    }}
    onKeyDown={(event) => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented || props.disabled) return;
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        menu.entry.current = event.key === "ArrowUp" ? "last" : "first";
        if (event.key === "ArrowUp") {
          event.preventDefault();
          menu.open(true);
        }
      }
    }}
  />;
}

export function Content(props: ComponentPropsWithoutRef<typeof Primitive.Content>) {
  const menu = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  return <Primitive.Content {...props} ref={ref}
    onFocus={(event) => {
      props.onFocus?.(event);
      if (event.defaultPrevented || event.target !== event.currentTarget) return;
      event.preventDefault();
      const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])');
      const target = items?.[menu.entry.current === "last" ? items.length - 1 : 0];
      target?.focus({ preventScroll: true });
    }}
    onKeyDown={(event) => {
      props.onKeyDown?.(event);
      if (event.key === "Tab" && !event.defaultPrevented) {
        event.preventDefault();
        menu.open(false);
      }
    }}
  />;
}

export function Item(props: ComponentPropsWithoutRef<typeof Primitive.Item>) {
  return <Primitive.Item {...props}
    onPointerMove={(event) => { props.onPointerMove?.(event); event.preventDefault(); }}
    onPointerLeave={(event) => { props.onPointerLeave?.(event); event.preventDefault(); }}
  />;
}

export const Portal = Primitive.Portal;
export const Label = Primitive.Label;
export const Separator = Primitive.Separator;
