/**
 * 解析の待ちの寸法
 *
 * どれも実時計で測る。テストが現物の `positionSyncTimeoutMs` を跨ぐと1本あたり数秒かかり、
 * 並走する機械ではコードを触っていないコミットが `verify` で落ちる。偽タイマーは `act` と本物の
 * `Promise` が噛み合わず待ちが進まないので使わない。`shortenWaits` で縮める。
 */
type AnalysisWaits = {
  /** 同期が追いつくのを見に行く間隔。1フレームぶん */
  syncPollMs: number;
  /** 盤が動いてから再開を始めるまでの猶予。連打を1本に畳む */
  restartDebounceMs: number;
  /**
   * エンジンが position を受け付けるまで待つ上限。超えたら送信できていないと見なし、
   * 盤面と一致しない候補手を出さないために解析を始めない。
   * 根拠は実測ではないので、重い評価関数の初期化で足りなければ引き上げてよい
   */
  positionSyncTimeoutMs: number;
  /** 結果を画面へ反映する間引き。`info` は数十 ms 間隔で届くので、1周期に1回へ畳む */
  resultFlushMs: number;
};

/** 現物の値。アプリはこれだけを使う */
const PRODUCTION: AnalysisWaits = {
  syncPollMs: 16,
  restartDebounceMs: 100,
  positionSyncTimeoutMs: 2000,
  resultFlushMs: 80,
};

let current: AnalysisWaits = PRODUCTION;

/** いま使う寸法を返す。読み込み時に値を取ると `shortenWaits` が効かないので、使うたびに呼ぶ。 */
export const waits = (): AnalysisWaits => current;

/**
 * 縮める割合。上限も実時計で測るので、大きくするほど上限を跨ぐテストの余白が消え、
 * 並走する機械で落ちる
 */
const TEST_SCALE = 4;

/**
 * 寸法を `TEST_SCALE` 分の1に縮め、元へ戻す関数を返す。
 *
 * テストからだけ呼ぶ（`src/__tests__/testWaits.test.ts`）。全部を同じ比で縮めるので、大小の順序
 * （刻み < 間引き < 猶予 < 上限）は現物と同じ。比が揃わないと、現物では起きない順序を検査する。
 * 後始末で必ず戻すこと。戻さないと後続のテストが縮んだ上限で走る。
 */
export function shortenWaits(): () => void {
  const previous = current;
  current = {
    syncPollMs: PRODUCTION.syncPollMs / TEST_SCALE,
    restartDebounceMs: PRODUCTION.restartDebounceMs / TEST_SCALE,
    positionSyncTimeoutMs: PRODUCTION.positionSyncTimeoutMs / TEST_SCALE,
    resultFlushMs: PRODUCTION.resultFlushMs / TEST_SCALE,
  };

  return () => {
    current = previous;
  };
}
