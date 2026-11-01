import { invoke } from "@tauri-apps/api/core";
import type { AnalysisResult } from "@/entities/engine";

/**
 * 深度指定の解析が返すもの。`result` は `reached` を見てから使う
 *
 * `usi` crate に深度を載せる手段が無く `go depth` は送れないので、Rust 側は `info depth` を見て
 * `stop` を送る。時間の打ち切りが先に来れば、目標に届かないまま結果が返る。
 * `result` だけを読むと、深度22の結果を深度40の解析として画面に出すことになる
 */
type DepthOutcome = {
  result: AnalysisResult;
  /** 要求した深度 */
  requested: number;
  /** 実際に届いた深度。`info` が1行も来なければ `null` */
  deepest?: number | null;
  /** `requested` に届いたか */
  reached: boolean;
};

/**
 * 無限解析を始め、Rust が作った席の識別子を返す。
 *
 * 席は応答が返るより先に埋まる。Rust は `take_session` で席を取ってから `go` を待つ（`bridge.rs`）ので、
 * この往復の最中に2本目を呼ぶと必ず断られる。
 *
 * **返ってきた席は、要求が要らなくなっていても `stopAnalysis` で必ず返す。** 返さないと以後の開始が
 * 全部「Analysis already running」で断られ、エンジンを起動し直すまで解析が始まらない。
 * `analyze_with_time` と `analyze_with_depth` も同じ席を取る
 */
export async function startInfiniteAnalysis(): Promise<AnalysisSessionId> {
  // reject の値は Rust の `StartRefusal`（`isAnalysisStartUnreachable` で見分ける）
  return (await invoke<string>("start_infinite_analysis")) as AnalysisSessionId;
}

export async function analyzeWithTime(timeSeconds: number): Promise<AnalysisResult> {
  return await invoke("analyze_with_time", { timeSeconds });
}

/** 深度を指定して解析する。目標に届かなくても解決するので、`DepthOutcome` の `reached` を見る */
export async function analyzeWithDepth(depth: number): Promise<DepthOutcome> {
  return await invoke("analyze_with_depth", { depth });
}

declare const analysisSessionIdBrand: unique symbol;

/**
 * Rust が渡した解析の席の識別子。素の `string` と取り違えないための brand。
 *
 * `AnalysisProvider`（`entities/analysis/model/provider.tsx`）は同じスコープに SFEN を同じ型で
 * 並べて持つ。取り違えると本物の `info` が席の照合に通らず全部落ち、停止は `Err` になる。
 * 本物の席は Rust に残ったままで、エンジンを起動し直すまで戻らない。
 *
 * **鋳造してよいのは IPC の境界だけ**（`startInfiniteAnalysis` の戻り値と、`api/events` が
 * `listen` の型引数で受ける通知）。`as` と綴りを書けるファイルは
 * `src/__tests__/analysisSessionId.test.ts` が固定している
 */
export type AnalysisSessionId = string & { readonly [analysisSessionIdBrand]: true };

/** 応答を待てる経路。失敗を呼び手へ投げる */
export type BlockingReleasePoint = "stop" | "start" | "restart";
/** 応答を待てない経路。落ちても画面に出せない（結末は `useEngineSeat` の `sendStopQuietly`） */
export type QuietReleasePoint = "sync-timeout" | "no-position";
/** 要らなくなった開始が持ってきた席を捨てる経路 */
export type DiscardReleasePoint = "late-start" | "late-restart";
/**
 * どの関数の引数にもならない値。席を指さない停止は Rust の席を全部空けるので、
 * 呼び手へ渡すと別の経路が取った席まで巻き添えにする。送るのは `useEngineSeat` の中だけ
 */
type InlineOnlyReleasePoint = "unmount";

/**
 * 停止をどの経路から呼んだか。Rust のログにそのまま出る（理由は `bridge.rs` の `stop_all_sessions`）。
 *
 * 値の集合が閉じていることがこの引数の価値なので、境界を跨いでも `string` に落とさず、省略もできない。
 * Rust 側は名乗らない呼び手のために `unnamed` を持つが、TS からはそこへ落ちない。
 *
 * 部分集合の分け方は席を返す経路の性質（応答を待てるか、捨てる側か）。値を取り違えても Rust は
 * 止まるので、壊れるのはログだけになる。型で割っておけば `releaseHeldQuietly("unmount")` は tsc が止める。
 *
 * 値を増やすときは、その経路が落ちたときの結末（返し直せるか、誰も返せないか）を、
 * その値を渡す関数の doc に書き足す。書けないなら、その経路は要らない
 */
export type SeatReleasePoint =
  | BlockingReleasePoint
  | QuietReleasePoint
  | DiscardReleasePoint
  | InlineOnlyReleasePoint;

/**
 * 解析の開始の失敗が、エンジンへ書けなかったためか。
 *
 * 書けなかったときは `応答なし` に入り、検討の意思が残る。やり直しても同じ断りになる失敗とは次の手が違う
 */
export function isAnalysisStartUnreachable(e: unknown): boolean {
  return typeof e === "object" && e !== null && "unreachable" in e && e.unreachable === true;
}

/**
 * 停止の結末。`unanswered` は席は空いたがエンジンが答えていない状態で、失敗ではない。
 * Rust は答えが来るまで次の局面を断るので、続けて開始を頼まない
 */
export type StopOutcome = "stopped" | "unanswered";

/**
 * 解析を止める。`by` の意味と経路ごとの部分集合は `SeatReleasePoint` に置く。
 *
 * **`sessionId` を省くと、自分の1本ではなく走っている解析を全部止める**
 * （Rust は `stop_all_sessions` に落ちる）。
 *
 * 指したときは持ち主を照合する。席に居るのが別のセッションなら `Err` で、止まらないまま解決はしない。
 * 指すなら自分が握っている ID を渡す。指した相手が既に居ないときだけは `Ok` で返る
 * （要求は「止まっていること」なので満たせている）
 */
export async function stopAnalysis(
  sessionId: AnalysisSessionId | undefined,
  by: SeatReleasePoint,
): Promise<StopOutcome> {
  return await invoke<StopOutcome>("stop_analysis", { sessionId, by });
}
