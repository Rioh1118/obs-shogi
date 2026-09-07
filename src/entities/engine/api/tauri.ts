import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisResult,
  AnalysisStatus,
  DepthOutcome,
  EngineInfo,
  EngineSettings,
} from "./rust-types";

// ===== エンジン初期化・管理 =====
export async function initializeEngine(enginePath: string, workDir: string): Promise<void> {
  return await invoke("initialize_engine", {
    enginePath,
    workingDir: workDir,
  });
}

export async function shutdownEngine(): Promise<void> {
  return await invoke("shutdown_engine");
}

export async function getEngineInfo(): Promise<EngineInfo | null> {
  return await invoke("get_engine_info");
}

// ===== エンジン設定 =====
export async function applyEngineSettings(settings: EngineSettings): Promise<void> {
  return await invoke("apply_engine_settings", { settings });
}

export async function getEngineSettings(): Promise<EngineSettings> {
  return await invoke("get_engine_settings");
}

export async function applyCustomSettings(
  hashSizeMB: number = 1024,
  threads: number = 4,
  multiPV: number = 1,
): Promise<void> {
  const settings: EngineSettings = {
    options: {
      USI_Hash: hashSizeMB.toString(),
      Threads: threads.toString(),
      MultiPV: multiPV.toString(),
    },
  };
  return await applyEngineSettings(settings);
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
 * **素の `string` と取り違えないための brand。** この provider は同じスコープに
 * SFEN を同じ型で並べて持つので、取り違えても tsc は何も言わない——取り違えた回は
 * 本物の `info` が全部落ち（席の照合に通らない）、停止は `Err` になり、
 * **本物の席が Rust に残ったままエンジンを起こし直すまで戻らない**（#441 の症状）。
 *
 * **鋳造してよいのは IPC の境界だけ**（`startInfiniteAnalysis` の戻り値と
 * `api/events` が受け取る通知）。`as` を書く場所は
 * `src/__tests__/analysisSessionId.test.ts` が固定している。
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
 * **受け取る口ごとに部分集合を持つ。** 値を取り違えても Rust は止まるので、
 * 壊れるのはログだけ——#441 の再発を追う人が読む唯一の手掛かりが嘘になる。
 * 型で割っておけば `releaseHeldQuietly("unmount")` は tsc が止める。
 *
 * 値を増やすときは、その口が落ちたときの結末（返し直せるのか、誰も返せないのか）を
 * **その値を撃つ関数の doc** に書き足すこと。書けないなら、その口は要らない。
 */
export type SeatReleasePoint = BlockingReleasePoint | QuietReleasePoint | DiscardPoint | "unmount";

/** 応答を待てる口。落ちたら呼び手へ投げ、次に返せる機会へ持ち越す */
export type BlockingReleasePoint = "stop" | "start" | "restart";

/** 応答を待てない口。落ちても画面に出せない（結末は `useEngineSeat` の `shootQuietly`） */
export type QuietReleasePoint = "sync-timeout" | "no-position";

/** 要らなくなった開始が持ってきた席を捨てる口 */
export type DiscardPoint = "late-start" | "late-restart";

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
