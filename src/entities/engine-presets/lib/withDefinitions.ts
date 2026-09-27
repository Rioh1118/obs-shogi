import type { ProbeOutcome } from "@/entities/engine";
import type { EnginePreset } from "../model/types";

/**
 * 取得の結果（定義・エンジンの名前・取った時刻）をプリセットの下書きに入れる。**利用者の値には触らない**
 * ——送る側が起動のたびに申告へ当てる（Rust の `binding::bind`）。
 *
 * `outcome.enginePath` が下書きのエンジンと違えば、何もせずに同じ参照を返す（取得を待つ間に
 * エンジンを選び直した）
 */
export function withDefinitions(
  cur: EnginePreset,
  outcome: ProbeOutcome,
  probedAt: string,
): EnginePreset {
  if (cur.enginePath !== outcome.enginePath) return cur;
  return {
    ...cur,
    definitions: outcome.definitions,
    definitionsFor: outcome.enginePath,
    probedAt,
    engineName: outcome.name,
    engineAuthor: outcome.author,
  };
}
