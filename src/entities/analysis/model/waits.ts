/**
 * 解析の待ちの寸法。**テストから縮められる。**
 *
 * ここに在るのは全部**実時計**で測る値で、打ち切りの判定は `Date.now()` の差を見る。
 * 上限（2秒）を跨ぐテストは1本あたり 2.4 秒進めており、**余白は 264ms しかない**
 * ——並走する機械では、コードを1行も触っていないコミットが `verify` でランダムに
 * 止まる。落ちた側は自分の変更が壊したと読むので、この経路を触る人ほど時間を取られる。
 *
 * **偽タイマーには寄せない。** `act` と本物の `Promise` が噛み合う経路なので、
 * 時間を止めると待ちそのものが進まない。縮めるほうを取る。
 */
export interface AnalysisWaits {
  /** 同期が追いつくのを見に行く間隔。**1フレームぶん**（打ち切りの上限に対して十分細かい） */
  syncPollMs: number;
  /** 盤が動いてから再開を始めるまでの猶予。連打を1本に畳む */
  restartDebounceMs: number;
  /**
   * エンジンが position を受け付けるまで待つ上限。これを超えたら送信できていないと
   * 見なし、盤面と一致しない候補手を出さないために解析を始めない。
   * 根拠は実測ではないので、重い評価関数の初期化で足りなければ引き上げてよい。
   */
  positionSyncTimeoutMs: number;
}

/** 現物の値。**アプリはこれだけを使う。** */
const PRODUCTION: AnalysisWaits = {
  syncPollMs: 16,
  restartDebounceMs: 100,
  positionSyncTimeoutMs: 2000,
};

let current: AnalysisWaits = PRODUCTION;

/**
 * いま使う寸法。**呼ぶたびに引くこと**——モジュールの読み込み時に焼き付けると、
 * テストの差し替えが効かない。
 */
export const waits = (): AnalysisWaits => current;

/**
 * 寸法を縮め、**元へ戻す関数を返す**。テストからだけ呼ぶ。
 *
 * 比（上限 : 刻み : 猶予）は現物と揃えてあるので、跨ぐ順序は変わらない。
 * **戻さないと**、後続のテストが縮んだ上限で走り、「上限まで待つ」筋を検査できなくなる
 * ——テストの後始末で必ず戻すこと。
 */
export function shortenWaits(): () => void {
  const previous = current;
  current = { syncPollMs: 4, restartDebounceMs: 25, positionSyncTimeoutMs: 200 };

  return () => {
    current = previous;
  };
}
