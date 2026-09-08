/**
 * 解析の待ちの寸法。**テストから縮められる。**
 *
 * ここに在るのは全部**実時計**で測る値。テストが現物の上限（2秒）を跨ごうとすると、
 * 1本あたり数秒を実時間で進めることになり、並走する機械では**コードを1行も触っていない
 * コミットが `verify` でランダムに落ちる**。落ちた側は自分の変更が壊したと読む。
 *
 * **偽タイマーには寄せない。** `act` と本物の `Promise` が噛み合う経路なので、
 * 時間を止めると待ちそのものが進まない。縮めるほうを取る。
 *
 * **4つとも同じ比で縮める。** 1つだけ別の比にすると、寸法どうしの**順序**が現物と
 * 変わる——間引きと猶予が入れ替わると、`useResultFlush` の窓を見るテストが
 * 現物では起きない順序を検査することになる。
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
  /** 結果を画面へ反映する間引き。**80ms ごとに1回**（`info` は数十 ms 間隔で届く） */
  resultFlushMs: number;
}

/** 現物の値。**アプリはこれだけを使う。** */
const PRODUCTION: AnalysisWaits = {
  syncPollMs: 16,
  restartDebounceMs: 100,
  positionSyncTimeoutMs: 2000,
  resultFlushMs: 80,
};

let current: AnalysisWaits = PRODUCTION;

/**
 * いま使う寸法。**呼ぶたびに引くこと**——モジュールの読み込み時に焼き付けると、
 * テストの差し替えが効かない。
 */
export const waits = (): AnalysisWaits => current;

/** 縮める割合。**4つとも同じ**——寸法どうしの順序を現物のまま保つため */
const TEST_SCALE = 4;

/**
 * 寸法を 1/4 に縮め、**元へ戻す関数を返す**。テストからだけ呼ぶ。
 *
 * **4つとも同じ比なので、大小の順序は現物と同じ**（刻み < 間引き < 猶予 < 上限）。
 * 1つだけ別の比にすると、間引きと猶予が入れ替わって現物では起きない順序を検査する。
 *
 * **戻さないと**、後続のテストが縮んだ上限で走り、「上限まで待つ」筋を検査できなくなる
 * ——テストの後始末で必ず戻すこと。
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
