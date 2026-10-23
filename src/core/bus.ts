/** Tiny pub/sub so repo writes can tell the sync engine something changed. */
type Fn = () => void;
const listeners = new Set<Fn>();
export const onLocalChange = (fn: Fn) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const emitLocalChange = () => listeners.forEach((f) => f());
