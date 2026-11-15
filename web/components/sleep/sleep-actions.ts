/** Synchronous acquisition is essential: React state can lag a second input event. */
export function createActionGate() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(action: () => void | Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try { await action(); return true; }
      finally { busy = false; }
    },
  };
}
