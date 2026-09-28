const KEY = "pixel-pocket-pending";
const EVENT = "pocket-queue";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(ids));
  window.dispatchEvent(new Event(EVENT));
}

export function enqueuePending(id: string): void {
  if (!id) return;
  const next = read();
  if (next.includes(id)) return;
  next.push(id);
  write(next);
}

export function dequeuePending(id: string): void {
  write(read().filter((row) => row !== id));
}

export function listPending(): string[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

export function onPendingChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const wrap = () => fn();
  window.addEventListener(EVENT, wrap);
  window.addEventListener("storage", wrap);
  return () => {
    window.removeEventListener(EVENT, wrap);
    window.removeEventListener("storage", wrap);
  };
}
