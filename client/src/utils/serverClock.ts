/**
 * Tracks the offset between this browser's clock and the server's, so
 * countdowns show server time even if the staff PC's clock is wrong. Timers are
 * display-only — the server alone decides when a session ends.
 */
let offsetMs = 0;
const listeners = new Set<() => void>();

/** Record a server timestamp observed at (approximately) the midpoint of a round trip. */
export function syncServerTime(serverIso: string, sentAt: number, receivedAt: number = Date.now()) {
  const server = new Date(serverIso).getTime();
  if (Number.isNaN(server)) return;
  offsetMs = server - (sentAt + receivedAt) / 2;
  listeners.forEach((l) => l());
}

export const serverNow = () => Date.now() + offsetMs;
export const getServerOffset = () => offsetMs;

export function onServerClockChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
