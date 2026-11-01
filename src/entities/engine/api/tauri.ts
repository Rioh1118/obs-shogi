import { invoke } from "@tauri-apps/api/core";
import { nextRequestNumber } from "./requestNumber";
import type {
  AnalysisResult,
  DepthOutcome,
  BookChoice,
  ProbeOutcome,
  SetOptionValue,
  StartOutcome,
} from "./rust-types";

/**
 * 起動と停止の要求の番号。呼ぶたびに `nextRequestNumber` で取り直す。
 *
 * Rust は既に受けた番号より古い要求を何もせずに断る。Tauri のコマンドは別々のタスクで走るので、
 * 送った順と Rust に着く順は逆転しうる。番号が無いと、フロントが捨てた古い起動が動いている
 * エンジンを落とし、新しい要求のほうが取り消される（`analyzer.rs` の `Request`）
 */
export type EngineRequest = number;

/** 解析の起動で渡すもの。USI の名前は含まない。どの名前で送るかは Rust が申告から決める */
type StartAnalysisEngineArgs = {
  enginePath: string;
  /** 利用者の値（プリセットの `options`） */
  values: SetOptionValue[];
  /** 選んだ評価関数（絶対パス。ファイルでもフォルダでもよい） */
  evalPath: string | null;
  book: BookChoice | null;
  request: EngineRequest;
};

/**
 * 解析用のエンジンを起動し、設定を送って `readyok` まで待つ。cwd は実行ファイルのフォルダ。
 *
 * 評価関数と定跡はパスで渡し、どの USI の名前（`EvalDir`、`EvalFile`、`BookFile` など）で送るかは
 * Rust がその起動の申告から決める（`binding.rs`）。送らなかった設定は `warnings` で返る。
 *
 * 断るときは `StartFailure` で、`asStartFailure` で読む。
 * **`readyok` の待ちに上限は無い。** 止めるには、より新しい番号で `shutdownEngine` か
 * `startAnalysisEngine` を呼ぶ。Rust が起動中のプロセスを落とし、この呼び出しは `cancelled` で断られる
 */
export async function startAnalysisEngine(args: StartAnalysisEngineArgs): Promise<StartOutcome> {
  return await invoke("start_analysis_engine", args);
}

/**
 * エンジンを起こして申告（名前・作者・オプションの定義）だけを取り、落とす。cwd は実行ファイルのフォルダ。
 * 前の取得が起こしている途中なら Rust が取り消し（そちらは `cancelled` で断られる）、既に取り終えて
 * いればそちらの結果も返る。
 *
 * 返った結果も失敗も、`token` がいま待っている取得のものでなければ捨てること（呼び手が持つ。
 * プリセット編集は `presetDialogReducer`）。やめた取得も Rust では止まらず、起こしている途中の
 * プロセスは `usiok` の上限まで残りうる（次の取得が来れば Rust が取り消す）。
 * 断るときは `StartFailure`（`asStartFailure` で読む）
 */
export function probeEngine(enginePath: string): { token: number; outcome: Promise<ProbeOutcome> } {
  const token = nextRequestNumber();
  return { token, outcome: invoke<ProbeOutcome>("probe_engine", { enginePath, token }) };
}

/** 解析用のエンジンを落とす。起動中のものも止める。既に新しい番号を受けていれば何もしない */
export async function shutdownEngine(request: EngineRequest): Promise<void> {
  return await invoke("shutdown_engine", { request });
}

export async function setPositionFromSfen(sfen: string): Promise<void> {
  return await invoke("set_position", { position: sfen });
}

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

/**
 * 停止をどの経路から呼んだか。Rust のログにそのまま出る（理由は `bridge.rs` の `stop_all_sessions`）。
 *
 * 値の集合が閉じていることがこの引数の価値なので、境界を跨いでも `string` に落とさず、省略もできない。
 * Rust 側は名乗らない呼び手のために `unnamed` を持つが、TS からはそこへ落ちない。
 *
 * 経路ごとの部分集合は受け取る側が持つ（`useEngineSeat`）。分け方は席を返す経路の性質
 * （応答を待てるか、捨てる側か）で、Rust が受け取る値の集合とは別の関心。
 *
 * 値を増やすときは、その経路が落ちたときの結末（返し直せるか、誰も返せないか）を、
 * その値を渡す関数の doc に書き足す。書けないなら、その経路は要らない
 */
export type SeatReleasePoint =
  | "stop"
  | "start"
  | "restart"
  | "unmount"
  | "no-position"
  | "sync-timeout"
  | "late-start"
  | "late-restart";

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
