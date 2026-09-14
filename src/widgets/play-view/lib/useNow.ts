import { useEffect, useState } from "react";

/**
 * `intervalMs` ごとに進む「いま」。**`null` を渡すと止まる。**
 *
 * 時計を描くためだけのもの。**止まっている時計のために毎秒描き直さない**
 * ——動いている側が居ないあいだ（裁定待ち・終局後・対局なし）は出る文字が変わらないので、
 * 起こしても描き直しが増えるだけになる。
 */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) return;

    // **止まっている間に進んだぶんを、再開した最初の描画で入れる。**
    // 次の tick まで待つと、動き出した時計が最大1秒ぶん古い値から始まる
    setNow(Date.now());

    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
