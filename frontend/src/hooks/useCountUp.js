import { useEffect, useState } from 'react';

export function useCountUp(value, duration = 420) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(Number(value))) { setShown(value); return undefined; }
    const from = Number(shown) || 0; const to = Number(value); const started = performance.now();
    let frame;
    const tick = (now) => {
      const p = Math.min((now - started) / duration, 1);
      setShown(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}
