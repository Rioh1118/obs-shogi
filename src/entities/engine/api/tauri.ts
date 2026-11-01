import { invoke } from "@tauri-apps/api/core";
import { nextRequestNumber } from "./requestNumber";
import type { BookChoice, ProbeOutcome, SetOptionValue, StartOutcome } from "./rust-types";

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
