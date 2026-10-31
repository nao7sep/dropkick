// A save keeps what this build did not read (config-sets-conventions,
// store-recovery-conventions): a key it does not know, and a set whose stored
// value is invalid while the session still uses its built-in for it. A set the
// session changed is written as changed.

const HEADER_KEYS = new Set(["format", "writer"]);

export function keepUnreadSets<K extends string>(
  document: Record<string, unknown>,
  stored: Record<string, unknown>,
  keys: readonly K[],
  current: Record<K, unknown>,
  builtIn: Record<K, unknown>,
  isValid: (key: K, value: unknown) => boolean,
): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...document };
  for (const [key, value] of Object.entries(stored)) {
    if (HEADER_KEYS.has(key)) continue;
    const known = keys.find((candidate) => candidate === key);
    if (known === undefined) {
      kept[key] = value;
    } else if (!isValid(known, value) && JSON.stringify(current[known]) === JSON.stringify(builtIn[known])) {
      kept[key] = value;
    }
  }
  return kept;
}
