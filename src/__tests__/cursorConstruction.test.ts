import { describeOwnedSpellings } from "./ownedSpelling";

/**
 * `KifuCursor` の材料を鋳造する綴りを、それを持つファイルの中に閉じる。
 *
 * 型を組む側は `KifuCursor` の brand が止める（`model/cursor.ts` 参照）。
 * ここが見るのは brand をすり抜ける綴りで、3種類ある。
 * **キャスト**、観測値を受け取らずに `KifuCursor` を組める `makeKifuCursor` の呼び出し、
 * そして**観測の欄（`tesuuPointer`）へ書く綴り**（スプレッドは brand ごと写るため）。
 *
 * 要求の鍵が `state.cursor.tesuuPointer`（観測の欄）に入ると、
 * `provider.tsx` の移動前後の比較が着けもしない局面の識別子で回り、
 * **盤が動かないのにエラーも出ない**。doc に書いても型でも止まらない種類の規約なので、
 * 綴りをここで止める。
 *
 * 山括弧キャスト（`<TesuuPointer>s`）は `erasableSyntaxOnly` が TS1294 で
 * 落とすので、ここでは見ない。
 *
 * **止められていない形が1つある。** `{ ...cursor, tesuu: cursor.tesuu + 1 }` のように
 * `tesuuPointer` を書かずにスプレッドだけで別の局面のカーソルを作ると、
 * 手数と識別子が食い違ったまま通る。綴りで見分けるには
 * 「カーソルのスプレッド」を名前で拾うしかなく、`previewCursor`（`CursorPath` なので
 * 無害）が現に引っ掛かる。名前に頼る規則を足すより、`cursorFromPlayer` を
 * 通していない `KifuCursor` は作らない、という規約で持たせている。
 */
const RULES = [
  {
    /**
     * 呼び出しだけを見ると `import { makeKifuCursor as mk }` で名前を変えられ、
     * 別名の `mk(...)` が素通りする。持ち出しの段階で止める。
     */
    name: "makeKifuCursor の綴り",
    pattern: /\bmakeKifuCursor\b/,
    owners: ["src/entities/kifu/model/cursor.ts", "src/entities/kifu/lib/playerCursor.ts"],
  },
  {
    name: "makeKifuCursor の呼び出し",
    /** 宣言行 `export function makeKifuCursor(` は呼び出しではないので数から外す */
    pattern: /(?<!function\s)\bmakeKifuCursor\s*\(/,
    /** 宣言は `model/cursor.ts` にあるが、**呼ぶ**のは `playerCursor.ts` だけ */
    owners: ["src/entities/kifu/lib/playerCursor.ts"],
  },
  {
    name: "TesuuPointer への as キャスト",
    pattern: /as TesuuPointer/,
    owners: ["src/entities/kifu/model/cursor.ts"],
  },
  {
    /**
     * `{ ...cursor, tesuuPointer: ... }` と `{ ...cursor, tesuu: ... }`。
     * スプレッドは brand ごと写すので型では止まらない。**欄に書く側**を見る。
     * 読み取り（`.tesuuPointer`）は `:` を伴わないので当たらない。
     */
    name: "tesuuPointer への書き込み",
    pattern: /tesuuPointer\s*:/,
    owners: ["src/entities/kifu/model/cursor.ts"],
  },
  {
    /** 二重キャストは brand を素通りする。`PlannedCursor` も同じ守り方に揃える */
    name: "カーソル型への as キャスト",
    pattern: /as (?:unknown as )?(?:KifuCursor|PlannedCursor)\b/,
    owners: ["src/entities/kifu/model/cursor.ts"],
  },
] as const;

describeOwnedSpellings(RULES);
