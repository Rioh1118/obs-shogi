import { describeOwnedSpellings } from "./ownedSpelling";

/**
 * 解析の席の識別子（`AnalysisSessionId`）を鋳造する綴りを、IPC の境界に閉じる。
 *
 * brand は素の `string` からの代入を tsc が止めるが、`as` は素通りする。
 * **取り違える相手がすぐ隣に居る**——`AnalysisProvider` は席の識別子と SFEN を
 * 同じスコープに持ち、どちらも `string`。取り違えた回は本物の `info` が全部落ち
 * （席の照合に通らない）、停止は `Err` になり、**本物の席が Rust に残ったまま
 * エンジンを起こし直すまで戻らない**（#441 の症状そのもの）。
 *
 * **綴りを2つのディレクトリに閉じる。** `as` だけを見ても足りない——`listen<{ sessionId:
 * AnalysisSessionId }>` のように**型引数でも鋳造できる**ので、綴りの出現そのものを
 * 持ち主の外で禁じる。`listen` は他のスライスからも呼ばれている。

 */
const RULES = [
  {
    name: "AnalysisSessionId の綴り",
    pattern: /\bAnalysisSessionId\b/,
    owners: [
      "src/entities/engine/api/tauri.ts",
      "src/entities/engine/api/events.ts",
      "src/entities/analysis/model/useEngineSeat.ts",
      "src/entities/analysis/model/provider.tsx",
    ],
  },
] as const;

describeOwnedSpellings(RULES);
