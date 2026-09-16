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
  const [ticking, setTicking] = useState(intervalMs);

  // **止まっている間に進んだぶんを、動き出した描画そのものに入れる。**
  // `useEffect` でやると commit が1回だけ古い値で通る。読み手（`HeaderGameLine`）は
  // アプリの起動から常時 mount していて、対局と対局の間ずっと `now` が据え置かれる
  // ——起動2時間後に始めた対局では、その1回が「残り 2:07:48」を描く。
  if (ticking !== intervalMs) {
    setTicking(intervalMs);
    if (intervalMs !== null) setNow(Date.now());
  }

  useEffect(() => {
    if (intervalMs === null) return;

    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
