// Reconstructs a typed value from parsed JSON, using a defaults object as the
// single source of truth for the shape.
//
// For every key on `defaults`, the stored value is kept when it is present and
// non-null — including other falsy values like false, 0, and "" — and the
// default is used when the file omits the key or stores null. A missing or
// null-corrupted field therefore heals to its default instead of poisoning the
// reconstructed object. Keys present in `data` but absent from `defaults` are
// dropped, so a top-level field removed from a DTO is never carried through a
// load and a later save never re-emits it.
//
// The projection is intentionally shallow and type-blind: nested objects and
// arrays are kept by reference (their inner keys are not filtered), and a stored
// value of the wrong type for a present key is passed through. Fields that
// accept a meaningful null, need range/format repair, or must be a specific
// structural type get an explicit coercion at the call site — see coerceTimezone
// and normalizeKickDistances (preferences) or the array coercion in
// loadWorkspace.
export function mergeWithDefaults<T extends object>(
  defaults: T,
  data: Partial<T>,
): T {
  const result: T = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = data[key];
    if (value !== undefined && value !== null) {
      result[key] = value as T[keyof T];
    }
  }
  return result;
}
