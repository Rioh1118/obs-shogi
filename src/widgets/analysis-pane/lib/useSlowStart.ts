import { useEffect, useState } from "react";
import { SLOW_START_MS } from "@/entities/engine";

/** `起動中…` が `SLOW_START_MS` を越えたか。段を抜けたら倒れる */
export function useSlowStart(starting: boolean): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [starting]);

  return slow;
}
