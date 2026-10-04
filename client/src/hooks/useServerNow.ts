import { useEffect, useState } from 'react';
import { onServerClockChange, serverNow } from '../utils/serverClock';

/** Server-aligned current time in ms, re-rendering every second. For display only. */
export function useServerNow(intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(serverNow());
    const id = setInterval(tick, intervalMs);
    const unsubscribe = onServerClockChange(tick);
    return () => {
      clearInterval(id);
      unsubscribe();
    };
  }, [intervalMs]);
  return now;
}
