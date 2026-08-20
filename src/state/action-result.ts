// The result vocabulary shared by every mutating store action.
//
// It lives in its own module rather than in one store because more than one
// store speaks it, and a store owning the type the others import would make the
// dependency between them point the wrong way.
//
// Every mutating action returns one of these and never rejects. That contract
// is the point: a store applies its state transition synchronously and then
// awaits a disk write, so a rejected write would leave the UI showing a change
// that never reached disk, with the rejection escaping to the global handler
// where no user ever sees it.
export type ActionResult =
  // `changed` (set by reorder actions like dropkick) reports whether the
  // operation actually moved anything, so callers can advance selection only on
  // a real change rather than guessing from the pre-state.
  | { status: "success"; changed?: boolean }
  | { status: "validation"; reason: string }
  | { status: "error"; message: string };
