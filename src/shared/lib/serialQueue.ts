/**
 * 渡した処理を1本ずつ順に走らせる列を作る。
 *
 * 前の処理が失敗しても次へ進み、失敗は呼び手の promise にだけ返る。
 * ファイルごと置き換える保存は、読んでから書くまでの間に別の書き込みが挟まると、
 * 挟まった分を古い値へ戻す。
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job);
    tail = run.catch(() => undefined);
    return run;
  };
}
