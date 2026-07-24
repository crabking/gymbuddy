import { useEffect } from "react";

const blockers = new Set<string>();
const listeners = new Set<() => void>();
let operationSequence = 0;

function notify() {
  listeners.forEach((listener) => listener());
}

export function setPwaUpdateBlocker(key: string, blocked: boolean) {
  const changed = blocked ? !blockers.has(key) : blockers.has(key);
  if (blocked) blockers.add(key);
  else blockers.delete(key);
  if (changed) notify();
}

export function isPwaUpdateBlocked() {
  return blockers.size > 0;
}

export function subscribePwaUpdateBlockers(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function whilePwaUpdateBlocked<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${label}-${++operationSequence}`;
  setPwaUpdateBlocker(key, true);
  try {
    return await operation();
  } finally {
    setPwaUpdateBlocker(key, false);
  }
}

export function usePwaUpdateBlocker(key: string, blocked: boolean) {
  useEffect(() => {
    setPwaUpdateBlocker(key, blocked);
    return () => setPwaUpdateBlocker(key, false);
  }, [key, blocked]);
}
