export function createPersistence(
  write: (snapshot: string) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let pending: { snapshot: string; revision: number } | undefined;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = Promise.resolve();

  function flush() {
    clearTimeout(timer);
    const entry = pending;
    pending = undefined;
    if (!entry) return writing;
    writing = writing
      .catch(() => {})
      .then(() => write(entry.snapshot))
      .catch((error) => {
        if (entry.revision === revision) pending ??= entry;
        throw error;
      });
    return writing;
  }

  return {
    queue(snapshot: string) {
      pending = { snapshot, revision: ++revision };
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flush().catch(onError);
      }, 180);
    },
    async flush() {
      await flush();
      while (pending) await flush();
    },
  };
}
