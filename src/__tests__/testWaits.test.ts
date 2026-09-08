import { describeOwnedSpellings } from "./ownedSpelling";

/**
 * 解析の待ちの寸法を縮める口を、テストの中に閉じる。
 *
 * `shortenWaits`（`src/entities/analysis/model/waits.ts`）は本番モジュールに置いた
 * 公開関数で、呼ぶと同期待ちの上限が 2000ms → 500ms に落ちる。**本番のどこかが
 * 呼ぶと、重い評価関数の初期化が必ず打ち切りに落ちる**——「エンジンが局面を
 * 受け取るのに時間が掛かっています」が出て、解析が始まらない。
 *
 * 寸法そのものを引く `waits()` は本番が呼んでよい（`provider.tsx` と
 * `useResultFlush.ts` が呼ぶ）。**縮める側だけを閉じる。**
 *
 * `waits.ts` の doc は「重い評価関数の初期化で足りなければ引き上げてよい」と書いており、
 * 引き上げに来た人がこの口の存在に気づく手掛かりは無い。人の注意ではなく綴りで止める。
 */
const RULES = [
  {
    name: "shortenWaits の綴り",
    pattern: /\bshortenWaits\b/,
    owners: ["src/entities/analysis/model/waits.ts"],
  },
] as const;

describeOwnedSpellings(RULES);
