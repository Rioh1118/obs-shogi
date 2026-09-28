import { invoke } from "@tauri-apps/api/core";
import { nextRequestNumber } from "./requestNumber";
import type {
  AnalysisResult,
  AnalysisStatus,
  DepthOutcome,
  BookChoice,
  ProbeOutcome,
  SetOptionValue,
  StartOutcome,
} from "./rust-types";

// ===== エンジンの起動・停止 =====
/**
 * 起動・停止の要求の番号。**撃つたびに上げる**（`nextRequestNumber`。webview を読み直しても下がらない）。
 *
 * Rust は既に受けた番号より古い要求を何もせずに断る。Tauri のコマンドは別々のタスクで走るので、
 * 撃った順と Rust に着く順が逆転しうる——番号が無いと、フロントが捨てた古い起動が動いている
 * エンジンを落とし、新しい要求のほうが取り消される（`analyzer.rs` の `Request`）。
 */
export type EngineRequest = number;

/** 解析の起動で渡すもの。**USI の名前は含まない**（どの名前で送るかは Rust が申告から決める） */
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
 * 解析用のエンジンを起動し、設定を送って `readyok` まで待つ。
 *
 * 評価関数と定跡は**パスで**渡し、どの USI の名前（`EvalDir` / `EvalFile` / `BookFile` …）で
 * 送るかは Rust がその回の申告から決める（`binding.rs`）。送らなかった設定は `warnings` で返る。
 * cwd は実行ファイルのフォルダ。
 *
 * 断るときは `StartFailure`（`asStartFailure` で読む）。**`readyok` の待ちに上限は無い**
 * ——止める口は、より新しい番号の `shutdownEngine` と `startAnalysisEngine`
 * （Rust が起動中のプロセスを落とし、この呼び出しは `cancelled` で断られる）。
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

// ===== 局面設定 =====
export async function setPosition(position: string): Promise<void> {
  return await invoke("set_position", { position });
}

export async function setPositionFromMoves(moves: string[]): Promise<void> {
  const position = moves.length > 0 ? `startpos moves ${moves.join(" ")}` : "startpos";
  return await setPosition(position);
}

export async function setPositionFromSfen(sfen: string): Promise<void> {
  const position = `${sfen}`;
  return await setPosition(position);
}

// ===== 解析実行 =====
/**
 * 無限解析を始め、**Rust が作った席の識別子**を返す。
 *
 * **席は応答が返るより先に埋まる。** Rust は `take_session` で席を取ってから `go` を
 * 待つ（`bridge.rs`）ので、この往復の最中に2本目を投げると必ず断られる。
 *
 * **返ってきた席は、要求が要らなくなっていても必ず返すこと**
 * （`stopAnalysis(sessionId, ...)`）。返さないと以後の開始が全部
 * 「Analysis already running」で断られ、エンジンを畳み直すまで解析が始まらない（#441）。
 *
 * 席を取る口はこれだけではない（`analyze_with_time` / `analyze_with_depth` も同じ席を取る）。
 */
export async function startInfiniteAnalysis(): Promise<AnalysisSessionId> {
  return (await invoke<string>("start_infinite_analysis")) as AnalysisSessionId;
}

export async function analyzeWithTime(timeSeconds: number): Promise<AnalysisResult> {
  return await invoke("analyze_with_time", { timeSeconds });
}

/**
 * 深度を指定して解析する。
 *
 * **目標に届かなくても解決する。** 届いたかは `reached` を見ること
 * （`DepthOutcome` の TSDoc に理由がある）。
 */
export async function analyzeWithDepth(depth: number): Promise<DepthOutcome> {
  return await invoke("analyze_with_depth", { depth });
}

/**
 * Rust が渡した解析の席の識別子。
 *
 * **素の `string` と取り違えないための brand。** `AnalysisProvider`
 * （`entities/analysis/model/provider.tsx`）は同じスコープに
 * SFEN を同じ型で並べて持つので、取り違えても tsc は何も言わない——取り違えた回は
 * 本物の `info` が全部落ち（席の照合に通らない）、停止は `Err` になり、
 * **本物の席が Rust に残ったままエンジンを起こし直すまで戻らない**（#441 の症状）。
 *
 * **鋳造してよいのは IPC の境界だけ**（`startInfiniteAnalysis` の戻り値と、`api/events` が
 * `listen` の型引数で受ける通知）。`as` を書けるファイルと、**綴りを書けるファイル**の
 * 両方を `src/__tests__/analysisSessionId.test.ts` が固定している。
 */
declare const analysisSessionIdBrand: unique symbol;
export type AnalysisSessionId = string & { readonly [analysisSessionIdBrand]: true };

/**
 * 停止をどの口から撃ったか。**Rust のログにそのまま出る**
 * （何のために要るかは `bridge.rs` の `stop_all_sessions` に置いてある）。
 *
 * 値の集合が閉じていることがこの引数の価値なので、境界を跨いでも `string` に
 * 落とさず、省略もできない（Rust 側は名乗らない呼び手のために `unnamed` を
 * 持つが、TS からはそこへ落ちない）。
 *
 * **口ごとの部分集合は受け取る側が持つ**（`useEngineSeat`）。分け方は席を返す口の
 * 性質（応答を待てるか・捨てる側か）で、Rust が受け取る値の集合とは別の関心。
 *
 * 値を増やすときは、その口が落ちたときの結末（返し直せるのか、誰も返せないのか）を
 * **その値を撃つ関数の doc** に書き足すこと。書けないなら、その口は要らない。
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
 * 解析を止める。
 *
 * **`sessionId` を省くと走っている解析を全部止める。** 自分の1本ではない
 * （Rust は `stop_all_sessions` に落ちる）。
 *
 * 指したときは持ち主を照合する。**席に居るのが別のセッションなら `Err`**
 * ——止まらないまま解決しないので、指すなら自分が握っている ID を渡すこと。
 * 指した相手が既に居ない場合だけは `Ok`（要求は「止まっていること」なので満たせている）。
 *
 * `by` の意味と、口ごとの部分集合は `SeatReleasePoint` に置いてある。
 */
export async function stopAnalysis(
  sessionId: AnalysisSessionId | undefined,
  by: SeatReleasePoint,
): Promise<void> {
  return await invoke("stop_analysis", { sessionId, by });
}

// ===== 結果取得 =====
export async function getAnalysisResult(
  sessionId: AnalysisSessionId,
): Promise<AnalysisResult | null> {
  return await invoke("get_analysis_result", { sessionId });
}

export async function getLastResult(): Promise<AnalysisResult | null> {
  return await invoke("get_last_result");
}

export async function getAnalysisStatus(): Promise<AnalysisStatus[]> {
  return await invoke("get_analysis_status");
}
