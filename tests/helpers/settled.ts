// Resolves once a store's state meets `done`, checked now and on each change,
// so a test waits for the event it needs rather than polling.
export function settled<S>(
  store: { getState: () => S; subscribe: (listener: (state: S) => void) => () => void },
  done: (state: S) => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    if (done(store.getState())) return resolve();
    const stop = store.subscribe((state) => {
      if (done(state)) { stop(); resolve(); }
    });
  });
}
